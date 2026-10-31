/**
 * Popup Script for Chess FEN-tastic
 */

import { isRestrictedUrl, RESTRICTED_PAGE_MESSAGE } from "../lib/constants.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Clear any status badge on extension icon
  if (chrome.action?.setBadgeText) {
    chrome.action.setBadgeText({ text: "" });
  }

  const captureBtn = document.getElementById("captureBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const statusBox = document.getElementById("statusBox");
  const statusSpinner = document.getElementById("statusSpinner");
  const statusMessage = document.getElementById("statusMessage");

  const resultContainer = document.getElementById("resultContainer");
  const validBadge = document.getElementById("validBadge");
  const fenOutput = document.getElementById("fenOutput");
  const copyFenBtn = document.getElementById("copyFenBtn");
  const openLichessBtn = document.getElementById("openLichessBtn");
  const openChessComBtn = document.getElementById("openChessComBtn");
  const previewWrapper = document.getElementById("previewWrapper");
  const previewImage = document.getElementById("previewImage");

  let currentUrls = null;

  function updateStatus(state, message) {
    statusBox.className = "status-box";
    statusSpinner.style.display = "none";

    if (state === "processing") {
      statusBox.classList.add("status-processing");
      statusSpinner.style.display = "block";
    } else if (state === "error") {
      statusBox.classList.add("status-error");
    } else if (state === "success") {
      statusBox.classList.add("status-success");
    } else {
      statusBox.classList.add("status-idle");
    }

    statusMessage.textContent = message || "Ready";
  }

  function displayResult(result, croppedImage) {
    if (!result || !result.fen) {
      resultContainer.style.display = "none";
      return;
    }

    resultContainer.style.display = "flex";
    fenOutput.value = result.fen;
    currentUrls = result.urls;

    if (result.isValid) {
      validBadge.className = "badge badge-success";
      validBadge.textContent = "VALID FEN";
    } else {
      validBadge.className = "badge badge-error";
      validBadge.textContent = "INVALID FEN";
    }

    if (croppedImage) {
      previewImage.src = croppedImage;
      previewWrapper.style.display = "flex";
    } else {
      previewWrapper.style.display = "none";
    }
  }

  // Load existing state from storage
  const stored = await chrome.storage.local.get([
    "lastStatus",
    "lastResult",
    "lastCroppedImage",
  ]);

  if (stored.lastStatus) {
    updateStatus(stored.lastStatus.state, stored.lastStatus.message);
  }

  if (stored.lastResult) {
    displayResult(stored.lastResult, stored.lastCroppedImage);
  }

  // Trigger screen capture with proactive restricted-URL checking
  captureBtn.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        updateStatus("error", "No active browser tab found.");
        return;
      }

      // Check if current tab is a restricted browser internal page
      if (isRestrictedUrl(tab.url)) {
        updateStatus("error", RESTRICTED_PAGE_MESSAGE);
        // Do NOT close popup window so the user sees this clear explanation
        return;
      }

      updateStatus("processing", "Activating snipping overlay...");
      const response = await chrome.runtime.sendMessage({ type: "TRIGGER_CAPTURE" });

      if (response && response.status === "initiated") {
        // Close popup window only when overlay was successfully launched
        window.close();
      } else if (response && response.status === "error") {
        updateStatus("error", response.message || "Failed to activate capture.");
      }
    } catch (err) {
      updateStatus("error", err.message || "Failed to trigger capture.");
    }
  });

  // Open settings
  settingsBtn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options/options.html"));
    }
  });

  // Copy FEN to clipboard
  copyFenBtn.addEventListener("click", async () => {
    if (!fenOutput.value) return;
    try {
      await navigator.clipboard.writeText(fenOutput.value);
      copyFenBtn.textContent = "✅ Copied!";
      setTimeout(() => {
        copyFenBtn.textContent = "📋 Copy";
      }, 1500);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  });

  // Open Lichess
  openLichessBtn.addEventListener("click", () => {
    if (currentUrls && currentUrls.lichess) {
      chrome.tabs.create({ url: currentUrls.lichess });
    }
  });

  // Open Chess.com
  openChessComBtn.addEventListener("click", () => {
    if (currentUrls && currentUrls.chessCom) {
      chrome.tabs.create({ url: currentUrls.chessCom });
    }
  });

  // Listen for background updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.lastStatus) {
      const s = changes.lastStatus.newValue;
      updateStatus(s.state, s.message);
    }

    if (changes.lastResult) {
      chrome.storage.local.get(["lastCroppedImage"]).then((res) => {
        displayResult(changes.lastResult.newValue, res.lastCroppedImage);
      });
    }
  });
});
