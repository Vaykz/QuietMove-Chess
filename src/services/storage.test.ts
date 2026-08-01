import { beforeEach, describe, expect, it } from "vitest";
import { defaultPreferences, loadPreferences } from "./storage";

describe("preference migrations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses OpenAI's flagship model by default", () => {
    expect(loadPreferences().aiProvider).toBe("openai");
    expect(loadPreferences().aiModel).toBe("gpt-5.6-sol");
    expect(defaultPreferences.aiModel).toBe("gpt-5.6-sol");
  });

  it("removes legacy local-model preferences", () => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ modelProfile: "light", estimatedRating: 1450 })
    );

    expect(loadPreferences()).toMatchObject({
      aiProvider: "openai",
      aiModel: "gpt-5.6-sol",
      estimatedRating: 1450
    });
  });

  it("keeps a supported Gemini model", () => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ aiProvider: "gemini", aiModel: "gemini-3.6-flash" })
    );

    expect(loadPreferences()).toMatchObject({
      aiProvider: "gemini",
      aiModel: "gemini-3.6-flash"
    });
  });

  it("restores the dark theme while discarding the removed history preference", () => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ theme: "dark", persistHistory: true })
    );

    const preferences = loadPreferences();
    expect(preferences.theme).toBe("dark");
    expect(preferences).not.toHaveProperty("persistHistory");
  });

  it("enables local move classifications for existing preferences", () => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ showEvaluation: false })
    );

    expect(loadPreferences()).toMatchObject({
      showEvaluation: false,
      showMoveClassifications: true,
      allowHistoricalBranching: false
    });
  });

  it("migrates the estimated bot level into the supported 0–3000 scale", () => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ estimatedRating: 3475 })
    );
    expect(loadPreferences().estimatedRating).toBe(3000);
  });
});
