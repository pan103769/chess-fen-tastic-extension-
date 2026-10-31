/**
 * Options Page Controller for Chess FEN-tastic
 */

import { PROVIDERS, DEFAULT_SETTINGS } from "../lib/constants.js";
import { checkOllamaStatus } from "../lib/vision-api.js";

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settingsForm");
  const providerRadios = document.getElementsByName("provider");

  const ollamaCloudSection = document.getElementById("ollamaCloudSection");
  const geminiSection = document.getElementById("geminiSection");
  const ollamaLocalSection = document.getElementById("ollamaLocalSection");

  // Inputs
  const ollamaCloudUrlInput = document.getElementById("ollamaCloudUrl");
  const testOllamaCloudBtn = document.getElementById("testOllamaCloudBtn");
  const ollamaCloudStatus = document.getElementById("ollamaCloudStatus");

  const geminiApiKeyInput = document.getElementById("geminiApiKey");
  const toggleKeyBtn = document.getElementById("toggleKeyBtn");
  const geminiModelSelect = document.getElementById("geminiModel");

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

  // Toggle API key reveal
  toggleKeyBtn.addEventListener("click", () => {
    if (geminiApiKeyInput.type === "password") {
      geminiApiKeyInput.type = "text";
      toggleKeyBtn.textContent = "Hide";
    } else {
      geminiApiKeyInput.type = "password";
      toggleKeyBtn.textContent = "Show";
    }
  });

  // Radio button change listener
  for (const radio of providerRadios) {
    radio.addEventListener("change", (e) => {
      updateProviderVisibility(e.target.value);
    });
  }

  // Test Ollama Cloud Connection
  testOllamaCloudBtn.addEventListener("click", async () => {
    ollamaCloudStatus.className = "test-status";
    ollamaCloudStatus.textContent = "Checking Ollama Cloud...";

    const hostUrl = ollamaCloudUrlInput.value.trim() || "http://localhost:11434";
    try {
      const res = await checkOllamaStatus(hostUrl, "gemma4:cloud");
      ollamaCloudStatus.className = "test-status success";
      ollamaCloudStatus.textContent = "✅ Connected! gemma4:cloud is ready via Ollama Cloud.";
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
    try {
      const res = await checkOllamaStatus(hostUrl, model);
      ollamaLocalStatus.className = "test-status success";
      ollamaLocalStatus.textContent = `✅ Connected! Model '${model}' found locally.`;
    } catch (err) {
      ollamaLocalStatus.className = "test-status error";
      ollamaLocalStatus.textContent = `❌ ${err.message}`;
    }
  });

  // Load saved settings
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  for (const radio of providerRadios) {
    if (radio.value === settings.provider) {
      radio.checked = true;
    }
  }

  ollamaCloudUrlInput.value = settings.ollamaCloudUrl || "http://localhost:11434";
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
      ollamaCloudUrl: ollamaCloudUrlInput.value.trim() || "http://localhost:11434",
      ollamaCloudModel: "gemma4:cloud",
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      ollamaLocalUrl: ollamaLocalUrlInput.value.trim() || "http://localhost:11434",
      ollamaLocalModel: ollamaLocalModelInput.value.trim() || "llama3.2-vision",
      autoOpenLichess: autoOpenLichessCheckbox.checked,
    };

    await chrome.storage.sync.set(newSettings);

    saveStatus.textContent = "✅ Settings saved successfully!";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2500);
  });
});
