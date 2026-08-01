import { describe, expect, it } from "vitest";
import { acceptsEvaluationResult, normalizeEvaluationForWhite } from "./evaluation";
import type { EngineLine } from "./types";

const line = (patch: Partial<EngineLine> = {}): EngineLine => ({
  multipv: 1,
  depth: 18,
  scoreCp: 120,
  mate: null,
  wdl: null,
  moves: ["e2e4"],
  ...patch
});

describe("position evaluation normalization", () => {
  it("keeps a positive score when White is to move", () => {
    const result = normalizeEvaluationForWhite(
      "8/8/8/8/8/8/4K3/7k w - - 0 1",
      line()
    );
    expect(result.whiteScoreCp).toBe(120);
    expect(result.whitePercent).toBeGreaterThan(50);
  });

  it("inverts score, mate and WDL when Black is to move", () => {
    const result = normalizeEvaluationForWhite(
      "8/8/8/8/8/8/4K3/7k b - - 0 1",
      line({ scoreCp: 80, mate: 3, wdl: [800, 150, 50] })
    );
    expect(result.whiteScoreCp).toBe(-80);
    expect(result.whiteMate).toBe(-3);
    expect(result.whiteWdl).toEqual([50, 150, 800]);
    expect(result.whitePercent).toBe(0);
  });

  it("uses normalized WDL expected score for the bar", () => {
    const result = normalizeEvaluationForWhite(
      "8/8/8/8/8/8/4K3/7k w - - 0 1",
      line({ scoreCp: 0, wdl: [600, 300, 100] })
    );
    expect(result.whitePercent).toBe(75);
  });

  it("rejects delayed results for another position or request", () => {
    const current = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const old = "8/8/8/8/8/8/4K3/7k b - - 0 1";
    expect(
      acceptsEvaluationResult({
        visibleFen: current,
        requestedFen: old,
        resultFen: old,
        requestToken: 1,
        activeToken: 2,
        status: "complete"
      })
    ).toBe(false);
    expect(
      acceptsEvaluationResult({
        visibleFen: current,
        requestedFen: current,
        resultFen: current,
        requestToken: 2,
        activeToken: 2,
        status: "complete"
      })
    ).toBe(true);
  });
});
