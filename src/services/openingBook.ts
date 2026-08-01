interface OpeningIndex {
  entries: Record<string, { eco: string; name: string }>;
}

let indexPromise: Promise<OpeningIndex> | null = null;

export function openingForFen(fen: string) {
  indexPromise ??= fetch("/data/openings.json", { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("Opening index could not be loaded.");
      return response.json() as Promise<OpeningIndex>;
    })
    .catch(() => ({ entries: {} }));
  const epd = fen.split(/\s+/).slice(0, 4).join(" ");
  return indexPromise.then((index) => index.entries[epd]);
}
