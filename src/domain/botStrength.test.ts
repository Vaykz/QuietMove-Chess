import { describe, expect, it } from "vitest";
import { START_FEN } from "./game";
import { expectedPoints } from "./moveClassification";
import type { EngineLine, EngineResult } from "./types";
import { botStrengthProfile, selectEstimatedBotMove } from "./botStrength";

const candidate = (multipv: number, move: string, wdl: [number, number, number]): EngineLine => ({
  multipv,
  depth: 8,
  scoreCp: null,
  mate: null,
  wdl,
  moves: [move]
});

const lines = [
  candidate(1, "e2e4", [400, 400, 200]),
  candidate(2, "d2d4", [390, 400, 210]),
  candidate(3, "g1f3", [370, 400, 230]),
  candidate(4, "c2c4", [330, 400, 270]),
  candidate(5, "a2a3", [250, 400, 350]),
  candidate(6, "h2h3", [150, 400, 450]),
  candidate(7, "g2g4", [80, 340, 580]),
  candidate(8, "f2f3", [40, 280, 680])
];

const result: EngineResult = {
  requestId: "bot-test",
  fen: START_FEN,
  status: "complete",
  bestMove: "e2e4",
  lines
};

describe("estimated bot strength", () => {
  it("uses monotonic custom profiles below Stockfish's native Elo floor", () => {
    const ratings = [0, 400, 800, 1200, 1319].map(botStrengthProfile);
    for (let index = 1; index < ratings.length; index += 1) {
      expect(ratings[index].depth).toBeGreaterThanOrEqual(ratings[index - 1].depth);
      expect(ratings[index].candidateCount).toBeLessThanOrEqual(ratings[index - 1].candidateCount);
      expect(ratings[index].bestMoveChance).toBeGreaterThan(ratings[index - 1].bestMoveChance);
      expect(ratings[index].targetExpectedLoss).toBeLessThan(ratings[index - 1].targetExpectedLoss);
    }
    expect(botStrengthProfile(1320).usesNativeElo).toBe(true);
    expect(botStrengthProfile(3000).usesNativeElo).toBe(true);
  });

  it("no longer turns rating 1200 into an unconditional top-engine move", () => {
    const selected = selectEstimatedBotMove(result, START_FEN, 1200);
    expect(selected).not.toBe("e2e4");
    expect(lines.some((line) => line.moves[0] === selected)).toBe(true);
  });

  it("permits a larger evaluated concession at a lower rating", () => {
    const highMove = selectEstimatedBotMove(result, START_FEN, 1200)!;
    const lowMove = selectEstimatedBotMove(result, START_FEN, 400)!;
    const bestPoints = expectedPoints(lines[0]);
    const lossFor = (move: string) =>
      bestPoints - expectedPoints(lines.find((line) => line.moves[0] === move)!);
    expect(lossFor(lowMove)).toBeGreaterThanOrEqual(lossFor(highMove));
  });

  it("defers ratings in the native range to Stockfish's selected bestmove", () => {
    expect(selectEstimatedBotMove(result, START_FEN, 1800)).toBe("e2e4");
  });
});
