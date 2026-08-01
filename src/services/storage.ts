import type { AppPreferences } from "../domain/types";

const preferencesKey = "quietmove:preferences";

export const defaultPreferences: AppPreferences = {
  language: (localStorage.getItem("quietmove:language") as "es" | "en") || "es",
  theme: "light",
  detailLevel: "balanced",
  aiProvider: "openai",
  aiModel: "gpt-5.6-sol",
  playerColor: "white",
  estimatedRating: 1200,
  showEvaluation: true,
  showMoveClassifications: true,
  allowHistoricalBranching: false,
  speechRate: 1
};

export function loadPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
    const aiProvider = stored.aiProvider === "gemini" ? "gemini" : "openai";
    const validModels =
      aiProvider === "openai"
        ? ["gpt-5.6-sol", "gpt-5.6-terra"]
        : ["gemini-3.5-flash", "gemini-3.6-flash"];
    const aiModel = validModels.includes(stored.aiModel)
      ? stored.aiModel
      : aiProvider === "openai"
        ? "gpt-5.6-sol"
        : "gemini-3.5-flash";
    const theme = stored.theme === "dark" ? "dark" : "light";
    const estimatedRating = Number.isFinite(Number(stored.estimatedRating))
      ? Math.max(0, Math.min(3000, Math.round(Number(stored.estimatedRating))))
      : defaultPreferences.estimatedRating;
    const {
      modelProfile: _legacyModelProfile,
      persistHistory: _legacyPersistHistory,
      ...current
    } = stored;
    return { ...defaultPreferences, ...current, aiProvider, aiModel, theme, estimatedRating };
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: AppPreferences) {
  localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  localStorage.setItem("quietmove:language", preferences.language);
}
