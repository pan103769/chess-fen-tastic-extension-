/**
 * Automated Tests for Vision API and Screenshot Capture Logic
 * Run with: node extension/tests/test_vision_and_capture.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isRestrictedUrl, RESTRICTED_PAGE_MESSAGE } from "../lib/constants.js";
import {
  checkOllamaStatus,
  callOllamaCloudVision,
  cleanBase64,
  recognizeChessboard,
} from "../lib/vision-api.js";
import { parseBoard, generateFen, validateFen } from "../lib/fen.js";

test("Issue 2: Restricted Chrome URL detection", () => {
  // Restricted internal browser URLs
  assert.equal(isRestrictedUrl("chrome://extensions"), true);
  assert.equal(isRestrictedUrl("chrome://newtab"), true);
  assert.equal(isRestrictedUrl("chrome://settings"), true);
  assert.equal(isRestrictedUrl("chrome-extension://abcdefg/popup.html"), true);
  assert.equal(isRestrictedUrl("https://chromewebstore.google.com/detail/123"), true);
  assert.equal(isRestrictedUrl("https://chrome.google.com/webstore/detail/123"), true);
  assert.equal(isRestrictedUrl("edge://settings"), true);
  assert.equal(isRestrictedUrl("about:blank"), true);
  assert.equal(isRestrictedUrl("view-source:https://example.com"), true);
  assert.equal(isRestrictedUrl("devtools://devtools/bundled/inspector.html"), true);
  assert.equal(isRestrictedUrl(null), true);
  assert.equal(isRestrictedUrl(""), true);

  // Ordinary allowable websites
  assert.equal(isRestrictedUrl("https://lichess.org/editor"), false);
  assert.equal(isRestrictedUrl("https://www.chess.com/analysis"), false);
  assert.equal(isRestrictedUrl("https://www.youtube.com/watch?v=abc"), false);
  assert.equal(isRestrictedUrl("https://en.wikipedia.org/wiki/Rules_of_chess"), false);
  assert.equal(isRestrictedUrl("http://localhost:3000/chess.html"), false);
});

test("Issue 2: Helpful error message for restricted pages", () => {
  assert.ok(RESTRICTED_PAGE_MESSAGE.includes("chrome://"));
  assert.ok(RESTRICTED_PAGE_MESSAGE.includes("Chrome Web Store"));
  assert.ok(RESTRICTED_PAGE_MESSAGE.includes("ordinary webpage"));
});

test("Issue 1: Ollama Cloud Status check with live Ollama instance", async () => {
  const status = await checkOllamaStatus("http://localhost:11434", "gemma4:cloud");
  assert.equal(status.connected, true);
  assert.equal(status.modelFound, true);
  assert.equal(status.isCloud, true);
  assert.ok(status.models.some((m) => m.startsWith("gemma4:cloud")));
});

test("Issue 1: Ollama offline error reporting", async () => {
  await assert.rejects(
    async () => {
      // Non-existent port
      await checkOllamaStatus("http://localhost:59999", "gemma4:cloud");
    },
    (err) => {
      assert.ok(err.message.includes("Cannot connect to Ollama at http://localhost:59999"));
      assert.ok(err.message.toLowerCase().includes("ensure the ollama desktop application is running"));
      return true;
    }
  );
});

test("Issue 1: Model availability verification and instructions", async () => {
  await assert.rejects(
    async () => {
      await checkOllamaStatus("http://localhost:11434", "non_existent_special_model:cloud");
    },
    (err) => {
      assert.ok(err.message.includes("is not registered in your Ollama client"));
      assert.ok(err.message.includes("ollama run non_existent_special_model:cloud"));
      return true;
    }
  );
});

test("Issue 1: Non-chessboard image rejection handling", async () => {
  // 1x1 black image
  const blankPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const rawOutput = await callOllamaCloudVision("http://localhost:11434", blankPngBase64);
  const { board, error } = parseBoard(rawOutput);

  // Should cleanly detect missing squares error without crashing
  assert.equal(board, null);
  assert.ok(error && error.includes("Missing squares"));
});

test("Issue 1: Real Ollama Cloud gemma4:cloud image processing & valid FEN output", async () => {
  const fixturePath = path.resolve("extension/tests/fixtures/sample_board_b64.txt");
  assert.ok(fs.existsSync(fixturePath), "Fixture must exist");
  const boardB64 = fs.readFileSync(fixturePath, "utf-8").trim();

  const rawOutput = await callOllamaCloudVision("http://localhost:11434", boardB64);
  assert.ok(rawOutput.length > 50, "Ollama Cloud should return recognition output");

  const { board, turn, error } = parseBoard(rawOutput);
  assert.equal(error, undefined, `Recognition should succeed without error: ${error}`);
  assert.ok(board !== null, "Board object must be constructed");

  const fen = generateFen(board, turn);
  assert.ok(fen !== null, "FEN string must be generated");
  assert.equal(validateFen(fen), true, `Generated FEN '${fen}' should be valid`);
});

test("Clean base64 helper removes prefixes correctly", () => {
  assert.equal(cleanBase64("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="), "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(cleanBase64("iVBORw0KGgoAAAANSUhEUg=="), "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(cleanBase64(""), "");
});

test("Error classification: Distinguishes CORS 403 vs Cloud Auth 401/403", async () => {
  const originalFetch = globalThis.fetch;

  // Subtest 1: HTTP 403 with empty body (typical CORS rejection)
  globalThis.fetch = async () => new Response("", { status: 403, statusText: "Forbidden" });
  await assert.rejects(
    async () => {
      await callOllamaCloudVision("http://localhost:11434", "dummy_image");
    },
    (err) => {
      assert.ok(err.message.includes("HTTP 403 CORS Forbidden"));
      assert.ok(err.message.includes('OLLAMA_ORIGINS="*"'));
      assert.equal(err.message.includes("sign in to Ollama"), false);
      return true;
    }
  );

  // Subtest 2: HTTP 401 Unauthorized (real auth failure)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthorized: sign in required" }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    async () => {
      await callOllamaCloudVision("http://localhost:11434", "dummy_image");
    },
    (err) => {
      assert.ok(err.message.includes("Ollama Cloud authentication required"));
      assert.ok(err.message.includes("ollama login"));
      return true;
    }
  );

  // Subtest 3: HTTP 403 with auth error body
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "login required to access cloud model" }), {
    status: 403,
    statusText: "Forbidden",
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    async () => {
      await callOllamaCloudVision("http://localhost:11434", "dummy_image");
    },
    (err) => {
      assert.ok(err.message.includes("Ollama Cloud authentication required"));
      return true;
    }
  );

  // Restore fetch
  globalThis.fetch = originalFetch;
});

test("Model enforcement: recognizeChessboard routes strictly to configured provider", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPayload = null;

  globalThis.fetch = async (url, options) => {
    requestedPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      message: { content: "a8: empty\nside_to_move: white" }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  // 1. Ollama Cloud provider strictly uses gemma4:cloud
  await recognizeChessboard("dummy_base64", {
    provider: "ollama_cloud",
    ollamaCloudUrl: "http://localhost:11434",
  });
  assert.equal(requestedPayload.model, "gemma4:cloud");

  // 2. Ollama Local provider strictly uses specified local model
  await recognizeChessboard("dummy_base64", {
    provider: "ollama_local",
    ollamaLocalUrl: "http://localhost:11434",
    ollamaLocalModel: "llama3.2-vision",
  });
  assert.equal(requestedPayload.model, "llama3.2-vision");

  // Restore fetch
  globalThis.fetch = originalFetch;
});
