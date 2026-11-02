/**
 * Vision API Client for Chess FEN-tastic
 * Supports:
 * 1. Ollama Cloud (Gemma 4 Cloud via local Ollama client proxy)
 * 2. Google Gemini API (Cloud multimodal)
 * 3. Ollama Local (Self-hosted local models)
 */

import { CHESS_VISION_PROMPT, PROVIDERS } from "./constants.js";

/**
 * Strips data URL prefix from base64 string if present.
 */
export function cleanBase64(dataUrl) {
  if (dataUrl && dataUrl.includes(",")) {
    return dataUrl.split(",")[1];
  }
  return dataUrl || "";
}

/**
 * Checks status and authentication against Ollama Cloud (direct cloud API).
 * Does NOT require Ollama Desktop or a local daemon.
 * @param {string} apiKey
 * @param {string} hostUrl
 * @param {string} requiredModel
 * @returns {Promise<{ connected: boolean, authenticated: boolean, modelFound: boolean, models: string[] }>}
 */
export async function checkOllamaCloudStatus(apiKey, hostUrl = "https://ollama.com", requiredModel = "gemma4:31b") {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Please enter your Ollama Cloud API key to test the connection.");
  }

  const cleanUrl = hostUrl.replace(/\/+$/, "");
  let response;

  try {
    response = await fetch(`${cleanUrl}/api/tags`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to Ollama Cloud at ${cleanUrl}. Please check your network connection.`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Invalid Ollama Cloud API key (HTTP 401 Unauthorized). Please check your key at https://ollama.com/settings/keys."
      );
    }
    if (response.status === 429) {
      throw new Error("Ollama Cloud rate limit reached. Please wait a moment before trying again.");
    }
    throw new Error(`Ollama Cloud returned error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json().catch(() => ({ models: [] }));
  const models = (data.models || []).map((m) => m.name || m.model || "");
  const foundModelObj = (data.models || []).find(
    (m) =>
      (m.name || "").toLowerCase() === requiredModel.toLowerCase() ||
      (m.name || "").toLowerCase().startsWith(requiredModel.toLowerCase() + ":") ||
      (m.model || "").toLowerCase() === requiredModel.toLowerCase()
  );

  const modelFound = !!foundModelObj;

  if (!modelFound && requiredModel) {
    throw new Error(
      `Model '${requiredModel}' is not currently available on your Ollama Cloud account.`
    );
  }

  return { connected: true, authenticated: true, modelFound, models };
}

/**
 * Checks connectivity to a local Ollama server (for optional local inference).
 * @param {string} hostUrl
 * @param {string} requiredModel
 * @returns {Promise<{ connected: boolean, modelFound: boolean, models: string[], isCloud: boolean }>}
 */
export async function checkOllamaLocalStatus(hostUrl = "http://localhost:11434", requiredModel = "llama3.2-vision") {
  const cleanUrl = hostUrl.replace(/\/+$/, "");
  let response;

  try {
    response = await fetch(`${cleanUrl}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to local Ollama at ${cleanUrl}. Please ensure the Ollama desktop application is running.`
    );
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Ollama returned HTTP 403 Forbidden (CORS restriction). Ensure OLLAMA_ORIGINS="*" is set in your environment or restart Ollama.`
      );
    }
    throw new Error(`Local Ollama returned error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json().catch(() => ({ models: [] }));
  const models = (data.models || []).map((m) => m.name || m.model || "");
  const foundModelObj = (data.models || []).find(
    (m) =>
      (m.name || "").toLowerCase() === requiredModel.toLowerCase() ||
      (m.name || "").toLowerCase().startsWith(requiredModel.toLowerCase() + ":")
  );

  const modelFound = !!foundModelObj;
  const isCloud = !!(foundModelObj && (foundModelObj.remote_model || foundModelObj.remote_host));

  if (!modelFound && requiredModel) {
    throw new Error(
      `Local model '${requiredModel}' is not downloaded. Run 'ollama pull ${requiredModel}' in your terminal.`
    );
  }

  return { connected: true, modelFound, models, isCloud };
}

// Backwards compatibility alias for local check
export const checkOllamaStatus = checkOllamaLocalStatus;

/**
 * Calls Ollama Cloud direct API (https://ollama.com/api/chat).
 * Runs inference in the cloud without requiring local Ollama server or downloads.
 * @param {Object|string} options Options object or hostUrl for backwards compatibility
 * @param {string} [fallbackImage]
 * @param {string} [maybeKey]
 * @param {string} [maybeModel]
 * @returns {Promise<string>}
 */
export async function callOllamaCloudVision(options, fallbackImage, maybeKey, maybeModel) {
  let apiKey = "";
  let hostUrl = "https://ollama.com";
  let model = "gemma4:31b";
  let base64Image = "";

  if (typeof options === "object" && options !== null && !Array.isArray(options)) {
    apiKey = options.apiKey || options.ollamaApiKey || "";
    hostUrl = options.hostUrl || options.ollamaCloudUrl || "https://ollama.com";
    model = options.model || options.ollamaCloudModel || "gemma4:31b";
    base64Image = options.base64Image || "";
  } else {
    hostUrl = options || "https://ollama.com";
    base64Image = fallbackImage || "";
    apiKey = maybeKey || "";
    model = maybeModel || "gemma4:31b";
  }

  // Safety net: if key wasn't explicitly passed, retrieve it directly from chrome.storage.local
  if (!apiKey && typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get(["ollamaApiKey"]);
      if (stored && stored.ollamaApiKey) {
        apiKey = stored.ollamaApiKey.trim();
      }
    } catch (_) {}
  }

  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "Ollama Cloud API Key is required. Please set your API key in extension settings (available from https://ollama.com/settings/keys)."
    );
  }

  const url = `${hostUrl.replace(/\/+$/, "")}/api/chat`;
  const rawBase64 = cleanBase64(base64Image);

  const payload = {
    model: model,
    messages: [
      {
        role: "user",
        content: CHESS_VISION_PROMPT,
        images: [rawBase64],
      },
    ],
    options: {
      temperature: 0,
    },
    stream: false,
    think: false,
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to Ollama Cloud at ${url}. Please check your internet connection.`
    );
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errDetail = "";
    try {
      const parsed = JSON.parse(rawText);
      errDetail = parsed.error || "";
    } catch {
      errDetail = rawText.trim();
    }

    const lowerDetail = errDetail.toLowerCase();

    if (
      response.status === 401 ||
      lowerDetail.includes("unauthorized") ||
      lowerDetail.includes("auth")
    ) {
      throw new Error(
        "Invalid or expired Ollama Cloud API key. Please verify your key at https://ollama.com/settings/keys."
      );
    }

    if (response.status === 429) {
      throw new Error("Ollama Cloud rate limit exceeded. Please wait a moment before trying again.");
    }

    if (response.status === 404 || lowerDetail.includes("not found")) {
      throw new Error(
        `Ollama Cloud model '${model}' was not found. Please verify the model identifier in settings.`
      );
    }

    throw new Error(`Ollama Cloud Error (${model}): ${errDetail || `HTTP ${response.status} ${response.statusText}`}`);
  }

  const result = await response.json();
  const text = result.message?.content;

  if (!text) {
    throw new Error(`Ollama Cloud model '${model}' returned an empty response.`);
  }

  return text.trim();
}

/**
 * Calls Local Ollama Vision Endpoint with user-chosen local model.
 * @param {string} hostUrl
 * @param {string} model
 * @param {string} base64Image
 * @returns {Promise<string>}
 */
export async function callOllamaLocalVision(hostUrl = "http://localhost:11434", model = "llama3.2-vision", base64Image) {
  if (!model) {
    throw new Error("No local model specified. Please specify a vision model (e.g. llama3.2-vision, llava).");
  }

  const url = `${hostUrl.replace(/\/+$/, "")}/api/chat`;
  const rawBase64 = cleanBase64(base64Image);

  const payload = {
    model: model,
    messages: [
      {
        role: "user",
        content: CHESS_VISION_PROMPT,
        images: [rawBase64],
      },
    ],
    options: {
      temperature: 0,
    },
    stream: false,
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Cannot connect to local Ollama at ${url}. Ensure Ollama is running.`);
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errDetail = "";
    try {
      const parsed = JSON.parse(rawText);
      errDetail = parsed.error || "";
    } catch {
      errDetail = rawText.trim();
    }
    if (response.status === 403) {
      throw new Error(`Local Ollama returned HTTP 403 CORS Forbidden. Ensure OLLAMA_ORIGINS="*" is set.`);
    }
    throw new Error(`Local Ollama Error (${model}): ${errDetail || `HTTP ${response.status}`}`);
  }

  const result = await response.json();
  const text = result.message?.content;

  if (!text) {
    throw new Error(`Local model '${model}' returned an empty response.`);
  }

  return text.trim();
}

/**
 * Calls Google Gemini Flash Multimodal API.
 * @param {string} apiKey
 * @param {string} base64Image
 * @param {string} model
 * @returns {Promise<string>}
 */
export async function callGeminiVision(apiKey, base64Image, model = "gemini-2.5-flash") {
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please set your key in extension settings.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const rawBase64 = cleanBase64(base64Image);

  const payload = {
    contents: [
      {
        parts: [
          { text: CHESS_VISION_PROMPT },
          {
            inline_data: {
              mime_type: "image/png",
              data: rawBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Gemini API Error: ${message}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini API returned an empty response.");
  }

  return text.trim();
}

/**
 * Unified vision recognition dispatcher based on user settings.
 * Strict model enforcement: Never silently falls back to a different model.
 * @param {string} base64Image
 * @param {Object} settings
 * @returns {Promise<string>}
 */
export async function recognizeChessboard(base64Image, settings = {}) {
  const provider = settings.provider || PROVIDERS.OLLAMA_CLOUD;

  if (provider === PROVIDERS.OLLAMA_CLOUD || provider === "ollama") {
    return callOllamaCloudVision({
      apiKey: settings.ollamaApiKey,
      hostUrl: settings.ollamaCloudUrl || "https://ollama.com",
      model: settings.ollamaCloudModel || "gemma4:31b",
      base64Image,
    });
  }

  if (provider === PROVIDERS.OLLAMA_LOCAL) {
    return callOllamaLocalVision(
      settings.ollamaLocalUrl || settings.ollamaUrl || "http://localhost:11434",
      settings.ollamaLocalModel || "llama3.2-vision",
      base64Image
    );
  }

  if (provider === PROVIDERS.GEMINI) {
    return callGeminiVision(
      settings.geminiApiKey,
      base64Image,
      settings.geminiModel || "gemini-2.5-flash"
    );
  }

  throw new Error(`Unknown vision provider '${provider}'. Please check extension settings.`);
}
