import type { AppMode } from "./types";

export function isTeacherLocked(mode: AppMode, gameOver: boolean) {
  return mode === "solo-game" && !gameOver;
}
