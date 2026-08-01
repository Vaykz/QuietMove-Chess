import { classifyMove, expectedPoints } from "../domain/moveClassification";
import type { EngineResult, MoveClassification } from "../domain/types";
import { StockfishClient } from "./engine";
import { openingForFen } from "./openingBook";

export interface MoveClassificationJob {
  fenBefore: string;
  fenAfter: string;
  playedMove: string;
  previousOpponentFen?: string;
}

export class MoveClassifier {
  private readonly engine = new StockfishClient();
  private readonly cache = new Map<string, EngineResult>();
  private generation = 0;

  async classify(job: MoveClassificationJob): Promise<MoveClassification | null> {
    const generation = this.generation;
    const opening = await openingForFen(job.fenAfter);
    if (generation !== this.generation) return null;

    let candidates = await this.analyze(job.fenBefore, 18, 5);
    if (!this.valid(candidates, job.fenBefore, generation)) return null;
    let playedLine = candidates.lines.find((line) => line.moves[0] === job.playedMove);
    if (!playedLine) {
      const played = await this.analyze(job.fenBefore, 18, 1, [job.playedMove]);
      if (!this.valid(played, job.fenBefore, generation)) return null;
      playedLine = played.lines[0];
    }
    if (!playedLine) return null;

    const previousExpectedPoints = job.previousOpponentFen
      ? await this.expectedPointsForWaitingPlayer(job.previousOpponentFen, generation)
      : undefined;
    if (generation !== this.generation) return null;

    let classification = classifyMove({
      ...job,
      candidateLines: candidates.lines,
      playedLine,
      previousExpectedPoints,
      opening
    });

    if (classification.kind === "great" || classification.kind === "brilliant") {
      candidates = await this.analyze(job.fenBefore, 22, 5);
      if (!this.valid(candidates, job.fenBefore, generation)) return null;
      playedLine = candidates.lines.find((line) => line.moves[0] === job.playedMove);
      if (!playedLine) {
        const played = await this.analyze(job.fenBefore, 22, 1, [job.playedMove]);
        if (!this.valid(played, job.fenBefore, generation)) return null;
        playedLine = played.lines[0];
      }
      if (!playedLine) return null;
      classification = classifyMove({
        ...job,
        candidateLines: candidates.lines,
        playedLine,
        previousExpectedPoints,
        opening
      });
    }

    return classification;
  }

  cancel() {
    this.generation += 1;
    this.engine.cancel();
  }

  dispose() {
    this.cancel();
    this.engine.dispose();
  }

  private async expectedPointsForWaitingPlayer(fen: string, generation: number) {
    const result = await this.analyze(fen, 18, 1);
    if (!this.valid(result, fen, generation) || !result.lines[0]) return undefined;
    return 1 - expectedPoints(result.lines[0]);
  }

  private analyze(fen: string, depth: number, multiPv: number, rootMoves?: string[]) {
    const key = `${fen}|${depth}|${multiPv}|${rootMoves?.join(",") ?? ""}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    return this.engine.analyze(fen, { depth, multiPv, rootMoves }).then((result) => {
      if (result.status === "complete") this.cache.set(key, result);
      return result;
    });
  }

  private valid(result: EngineResult, fen: string, generation: number) {
    return generation === this.generation && result.status === "complete" && result.fen === fen;
  }
}

export const moveClassifier = new MoveClassifier();
