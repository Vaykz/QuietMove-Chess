import { describe, expect, it } from "vitest";
import {
  baseClassification,
  classifyMove,
  expectedPoints,
  hasVerifiedSacrifice
} from "./moveClassification";
import type { EngineLine } from "./types";

function line(move: string, points: number, mate: number | null = null): EngineLine {
  const wins = Math.round(points * 1000);
  return {
    multipv: 1,
    depth: 18,
    scoreCp: null,
    mate,
    wdl: mate === null ? [wins, 0, 1000 - wins] : null,
    moves: [move]
  };
}

const quietFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

describe("QuietMove move classifications", () => {
  it("uses the complete expected-points thresholds", () => {
    expect(baseClassification(0, false)).toBe("best");
    expect(baseClassification(0.015, false)).toBe("excellent");
    expect(baseClassification(0.04, false)).toBe("good");
    expect(baseClassification(0.08, false)).toBe("inaccuracy");
    expect(baseClassification(0.15, false)).toBe("mistake");
    expect(baseClassification(0.21, false)).toBe("blunder");
  });

  it("derives expected points from WDL, mate and centipawns", () => {
    expect(expectedPoints(line("e2e4", 0.7))).toBeCloseTo(0.7);
    expect(expectedPoints(line("e2e4", 0, 3))).toBe(1);
    expect(expectedPoints(line("e2e4", 0, -2))).toBe(0);
    expect(expectedPoints({ ...line("e2e4", 0.5), wdl: null, scoreCp: 0 })).toBe(0.5);
  });

  it("marks a unique near-best continuation as great", () => {
    const result = classifyMove({
      fenBefore: quietFen,
      fenAfter: quietFen,
      playedMove: "e1e2",
      candidateLines: [line("e1e2", 0.7), line("e1f2", 0.55)],
      playedLine: line("e1e2", 0.7)
    });
    expect(result.kind).toBe("great");
  });

  it("marks a verified good piece sacrifice as brilliant", () => {
    const fen = "3rk3/8/8/8/8/8/8/3QK3 w - - 0 1";
    const sacrifice = { ...line("d1d8", 0.75), moves: ["d1d8", "e8d8"] };
    expect(hasVerifiedSacrifice(fen, sacrifice.moves)).toBe(true);
    const result = classifyMove({
      fenBefore: fen,
      fenAfter: "3Qk3/8/8/8/8/8/8/4K3 b - - 0 1",
      playedMove: "d1d8",
      candidateLines: [sacrifice, line("d1a4", 0.7)],
      playedLine: sacrifice
    });
    expect(result.kind).toBe("brilliant");
  });

  it("does not call a strong move brilliant without a sacrifice", () => {
    expect(hasVerifiedSacrifice(quietFen, ["e1e2", "e8e7"])).toBe(false);
  });

  it("prioritizes a missed opportunity over an ordinary blunder", () => {
    const result = classifyMove({
      fenBefore: quietFen,
      fenAfter: quietFen,
      playedMove: "e1f1",
      candidateLines: [line("e1e2", 0.8)],
      playedLine: line("e1f1", 0.5),
      previousExpectedPoints: 0.4
    });
    expect(result.kind).toBe("miss");
  });

  it("marks allowing an avoidable mate as a blunder", () => {
    const result = classifyMove({
      fenBefore: quietFen,
      fenAfter: quietFen,
      playedMove: "e1f1",
      candidateLines: [line("e1e2", 0.5)],
      playedLine: line("e1f1", 0, -2)
    });
    expect(result.kind).toBe("blunder");
  });

  it("uses book only when the move remains good", () => {
    const result = classifyMove({
      fenBefore: quietFen,
      fenAfter: quietFen,
      playedMove: "e1f1",
      candidateLines: [line("e1e2", 0.55)],
      playedLine: line("e1f1", 0.52),
      opening: { eco: "A00", name: "Test Opening" }
    });
    expect(result.kind).toBe("book");
    expect(result.opening?.eco).toBe("A00");
  });
});
