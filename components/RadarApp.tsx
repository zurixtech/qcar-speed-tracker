"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import ControlPanel from "@/components/ControlPanel";
import VideoStage from "@/components/VideoStage";
import ViolationsPanel from "@/components/ViolationsPanel";
import { useRadar, type Source } from "@/hooks/useRadar";
import { unitLabel } from "@/lib/format";
import type { Quad } from "@/lib/homography";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import {
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  subscribeSettings,
  updateSettings,
} from "@/lib/settingsStore";

const DEMO_VIDEO = "/demo/traffic.mp4";

export default function RadarApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileUrlRef = useRef<string | null>(null);

  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getServerSettingsSnapshot,
  );
  const [calibrating, setCalibrating] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [hasDemo, setHasDemo] = useState(false);

  const radar = useRadar({ videoRef, canvasRef, settings });
  const running = radar.status === "running";
  const busy = radar.status === "loading-model" || radar.status === "starting";

  useEffect(() => {
    let cancelled = false;
    fetch(DEMO_VIDEO, { method: "HEAD" })
      .then((r) => !cancelled && setHasDemo(r.ok))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, []);

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      // enumerateDevices puede fallar sin permisos: no es critico.
    }
  }, []);

  const patch = useCallback((p: Partial<Settings>) => {
    updateSettings((prev) => ({ ...prev, ...p }));
  }, []);

  const setQuad = useCallback((quad: Quad) => {
    updateSettings((prev) => ({ ...prev, calibration: { ...prev.calibration, quad } }));
  }, []);

  const startSource = useCallback(
    async (source: Source) => {
      await radar.start(source);
      if (source.kind === "camera") void refreshCameras();
    },
    [radar, refreshCameras],
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      const url = URL.createObjectURL(file);
      fileUrlRef.current = url;
      void startSource({ kind: "file", url, name: file.name });
    },
    [startSource],
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            QCar Radar
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-amber-300 uppercase">
              POC
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Deteccion de vehiculos y estimacion de velocidad, 100% en el navegador.
          </p>
        </div>
        <StatusBadge status={radar.status} backend={radar.backend} fps={radar.stats.fps} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <VideoStage
            videoRef={videoRef}
            canvasRef={canvasRef}
            calibration={settings.calibration}
            calibrationValid={radar.calibrationValid}
            calibrating={calibrating}
            onQuadChange={setQuad}
            placeholder={
              radar.status === "idle" || radar.status === "error" ? (
                <div className="max-w-sm">
                  <p className="text-sm font-medium text-slate-200">
                    Elegi una fuente para empezar
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    Apunta la camara a la calzada desde un punto fijo, o carga un video
                    grabado para probar. Despues ajusta la zona y sus medidas reales.
                  </p>
                  {radar.error && (
                    <p
                      data-testid="radar-error"
                      className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300"
                    >
                      {radar.error}
                    </p>
                  )}
                </div>
              ) : busy ? (
                <p data-testid="radar-busy" className="text-sm text-slate-300">
                  {radar.status === "loading-model"
                    ? "Descargando el modelo de deteccion…"
                    : "Iniciando la fuente de video…"}
                </p>
              ) : null
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            {!running ? (
              <>
                <button
                  type="button"
                  data-testid="start-camera"
                  disabled={busy}
                  onClick={() => void startSource({ kind: "camera" })}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
                >
                  Usar camara
                </button>
                <button
                  type="button"
                  data-testid="pick-file"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-panel disabled:opacity-50"
                >
                  Cargar video
                </button>
                {hasDemo && (
                  <button
                    type="button"
                    data-testid="start-demo"
                    disabled={busy}
                    onClick={() =>
                      void startSource({ kind: "file", url: DEMO_VIDEO, name: "demo" })
                    }
                    className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-panel disabled:opacity-50"
                  >
                    Video de demo
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                data-testid="stop"
                onClick={radar.stop}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                Detener
              </button>
            )}

            <input
              ref={fileInputRef}
              data-testid="file-input"
              type="file"
              accept="video/*"
              onChange={onPickFile}
              className="hidden"
            />

            {cameras.length > 1 && !running && (
              <select
                data-testid="camera-select"
                onChange={(e) => void startSource({ kind: "camera", deviceId: e.target.value })}
                className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-200"
                defaultValue=""
              >
                <option value="" disabled>
                  Elegir camara…
                </option>
                {cameras.map((c, i) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camara ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <StatsBar
            vehicles={radar.stats.vehicles}
            measuring={radar.stats.measuring}
            speeding={radar.stats.speeding}
            limit={`${settings.speedLimit} ${unitLabel(settings.units)}`}
          />

          <ViolationsPanel
            violations={radar.violations}
            units={settings.units}
            onClear={radar.clearViolations}
          />

          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200/90">
            <strong>Prueba de concepto.</strong> La velocidad es una estimacion basada en la
            calibracion que cargues y en como se ve el vehiculo desde la camara. No sirve
            como prueba legal ni reemplaza a un radar homologado.
          </p>
        </div>

        <aside>
          <ControlPanel
            settings={settings}
            onChange={patch}
            onReset={() => updateSettings(DEFAULT_SETTINGS)}
            calibrating={calibrating}
            onToggleCalibrating={() => setCalibrating((v) => !v)}
            calibrationValid={radar.calibrationValid}
            modelLocked={running || busy}
          />
        </aside>
      </div>
    </main>
  );
}

function StatusBadge({
  status,
  backend,
  fps,
}: {
  status: string;
  backend: string | null;
  fps: number;
}) {
  const tone =
    status === "running"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "error"
        ? "bg-red-500/15 text-red-300"
        : "bg-slate-500/15 text-slate-300";

  const text =
    status === "running"
      ? `En vivo · ${fps} fps${backend ? ` · ${backend}` : ""}`
      : status === "loading-model"
        ? "Cargando modelo…"
        : status === "starting"
          ? "Iniciando…"
          : status === "error"
            ? "Error"
            : "Detenido";

  return (
    <span
      data-testid="radar-status"
      data-status={status}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      {text}
    </span>
  );
}

function StatsBar({
  vehicles,
  measuring,
  speeding,
  limit,
}: {
  vehicles: number;
  measuring: number;
  speeding: number;
  limit: string;
}) {
  const items = [
    { label: "En cuadro", value: vehicles, testId: "stat-vehicles" },
    { label: "Midiendo", value: measuring, testId: "stat-measuring" },
    { label: "En exceso", value: speeding, testId: "stat-speeding" },
    { label: "Limite", value: limit, testId: "stat-limit" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-edge bg-panel px-3 py-2">
          <p className="text-[11px] tracking-wide text-slate-500 uppercase">{it.label}</p>
          <p data-testid={it.testId} className="text-lg font-bold tabular-nums text-slate-100">
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}
