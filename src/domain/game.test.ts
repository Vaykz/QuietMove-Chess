import { Chess } from "chess.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  createDemoLine,
  createSession,
  exportPgn,
  importFen,
  importPgn,
  sessionStatus,
  setDemo,
  stepDemo,
  viewFen
} from "./game";

describe("game domain", () => {
  it("creates bot games in setup state until the player starts them", () => {
    expect(createSession("coach-game", "black").started).toBe(false);
    expect(createSession("coach-game", "black").playerColor).toBe("black");
  });

  it("accepts legal moves and rejects illegal moves", () => {
    const initial = createSession();
    const moved = applyMove(initial, "e2", "e4");
    expect(moved?.moves[0].san).toBe("e4");
    expect(applyMove(initial, "e2", "e5")).toBeNull();
  });

  it("replaces the future only when branching is enabled on the player's turn", () => {
    let session = createSession("coach-game", "white");
    session = applyMove(session, "e2", "e4")!;
    session = applyMove(session, "e7", "e5")!;
    session = applyMove(session, "g1", "f3")!;
    session = applyMove(session, "b8", "c6")!;
    session = { ...session, started: true, selectedPly: 2 };

    expect(applyMove(session, "f1", "c4")).toBeNull();
    const branched = applyMove(session, "f1", "c4", "q", true)!;
    expect(branched.moves.map((move) => move.san)).toEqual(["e4", "e5", "Bc4"]);
    expect(branched.selectedPly).toBe(3);
    expect(branched.realFen).toBe(branched.moves[2].fen);

    const wrongTurn = { ...session, selectedPly: 1 };
    expect(applyMove(wrongTurn, "e7", "e6", "q", true)).toBeNull();
  });

  it("keeps demonstration state isolated from the real game", () => {
    const real = applyMove(createSession(), "e2", "e4")!;
    const realFen = real.realFen;
    const demo = createDemoLine(realFen, ["e7e5", "g1f3"], "Main line")!;
    const stepped = stepDemo(setDemo(real, demo), 2);
    expect(viewFen(stepped)).not.toBe(realFen);
    expect(stepped.realFen).toBe(realFen);
    expect(setDemo(stepped, null).realFen).toBe(realFen);
  });

  it("round-trips a PGN without changing the moves", () => {
    let session = createSession();
    session = applyMove(session, "e2", "e4")!;
    session = applyMove(session, "e7", "e5")!;
    session = applyMove(session, "g1", "f3")!;
    const imported = importPgn(createSession("coach-game"), exportPgn(session));
    expect(imported.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(imported.realFen).toBe(session.realFen);
  });

  it("preserves repetition history when determining game status", () => {
    let session = createSession();
    for (const [from, to] of [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"]
    ]) {
      session = applyMove(session, from, to)!;
    }
    expect(sessionStatus(session).isThreefoldRepetition).toBe(true);
  });

  it("handles explicit promotion choices", () => {
    const ready = importFen(createSession("coach-game"), "8/P7/8/8/8/8/7k/4K3 w - - 0 1");
    const promoted = applyMove(ready, "a7", "a8", "n")!;
    expect(new Chess(promoted.realFen).get("a8")?.type).toBe("n");
  });

  it("never changes the real FEN while stepping arbitrary legal demo lines", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (seed) => {
        const session = createSession();
        const chess = new Chess(session.realFen);
        const uci: string[] = [];
        for (let ply = 0; ply < 8 && !chess.isGameOver(); ply += 1) {
          const moves = chess.moves({ verbose: true });
          const move = moves[(seed + ply * 7) % moves.length];
          chess.move(move);
          uci.push(`${move.from}${move.to}${move.promotion ?? ""}`);
        }
        const demo = createDemoLine(session.realFen, uci, "property")!;
        const stepped = stepDemo(setDemo(session, demo), seed);
        expect(stepped.realFen).toBe(session.realFen);
      })
    );
  });
});
