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
import { runHybridRecognition } from "../lib/hybrid-recognizer.js";
import { getSettings } from "../lib/settings-storage.js";
import {
  isRestrictedUrl,
  RESTRICTED_PAGE_MESSAGE,
  DEFAULT_SETTINGS,
  VERIFICATION_STATUS,
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

  // Margin for algebraic coordinate anchors (files a-h, ranks 8-1)
  // This provides clear spatial anchors for multimodal vision models (e.g. Gemma 4 Cloud)
  // and eliminates the 1-file horizontal displacement bug on unannotated chessboards.
  const margin = Math.max(20, Math.round(Math.min(safeW, safeH) * 0.06));
  const totalW = safeW + margin * 2;
  const totalH = safeH + margin * 2;

  const offscreen = new OffscreenCanvas(totalW, totalH);
  const ctx = offscreen.getContext("2d");

  // Fill outer border background
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw the cropped chessboard in the center
  ctx.drawImage(
    imageBitmap,
    safeX,
    safeY,
    safeW,
    safeH,
    margin,
    margin,
    safeW,
    safeH
  );

  // Draw coordinate labels along margins
  const sqW = safeW / 8;
  const sqH = safeH / 8;
  const fontSize = Math.max(12, Math.round(margin * 0.65));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = "#1f2937";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const files = "abcdefgh";
  for (let i = 0; i < 8; i++) {
    const x = margin + i * sqW + sqW / 2;
    // Top file label
    ctx.fillText(files[i], x, margin / 2);
    // Bottom file label
    ctx.fillText(files[i], x, totalH - margin / 2);
  }

  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  for (let j = 0; j < 8; j++) {
    const y = margin + j * sqH + sqH / 2;
    // Left rank label
    ctx.fillText(ranks[j].toString(), margin / 2, y);
    // Right rank label
    ctx.fillText(ranks[j].toString(), totalW - margin / 2, y);
  }

  // Extract pixel buffer of unannotated chessboard for square-level computer vision analysis
  const boardImageData = ctx.getImageData(margin, margin, safeW, safeH);

  const croppedBlob = await offscreen.convertToBlob({ type: "image/png" });
  const buffer = await croppedBlob.arrayBuffer();
  const annotatedDataUrl = arrayBufferToDataUrl(buffer, "image/png");

  return {
    annotatedDataUrl,
    rawPixelBuffer: {
      data: boardImageData.data,
      width: boardImageData.width,
      height: boardImageData.height,
    },
  };
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

  // Clear previous result so stale FEN or VERIFIED status is never displayed on failure
  await chrome.storage.local.set({
    lastStatus: { state: "processing", message: "Cropping chessboard image..." },
    lastResult: null,
    lastCroppedImage: null,
  });

  try {
    // 1. Crop image and obtain unannotated board pixel buffer
    const { annotatedDataUrl, rawPixelBuffer } = await cropScreenshot(pendingScreenshot, box);
    pendingScreenshot = null; // Clear cached full screenshot

    // 2. Fetch latest user settings from chrome.storage.local using settings-storage
    const settings = await getSettings();

    const providerLabel =
      settings.provider === "gemini"
        ? `Google Gemini (${settings.geminiModel || "gemini-2.5-flash"})`
        : settings.provider === "ollama_local"
        ? `Local Ollama (${settings.ollamaLocalModel || "llama3.2-vision"})`
        : `Ollama Cloud (${settings.ollamaCloudModel || "gemma4:31b"})`;

    await chrome.storage.local.set({
      lastStatus: { state: "processing", message: `Analyzing board using ${providerLabel}...` },
      lastCroppedImage: annotatedDataUrl,
    });

    // 3. Run Hybrid Recognition (Stage 1-6)
    const result = await runHybridRecognition(annotatedDataUrl, settings, {
      pixelBuffer: rawPixelBuffer,
    });

    const finalResult = {
      ...result,
      timestamp: Date.now(),
    };

    const statusState = result.status === VERIFICATION_STATUS.INVALID ? "error" : "success";

    await chrome.storage.local.set({
      lastStatus: { state: statusState, message: result.statusMessage },
      lastResult: finalResult,
    });

    // Set action badge to indicate verification status
    if (chrome.action?.setBadgeText) {
      if (result.status === VERIFICATION_STATUS.VERIFIED) {
        chrome.action.setBadgeText({ text: "✓" });
        chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
      } else if (result.status === VERIFICATION_STATUS.NEEDS_REVIEW) {
        chrome.action.setBadgeText({ text: "?" });
        chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
      } else {
        chrome.action.setBadgeText({ text: "!" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      }
    }

    // 4. Optional auto-open in Lichess
    if (result.isValid && result.status === VERIFICATION_STATUS.VERIFIED && settings.autoOpenLichess) {
      chrome.tabs.create({ url: result.urls.lichess });
    }

    return finalResult;
  } catch (error) {
    console.error("Recognition processing error:", error);
    await chrome.storage.local.set({
      lastStatus: { state: "error", message: error.message || "Recognition failed." },
      lastResult: null,
      lastCroppedImage: null,
    });
    if (chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    }
    throw error;
  }
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
          lastResult: null,
          lastCroppedImage: null,
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
