"use client";

import { useCallback, useRef, useState } from "react";

import type { Calibration, Quad } from "@/lib/homography";
import type { Point } from "@/lib/types";

const CORNER_LABELS = ["Lejos izq.", "Lejos der.", "Cerca der.", "Cerca izq."] as const;

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  calibration: Calibration;
  calibrationValid: boolean;
  calibrating: boolean;
  onQuadChange: (quad: Quad) => void;
  /** Contenido superpuesto cuando no hay fuente activa. */
  placeholder?: React.ReactNode;
  mirrored?: boolean;
};

export default function VideoStage({
  videoRef,
  canvasRef,
  calibration,
  calibrationValid,
  calibrating,
  onQuadChange,
  placeholder,
  mirrored = false,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const moveCorner = useCallback(
    (index: number, clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const x = clamp01((clientX - rect.left) / rect.width);
      const y = clamp01((clientY - rect.top) / rect.height);
      const next = calibration.quad.map((p, i) => (i === index ? { x, y } : p)) as unknown as Quad;
      onQuadChange(next);
    },
    [calibration.quad, onQuadChange],
  );

  const handlePointerDown = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(index);
  };

  const handlePointerMove = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragging !== index) return;
    moveCorner(index, e.clientX, e.clientY);
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(null);
  };

  // El teclado tambien mueve las esquinas: mas preciso que el mouse en desktop.
  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    const p = calibration.quad[index];
    const next = calibration.quad.map((q, i) =>
      i === index ? { x: clamp01(p.x + d.x), y: clamp01(p.y + d.y) } : q,
    ) as unknown as Quad;
    onQuadChange(next);
  };

  const midFar = midpoint(calibration.quad[0], calibration.quad[1]);
  const midSide = midpoint(calibration.quad[0], calibration.quad[3]);

  return (
    <div
      ref={stageRef}
      data-testid="video-stage"
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black"
    >
      <video
        ref={videoRef}
        data-testid="radar-video"
        playsInline
        muted
        autoPlay
        className="h-full w-full object-contain"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />
      <canvas
        ref={canvasRef}
        data-testid="radar-overlay"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {calibrating && (
        <>
          <EdgeLabel at={midFar} text={`${calibration.widthMeters} m de ancho`} />
          <EdgeLabel at={midSide} text={`${calibration.lengthMeters} m de largo`} />
          {calibration.quad.map((p, i) => (
            <button
              key={i}
              type="button"
              data-testid={`calib-handle-${i}`}
              aria-label={`Esquina ${CORNER_LABELS[i]}`}
              onPointerDown={handlePointerDown(i)}
              onPointerMove={handlePointerMove(i)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={handleKeyDown(i)}
              className={`absolute z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 text-[10px] font-bold transition active:cursor-grabbing ${
                calibrationValid
                  ? "border-sky-300 bg-sky-500/80 text-white"
                  : "border-red-300 bg-red-500/80 text-white"
              } ${dragging === i ? "scale-125" : "hover:scale-110"}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {i + 1}
            </button>
          ))}
        </>
      )}

      {placeholder && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
          {placeholder}
        </div>
      )}
    </div>
  );
}

function EdgeLabel({ at, text }: { at: Point; text: string }) {
  return (
    <span
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white"
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      {text}
    </span>
  );
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
