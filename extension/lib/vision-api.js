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
 * Checks connectivity to an Ollama server and verifies if a specific model is registered.
 * @param {string} hostUrl
 * @param {string} requiredModel
 * @returns {Promise<{ connected: boolean, modelFound: boolean, models: string[], isCloud: boolean }>}
 */
export async function checkOllamaStatus(hostUrl = "http://localhost:11434", requiredModel = "gemma4:cloud") {
  const cleanUrl = hostUrl.replace(/\/+$/, "");
  let response;

  try {
    response = await fetch(`${cleanUrl}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to Ollama at ${cleanUrl}. Please ensure the Ollama desktop application is running (it handles the connection to Ollama Cloud).`
    );
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Ollama returned HTTP 403 Forbidden (CORS restriction). Ensure OLLAMA_ORIGINS="*" is set in your environment or restart Ollama.`
      );
    }
    throw new Error(`Ollama returned error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json().catch(() => ({ models: [] }));
  const models = (data.models || []).map((m) => m.name || m.model || "");
  const foundModelObj = (data.models || []).find(
    (m) => (m.name || "").toLowerCase() === requiredModel.toLowerCase() ||
           (m.name || "").toLowerCase().startsWith(requiredModel.toLowerCase() + ":")
  );

  const modelFound = !!foundModelObj;
  const isCloud = !!(foundModelObj && (foundModelObj.remote_model || foundModelObj.remote_host));

  if (!modelFound && requiredModel) {
    throw new Error(
      `Model '${requiredModel}' is not registered in your Ollama client. Run 'ollama run ${requiredModel}' once in your terminal to register it for cloud inference (no local weights will be downloaded).`
    );
  }

  return { connected: true, modelFound, models, isCloud };
}

/**
 * Calls Ollama Cloud using gemma4:cloud.
 * The local Ollama client acts as the gateway while inference runs in Ollama Cloud.
 * @param {string} hostUrl
 * @param {string} base64Image
 * @returns {Promise<string>}
 */
export async function callOllamaCloudVision(hostUrl = "http://localhost:11434", base64Image) {
  const model = "gemma4:cloud";
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to Ollama at ${url}. Ensure the Ollama desktop application is running.`
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

    // Check for true Ollama Cloud authentication failure
    if (
      response.status === 401 ||
      lowerDetail.includes("unauthorized") ||
      lowerDetail.includes("login") ||
      lowerDetail.includes("sign in") ||
      lowerDetail.includes("auth")
    ) {
      throw new Error(
        "Ollama Cloud authentication required. Please sign in to Ollama by running 'ollama login' in terminal or via the Ollama desktop app."
      );
    }

    // Check for CORS 403 block from Ollama's local server (empty or Forbidden body with 403)
    if (response.status === 403) {
      throw new Error(
        `Ollama local server blocked extension access (HTTP 403 CORS Forbidden). Ensure OLLAMA_ORIGINS="*" is set in your environment or restart Ollama.`
      );
    }

    if (lowerDetail.includes("not found") || lowerDetail.includes("pull")) {
      throw new Error(
        `Ollama Cloud model 'gemma4:cloud' is not available. Run 'ollama run gemma4:cloud' once in your terminal to enable cloud access.`
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
    // Strictly invoke gemma4:cloud via Ollama Cloud
    return callOllamaCloudVision(
      settings.ollamaCloudUrl || settings.ollamaUrl || "http://localhost:11434",
      base64Image
    );
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
