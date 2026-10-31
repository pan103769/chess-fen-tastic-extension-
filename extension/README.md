# ♟️ Chess FEN-tastic Chrome Extension (Manifest V3)

> **Turn any 2D chess position on the web into a playable digital board on Lichess or Chess.com in seconds.**

Inspired by the original Chess FEN-tastic desktop reference application, this Chrome Extension brings instant visual chessboard recognition directly into your browser with Chrome Extension Manifest V3.

---

## 🚀 Key Features

* **Instant In-Browser Snipping:** Press `Alt+Shift+C` (or click the extension icon) and drag a box around any chessboard on any website (YouTube videos, chess blogs, puzzle pages, PDFs, images).
* **Restricted Page Safety:** Proactively identifies internal browser tabs (`chrome://`, extension settings, or Chrome Web Store) and clearly guides you to ordinary webpages without throwing confusing errors.
* **Vision AI Backends:**
  * **Ollama Cloud (Gemma 4 Cloud - Default):** Connects to your local Ollama client which acts as the gateway to Ollama Cloud. The `gemma4:cloud` model executes in the cloud, so you do **not** need to download massive model weights locally.
  * **Google Gemini API (Cloud API):** High-speed cloud vision via Google's Gemini Flash multimodal models.
  * **Ollama Local (Self-Hosted):** For users who have downloaded a local vision model (e.g. `llama3.2-vision`) to run 100% offline.
* **Deterministic FEN Generation:** Client-side, exact coordinate parsing (`a8` through `h1`) and empty-square compression.
* **One-Click Play & Export:**
  * Open directly in **Lichess Editor & Analysis**.
  * Open directly in **Chess.com Analysis**.
  * Instant **Copy FEN** to clipboard.
* **Manifest V3 Compliant:** Built using modern Chrome Extension standards (Service Workers, declarative commands, scoped permissions).

---

## 📦 How to Install (Developer Mode)

1. Open Google Chrome (or any Chromium browser like Brave or Edge).
2. Navigate to `chrome://extensions`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left.
5. Select the `extension/` folder inside this repository:
   ```
   c:\Users\user\Desktop\chess-fentastic extension\extension
   ```
6. The **Chess FEN-tastic** extension will appear in your extension bar! Pin it for quick access.

---

## ⚙️ Vision AI Provider Configuration

1. Click the Chess FEN-tastic icon in the toolbar, then click the **Settings (⚙️)** button (or right-click the extension icon and select **Options**).
2. Select your preferred provider:
   * **Ollama Cloud (Gemma 4 Cloud - Recommended):**
     * Ensure your Ollama desktop app is running (`http://localhost:11434`).
     * Model is set to `gemma4:cloud`. The local Ollama app acts as the client, and model inference executes in Ollama Cloud.
     * Click **Test Ollama Cloud Connection** to verify readiness.
   * **Google Gemini API:**
     * Enter your Gemini API key (get a free key from [Google AI Studio](https://aistudio.google.com/app/apikey)).
     * Model: `gemini-2.5-flash` (recommended).
   * **Ollama Local:**
     * Enter your local Ollama URL (`http://localhost:11434`) and local vision model name (e.g. `llama3.2-vision`).
3. (Optional) Check **Automatically open board in Lichess** for instant 1-click play.
4. Click **Save Settings**.

---

## 🎮 How to Use

1. Navigate to any ordinary webpage showing a chessboard (e.g. Lichess, Chess.com, YouTube video, puzzle diagram).
   *(Note: Browser security forbids capturing internal pages like `chrome://extensions` or Chrome Web Store).*
2. Press **`Alt+Shift+C`** (or click **Capture Chessboard** in the extension popup).
3. Drag your mouse over the chessboard to select it.
4. Release the mouse. The extension will automatically:
   - Crop the chessboard.
   - Run Vision AI (`gemma4:cloud` via Ollama Cloud or Gemini) to classify all 64 squares and side to move.
   - Generate standard FEN notation.
   - Validate the position.
5. Click **Lichess** or **Chess.com** to analyze and play the position immediately!

---

## 🧪 Automated Tests

Run all unit and integration tests:

```bash
# Test FEN parsing and generation algorithms
node extension/tests/test_fen.js

# Test Vision API clients, Ollama Cloud gemma4:cloud integration, and restricted URL detection
node extension/tests/test_vision_and_capture.js
```
