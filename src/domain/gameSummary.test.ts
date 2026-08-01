import { describe, expect, it } from "vitest";
import { applyMove, createSession, sessionStatus } from "./game";
import { summarizeGame } from "./gameSummary";

describe("game summary", () => {
  it("counts only the player's classified moves and keeps every category", () => {
    let session = createSession("coach-game", "white");
    session = applyMove(session, "e2", "e4")!;
    session = applyMove(session, "e7", "e5")!;
    session = applyMove(session, "g1", "f3")!;
    session = {
      ...session,
      moves: session.moves.map((move, index) => index === 0
        ? {
            ...move,
            classification: {
              kind: "best",
              fenBefore: session.initialFen,
              fenAfter: move.fen,
              playedMove: move.uci,
              bestMove: move.uci,
              expectedPointLoss: 0,
              depth: 18
            }
          }
        : move)
    };
    const summary = summarizeGame(session, { isGameOver: false, isCheckmate: false, turn: "black" });
    expect(summary.classification.counts.best).toBe(1);
    expect(summary.classification.counts.blunder).toBe(0);
    expect(summary.classification.playerMoves).toBe(2);
    expect(summary.classification.classifiedMoves).toBe(1);
    expect(summary.classification.pendingMoves).toBe(1);
  });

  it("derives a checkmate result", () => {
    let session = createSession("solo-game", "white", 1200, "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1");
    session = applyMove(session, "f7", "g7")!;
    const status = sessionStatus(session);
    expect(status.isGameOver).toBe(true);
    expect(summarizeGame(session, status).result).toBe("1-0");
  });
});
