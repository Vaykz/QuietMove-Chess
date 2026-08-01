import { Chess, DEFAULT_POSITION, type Move, type Square } from "chess.js";
import type { AppMode, DemoLine, GameSession, MoveRecord, PlayerColor } from "./types";

export const START_FEN = DEFAULT_POSITION;

const id = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `quiet-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toRecord(move: Move, fen: string): MoveRecord {
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ""}`,
    fen
  };
}

export function createSession(
  mode: AppMode = "coach-game",
  playerColor: PlayerColor = "white",
  estimatedRating = 1200,
  initialFen = START_FEN
): GameSession {
  const now = new Date().toISOString();
  const chess = new Chess(initialFen);
  return {
    id: id(),
    mode,
    started: false,
    initialFen,
    moves: [],
    realFen: chess.fen(),
    selectedPly: 0,
    demo: null,
    playerColor,
    estimatedRating,
    clocks: { enabled: false, whiteMs: 600_000, blackMs: 600_000, running: false },
    createdAt: now,
    updatedAt: now
  };
}

export function applyMove(
  session: GameSession,
  from: string,
  to: string,
  promotion = "q",
  allowHistoricalBranching = false
): GameSession | null {
  if (session.demo) return null;
  const isHistorical = session.selectedPly !== session.moves.length;
  if (isHistorical && !allowHistoricalBranching) return null;

  const originFen = isHistorical ? viewFen(session) : session.realFen;
  const chess = new Chess(originFen);
  if (
    isHistorical &&
    (chess.turn() === "w" ? "white" : "black") !== session.playerColor
  ) {
    return null;
  }
  try {
    const move = chess.move({ from: from as Square, to: to as Square, promotion });
    if (!move) return null;
    const record = toRecord(move, chess.fen());
    const retainedMoves = isHistorical
      ? session.moves.slice(0, session.selectedPly)
      : session.moves;
    return {
      ...session,
      moves: [...retainedMoves, record],
      realFen: chess.fen(),
      selectedPly: retainedMoves.length + 1,
      updatedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function viewFen(session: GameSession): string {
  if (session.demo) {
    if (session.demo.index <= 0) return session.demo.originFen;
    return session.demo.moves[session.demo.index - 1]?.fen ?? session.demo.originFen;
  }
  if (session.selectedPly <= 0) return session.initialFen;
  return session.moves[session.selectedPly - 1]?.fen ?? session.realFen;
}

export function selectPly(session: GameSession, ply: number): GameSession {
  return {
    ...session,
    selectedPly: Math.max(0, Math.min(ply, session.moves.length)),
    demo: null
  };
}

export function createDemoLine(originFen: string, uciMoves: string[], label: string): DemoLine | null {
  const chess = new Chess(originFen);
  const records: MoveRecord[] = [];
  try {
    for (const uci of uciMoves) {
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.slice(4, 5) || "q"
      });
      if (!move) return null;
      records.push(toRecord(move, chess.fen()));
    }
    return { originFen, moves: records, index: 0, label };
  } catch {
    return null;
  }
}

export function setDemo(session: GameSession, demo: DemoLine | null): GameSession {
  return { ...session, demo };
}

export function stepDemo(session: GameSession, delta: number): GameSession {
  if (!session.demo) return session;
  return {
    ...session,
    demo: {
      ...session.demo,
      index: Math.max(0, Math.min(session.demo.index + delta, session.demo.moves.length))
    }
  };
}

export function importFen(session: GameSession, fen: string): GameSession {
  const chess = new Chess(fen);
  return {
    ...createSession(session.mode, session.playerColor, session.estimatedRating, chess.fen()),
    id: session.id
  };
}

export function importPgn(session: GameSession, pgn: string): GameSession {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const headers = parsed.header();
  const initialFen = headers.FEN || START_FEN;
  const replay = new Chess(initialFen);
  const records: MoveRecord[] = [];
  for (const verbose of parsed.history({ verbose: true })) {
    const move = replay.move({
      from: verbose.from,
      to: verbose.to,
      promotion: verbose.promotion
    });
    records.push(toRecord(move, replay.fen()));
  }
  return {
    ...session,
    initialFen,
    moves: records,
    realFen: replay.fen(),
    selectedPly: records.length,
    demo: null,
    updatedAt: new Date().toISOString()
  };
}

export function exportPgn(session: GameSession): string {
  const chess = new Chess(session.initialFen);
  if (session.initialFen !== START_FEN) {
    chess.header("SetUp", "1", "FEN", session.initialFen);
  }
  for (const move of session.moves) {
    chess.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion
    });
  }
  return chess.pgn();
}

export function gameStatus(fen: string) {
  const chess = new Chess(fen);
  return statusFromChess(chess);
}

export function sessionStatus(session: GameSession) {
  const chess = new Chess(session.initialFen);
  for (const move of session.moves) {
    chess.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion
    });
  }
  return statusFromChess(chess);
}

function statusFromChess(chess: Chess) {
  return {
    turn: chess.turn() === "w" ? "white" : "black",
    isCheck: chess.isCheck(),
    isGameOver: chess.isGameOver(),
    isCheckmate: chess.isCheckmate(),
    isDraw: chess.isDraw(),
    isThreefoldRepetition: chess.isThreefoldRepetition(),
    legalMoves: chess.moves({ verbose: true })
  } as const;
}

export function pickFallbackBotMove(fen: string, rating: number): string | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const value: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const ranked = moves
    .map((move) => {
      let score = move.captured ? value[move.captured] : 0;
      score += move.san.includes("+") ? 65 : 0;
      score += move.san.includes("#") ? 10_000 : 0;
      score += ["d4", "e4", "d5", "e5"].includes(move.to) ? 18 : 0;
      score += move.promotion ? value[move.promotion] : 0;
      const noiseWindow = Math.max(4, Math.round((1800 - rating) / 220));
      return { move, score, jitter: hash(`${fen}:${move.from}${move.to}`) % noiseWindow };
    })
    .sort((a, b) => b.score - a.score || a.jitter - b.jitter);
  const selected = ranked[Math.min(ranked.length - 1, Math.max(0, ranked[0].jitter - 1))].move;
  return `${selected.from}${selected.to}${selected.promotion ?? ""}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}
