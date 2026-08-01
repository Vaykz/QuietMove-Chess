import { describe, expect, it } from "vitest";
import { parseInfo } from "./engine";

describe("Stockfish UCI parser", () => {
  it("preserves depth, score, WDL and the exact PV", () => {
    expect(
      parseInfo("info depth 15 seldepth 20 multipv 2 score cp -34 wdl 201 444 355 nodes 20 pv e2e4 e7e5")
    ).toEqual({
      depth: 15,
      multipv: 2,
      scoreCp: -34,
      mate: null,
      wdl: [201, 444, 355],
      moves: ["e2e4", "e7e5"]
    });
  });
});
