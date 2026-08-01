import { describe, expect, it } from "vitest";
import { START_FEN } from "./game";
import { engineVariationToSan } from "./engineVariation";

describe("engine variation formatting", () => {
  it("converts a legal UCI line to SAN and limits its visible length", () => {
    expect(
      engineVariationToSan(
        START_FEN,
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"],
        4
      )
    ).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("rejects a line as soon as it contains an illegal move", () => {
    expect(engineVariationToSan(START_FEN, ["e2e4", "e7e4"])).toEqual([]);
  });
});
