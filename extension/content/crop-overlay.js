/**
 * Chess FEN-tastic Snipping / Crop Overlay Content Script
 * Allows user to drag-select any chessboard on the webpage.
 */

(function () {
  // Prevent duplicate overlays
  if (document.getElementById("chess-fentastic-overlay")) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "chess-fentastic-overlay";

  const banner = document.createElement("div");
  banner.id = "chess-fentastic-banner";
  banner.innerHTML = `♟️ Drag mouse to select the chessboard <span class="key-hint">ESC to cancel</span>`;
  overlay.appendChild(banner);

  const selection = document.createElement("div");
  selection.id = "chess-fentastic-selection";
  selection.style.display = "none";
  overlay.appendChild(selection);

  document.body.appendChild(overlay);

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  function onMouseDown(e) {
    if (e.button !== 0) return; // Left click only
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = "0px";
    selection.style.height = "0px";
    selection.style.display = "block";
  }

  function onMouseMove(e) {
    if (!isDragging) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;
  }

  function cleanup() {
    window.removeEventListener("keydown", onKeyDown, true);
    overlay.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    overlay.remove();
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    isDragging = false;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    cleanup();

    if (width > 20 && height > 20) {
      chrome.runtime.sendMessage({
        type: "CROP_SELECTED",
        box: {
          x: left,
          y: top,
          width: width,
          height: height,
          dpr: window.devicePixelRatio || 1,
        },
      });
    } else {
      chrome.runtime.sendMessage({ type: "CROP_CANCELLED", reason: "Selection too small" });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "CROP_CANCELLED", reason: "User pressed ESC" });
    }
  }

  overlay.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", onKeyDown, true);
})();

