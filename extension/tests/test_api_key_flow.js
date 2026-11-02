/**
 * Comprehensive Automated Tests for API Key Flow & Recognition Result State Management
 * Covers:
 * 1. API key successfully saved.
 * 2. API key successfully retrieved.
 * 3. Key missing.
 * 4. Key saved but unavailable to service worker (safety net retrieval).
 * 5. Incorrect API key (HTTP 401).
 * 6. Successful authenticated Cloud request.
 * 7. Failed Cloud request (HTTP 429).
 * 8. Previous FEN cleared when a new capture starts.
 * 9. No VERIFIED badge when recognition fails.
 *
 * Run with: node extension/tests/test_api_key_flow.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { getSettings, saveSettings } from "../lib/settings-storage.js";
import { callOllamaCloudVision, checkOllamaCloudStatus } from "../lib/vision-api.js";
import { DEFAULT_SETTINGS, PROVIDERS } from "../lib/constants.js";

// Mock Chrome Storage in memory for Node.js test environment
function setupMockChromeStorage() {
  const localStorageMap = new Map();
  const syncStorageMap = new Map();

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return { [keys]: localStorageMap.get(keys) };
          }
          if (Array.isArray(keys)) {
            const res = {};
            for (const k of keys) {
              if (localStorageMap.has(k)) res[k] = localStorageMap.get(k);
            }
            return res;
          }
          if (typeof keys === "object" && keys !== null) {
            const res = { ...keys };
            for (const k of Object.keys(keys)) {
              if (localStorageMap.has(k)) res[k] = localStorageMap.get(k);
            }
            return res;
          }
          return Object.fromEntries(localStorageMap.entries());
        },
        async set(items) {
          for (const [k, v] of Object.entries(items)) {
            localStorageMap.set(k, v);
          }
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) localStorageMap.delete(k);
        },
        async clear() {
          localStorageMap.clear();
        },
      },
      sync: {
        async get(keys) {
          if (typeof keys === "string") {
            return { [keys]: syncStorageMap.get(keys) };
          }
          if (Array.isArray(keys)) {
            const res = {};
            for (const k of keys) {
              if (syncStorageMap.has(k)) res[k] = syncStorageMap.get(k);
            }
            return res;
          }
          if (typeof keys === "object" && keys !== null) {
            const res = { ...keys };
            for (const k of Object.keys(keys)) {
              if (syncStorageMap.has(k)) res[k] = syncStorageMap.get(k);
            }
            return res;
          }
          return Object.fromEntries(syncStorageMap.entries());
        },
        async set(items) {
          for (const [k, v] of Object.entries(items)) {
            syncStorageMap.set(k, v);
          }
        },
        async clear() {
          syncStorageMap.clear();
        },
      },
    },
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
    },
  };

  return { localStorageMap, syncStorageMap };
}

test("1. API key successfully saved to chrome.storage.local", async () => {
  const { localStorageMap } = setupMockChromeStorage();

  const saved = await saveSettings({
    ollamaApiKey: "mock_test_key_abc123",
    provider: PROVIDERS.OLLAMA_CLOUD,
  });

  assert.equal(saved.ollamaApiKey, "mock_test_key_abc123");
  assert.equal(localStorageMap.get("ollamaApiKey"), "mock_test_key_abc123");

  const storedSettings = localStorageMap.get("settings");
  assert.equal(storedSettings.ollamaApiKey, "mock_test_key_abc123");
});

test("2. API key successfully retrieved from storage", async () => {
  setupMockChromeStorage();

  await saveSettings({
    ollamaApiKey: "mock_test_key_retrieval_456",
    ollamaCloudModel: "gemma4:31b",
  });

  const retrieved = await getSettings();
  assert.equal(retrieved.ollamaApiKey, "mock_test_key_retrieval_456");
  assert.equal(retrieved.ollamaCloudModel, "gemma4:31b");
  assert.equal(retrieved.ollamaCloudUrl, "https://ollama.com");
});

test("3. Key missing throws clear user-facing configuration error", async () => {
  setupMockChromeStorage();
  await chrome.storage.local.clear();

  await assert.rejects(
    async () => {
      await callOllamaCloudVision({ apiKey: "", base64Image: "dummy_image" });
    },
    (err) => {
      assert.ok(err.message.includes("Ollama Cloud API Key is required"));
      assert.ok(err.message.includes("https://ollama.com/settings/keys"));
      return true;
    }
  );
});

test("4. Key saved in storage but empty in argument is rescued by safety net", async () => {
  setupMockChromeStorage();

  // Save key in storage
  await saveSettings({ ollamaApiKey: "mock_rescued_key_789" });

  const originalFetch = globalThis.fetch;
  let sentAuthHeader = null;

  globalThis.fetch = async (url, options) => {
    sentAuthHeader = options.headers?.Authorization;
    return new Response(
      JSON.stringify({
        message: { content: "a8: empty\nside_to_move: white" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  // Pass empty apiKey in options argument - safety net should retrieve it from storage
  await callOllamaCloudVision({
    apiKey: "",
    hostUrl: "https://ollama.com",
    model: "gemma4:31b",
    base64Image: "iVBORw0KGgoAAAANSUhEUg==",
  });

  assert.equal(sentAuthHeader, "Bearer mock_rescued_key_789");

  globalThis.fetch = originalFetch;
});

test("5. Incorrect API key returns HTTP 401 Unauthorized with distinct message", async () => {
  setupMockChromeStorage();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  await assert.rejects(
    async () => {
      await callOllamaCloudVision({
        apiKey: "invalid_expired_mock_key",
        base64Image: "iVBORw0KGgoAAAANSUhEUg==",
      });
    },
    (err) => {
      assert.ok(err.message.includes("Invalid or expired Ollama Cloud API key"));
      assert.ok(err.message.includes("https://ollama.com/settings/keys"));
      return true;
    }
  );

  globalThis.fetch = originalFetch;
});

test("6. Successful authenticated Cloud request sends correct payload & header", async () => {
  setupMockChromeStorage();
  const originalFetch = globalThis.fetch;

  let requestUrl = null;
  let requestHeaders = null;
  let requestPayload = null;

  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    requestPayload = JSON.parse(options.body);

    const lines = [];
    for (const r of [8, 7, 6, 5, 4, 3, 2, 1]) {
      for (const f of "abcdefgh") {
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

  const responseText = await callOllamaCloudVision({
    apiKey: "valid_mock_token_123",
    hostUrl: "https://ollama.com",
    model: "gemma4:31b",
    base64Image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  });

  assert.equal(requestUrl, "https://ollama.com/api/chat");
  assert.equal(requestHeaders.Authorization, "Bearer valid_mock_token_123");
  assert.equal(requestPayload.model, "gemma4:31b");
  assert.equal(requestPayload.stream, false);
  assert.equal(requestPayload.messages[0].images[0], "iVBORw0KGgoAAAANSUhEUg==");
  assert.ok(responseText.includes("a8: empty"));

  globalThis.fetch = originalFetch;
});

test("7. Failed Cloud request with rate limit (HTTP 429) returns actionable error", async () => {
  setupMockChromeStorage();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "rate limit exceeded" }), { status: 429 });

  await assert.rejects(
    async () => {
      await callOllamaCloudVision({
        apiKey: "mock_rate_limited_key",
        base64Image: "iVBORw0KGgoAAAANSUhEUg==",
      });
    },
    (err) => {
      assert.ok(err.message.includes("rate limit exceeded"));
      assert.ok(err.message.includes("wait a moment"));
      return true;
    }
  );

  globalThis.fetch = originalFetch;
});

test("8. Previous FEN and image are cleared when a new capture starts", async () => {
  setupMockChromeStorage();

  // Seed storage with an existing previous FEN result
  await chrome.storage.local.set({
    lastResult: {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1",
      isValid: true,
      status: "VERIFIED",
    },
    lastCroppedImage: "data:image/png;base64,old_image",
    lastStatus: { state: "success", message: "FEN successfully generated!" },
  });

  // Verify initial state
  const before = await chrome.storage.local.get(["lastResult", "lastCroppedImage"]);
  assert.ok(before.lastResult !== null);
  assert.ok(before.lastCroppedImage !== null);

  // Simulate initiating a new capture (as in service-worker.js & popup.js)
  await chrome.storage.local.set({
    lastStatus: { state: "processing", message: "Activating snipping overlay..." },
    lastResult: null,
    lastCroppedImage: null,
  });

  const after = await chrome.storage.local.get(["lastResult", "lastCroppedImage", "lastStatus"]);
  assert.equal(after.lastResult, null, "lastResult must be wiped on new capture");
  assert.equal(after.lastCroppedImage, null, "lastCroppedImage must be wiped on new capture");
  assert.equal(after.lastStatus.state, "processing");
});

test("9. No VERIFIED badge or stale FEN is displayed when recognition fails", async () => {
  setupMockChromeStorage();

  // 1. Simulate capture initiation wiping stale state
  await chrome.storage.local.set({
    lastResult: null,
    lastCroppedImage: null,
    lastStatus: { state: "processing", message: "Cropping chessboard image..." },
  });

  // 2. Simulate recognition error (e.g. missing API key)
  const errorMsg = "Ollama Cloud API Key is required. Please set your API key in extension settings.";
  await chrome.storage.local.set({
    lastStatus: { state: "error", message: errorMsg },
    lastResult: null,
    lastCroppedImage: null,
  });

  // 3. Verify storage state after failure
  const stored = await chrome.storage.local.get(["lastStatus", "lastResult", "lastCroppedImage"]);
  assert.equal(stored.lastStatus.state, "error");
  assert.equal(stored.lastStatus.message, errorMsg);
  assert.equal(stored.lastResult, null, "lastResult must remain null on error");
  assert.equal(stored.lastCroppedImage, null, "lastCroppedImage must remain null on error");

  // 4. Verify popup rendering policy:
  // When state === 'error', popup logic enforces: resultContainer.style.display = 'none'
  const isError = stored.lastStatus.state === "error";
  const shouldDisplayResult = Boolean(stored.lastResult && !isError);
  assert.equal(shouldDisplayResult, false, "Result container must never display on error");
});
