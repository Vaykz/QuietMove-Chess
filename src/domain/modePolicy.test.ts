import { describe, expect, it } from "vitest";
import { isTeacherLocked } from "./modePolicy";

describe("mode policies", () => {
  it("keeps the teacher locked only while a no-help game is active", () => {
    expect(isTeacherLocked("solo-game", false)).toBe(true);
    expect(isTeacherLocked("solo-game", true)).toBe(false);
    expect(isTeacherLocked("coach-game", false)).toBe(false);
  });
});
