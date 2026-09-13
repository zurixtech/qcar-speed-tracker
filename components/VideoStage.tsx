"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Calibration, Quad } from "@/lib/homography";
import type { Point } from "@/lib/types";
import { clamp01, containRect, fromView, toView, type ViewRect } from "@/lib/view";

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
  /** HUD que flota sobre el video (estado, contadores, acciones). */
  children?: React.ReactNode;
};

export default function VideoStage({
  videoRef,
  canvasRef,
  calibration,
  calibrationValid,
  calibrating,
  onQuadChange,
  placeholder,
  children,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const view = useFrameRect(stageRef, videoRef);

  const moveCorner = useCallback(
    (index: number, clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      // El punto se mide contra el frame dibujado, no contra el contenedor: si
      // hay bandas negras, arrastrar una esquina tiene que seguir al pixel del
      // video que el usuario esta tocando.
      const { x, y } = fromView(view, clientX - rect.left, clientY - rect.top);
      const next = calibration.quad.map((p, i) => (i === index ? { x, y } : p)) as unknown as Quad;
      onQuadChange(next);
    },
    [calibration.quad, onQuadChange, view],
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

  // El teclado tambien mueve las esquinas: util para ajustar de a un pixel.
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
      className="relative w-full flex-1 overflow-hidden bg-black"
    >
      <video
        ref={videoRef}
        data-testid="radar-video"
        playsInline
        muted
        autoPlay
        className="h-full w-full object-contain"
      />
      <canvas
        ref={canvasRef}
        data-testid="radar-overlay"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {children}

      {calibrating && (
        <>
          <EdgeLabel at={midFar} view={view} text={`${calibration.widthMeters} m de ancho`} />
          <EdgeLabel at={midSide} view={view} text={`${calibration.lengthMeters} m de largo`} />
          {calibration.quad.map((p, i) => {
            const at = toView(view, p.x, p.y);
            return (
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
                className={`absolute z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                  calibrationValid
                    ? "border-sky-200 bg-sky-500/85 text-white"
                    : "border-red-200 bg-red-500/85 text-white"
                } ${dragging === i ? "scale-125" : ""}`}
                style={{ left: at.x, top: at.y }}
              >
                {i + 1}
              </button>
            );
          })}
        </>
      )}

      {placeholder && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-6 text-center">
          {placeholder}
        </div>
      )}
    </div>
  );
}

/**
 * Rectangulo (en pixeles CSS del contenedor) donde cae el frame del video.
 * Se recalcula cuando cambia el tamano del contenedor —rotar el telefono— o
 * cuando la camara entrega un frame de otra resolucion.
 */
function useFrameRect(
  stageRef: React.RefObject<HTMLDivElement | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): ViewRect {
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setStage({ w: box.width, h: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setFrame({ w: video.videoWidth, h: video.videoHeight });
    sync();
    const events = ["loadedmetadata", "loadeddata", "resize", "playing", "emptied"] as const;
    for (const e of events) video.addEventListener(e, sync);
    return () => {
      for (const e of events) video.removeEventListener(e, sync);
    };
  }, [videoRef]);

  return containRect(stage.w, stage.h, frame.w, frame.h);
}

function EdgeLabel({ at, view, text }: { at: Point; view: ViewRect; text: string }) {
  const p = toView(view, at.x, at.y);
  return (
    <span
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded bg-sky-500/90 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white"
      style={{ left: p.x, top: p.y }}
    >
      {text}
    </span>
  );
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
