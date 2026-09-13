"use client";

/**
 * Orquesta la sesion del radar: fuente de video, carga del modelo, bucle de
 * frames, dibujo del overlay y registro de infracciones.
 *
 * El bucle NO pasa por el estado de React: los vehiculos se dibujan directo
 * sobre el canvas y a React solo le llegan datos livianos (fps, contadores,
 * infracciones) y con throttling, para no re-renderizar 30 veces por segundo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playAlert, unlockAudio } from "@/lib/audio";
import { loadDetector, type Detector } from "@/lib/detector";
import { drawOverlay } from "@/lib/draw";
import { RadarEngine } from "@/lib/engine";
import { runFrameLoop } from "@/lib/frames";
import { createProjector, type Projector } from "@/lib/homography";
import { DEFAULT_SPEED_OPTIONS } from "@/lib/speed";
import { limitToMps, type ModelVariant, type Settings } from "@/lib/settings";
import type { Violation } from "@/lib/types";

export type Source =
  | { kind: "camera"; deviceId?: string }
  | { kind: "file"; url: string; name: string };

export type RadarStatus = "idle" | "loading-model" | "starting" | "running" | "error";

export type RadarStats = {
  fps: number;
  vehicles: number;
  measuring: number;
  speeding: number;
};

const MAX_VIOLATIONS = 100;
const STATS_INTERVAL_MS = 250;
const SNAPSHOT_WIDTH = 360;

type UseRadarArgs = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  settings: Settings;
};

export function useRadar({ videoRef, canvasRef, settings }: UseRadarArgs) {
  const [status, setStatus] = useState<RadarStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [stats, setStats] = useState<RadarStats>({ fps: 0, vehicles: 0, measuring: 0, speeding: 0 });
  const [violations, setViolations] = useState<Violation[]>([]);

  const engineRef = useRef<RadarEngine>(null);
  engineRef.current ??= new RadarEngine();

  const detectorRef = useRef<Detector | null>(null);
  const detectorVariantRef = useRef<ModelVariant | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // La calibracion solo se recalcula cuando cambian sus valores, no cada frame.
  const projector: Projector | null = useMemo(
    () => createProjector(settings.calibration),
    [settings.calibration],
  );

  // El bucle lee la configuracion viva por referencia: cambiar el limite o la
  // zona surte efecto al instante, sin reiniciar la camara ni el modelo.
  const settingsRef = useRef(settings);
  const projectorRef = useRef(projector);

  useEffect(() => {
    settingsRef.current = settings;
    projectorRef.current = projector;
  }, [settings, projector]);

  useEffect(() => {
    engineRef.current?.setOptions({
      limitMps: limitToMps(settings),
      smoothing: settings.smoothing,
      confirmReadings: settings.confirmReadings,
      speed: { ...DEFAULT_SPEED_OPTIONS, requireInZone: settings.requireInZone },
    });
  }, [settings]);

  const stop = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }

    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    engineRef.current?.reset();
    setSource(null);
    setStatus("idle");
    setStats({ fps: 0, vehicles: 0, measuring: 0, speeding: 0 });
  }, [videoRef, canvasRef]);

  const captureSnapshot = useCallback((): string | undefined => {
    const video = videoRef.current;
    if (!video?.videoWidth) return undefined;
    const canvas = (snapshotCanvasRef.current ??= document.createElement("canvas"));
    const scale = SNAPSHOT_WIDTH / video.videoWidth;
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      return undefined;
    }
  }, [videoRef]);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;

    let frames = 0;
    let lastStatsAt = performance.now();

    stopLoopRef.current = runFrameLoop(video, async (t) => {
      const detector = detectorRef.current;
      const canvas = canvasRef.current;
      if (!detector || !canvas) return;

      const current = settingsRef.current;
      const detections = await detector.detect(video, current.minScore);
      const { vehicles, newViolations } = engine.update(detections, t, projectorRef.current);

      syncCanvasSize(canvas, video);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        drawOverlay(ctx, canvas.width, canvas.height, {
          vehicles,
          calibration: current.calibration,
          units: current.units,
          showZone: current.showZone,
          showTrails: current.showTrails,
          calibrationValid: projectorRef.current !== null,
        });
      }

      if (newViolations.length > 0) {
        const snapshot = captureSnapshot();
        const stamped = newViolations.map((v) => ({ ...v, snapshot }));
        setViolations((prev) => [...stamped, ...prev].slice(0, MAX_VIOLATIONS));
        if (current.soundAlerts) playAlert();
      }

      frames++;
      const now = performance.now();
      const elapsed = now - lastStatsAt;
      if (elapsed >= STATS_INTERVAL_MS) {
        setStats({
          fps: Math.round((frames * 1000) / elapsed),
          vehicles: vehicles.length,
          measuring: vehicles.filter((v) => v.mps !== null).length,
          speeding: vehicles.filter((v) => v.speeding).length,
        });
        frames = 0;
        lastStatsAt = now;
      }
    });
  }, [videoRef, canvasRef, captureSnapshot]);

  const start = useCallback(
    async (next: Source) => {
      const video = videoRef.current;
      if (!video) return;

      stopLoopRef.current?.();
      stopLoopRef.current = null;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      engineRef.current?.reset();

      setError(null);
      setSource(next);

      try {
        const variant = settingsRef.current.modelVariant;
        if (!detectorRef.current || detectorVariantRef.current !== variant) {
          setStatus("loading-model");
          detectorRef.current?.dispose();
          detectorRef.current = null;
          const detector = await loadDetector(variant);
          detectorRef.current = detector;
          detectorVariantRef.current = variant;
          setBackend(detector.backend);
        }

        setStatus("starting");

        if (next.kind === "camera") {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: next.deviceId
              ? { deviceId: { exact: next.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
              : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          streamRef.current = stream;
          video.srcObject = null;
          video.src = "";
          video.srcObject = stream;
          video.loop = false;
        } else {
          video.srcObject = null;
          video.src = next.url;
          video.loop = true;
        }

        await video.play();
        await waitForVideoData(video);
        await unlockAudio();

        startLoop();
        setStatus("running");
      } catch (err) {
        console.error("[radar] no se pudo iniciar", err);
        setError(describeError(err));
        setStatus("error");
      }
    },
    [videoRef, startLoop],
  );

  useEffect(() => {
    return () => {
      stopLoopRef.current?.();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      detectorRef.current?.dispose();
    };
  }, []);

  const clearViolations = useCallback(() => setViolations([]), []);

  return {
    status,
    error,
    backend,
    stats,
    source,
    violations,
    projector,
    calibrationValid: projector !== null,
    start,
    stop,
    clearViolations,
  };
}

function syncCanvasSize(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((rect.width || video.videoWidth) * dpr);
  const h = Math.round((rect.height || video.videoHeight) * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function waitForVideoData(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("No se pudo leer el video"));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
  });
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return "Permiso de camara denegado. Habilitalo en el navegador y volve a intentar.";
    }
    if (err.name === "NotFoundError") return "No se encontro ninguna camara disponible.";
    if (err.name === "NotReadableError") return "La camara esta siendo usada por otra aplicacion.";
  }
  if (err instanceof Error) return err.message;
  return "Ocurrio un error inesperado.";
}
