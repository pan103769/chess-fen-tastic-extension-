/**
 * Centralized Settings Storage Manager for Chess FEN-tastic
 * Enforces:
 * - Single consistent storage area (chrome.storage.local)
 * - Single exact property name everywhere (ollamaApiKey)
 * - Immediate persistence on input change and before connection testing
 * - Safe retrieval without silent empty overwrites
 * - Direct safety-net fallback if background service worker restarts
 */

import { DEFAULT_SETTINGS, PROVIDERS } from "./constants.js";

/**
 * Retrieves the current settings from chrome.storage.local,
 * merging with DEFAULT_SETTINGS.
 * Checks chrome.storage.sync as a migration fallback if local has no key.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  let settings = { ...DEFAULT_SETTINGS };

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const localData = await chrome.storage.local.get([
        "settings",
        "provider",
        "ollamaApiKey",
        "ollamaCloudModel",
        "ollamaCloudUrl",
        "geminiApiKey",
        "geminiModel",
        "ollamaLocalUrl",
        "ollamaLocalModel",
        "autoOpenLichess",
      ]);

      if (localData) {
        // If stored inside 'settings' sub-object
        if (localData.settings && typeof localData.settings === "object") {
          settings = { ...settings, ...localData.settings };
        }
        // Flat properties override defaults if present
        for (const [key, val] of Object.entries(localData)) {
          if (key !== "settings" && val !== undefined && val !== null && val !== "") {
            settings[key] = val;
          }
        }
      }
    } catch (err) {
      console.warn("Could not read from chrome.storage.local:", err);
    }
  }

  // Fallback migration: If ollamaApiKey is not in local storage, check sync storage
  if (!settings.ollamaApiKey && typeof chrome !== "undefined" && chrome.storage?.sync) {
    try {
      const syncData = await chrome.storage.sync.get(["ollamaApiKey", "provider", "ollamaCloudModel", "ollamaCloudUrl"]);
      if (syncData && syncData.ollamaApiKey) {
        settings.ollamaApiKey = syncData.ollamaApiKey.trim();
        if (syncData.provider) settings.provider = syncData.provider;
        if (syncData.ollamaCloudModel) settings.ollamaCloudModel = syncData.ollamaCloudModel;
        if (syncData.ollamaCloudUrl) settings.ollamaCloudUrl = syncData.ollamaCloudUrl;

        // Persist to local storage immediately so future reads are local
        if (chrome.storage?.local) {
          await chrome.storage.local.set({
            ollamaApiKey: settings.ollamaApiKey,
            settings: { ...settings },
          });
        }
      }
    } catch (err) {
      // Sync storage unavailable or unconfigured
    }
  }

  return settings;
}

/**
 * Saves settings to chrome.storage.local immediately as the single source of truth.
 * Also mirrors to chrome.storage.sync if available.
 * @param {Partial<typeof DEFAULT_SETTINGS>} updates
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function saveSettings(updates = {}) {
  const current = await getSettings();
  const merged = {
    ...current,
    ...updates,
  };

  // Ensure strings are trimmed
  if (merged.ollamaApiKey) merged.ollamaApiKey = merged.ollamaApiKey.trim();
  if (merged.ollamaCloudUrl) merged.ollamaCloudUrl = merged.ollamaCloudUrl.trim();
  if (merged.ollamaCloudModel) merged.ollamaCloudModel = merged.ollamaCloudModel.trim();
  if (merged.geminiApiKey) merged.geminiApiKey = merged.geminiApiKey.trim();

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    // Write flat keys AND nested object for complete compatibility
    await chrome.storage.local.set({
      settings: { ...merged },
      provider: merged.provider,
      ollamaApiKey: merged.ollamaApiKey,
      ollamaCloudModel: merged.ollamaCloudModel,
      ollamaCloudUrl: merged.ollamaCloudUrl,
      geminiApiKey: merged.geminiApiKey,
      geminiModel: merged.geminiModel,
      ollamaLocalUrl: merged.ollamaLocalUrl,
      ollamaLocalModel: merged.ollamaLocalModel,
      autoOpenLichess: merged.autoOpenLichess,
    });
  }

  // Also mirror to sync storage for users with Chrome Sync enabled
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    try {
      await chrome.storage.sync.set(merged);
    } catch (err) {
      // Ignore sync quota or offline errors
    }
  }

  return merged;
}

