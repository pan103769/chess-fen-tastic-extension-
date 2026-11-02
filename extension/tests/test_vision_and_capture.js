/**
 * Automated Tests for Direct Ollama Cloud Vision API and Screenshot Capture Logic
 * Run with: node extension/tests/test_vision_and_capture.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isRestrictedUrl, RESTRICTED_PAGE_MESSAGE } from "../lib/constants.js";
import {
  checkOllamaCloudStatus,
  checkOllamaLocalStatus,
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

test("Clean base64 helper removes prefixes correctly", () => {
  assert.equal(cleanBase64("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="), "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(cleanBase64("iVBORw0KGgoAAAANSUhEUg=="), "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(cleanBase64(""), "");
});

test("Ollama Cloud: Requires API key and throws user-friendly message when missing", async () => {
  await assert.rejects(
    async () => {
      await callOllamaCloudVision({ apiKey: "", base64Image: "abc" });
    },
    (err) => {
      assert.ok(err.message.includes("Ollama Cloud API Key is required"));
      assert.ok(err.message.includes("ollama.com/settings/keys"));
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await checkOllamaCloudStatus("", "https://ollama.com", "gemma4:31b");
    },
    (err) => {
      assert.ok(err.message.includes("Please enter your Ollama Cloud API key"));
      return true;
    }
  );
});

test("Ollama Cloud: Status check verifies authentication and model availability", async () => {
  const originalFetch = globalThis.fetch;

  // Mock successful response from https://ollama.com/api/tags
  globalThis.fetch = async (url, options) => {
    assert.ok(url.includes("/api/tags"));
    assert.equal(options.headers.Authorization, "Bearer test_cloud_key");
    return new Response(
      JSON.stringify({
        models: [
          { name: "gemma4:31b", model: "gemma4:31b", capabilities: ["vision", "completion"] },
          { name: "mistral-large-4", model: "mistral-large-4" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const status = await checkOllamaCloudStatus("test_cloud_key", "https://ollama.com", "gemma4:31b");
  assert.equal(status.connected, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.modelFound, true);
  assert.ok(status.models.includes("gemma4:31b"));

  // Mock 401 Unauthorized
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    async () => {
      await checkOllamaCloudStatus("bad_key", "https://ollama.com", "gemma4:31b");
    },
    (err) => {
      assert.ok(err.message.includes("Invalid Ollama Cloud API key"));
      return true;
    }
  );

  globalThis.fetch = originalFetch;
});

test("Ollama Cloud: Image submission sends correct Cloud payload and Bearer header", async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload = null;
  let sentHeaders = null;
  let sentUrl = null;

  globalThis.fetch = async (url, options) => {
    sentUrl = url;
    sentHeaders = options.headers;
    sentPayload = JSON.parse(options.body);

    // Generate mock 64-square response
    const lines = [];
    const files = "abcdefgh";
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    for (const r of ranks) {
      for (const f of files) {
        lines.push(`${f}${r}: empty`);
      }
    }
    lines.push("side_to_move: white");

    return new Response(
      JSON.stringify({
        message: { content: lines.join("\n") },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const output = await callOllamaCloudVision({
    apiKey: "my_secret_cloud_key",
    hostUrl: "https://ollama.com",
    model: "gemma4:31b",
    base64Image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  });

  assert.equal(sentUrl, "https://ollama.com/api/chat");
  assert.equal(sentHeaders.Authorization, "Bearer my_secret_cloud_key");
  assert.equal(sentPayload.model, "gemma4:31b");
  assert.equal(sentPayload.stream, false);
  assert.equal(sentPayload.messages[0].images[0], "iVBORw0KGgoAAAANSUhEUg==");

  const { board, turn, error } = parseBoard(output);
  assert.equal(error, undefined);
  assert.equal(turn, "white");
  assert.equal(board.e4, "empty");

  const fen = generateFen(board, turn);
  assert.equal(validateFen(fen), true);

  globalThis.fetch = originalFetch;
});

test("Ollama Cloud: Error classification (401, 429, 404, network)", async () => {
  const originalFetch = globalThis.fetch;

  // 1. Rate limit (429)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "rate limit exceeded" }), { status: 429 });
  await assert.rejects(
    async () => {
      await callOllamaCloudVision({ apiKey: "key", base64Image: "abc" });
    },
    (err) => {
      assert.ok(err.message.includes("rate limit exceeded"));
      return true;
    }
  );

  // 2. Model not found (404)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 });
  await assert.rejects(
    async () => {
      await callOllamaCloudVision({ apiKey: "key", model: "non_existent_model", base64Image: "abc" });
    },
    (err) => {
      assert.ok(err.message.includes("was not found"));
      return true;
    }
  );

  globalThis.fetch = originalFetch;
});

test("Model enforcement: recognizeChessboard routes strictly to configured provider", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPayload = null;
  let requestedHeaders = null;

  globalThis.fetch = async (url, options) => {
    requestedHeaders = options.headers;
    requestedPayload = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        message: { content: "a8: empty\nside_to_move: white" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  // 1. Ollama Cloud provider strictly uses cloud endpoint, model gemma4:31b, and Bearer token
  await recognizeChessboard("dummy_base64", {
    provider: "ollama_cloud",
    ollamaApiKey: "test_key_123",
    ollamaCloudUrl: "https://ollama.com",
    ollamaCloudModel: "gemma4:31b",
  });
  assert.equal(requestedPayload.model, "gemma4:31b");
  assert.equal(requestedHeaders.Authorization, "Bearer test_key_123");

  // 2. Ollama Local provider strictly routes to local model
  await recognizeChessboard("dummy_base64", {
    provider: "ollama_local",
    ollamaLocalUrl: "http://localhost:11434",
    ollamaLocalModel: "llama3.2-vision",
  });
  assert.equal(requestedPayload.model, "llama3.2-vision");

  globalThis.fetch = originalFetch;
});

test("Local Ollama: Offline error reporting for optional local server", async () => {
  await assert.rejects(
    async () => {
      await checkOllamaLocalStatus("http://localhost:59999", "llama3.2-vision");
    },
    (err) => {
      assert.ok(err.message.includes("Cannot connect to local Ollama at http://localhost:59999"));
      assert.ok(err.message.includes("ensure the Ollama desktop application is running"));
      return true;
    }
  );
});
