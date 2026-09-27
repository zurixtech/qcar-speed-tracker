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

import { installAudioUnlock, playAlert, unlockAudio } from "@/lib/audio";
// Solo tipos: el modulo real (todo TF.js, ~1 MB) se baja con `import()` al
// iniciar la primera sesion, asi no pesa en la carga inicial de la pagina.
import type { Detector } from "@/lib/detector";
import { drawOverlay } from "@/lib/draw";
import { RadarEngine } from "@/lib/engine";
import {
  cameraUnavailableReason,
  describeError,
  FriendlyError,
  MESSAGES,
  withTimeout,
  type SourceKind,
} from "@/lib/errors";
import { runFrameLoop } from "@/lib/frames";
import { createProjector, type Projector } from "@/lib/homography";
import { DEFAULT_SPEED_OPTIONS } from "@/lib/speed";
import { containRect } from "@/lib/view";
import { limitToMps, type ModelVariant, type Settings } from "@/lib/settings";
import type { Violation } from "@/lib/types";

export type Facing = "environment" | "user";

export type Source =
  | { kind: "camera"; deviceId?: string; facing?: Facing }
  | { kind: "file"; url: string; name: string };

export type RadarStatus = "idle" | "loading-model" | "starting" | "running" | "error";

export type RadarStats = {
  fps: number;
  /** Vehiculos que el radar esta siguiendo (a lo sumo `maxVehicles`). */
  vehicles: number;
  /** Vehiculos que hay en el cuadro, se sigan o no. */
  detected: number;
  measuring: number;
  speeding: number;
};

const EMPTY_STATS: RadarStats = { fps: 0, vehicles: 0, detected: 0, measuring: 0, speeding: 0 };

const MAX_VIOLATIONS = 100;
const STATS_INTERVAL_MS = 250;
const SNAPSHOT_WIDTH = 360;
/** ~17 MB por datos moviles lentos entran; mas que esto es una red colgada. */
const MODEL_TIMEOUT_MS = 60_000;
const VIDEO_TIMEOUT_MS = 10_000;
/**
 * Fallos seguidos de `detect()` antes de darse por vencido. Uno suelto puede
 * ser un frame raro; una racha es el contexto WebGL perdido (el sistema se lo
 * dio a otra app) y el radar quedaria "en vivo" sin detectar nada.
 */
const MAX_DETECT_FAILURES = 10;
/** Sin frames procesados por este tiempo, el HUD muestra 0 fps. */
const STALL_MS = 2_000;

type DetectorModule = typeof import("@/lib/detector");

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
  const [stats, setStats] = useState<RadarStats>(EMPTY_STATS);
  const [violations, setViolations] = useState<Violation[]>([]);
  // Progreso de descarga del modelo (0..1); null cuando no se esta bajando.
  const [loadProgress, setLoadProgress] = useState<number | null>(null);

  const engineRef = useRef<RadarEngine>(null);
  engineRef.current ??= new RadarEngine();

  const detectorRef = useRef<Detector | null>(null);
  const detectorVariantRef = useRef<ModelVariant | null>(null);
  const detectorModuleRef = useRef<DetectorModule | null>(null);
  // Descarga del modelo en curso. Vive fuera de `start()` para que detener y
  // volver a empezar (o tocar dos veces) reuse la misma descarga.
  const loadingRef = useRef<{ variant: ModelVariant; promise: Promise<Detector> } | null>(null);
  const loadIdRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wakeLockRef = useRef<Promise<WakeLockSentinel | null> | null>(null);
  // Generacion de la sesion: stop(), un start() nuevo o desmontar la
  // incrementan, y lo asincrono de una sesion vieja se descarta al volver.
  const genRef = useRef(0);
  const runningRef = useRef(false);
  const sourceKindRef = useRef<SourceKind>("camera");
  const mountedRef = useRef(true);

  // La calibracion solo se recalcula cuando cambian sus valores. El saneo
  // devuelve un objeto nuevo en cada cambio de ajustes, asi que la clave es el
  // contenido: si no, cambiar el limite reiniciaria las lecturas en curso
  // (el motor las descarta cuando cambia el proyector).
  const calibrationKey = JSON.stringify(settings.calibration);
  const projector: Projector | null = useMemo(
    () => createProjector(JSON.parse(calibrationKey)),
    [calibrationKey],
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
      maxVehicles: settings.maxVehicles,
      speed: {
        ...DEFAULT_SPEED_OPTIONS,
        requireInZone: settings.requireInZone,
        autoScale: settings.autoScale,
        fovDeg: settings.cameraFovDeg,
      },
    });
  }, [settings]);

  // Con el celular quieto en un tripode nadie toca la pantalla: sin esto se
  // apaga a los 30 s y el sistema corta la camara. El navegador suelta el lock
  // solo al ocultarse la pagina, por eso se vuelve a pedir al volver.
  const acquireWakeLock = useCallback(() => {
    if (wakeLockRef.current || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const pending: Promise<WakeLockSentinel | null> = navigator.wakeLock
      .request("screen")
      .then((sentinel) => {
        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === pending) wakeLockRef.current = null;
        });
        return sentinel;
      })
      .catch(() => {
        // Sin permiso o en ahorro de bateria: todo sigue, solo que la pantalla se apaga.
        if (wakeLockRef.current === pending) wakeLockRef.current = null;
        return null;
      });
    wakeLockRef.current = pending;
  }, []);

  const releaseWakeLock = useCallback(() => {
    const pending = wakeLockRef.current;
    wakeLockRef.current = null;
    void pending?.then((sentinel) => sentinel?.release()).catch(() => {});
  }, []);

  /** Corta bucle, camara y video, sin tocar el estado de React. */
  const releaseMedia = useCallback(() => {
    runningRef.current = false;
    stopLoopRef.current?.();
    stopLoopRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }

    // Sin esto las cajas de la sesion anterior quedan pintadas sobre la nueva.
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [videoRef, canvasRef]);

  const stop = useCallback(() => {
    genRef.current++;
    releaseMedia();
    releaseWakeLock();
    engineRef.current?.reset();
    setSource(null);
    setStatus("idle");
    setStats(EMPTY_STATS);
  }, [releaseMedia, releaseWakeLock]);

  /** Termina la sesion y deja el motivo a la vista. */
  const fail = useCallback(
    (message: string) => {
      stop();
      setError(message);
      setStatus("error");
    },
    [stop],
  );

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

  /**
   * Tras perder WebGL el detector y el backend quedan inservibles: se tiran
   * para que el proximo intento cree un contexto nuevo en vez de fallar igual.
   */
  const loseGpu = useCallback(() => {
    detectorRef.current?.dispose();
    detectorRef.current = null;
    detectorVariantRef.current = null;
    detectorModuleRef.current?.resetBackend();
    setBackend(null);
    fail(MESSAGES.gpuLost);
  }, [fail]);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;

    let frames = 0;
    let failures = 0;
    let lastStatsAt = performance.now();
    let lastFrameAt = lastStatsAt;

    const cancelLoop = runFrameLoop(video, async (t, isActive) => {
      const detector = detectorRef.current;
      const canvas = canvasRef.current;
      if (!detector || !canvas) return;

      const current = settingsRef.current;
      let detections;
      try {
        detections = await detector.detect(video, current.minScore);
        failures = 0;
      } catch (err) {
        if (!isActive()) return;
        console.error("[radar] fallo la deteccion", err);
        if (++failures >= MAX_DETECT_FAILURES) loseGpu();
        return;
      }
      // Un frame que estaba en vuelo al detener o cambiar de fuente no debe
      // ensuciar el motor ni dibujar cajas viejas sobre la sesion nueva.
      if (!isActive()) return;
      lastFrameAt = performance.now();

      const { vehicles, detected: detectedCount, newViolations } = engine.update(
        detections,
        t,
        projectorRef.current,
      );

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
          // El frame se dibuja "contenido" en el canvas: sin este rectangulo
          // las cajas caen corridas en cuanto la pantalla no tiene la misma
          // relacion de aspecto que la camara, que en el celular es siempre.
          view: containRect(canvas.width, canvas.height, video.videoWidth, video.videoHeight),
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
          detected: detectedCount,
          measuring: vehicles.filter((v) => v.mps !== null).length,
          speeding: vehicles.filter((v) => v.speeding).length,
        });
        frames = 0;
        lastStatsAt = now;
      }
    });

    // Si el video se congela (camara colgada, decoder trabado) el bucle deja
    // de llamar y el HUD seguiria mostrando los ultimos fps como si nada.
    const watchdog = window.setInterval(() => {
      if (performance.now() - lastFrameAt > STALL_MS) {
        setStats((s) => (s.fps === 0 ? s : { ...s, fps: 0 }));
      }
    }, STALL_MS / 2);

    stopLoopRef.current = () => {
      cancelLoop();
      window.clearInterval(watchdog);
    };
  }, [videoRef, canvasRef, captureSnapshot, loseGpu]);

  /** Devuelve el detector de la variante pedida, bajandolo si hace falta. */
  const ensureDetector = useCallback(async (variant: ModelVariant): Promise<Detector> => {
    if (detectorRef.current && detectorVariantRef.current === variant) return detectorRef.current;

    let loading = loadingRef.current;
    if (!loading || loading.variant !== variant) {
      detectorRef.current?.dispose();
      detectorRef.current = null;
      detectorVariantRef.current = null;

      const id = ++loadIdRef.current;
      const isCurrent = () => loadIdRef.current === id && mountedRef.current;
      setLoadProgress(0);
      const promise = import("@/lib/detector").then((mod) => {
        detectorModuleRef.current = mod;
        return mod.loadDetector(variant, {
          onProgress: (f) => {
            if (isCurrent()) setLoadProgress(f);
          },
        });
      });
      loading = { variant, promise };
      loadingRef.current = loading;
      promise.then(
        (detector) => {
          // Descarga abandonada (timeout, otra variante, desmontado): no se usa.
          if (!isCurrent()) {
            detector.dispose();
            return;
          }
          loadingRef.current = null;
          detectorRef.current = detector;
          detectorVariantRef.current = variant;
          setBackend(detector.backend);
          setLoadProgress(null);
        },
        () => {
          if (!isCurrent()) return;
          loadingRef.current = null;
          setLoadProgress(null);
        },
      );
    }

    const pending = loading;
    try {
      return await withTimeout(
        pending.promise,
        MODEL_TIMEOUT_MS,
        () => new FriendlyError(MESSAGES.modelTimeout),
      );
    } catch (err) {
      if (err instanceof FriendlyError) {
        // Se abandona la descarga colgada para que el reintento arranque de cero.
        if (loadingRef.current === pending) {
          loadIdRef.current++;
          loadingRef.current = null;
          setLoadProgress(null);
        }
        throw err;
      }
      throw new FriendlyError(MESSAGES.modelLoad, { cause: err });
    }
  }, []);

  const start = useCallback(
    async (next: Source) => {
      // iOS solo desbloquea el audio dentro del gesto: tiene que ir antes del
      // primer await, o el bip de las infracciones nunca suena.
      void unlockAudio();

      const video = videoRef.current;
      if (!video) return;

      const gen = ++genRef.current;
      const alive = () => gen === genRef.current;

      releaseMedia();
      engineRef.current?.reset();
      sourceKindRef.current = next.kind;

      setError(null);
      setSource(next);
      setStats(EMPTY_STATS);

      try {
        if (next.kind === "camera") {
          // Antes de bajar el modelo: sin camara no tiene sentido gastar 17 MB.
          const reason = cameraUnavailableReason({
            // Navegadores viejos no exponen la propiedad: se asume seguro.
            isSecureContext: window.isSecureContext !== false,
            hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
          });
          if (reason) throw new FriendlyError(reason);
        }

        const variant = settingsRef.current.modelVariant;
        if (!detectorRef.current || detectorVariantRef.current !== variant) {
          setStatus("loading-model");
        }
        await ensureDetector(variant);
        if (!alive()) return;

        setStatus("starting");

        if (next.kind === "camera") {
          // El celular se sostiene en vertical: se pide un frame alto y no muy
          // grande, que es lo que el detector puede procesar a ritmo decente.
          const size = { width: { ideal: 720 }, height: { ideal: 1280 } };
          const stream = await navigator.mediaDevices.getUserMedia({
            video: next.deviceId
              ? { deviceId: { exact: next.deviceId }, ...size }
              : { facingMode: { ideal: next.facing ?? "environment" }, ...size },
            audio: false,
          });
          if (!alive()) {
            // Llego tarde: la sesion ya se detuvo o se desmonto. Si no se
            // corta aca, la camara queda prendida sin que nadie la use.
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          streamRef.current = stream;
          // Otra app que toma la camara o una llamada terminan el track; sin
          // esto el HUD seguiria "En vivo" con la imagen congelada.
          stream.getVideoTracks()[0]?.addEventListener(
            "ended",
            () => {
              if (alive()) fail(MESSAGES.cameraEnded);
            },
            { once: true },
          );
          video.srcObject = null;
          video.src = "";
          video.srcObject = stream;
          video.loop = false;
        } else {
          video.srcObject = null;
          video.src = next.url;
          video.loop = true;
        }

        await withTimeout(video.play(), VIDEO_TIMEOUT_MS, () => new FriendlyError(MESSAGES.videoTimeout));
        if (!alive()) return;
        await waitForVideoData(video, VIDEO_TIMEOUT_MS);
        if (!alive()) return;

        runningRef.current = true;
        startLoop();
        setStatus("running");
        acquireWakeLock();
      } catch (err) {
        // Una sesion reemplazada ya libero lo suyo; su error no le importa a nadie.
        if (!alive()) return;
        // El detalle tecnico va a la consola; al usuario, un texto que entienda.
        console.error("[radar] no se pudo iniciar", err);
        releaseMedia();
        releaseWakeLock();
        setError(describeError(err, next.kind));
        setStatus("error");
      }
    },
    [videoRef, releaseMedia, releaseWakeLock, ensureDetector, startLoop, fail, acquireWakeLock],
  );

  // Con la pagina oculta no se detecta (nadie mira, gasta bateria y en iOS el
  // video se congela igual); al volver se reanuda donde estaba.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!runningRef.current || !video) return;

      if (document.visibilityState === "hidden") {
        stopLoopRef.current?.();
        stopLoopRef.current = null;
        video.pause();
        return;
      }

      const track = streamRef.current?.getVideoTracks()[0];
      if (track?.readyState === "ended") {
        fail(MESSAGES.cameraEnded);
        return;
      }
      // La velocidad sale de diferencias de tiempo: con el hueco de la pausa
      // los tracks viejos darian lecturas absurdas.
      engineRef.current?.reset();
      const gen = genRef.current;
      video.play().then(
        () => {
          if (gen !== genRef.current || !runningRef.current) return;
          if (!stopLoopRef.current) startLoop();
          acquireWakeLock();
        },
        (err: unknown) => {
          if (gen !== genRef.current) return;
          console.error("[radar] no se pudo reanudar", err);
          fail(describeError(err, sourceKindRef.current));
        },
      );
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [videoRef, fail, startLoop, acquireWakeLock]);

  useEffect(() => installAudioUnlock(), []);

  // Invalida cualquier start() o descarga en vuelo: al volver, se limpian solos.
  const invalidateAll = useCallback(() => {
    genRef.current++;
    loadIdRef.current++;
    loadingRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateAll();
      runningRef.current = false;
      stopLoopRef.current?.();
      stopLoopRef.current = null;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      releaseWakeLock();
      detectorRef.current?.dispose();
      detectorRef.current = null;
      detectorVariantRef.current = null;
    };
  }, [invalidateAll, releaseWakeLock]);

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
    loadProgress,
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

/**
 * Espera a que haya un frame decodificado. Con timeout: una camara o un
 * archivo que nunca entregan datos dejarian la app en "Iniciando" para siempre.
 */
function waitForVideoData(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new FriendlyError(MESSAGES.videoUnreadable));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new FriendlyError(MESSAGES.videoTimeout));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
  });
}
