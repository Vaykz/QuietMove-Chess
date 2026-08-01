import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { extractLegalMoveFromQuestion } from "./domain/moveReference";

describe("move references in teacher questions", () => {
  const fen = "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3";

  it("recognizes a legal move written naturally in Spanish", () => {
    expect(extractLegalMoveFromQuestion("¿Debería comer d5 a e4? Explícame.", fen)).toBe("d5e4");
  });

  it("recognizes compact UCI notation", () => {
    expect(extractLegalMoveFromQuestion("¿Qué pasa después de d5e4?", fen)).toBe("d5e4");
  });

  it("never accepts an illegal move merely because it appears in the question", () => {
    expect(extractLegalMoveFromQuestion("¿Puedo jugar d5 a d1?", fen)).toBeNull();
  });

  it("recognizes SAN in English and Spanish", () => {
    const start = new Chess().fen();
    expect(extractLegalMoveFromQuestion("¿Qué pasa con Nf3?", start)).toBe("g1f3");
    expect(extractLegalMoveFromQuestion("¿Y si juego Cf3?", start)).toBe("g1f3");
  });

  it("recognizes a piece and destination written naturally", () => {
    const start = new Chess().fen();
    expect(extractLegalMoveFromQuestion("¿Conviene llevar el caballo a f3?", start)).toBe("g1f3");
  });
});
