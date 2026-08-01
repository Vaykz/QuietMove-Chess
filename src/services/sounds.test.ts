import { describe, expect, it } from "vitest";
import { soundCueAfterMove } from "./sounds";

describe("chess sound cues", () => {
  it("plays the normal piece sound after a real move", () => {
    expect(soundCueAfterMove(2, 3, false)).toBe("move");
  });

  it("uses only the finish sound for the final move", () => {
    expect(soundCueAfterMove(8, 9, true)).toBe("game-finished");
  });

  it("stays silent while navigating or resetting the game", () => {
    expect(soundCueAfterMove(4, 4, false)).toBeNull();
    expect(soundCueAfterMove(4, 0, false)).toBeNull();
  });
});
