import { Chess, type Square } from "chess.js";

export function engineVariationToSan(
  fen: string,
  uciMoves: string[],
  maxPlies = 10
): string[] {
  const chess = new Chess(fen);
  const sanMoves: string[] = [];
  try {
    for (const uci of uciMoves.slice(0, maxPlies)) {
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.slice(4, 5) || "q"
      });
      if (!move) return [];
      sanMoves.push(move.san);
    }
    return sanMoves;
  } catch {
    return [];
  }
}
