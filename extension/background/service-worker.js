/**
 * Background Service Worker for Chess FEN-tastic (Manifest V3)
 * Handles tab capture, image cropping, vision API calls, and FEN generation.
 */

import {
  parseBoard,
  generateFen,
  validateFen,
  getBoardUrls,
} from "../lib/fen.js";
import { recognizeChessboard } from "../lib/vision-api.js";
import {
  isRestrictedUrl,
  RESTRICTED_PAGE_MESSAGE,
  DEFAULT_SETTINGS,
} from "../lib/constants.js";

let pendingScreenshot = null;

/**
 * Configure declarativeNetRequest dynamic rules to rewrite Origin header on Ollama requests.
 * Ollama rejects 'chrome-extension://' by default via its CORS middleware.
 * Rewriting Origin to the localhost origin allows seamless communication.
 */
const OLLAMA_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Origin",
          operation: "set",
          value: "http://localhost:11434",
        },
      ],
    },
    condition: {
      urlFilter: "||localhost:11434/*",
      resourceTypes: ["xmlhttprequest"],
    },
  },
  {
    id: 2,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Origin",
          operation: "set",
          value: "http://127.0.0.1:11434",
        },
      ],
    },
    condition: {
      urlFilter: "||127.0.0.1:11434/*",
      resourceTypes: ["xmlhttprequest"],
    },
  },
];

async function setupDeclarativeNetRules() {
  if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1, 2],
        addRules: OLLAMA_RULES,
      });
      console.log("DeclarativeNetRequest rules registered for Ollama requests.");
    } catch (err) {
      console.warn("Could not register declarativeNetRequest rules:", err);
    }
  }
}

// Register dynamic rules at service worker startup and installation
if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled?.addListener(setupDeclarativeNetRules);
  chrome.runtime.onStartup?.addListener(setupDeclarativeNetRules);
}
setupDeclarativeNetRules();

/**
 * Converts an ArrayBuffer to a base64 Data URL safely without FileReader.
 * (FileReader can fail or be unavailable in Service Worker contexts).
 * @param {ArrayBuffer} buffer
 * @param {string} mimeType
 * @returns {string}
 */
function arrayBufferToDataUrl(buffer, mimeType = "image/png") {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len))
    );
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Crops a data URL image to the given bounding box using OffscreenCanvas.
 * Safely clamps coordinates within imageBitmap boundaries.
 * @param {string} fullDataUrl
 * @param {{ x: number, y: number, width: number, height: number, dpr: number }} box
 * @returns {Promise<string>} cropped PNG base64 data URL
 */
async function cropScreenshot(fullDataUrl, box) {
  const response = await fetch(fullDataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  const dpr = box.dpr || 1;
  const naturalX = Math.round(box.x * dpr);
  const naturalY = Math.round(box.y * dpr);
  const naturalW = Math.round(box.width * dpr);
  const naturalH = Math.round(box.height * dpr);

  // Bounds clamping to avoid invalid dimensions or out-of-bounds rendering
  const safeX = Math.max(0, Math.min(naturalX, imageBitmap.width - 1));
  const safeY = Math.max(0, Math.min(naturalY, imageBitmap.height - 1));
  const safeW = Math.max(1, Math.min(naturalW, imageBitmap.width - safeX));
  const safeH = Math.max(1, Math.min(naturalH, imageBitmap.height - safeY));

  const offscreen = new OffscreenCanvas(safeW, safeH);
  const ctx = offscreen.getContext("2d");

  ctx.drawImage(
    imageBitmap,
    safeX,
    safeY,
    safeW,
    safeH,
    0,
    0,
    safeW,
    safeH
  );

  const croppedBlob = await offscreen.convertToBlob({ type: "image/png" });
  const buffer = await croppedBlob.arrayBuffer();
  return arrayBufferToDataUrl(buffer, "image/png");
}

/**
 * Initiates the capture and snipping workflow on the active tab.
 * Pre-checks for restricted browser URLs to avoid silent permission errors.
 * @param {chrome.tabs.Tab} targetTab
 * @returns {Promise<{ status: string, message?: string }>}
 */
async function initiateCapture(targetTab) {
  let tab = targetTab;
  if (!tab || !tab.url) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }

  if (!tab || !tab.id) {
    const msg = "No active browser tab found to capture.";
    await chrome.storage.local.set({ lastStatus: { state: "error", message: msg } });
    return { status: "error", message: msg };
  }

  // Pre-detect restricted browser pages (chrome://, extension settings, chrome webstore)
  if (isRestrictedUrl(tab.url)) {
    console.warn("Attempted capture on restricted URL:", tab.url);
    await chrome.storage.local.set({
      lastStatus: {
        state: "error",
        message: RESTRICTED_PAGE_MESSAGE,
      },
    });
    return { status: "error", message: RESTRICTED_PAGE_MESSAGE };
  }

  try {
    // 1. Capture the visible viewport of the active tab
    pendingScreenshot = await chrome.tabs.captureVisibleTab(tab.windowId || null, { format: "png" });

    // 2. Inject CSS and content script overlay
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/crop-overlay.css"],
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/crop-overlay.js"],
    });

    await chrome.storage.local.set({
      lastStatus: { state: "idle", message: "Drag mouse over chessboard to select position." },
    });
    return { status: "initiated" };
  } catch (error) {
    console.error("Failed to initiate capture:", error);
    const userMsg = isRestrictedUrl(tab.url) || error.message?.includes("chrome://")
      ? RESTRICTED_PAGE_MESSAGE
      : `Capture failed: ${error.message || "Ensure you are on an active webpage."}`;

    await chrome.storage.local.set({
      lastStatus: { state: "error", message: userMsg },
    });
    return { status: "error", message: userMsg };
  }
}

/**
 * Processes a cropped screenshot: runs vision recognition, FEN generation, and validation.
 */
async function processCroppedArea(box) {
  if (!pendingScreenshot) {
    throw new Error("No pending screenshot found to crop. Please try capturing again.");
  }

  await chrome.storage.local.set({
    lastStatus: { state: "processing", message: "Cropping chessboard image..." },
  });

  // 1. Crop image
  const croppedDataUrl = await cropScreenshot(pendingScreenshot, box);
  pendingScreenshot = null; // Clear cached full screenshot

  // 2. Fetch user settings (defaulting to Ollama Cloud / gemma4:cloud)
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  const providerLabel =
    settings.provider === "gemini"
      ? "Google Gemini API"
      : settings.provider === "ollama_local"
      ? `Local Ollama (${settings.ollamaLocalModel})`
      : "Ollama Cloud (gemma4:cloud)";

  await chrome.storage.local.set({
    lastStatus: { state: "processing", message: `Analyzing board using ${providerLabel}...` },
    lastCroppedImage: croppedDataUrl,
  });

  // 3. Vision Recognition (Strictly routes to chosen provider)
  const visionOutput = await recognizeChessboard(croppedDataUrl, settings);

  await chrome.storage.local.set({
    lastStatus: { state: "processing", message: "Parsing coordinates & generating FEN..." },
    lastVisionOutput: visionOutput,
  });

  // 4. Parse 64 squares
  const { board, turn, error: parseError } = parseBoard(visionOutput);
  if (parseError || !board) {
    throw new Error(parseError || "Failed to parse 64 chess squares from model output.");
  }

  // 5. Generate and Validate FEN
  const fen = generateFen(board, turn);
  if (!fen) {
    throw new Error("Could not construct FEN notation from parsed board.");
  }

  const isValid = validateFen(fen);
  const urls = getBoardUrls(fen);

  const finalResult = {
    fen,
    isValid,
    urls,
    turn,
    timestamp: Date.now(),
  };

  await chrome.storage.local.set({
    lastStatus: { state: "success", message: "FEN successfully generated!" },
    lastResult: finalResult,
  });

  // Set action badge to indicate completion
  if (chrome.action?.setBadgeText) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  }

  // 6. Optional auto-open in Lichess
  if (isValid && settings.autoOpenLichess) {
    chrome.tabs.create({ url: urls.lichess });
  }

  return finalResult;
}

// Keyboard shortcuts (commands)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "capture-board") {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await initiateCapture(activeTab);
    }
  }
});

// Runtime messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRIGGER_CAPTURE") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      initiateCapture(tab).then((res) => sendResponse(res));
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === "CROP_SELECTED") {
    processCroppedArea(message.box)
      .then((result) => sendResponse({ status: "success", result }))
      .catch((error) => {
        console.error("Processing error:", error);
        chrome.storage.local.set({
          lastStatus: { state: "error", message: error.message || "Recognition failed." },
        });
        if (chrome.action?.setBadgeText) {
          chrome.action.setBadgeText({ text: "!" });
          chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        }
        sendResponse({ status: "error", message: error.message });
      });
    return true;
  }

  if (message.type === "CROP_CANCELLED") {
    pendingScreenshot = null;
    chrome.storage.local.set({
      lastStatus: { state: "idle", message: "Capture cancelled." },
    });
    sendResponse({ status: "cancelled" });
  }
});
