/**
 * Popup Script for Chess FEN-tastic
 * Features:
 * - Proactive restricted-page checking
 * - Verification status display (VERIFIED, NEEDS_REVIEW, INVALID)
 * - Interactive 8x8 chessboard preview
 * - 1-click square editor to inspect and adjust any piece
 * - Real-time FEN recalculation, chess legality re-validation, and Lichess/Chess.com URL updates
 */

import {
  isRestrictedUrl,
  RESTRICTED_PAGE_MESSAGE,
  FILES,
  RANKS,
  PIECE_TO_UNICODE,
  VERIFICATION_STATUS,
} from "../lib/constants.js";
import { validateChessLegality, generateSafeFen } from "../lib/chess-validator.js";
import { getBoardUrls, validateFen } from "../lib/fen.js";

document.addEventListener("DOMContentLoaded", async () => {
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
  const verificationBadge = document.getElementById("verificationBadge");
  const verificationMsg = document.getElementById("verificationMsg");

  const fenOutput = document.getElementById("fenOutput");
  const copyFenBtn = document.getElementById("copyFenBtn");
  const openLichessBtn = document.getElementById("openLichessBtn");
  const openChessComBtn = document.getElementById("openChessComBtn");

  const boardPreviewSection = document.getElementById("boardPreviewSection");
  const chessBoardGrid = document.getElementById("chessBoardGrid");
  const confidenceLabel = document.getElementById("confidenceLabel");

  const piecePickerPopover = document.getElementById("piecePickerPopover");
  const pickerSquareName = document.getElementById("pickerSquareName");
  const closePickerBtn = document.getElementById("closePickerBtn");

  const previewWrapper = document.getElementById("previewWrapper");
  const previewImage = document.getElementById("previewImage");

  let currentResult = null;
  let activeSelectedSquare = null;

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

  function renderInteractiveBoard(board, flaggedSquares = []) {
    if (!chessBoardGrid || !board) return;
    chessBoardGrid.innerHTML = "";

    for (let rIdx = 0; rIdx < 8; rIdx++) {
      const rank = RANKS[rIdx];
      for (let fIdx = 0; fIdx < 8; fIdx++) {
        const file = FILES[fIdx];
        const square = `${file}${rank}`;
        const piece = board[square] || "empty";

        const squareEl = document.createElement("div");
        const isLight = (fIdx + rIdx) % 2 === 0;
        squareEl.className = `board-square ${isLight ? "light" : "dark"}`;
        squareEl.dataset.square = square;
        squareEl.title = `${square}: ${piece.replace("_", " ")}`;

        if (flaggedSquares.includes(square)) {
          squareEl.classList.add("flagged");
        }
        if (square === activeSelectedSquare) {
          squareEl.classList.add("selected");
        }

        if (piece !== "empty" && PIECE_TO_UNICODE[piece]) {
          const pieceSpan = document.createElement("span");
          const isWhite = piece.startsWith("white_");
          pieceSpan.className = `piece-char ${isWhite ? "white-piece" : "black-piece"}`;
          pieceSpan.textContent = PIECE_TO_UNICODE[piece];
          squareEl.appendChild(pieceSpan);
        }

        squareEl.addEventListener("click", () => {
          openPiecePicker(square);
        });

        chessBoardGrid.appendChild(squareEl);
      }
    }
  }

  function openPiecePicker(square) {
    activeSelectedSquare = square;
    pickerSquareName.textContent = `Edit Square ${square.toUpperCase()}`;
    piecePickerPopover.style.display = "flex";

    // Highlight active square
    document.querySelectorAll(".board-square").forEach((sq) => {
      sq.classList.toggle("selected", sq.dataset.square === square);
    });
  }

  function closePiecePicker() {
    activeSelectedSquare = null;
    piecePickerPopover.style.display = "none";
    document.querySelectorAll(".board-square").forEach((sq) => {
      sq.classList.remove("selected");
    });
  }

  if (closePickerBtn) {
    closePickerBtn.addEventListener("click", closePiecePicker);
  }

  // Handle piece selection from picker popover
  document.querySelectorAll(".picker-piece").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!activeSelectedSquare || !currentResult || !currentResult.board) return;

      const chosenPiece = btn.dataset.piece;
      const targetSquare = activeSelectedSquare;

      // Update piece on square
      currentResult.board[targetSquare] = chosenPiece;

      // Re-run validation and FEN construction
      const legality = validateChessLegality(currentResult.board, currentResult.turn || "white");
      const safeFen = generateSafeFen(currentResult.board, currentResult.turn || "white");
      const isFormatValid = validateFen(safeFen);

      currentResult.fen = safeFen;
      currentResult.isValid = legality.isValid && isFormatValid;
      currentResult.legalityErrors = legality.errors;
      currentResult.urls = getBoardUrls(safeFen);

      // Remove square from flagged list once manually adjusted
      if (currentResult.flaggedSquares) {
        currentResult.flaggedSquares = currentResult.flaggedSquares.filter(
          (s) => s !== targetSquare
        );
      }

      if (legality.isValid) {
        currentResult.status =
          (currentResult.flaggedSquares || []).length === 0
            ? VERIFICATION_STATUS.VERIFIED
            : VERIFICATION_STATUS.NEEDS_REVIEW;
      } else {
        currentResult.status = VERIFICATION_STATUS.INVALID;
      }

      // Update UI
      displayResult(currentResult, previewImage.src);

      // Save to storage
      await chrome.storage.local.set({ lastResult: currentResult });

      closePiecePicker();
    });
  });

  function displayResult(result, croppedImage) {
    if (!result || !result.fen) {
      resultContainer.style.display = "none";
      return;
    }

    currentResult = result;
    resultContainer.style.display = "flex";
    fenOutput.value = result.fen;

    // FEN Validity badge
    if (result.isValid) {
      validBadge.className = "badge badge-success";
      validBadge.textContent = "VALID FEN";
    } else {
      validBadge.className = "badge badge-error";
      validBadge.textContent = "INVALID FEN";
    }

    // Verification Status badge
    const status = result.status || (result.isValid ? "VERIFIED" : "INVALID");
    if (status === VERIFICATION_STATUS.VERIFIED) {
      verificationBadge.className = "badge badge-verified";
      verificationBadge.textContent = "VERIFIED";
      verificationMsg.style.display = "none";
    } else if (status === VERIFICATION_STATUS.NEEDS_REVIEW) {
      verificationBadge.className = "badge badge-needs-review";
      verificationBadge.textContent = "NEEDS REVIEW";
      verificationMsg.className = "verification-msg has-warning";
      verificationMsg.textContent =
        result.statusMessage ||
        `Please check flagged square(s): ${(result.flaggedSquares || []).join(", ")}`;
      verificationMsg.style.display = "block";
    } else {
      verificationBadge.className = "badge badge-invalid";
      verificationBadge.textContent = "INVALID";
      verificationMsg.className = "verification-msg has-warning";
      verificationMsg.textContent =
        (result.legalityErrors && result.legalityErrors[0]) ||
        result.statusMessage ||
        "Position violates chess legality rules.";
      verificationMsg.style.display = "block";
    }

    // Confidence label
    if (confidenceLabel) {
      const confPercent = Math.round(
        (result.overallConfidence !== undefined ? result.overallConfidence : 0.98) * 100
      );
      confidenceLabel.textContent = `Confidence: ${confPercent}%`;
    }

    // Render interactive chessboard
    if (result.board) {
      boardPreviewSection.style.display = "flex";
      renderInteractiveBoard(result.board, result.flaggedSquares || []);
    } else {
      boardPreviewSection.style.display = "none";
    }

    // Screenshot preview
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

      if (isRestrictedUrl(tab.url)) {
        updateStatus("error", RESTRICTED_PAGE_MESSAGE);
        return;
      }

      updateStatus("processing", "Activating snipping overlay...");
      const response = await chrome.runtime.sendMessage({ type: "TRIGGER_CAPTURE" });

      if (response && response.status === "initiated") {
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
    if (currentResult && currentResult.urls && currentResult.urls.lichess) {
      chrome.tabs.create({ url: currentResult.urls.lichess });
    }
  });

  // Open Chess.com
  openChessComBtn.addEventListener("click", () => {
    if (currentResult && currentResult.urls && currentResult.urls.chessCom) {
      chrome.tabs.create({ url: currentResult.urls.chessCom });
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
