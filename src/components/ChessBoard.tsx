import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import type { MoveClassificationKind, PlayerColor } from "../domain/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";

interface ChessBoardProps {
  fen: string;
  orientation: PlayerColor;
  interactive: boolean;
  lastMove?: [string, string];
  arrows?: Array<[string, string]>;
  highlightedSquares?: string[];
  moveAnnotation?: {
    square: string;
    kind: MoveClassificationKind;
    symbol: string;
    label: string;
  };
  onMove: (from: string, to: string) => void;
}

export function ChessBoard({
  fen,
  orientation,
  interactive,
  lastMove,
  arrows = [],
  highlightedSquares = [],
  moveAnnotation,
  onMove
}: ChessBoardProps) {
  const node = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!node.current) return;
    api.current = Chessground(node.current, {
      fen,
      orientation,
      turnColor: colorToMove(fen),
      coordinates: false,
      animation: { enabled: true, duration: 180 },
      movable: {
        free: false,
        color: interactive ? colorToMove(fen) : undefined,
        dests: interactive ? destinations(fen) : new Map(),
        showDests: true,
        events: {
          after: (from, to) => onMoveRef.current(from, to)
        }
      }
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor: colorToMove(fen),
      lastMove: lastMove as [Key, Key] | undefined,
      check: new Chess(fen).isCheck() ? colorToMove(fen) : false,
      movable: {
        color: interactive ? colorToMove(fen) : undefined,
        dests: interactive ? destinations(fen) : new Map(),
        events: {
          after: (from, to) => onMoveRef.current(from, to)
        }
      },
      drawable: {
        autoShapes: [
          ...arrows.map(([from, to]) => ({ orig: from as Key, dest: to as Key, brush: "paleGreen" })),
          ...highlightedSquares.map((square) => ({ orig: square as Key, brush: "paleBlue" }))
        ]
      }
    });
  }, [fen, orientation, interactive, lastMove?.[0], lastMove?.[1], JSON.stringify(arrows), JSON.stringify(highlightedSquares)]);

  const files = orientation === "white"
    ? ["a", "b", "c", "d", "e", "f", "g", "h"]
    : ["h", "g", "f", "e", "d", "c", "b", "a"];
  const ranks = orientation === "white"
    ? ["8", "7", "6", "5", "4", "3", "2", "1"]
    : ["1", "2", "3", "4", "5", "6", "7", "8"];
  const annotationPosition = moveAnnotation
    ? squareGridPosition(moveAnnotation.square, orientation)
    : null;

  return (
    <div className="quiet-board-shell" data-fen={fen}>
      <div ref={node} className="quiet-board" aria-label="Chess board" />
      {moveAnnotation && annotationPosition && (
        <div className="move-classification-layer" aria-live="polite">
          <span
            className={`move-classification-badge ${moveAnnotation.kind}`}
            style={{
              gridColumn: annotationPosition.column,
              gridRow: annotationPosition.row
            }}
            data-classification={moveAnnotation.kind}
            data-square={moveAnnotation.square}
            title={moveAnnotation.label}
            aria-label={moveAnnotation.label}
            role="status"
          >
            {moveAnnotation.symbol}
          </span>
        </div>
      )}
      <div className="board-coordinate-files" aria-hidden="true">
        {files.map((file) => <span key={file} data-coordinate={file}>{file}</span>)}
      </div>
      <div className="board-coordinate-ranks" aria-hidden="true">
        {ranks.map((rank) => <span key={rank} data-coordinate={rank}>{rank}</span>)}
      </div>
    </div>
  );
}

export function squareGridPosition(square: string, orientation: PlayerColor) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return orientation === "white"
    ? { column: file + 1, row: 9 - rank }
    : { column: 8 - file, row: rank };
}

function destinations(fen: string) {
  const chess = new Chess(fen);
  const map = new Map<Key, Key[]>();
  for (const move of chess.moves({ verbose: true })) {
    const list = map.get(move.from as Key) ?? [];
    list.push(move.to as Key);
    map.set(move.from as Key, list);
  }
  return map;
}

function colorToMove(fen: string) {
  return new Chess(fen).turn() === "w" ? ("white" as const) : ("black" as const);
}
