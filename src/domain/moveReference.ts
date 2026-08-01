import { Chess, type Move } from "chess.js";

const pieceWords: Record<string, Move["piece"]> = {
  caballo: "n",
  knight: "n",
  alfil: "b",
  bishop: "b",
  torre: "r",
  rook: "r",
  dama: "q",
  reina: "q",
  queen: "q",
  rey: "k",
  king: "k",
  peon: "p",
  pawn: "p"
};

export function extractLegalMoveFromQuestion(question: string, fen: string) {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  const normalized = normalize(question);

  const coordinates = normalized.match(
    /\b([a-h][1-8])\s*(?:x|a|to|hacia|-)?\s*([a-h][1-8])(?:\s*=?\s*([qrbn]))?\b/
  );
  if (coordinates) {
    const [, from, to, promotion] = coordinates;
    const move = legalMoves.find(
      (candidate) =>
        candidate.from === from &&
        candidate.to === to &&
        (!candidate.promotion || candidate.promotion === (promotion ?? "q"))
    );
    if (move) return toUci(move);
  }

  const namedPiece = normalized.match(
    /\b(caballo|knight|alfil|bishop|torre|rook|dama|reina|queen|rey|king|peon|pawn)\b.*?\b([a-h][1-8])\b/
  );
  if (namedPiece) {
    const matches = legalMoves.filter(
      (move) => move.piece === pieceWords[namedPiece[1]] && move.to === namedPiece[2]
    );
    if (matches.length === 1) return toUci(matches[0]);
  }

  const sanMatches = legalMoves.filter((move) =>
    sanForms(move.san).some((san) => containsNotation(normalized, san))
  );
  return sanMatches.length === 1 ? toUci(sanMatches[0]) : null;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/0-0-0/g, "o-o-o")
    .replace(/0-0/g, "o-o");
}

function sanForms(san: string) {
  const english = normalize(san.replace(/[+#]+$/g, ""));
  const spanish = english.replace(/^([nbrqk])/, (piece) => {
    const translated: Record<string, string> = { n: "c", b: "a", r: "t", q: "d", k: "r" };
    return translated[piece] ?? piece;
  });
  return english === spanish ? [english] : [english, spanish];
}

function containsNotation(text: string, notation: string) {
  const escaped = notation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function toUci(move: Move) {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}
