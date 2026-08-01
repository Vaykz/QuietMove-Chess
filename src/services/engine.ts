import type { EngineLine, EngineResult } from "../domain/types";
import {
  botStrengthProfile,
  selectEstimatedBotMove,
  STOCKFISH_HIGHEST_NATIVE_ELO,
  STOCKFISH_LOWEST_NATIVE_ELO
} from "../domain/botStrength";

type Pending = {
  requestId: string;
  fen: string;
  lines: Map<number, EngineLine>;
  resolve: (result: EngineResult) => void;
  reject: (error: Error) => void;
};

export class StockfishClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private pending: Pending | null = null;
  private sequence = 0;
  private available = false;

  async initialize() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      try {
        const canThread =
          globalThis.crossOriginIsolated &&
          typeof SharedArrayBuffer !== "undefined" &&
          (navigator.hardwareConcurrency ?? 1) > 1;
        this.worker = new Worker(
          canThread ? "/engine/stockfish-18-lite.js" : "/engine/stockfish-18-lite-single.js"
        );
        this.worker.addEventListener("message", this.onMessage);
        this.worker.addEventListener("error", () => {
          this.available = false;
          reject(new Error("Stockfish worker could not be loaded."));
        });
        this.send("uci");
      } catch (error) {
        reject(error);
      }
    });
    return this.readyPromise;
  }

  isAvailable() {
    return this.available;
  }

  async analyze(
    fen: string,
    options: {
      depth?: number;
      moveTimeMs?: number;
      multiPv?: number;
      estimatedElo?: number;
      skillLevel?: number;
      rootMoves?: string[];
    } = {}
  ): Promise<EngineResult> {
    await this.initialize();
    this.cancel();
    const requestId = `engine-${++this.sequence}`;
    const multiPv = Math.max(1, Math.min(options.multiPv ?? 3, 20));
    if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined") {
      this.send(`setoption name Threads value ${Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 1))}`);
    }
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send("setoption name UCI_ShowWDL value true");
    this.send(`setoption name Skill Level value ${Math.max(0, Math.min(20, options.skillLevel ?? 20))}`);
    if ((options.estimatedElo ?? 0) >= STOCKFISH_LOWEST_NATIVE_ELO) {
      this.send("setoption name UCI_LimitStrength value true");
      this.send(
        `setoption name UCI_Elo value ${Math.min(
          options.estimatedElo ?? STOCKFISH_LOWEST_NATIVE_ELO,
          STOCKFISH_HIGHEST_NATIVE_ELO
        )}`
      );
    } else {
      this.send("setoption name UCI_LimitStrength value false");
    }
    this.send(`position fen ${fen}`);
    const limit = options.moveTimeMs
      ? `movetime ${Math.max(50, options.moveTimeMs)}`
      : `depth ${Math.max(1, Math.min(options.depth ?? 13, 30))}`;
    const searchMoves = options.rootMoves?.length ? ` searchmoves ${options.rootMoves.join(" ")}` : "";

    return new Promise<EngineResult>((resolve, reject) => {
      this.pending = { requestId, fen, lines: new Map(), resolve, reject };
      this.send(`go ${limit}${searchMoves}`);
    });
  }

  async bestMove(fen: string, estimatedElo: number) {
    const profile = botStrengthProfile(estimatedElo);
    if (profile.usesNativeElo) {
      const result = await this.analyze(fen, {
        moveTimeMs: estimatedElo < 1600 ? 500 : 900,
        multiPv: 1,
        estimatedElo
      });
      return result.bestMove;
    }

    const result = await this.analyze(fen, {
      depth: profile.depth,
      multiPv: profile.candidateCount,
      skillLevel: 20
    });
    return selectEstimatedBotMove(result, fen, estimatedElo);
  }

  cancel() {
    if (!this.pending) return;
    this.send("stop");
    this.pending.resolve({
      requestId: this.pending.requestId,
      fen: this.pending.fen,
      status: "cancelled",
      bestMove: null,
      lines: [...this.pending.lines.values()]
    });
    this.pending = null;
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.available = false;
  }

  private send(command: string) {
    this.worker?.postMessage(command);
  }

  private onMessage = (event: MessageEvent<string>) => {
    const line = String(event.data);
    if (line === "uciok") {
      this.send("isready");
      return;
    }
    if (line === "readyok") {
      this.available = true;
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    if (!this.pending) return;
    if (line.startsWith("info ")) {
      const parsed = parseInfo(line);
      if (parsed) this.pending.lines.set(parsed.multipv, parsed);
      return;
    }
    if (line.startsWith("bestmove ")) {
      const bestMove = line.split(/\s+/)[1];
      const pending = this.pending;
      this.pending = null;
      pending.resolve({
        requestId: pending.requestId,
        fen: pending.fen,
        status: "complete",
        bestMove: bestMove === "(none)" ? null : bestMove,
        lines: [...pending.lines.values()].sort((a, b) => a.multipv - b.multipv)
      });
    }
  };
}

export function parseInfo(input: string): EngineLine | null {
  const pvIndex = input.indexOf(" pv ");
  if (pvIndex < 0) return null;
  const metadata = input.slice(0, pvIndex);
  const moves = input.slice(pvIndex + 4).trim().split(/\s+/).filter(Boolean);
  if (!moves.length) return null;
  const depth = Number(metadata.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const multipv = Number(metadata.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const cpMatch = metadata.match(/\bscore cp (-?\d+)/);
  const mateMatch = metadata.match(/\bscore mate (-?\d+)/);
  const wdlMatch = metadata.match(/\bwdl (\d+) (\d+) (\d+)/);
  return {
    depth,
    multipv,
    scoreCp: cpMatch ? Number(cpMatch[1]) : null,
    mate: mateMatch ? Number(mateMatch[1]) : null,
    wdl: wdlMatch ? [Number(wdlMatch[1]), Number(wdlMatch[2]), Number(wdlMatch[3])] : null,
    moves
  };
}

export const stockfish = new StockfishClient();
