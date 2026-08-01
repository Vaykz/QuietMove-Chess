import { describe, expect, it } from "vitest";
import { START_FEN } from "./game";
import { buildPedagogicalReport, classifyWdlLoss } from "./pedagogy";

describe("pedagogical analysis", () => {
  it("builds evidence tied to the exact FEN", () => {
    const report = buildPedagogicalReport(START_FEN);
    expect(report.fen).toBe(START_FEN);
    expect(report.legalMoveCount).toBe(20);
    expect(report.evidence.every((item) => item.fen === START_FEN)).toBe(true);
  });

  it.each([
    [2, "reasonable"],
    [4, "slight"],
    [12, "inaccuracy"],
    [24, "mistake"],
    [40, "severe"]
  ])("classifies a %s WDL loss as %s", (loss, expected) => {
    expect(classifyWdlLoss(loss)).toBe(expected);
  });
});
