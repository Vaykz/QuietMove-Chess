import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Chess } from "chess.js";

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  throw new Error("Usage: node scripts/generate-openings.mjs <lichess-chess-openings-directory>");
}

const entries = {};
for (const volume of ["a", "b", "c", "d", "e"]) {
  const contents = await readFile(path.join(sourceDirectory, `${volume}.tsv`), "utf8");
  for (const line of contents.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split("\t");
    if (!eco || !name || !pgn) continue;
    const chess = new Chess();
    try {
      chess.loadPgn(`${pgn} *`);
    } catch {
      continue;
    }
    const epd = chess.fen().split(/\s+/).slice(0, 4).join(" ");
    entries[epd] ??= { eco, name };
  }
}

const outputDirectory = path.join(process.cwd(), "public", "data");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "openings.json"),
  JSON.stringify({
    source: "lichess-org/chess-openings",
    commit: "51b886249b9e418498d25b6e39b926c3de99c29a",
    entries
  })
);
console.log(`Generated ${Object.keys(entries).length} opening positions.`);
