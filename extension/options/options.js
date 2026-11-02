/**
 * Options Page Controller for Chess FEN-tastic
 * Enforces immediate persistence of API key to chrome.storage.local
 */

import { PROVIDERS, DEFAULT_SETTINGS } from "../lib/constants.js";
import { checkOllamaCloudStatus, checkOllamaLocalStatus } from "../lib/vision-api.js";
import { getSettings, saveSettings } from "../lib/settings-storage.js";

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settingsForm");
  const providerRadios = document.getElementsByName("provider");

  const ollamaCloudSection = document.getElementById("ollamaCloudSection");
  const geminiSection = document.getElementById("geminiSection");
  const ollamaLocalSection = document.getElementById("ollamaLocalSection");

  // Inputs - Ollama Cloud
  const ollamaApiKeyInput = document.getElementById("ollamaApiKey");
  const toggleOllamaKeyBtn = document.getElementById("toggleOllamaKeyBtn");
  const ollamaCloudModelInput = document.getElementById("ollamaCloudModel");
  const ollamaCloudUrlInput = document.getElementById("ollamaCloudUrl");
  const testOllamaCloudBtn = document.getElementById("testOllamaCloudBtn");
  const ollamaCloudStatus = document.getElementById("ollamaCloudStatus");

  // Inputs - Gemini
  const geminiApiKeyInput = document.getElementById("geminiApiKey");
  const toggleKeyBtn = document.getElementById("toggleKeyBtn");
  const geminiModelSelect = document.getElementById("geminiModel");

  // Inputs - Ollama Local
  const ollamaLocalUrlInput = document.getElementById("ollamaLocalUrl");
  const ollamaLocalModelInput = document.getElementById("ollamaLocalModel");
  const testOllamaLocalBtn = document.getElementById("testOllamaLocalBtn");
  const ollamaLocalStatus = document.getElementById("ollamaLocalStatus");

  const autoOpenLichessCheckbox = document.getElementById("autoOpenLichess");
  const saveStatus = document.getElementById("saveStatus");

  function updateProviderVisibility(provider) {
    ollamaCloudSection.style.display = "none";
    geminiSection.style.display = "none";
    ollamaLocalSection.style.display = "none";

    if (provider === PROVIDERS.GEMINI) {
      geminiSection.style.display = "flex";
    } else if (provider === PROVIDERS.OLLAMA_LOCAL) {
      ollamaLocalSection.style.display = "flex";
    } else {
      // Default to Ollama Cloud
      ollamaCloudSection.style.display = "flex";
    }
  }

  // Toggle Ollama Cloud API key reveal
  if (toggleOllamaKeyBtn && ollamaApiKeyInput) {
    toggleOllamaKeyBtn.addEventListener("click", () => {
      if (ollamaApiKeyInput.type === "password") {
        ollamaApiKeyInput.type = "text";
        toggleOllamaKeyBtn.textContent = "Hide";
      } else {
        ollamaApiKeyInput.type = "password";
        toggleOllamaKeyBtn.textContent = "Show";
      }
    });
  }

  // Toggle Gemini API key reveal
  if (toggleKeyBtn && geminiApiKeyInput) {
    toggleKeyBtn.addEventListener("click", () => {
      if (geminiApiKeyInput.type === "password") {
        geminiApiKeyInput.type = "text";
        toggleKeyBtn.textContent = "Hide";
      } else {
        geminiApiKeyInput.type = "password";
        toggleKeyBtn.textContent = "Show";
      }
    });
  }

  // Auto-save API key immediately on input/change so the user never loses the entered key
  if (ollamaApiKeyInput) {
    ollamaApiKeyInput.addEventListener("input", async () => {
      const key = ollamaApiKeyInput.value.trim();
      await saveSettings({ ollamaApiKey: key });
    });
    ollamaApiKeyInput.addEventListener("change", async () => {
      const key = ollamaApiKeyInput.value.trim();
      await saveSettings({ ollamaApiKey: key });
    });
  }

  // Radio button change listener
  for (const radio of providerRadios) {
    radio.addEventListener("change", async (e) => {
      updateProviderVisibility(e.target.value);
      await saveSettings({ provider: e.target.value });
    });
  }

  // Test Ollama Cloud Connection - ALWAYS saves settings first before running test
  testOllamaCloudBtn.addEventListener("click", async () => {
    ollamaCloudStatus.className = "test-status";
    ollamaCloudStatus.textContent = "Saving settings and testing Ollama Cloud...";

    const apiKey = ollamaApiKeyInput.value.trim();
    const hostUrl = ollamaCloudUrlInput.value.trim() || "https://ollama.com";
    const model = ollamaCloudModelInput.value.trim() || "gemma4:31b";

    // 1. Immediately persist settings to chrome.storage.local before testing
    await saveSettings({
      ollamaApiKey: apiKey,
      ollamaCloudUrl: hostUrl,
      ollamaCloudModel: model,
      provider: PROVIDERS.OLLAMA_CLOUD,
    });

    if (!apiKey) {
      ollamaCloudStatus.className = "test-status error";
      ollamaCloudStatus.textContent = "❌ Please enter your API key from ollama.com/settings/keys.";
      return;
    }

    try {
      const res = await checkOllamaCloudStatus(apiKey, hostUrl, model);
      ollamaCloudStatus.className = "test-status success";
      ollamaCloudStatus.textContent = `✅ Connected & Saved! Model '${model}' is ready on Ollama Cloud.`;
    } catch (err) {
      ollamaCloudStatus.className = "test-status error";
      ollamaCloudStatus.textContent = `❌ ${err.message}`;
    }
  });

  // Test Ollama Local Connection
  testOllamaLocalBtn.addEventListener("click", async () => {
    ollamaLocalStatus.className = "test-status";
    ollamaLocalStatus.textContent = "Checking local model...";

    const hostUrl = ollamaLocalUrlInput.value.trim() || "http://localhost:11434";
    const model = ollamaLocalModelInput.value.trim() || "llama3.2-vision";

    await saveSettings({
      ollamaLocalUrl: hostUrl,
      ollamaLocalModel: model,
    });

    try {
      const res = await checkOllamaLocalStatus(hostUrl, model);
      ollamaLocalStatus.className = "test-status success";
      ollamaLocalStatus.textContent = `✅ Connected! Model '${model}' found locally.`;
    } catch (err) {
      ollamaLocalStatus.className = "test-status error";
      ollamaLocalStatus.textContent = `❌ ${err.message}`;
    }
  });

  // Load saved settings from single source of truth
  const settings = await getSettings();

  for (const radio of providerRadios) {
    if (radio.value === settings.provider) {
      radio.checked = true;
    }
  }

  ollamaApiKeyInput.value = settings.ollamaApiKey || "";
  ollamaCloudModelInput.value = settings.ollamaCloudModel || "gemma4:31b";
  ollamaCloudUrlInput.value = settings.ollamaCloudUrl || "https://ollama.com";

  geminiApiKeyInput.value = settings.geminiApiKey || "";
  geminiModelSelect.value = settings.geminiModel || "gemini-2.5-flash";

  ollamaLocalUrlInput.value = settings.ollamaLocalUrl || "http://localhost:11434";
  ollamaLocalModelInput.value = settings.ollamaLocalModel || "llama3.2-vision";

  autoOpenLichessCheckbox.checked = !!settings.autoOpenLichess;

  updateProviderVisibility(settings.provider);

  // Save on submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    let selectedProvider = PROVIDERS.OLLAMA_CLOUD;
    for (const radio of providerRadios) {
      if (radio.checked) {
        selectedProvider = radio.value;
        break;
      }
    }

    const newSettings = {
      provider: selectedProvider,
      ollamaApiKey: ollamaApiKeyInput.value.trim(),
      ollamaCloudModel: ollamaCloudModelInput.value.trim() || "gemma4:31b",
      ollamaCloudUrl: ollamaCloudUrlInput.value.trim() || "https://ollama.com",
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      ollamaLocalUrl: ollamaLocalUrlInput.value.trim() || "http://localhost:11434",
      ollamaLocalModel: ollamaLocalModelInput.value.trim() || "llama3.2-vision",
      autoOpenLichess: autoOpenLichessCheckbox.checked,
    };

    // Save to unified storage
    await saveSettings(newSettings);

    saveStatus.textContent = "✅ Settings saved successfully!";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2500);
  });
});
