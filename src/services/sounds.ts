export type ChessSoundCue = "move" | "game-finished";

const soundFiles: Record<ChessSoundCue, string> = {
  move: "/sounds/piece-move-dry.mp3",
  "game-finished": "/sounds/game-finished.mp3"
};

const soundVolumes: Record<ChessSoundCue, number> = {
  move: 0.46,
  "game-finished": 0.5
};

const audioCache = new Map<ChessSoundCue, HTMLAudioElement>();

export function soundCueAfterMove(
  previousMoveCount: number,
  nextMoveCount: number,
  gameIsFinished: boolean
): ChessSoundCue | null {
  if (nextMoveCount <= previousMoveCount) return null;
  return gameIsFinished ? "game-finished" : "move";
}

export function playChessSound(cue: ChessSoundCue) {
  if (typeof Audio === "undefined") return;

  let audio = audioCache.get(cue);
  if (!audio) {
    audio = new Audio(soundFiles[cue]);
    audio.preload = "auto";
    audio.volume = soundVolumes[cue];
    audioCache.set(cue, audio);
  }

  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Browsers may block audio before the first user interaction.
  });
}
