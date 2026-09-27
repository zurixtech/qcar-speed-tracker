"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import ControlPanel from "@/components/ControlPanel";
import Sheet from "@/components/Sheet";
import VideoStage from "@/components/VideoStage";
import ViolationsPanel from "@/components/ViolationsPanel";
import { useRadar, type Facing, type Source } from "@/hooks/useRadar";
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

type SheetTab = "settings" | "violations";

/**
 * La app es una sola pantalla de celular: camara a pantalla completa, los
 * numeros encima del video y todo lo demas en una hoja que sube desde abajo.
 * No hay layout de escritorio; en una pantalla grande se muestra la misma
 * columna angosta, centrada.
 */
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
  const [sheet, setSheet] = useState<SheetTab | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [hasDemo, setHasDemo] = useState(false);

  const radar = useRadar({ videoRef, canvasRef, settings });
  const running = radar.status === "running";
  const busy = radar.status === "loading-model" || radar.status === "starting";
  const usingCamera = radar.source?.kind === "camera";

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

  const patch = useCallback((p: Partial<Settings>) => {
    updateSettings((prev) => ({ ...prev, ...p }));
  }, []);

  const setQuad = useCallback((quad: Quad) => {
    updateSettings((prev) => ({ ...prev, calibration: { ...prev.calibration, quad } }));
  }, []);

  const startSource = useCallback(
    async (source: Source) => {
      setSheet(null);
      await radar.start(source);
    },
    [radar],
  );

  // El object URL de un video elegido por archivo solo sirve mientras esa
  // sesion esta activa: liberarlo al Detener evita que el navegador retenga
  // en memoria un video que ya no se ve.
  const stopSession = useCallback(() => {
    radar.stop();
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
  }, [radar]);

  const flipCamera = useCallback(() => {
    const next: Facing = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void startSource({ kind: "camera", facing: next });
  }, [facing, startSource]);

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Se limpia siempre, incluso sin archivo: sin esto, elegir el mismo
      // archivo dos veces seguidas no dispara un segundo "change".
      e.target.value = "";
      if (!file) return;
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      const url = URL.createObjectURL(file);
      fileUrlRef.current = url;
      void startSource({ kind: "file", url, name: file.name });
    },
    [startSource],
  );

  // Calibrar es tocar el video: la hoja de ajustes se corre del medio.
  const toggleCalibrating = useCallback(() => {
    setCalibrating((v) => !v);
    setSheet(null);
  }, []);

  return (
    <div className="flex min-h-dvh justify-center bg-black">
      <DesktopHint />

      <main className="relative flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-ink">
        <header
          data-inert-behind-sheet
          className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <h1 className="flex items-center gap-2 text-base font-bold tracking-tight text-white">
            QCar Radar
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-300 uppercase">
              POC
            </span>
          </h1>
          <StatusBadge status={radar.status} fps={radar.stats.fps} />
        </header>

        <div data-inert-behind-sheet className="flex min-h-0 flex-1 flex-col">
        <VideoStage
          videoRef={videoRef}
          canvasRef={canvasRef}
          calibration={settings.calibration}
          calibrationValid={radar.calibrationValid}
          calibrating={calibrating}
          onQuadChange={setQuad}
          placeholder={
            radar.status === "idle" || radar.status === "error" ? (
              <div className="max-w-xs">
                <p className="text-base font-semibold text-slate-100">
                  Apuntá el teléfono a la calle
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Apoyalo firme, tocá <strong>Cámara</strong> y el radar sigue hasta{" "}
                  {settings.maxVehicles === 1 ? "un vehículo" : "dos vehículos"} a la vez,
                  con la velocidad adentro del recuadro.
                </p>
                {radar.error && (
                  <p
                    data-testid="radar-error"
                    role="alert"
                    className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300"
                  >
                    {radar.error}
                  </p>
                )}
              </div>
            ) : busy ? (
              <div
                data-testid="radar-busy"
                role="status"
                aria-live="polite"
                className="w-full max-w-[220px] text-sm text-slate-200"
              >
                <p>
                  {radar.status === "loading-model"
                    ? "Descargando el modelo de detección…"
                    : "Iniciando la cámara…"}
                </p>
                {radar.status === "loading-model" && radar.loadProgress !== null ? (
                  <>
                    <div
                      role="progressbar"
                      aria-label="Progreso de la descarga"
                      aria-valuenow={Math.round(radar.loadProgress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
                    >
                      <div
                        className="h-full rounded-full bg-sky-500 transition-[width]"
                        style={{ width: `${Math.round(radar.loadProgress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-slate-400">
                      {Math.round(radar.loadProgress * 100)}%
                    </p>
                  </>
                ) : radar.status === "loading-model" ? (
                  <p className="mt-2 text-xs text-slate-400">Esto puede tardar un rato…</p>
                ) : null}
              </div>
            ) : null
          }
        >
          <StatsStrip
            vehicles={radar.stats.vehicles}
            detected={radar.stats.detected}
            measuring={radar.stats.measuring}
            speeding={radar.stats.speeding}
            limit={`${settings.speedLimit} ${unitLabel(settings.units)}`}
            max={settings.maxVehicles}
          />

          {calibrating && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-3 z-30 flex flex-col items-center gap-2 px-4">
              <p className="rounded-full bg-black/70 px-3 py-1.5 text-center text-[11px] text-slate-200">
                Arrastrá las 4 esquinas sobre el tramo de calle que querés medir.
              </p>
              <button
                type="button"
                data-testid="finish-calibration"
                onClick={toggleCalibrating}
                className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg"
              >
                Listo
              </button>
            </div>
          )}
        </VideoStage>
        </div>

        <nav
          data-inert-behind-sheet
          className="shrink-0 space-y-3 border-t border-edge bg-ink px-4 pt-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2">
            {!running ? (
              <>
                <button
                  type="button"
                  data-testid="start-camera"
                  disabled={busy}
                  onClick={() => void startSource({ kind: "camera", facing })}
                  className="flex-1 rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white active:bg-sky-600 disabled:opacity-50"
                >
                  Cámara
                </button>
                <button
                  type="button"
                  data-testid="pick-file"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-2xl border border-edge px-4 py-3.5 text-sm font-medium text-slate-200 active:bg-panel disabled:opacity-50"
                >
                  Video
                </button>
                {hasDemo && (
                  <button
                    type="button"
                    data-testid="start-demo"
                    disabled={busy}
                    onClick={() => void startSource({ kind: "file", url: DEMO_VIDEO, name: "demo" })}
                    className="rounded-2xl border border-edge px-4 py-3.5 text-sm font-medium text-slate-200 active:bg-panel disabled:opacity-50"
                  >
                    Demo
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="stop"
                  onClick={stopSession}
                  className="flex-1 rounded-2xl bg-red-500 py-3.5 text-sm font-semibold text-white active:bg-red-600"
                >
                  Detener
                </button>
                {usingCamera && (
                  <button
                    type="button"
                    data-testid="flip-camera"
                    aria-label="Cambiar de cámara"
                    onClick={flipCamera}
                    className="rounded-2xl border border-edge px-4 py-3.5 text-sm font-medium text-slate-200 active:bg-panel"
                  >
                    Girar
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="open-settings"
              onClick={() => setSheet((s) => (s === "settings" ? null : "settings"))}
              className="min-h-11 flex-1 rounded-xl border border-edge py-3 text-sm font-medium text-slate-300 active:bg-panel"
            >
              Ajustes
            </button>
            <button
              type="button"
              data-testid="open-violations"
              onClick={() => setSheet((s) => (s === "violations" ? null : "violations"))}
              className="min-h-11 flex-1 rounded-xl border border-edge py-3 text-sm font-medium text-slate-300 active:bg-panel"
            >
              Infracciones
              <span data-testid="violation-badge" className="ml-1 tabular-nums text-slate-400">
                ({radar.violations.length})
              </span>
            </button>
          </div>
        </nav>

        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          accept="video/*"
          onChange={onPickFile}
          className="hidden"
        />

        <Sheet
          open={sheet !== null}
          title={sheet === "violations" ? "Infracciones" : "Ajustes"}
          onClose={() => setSheet(null)}
        >
          {sheet === "settings" && (
            <>
              <ControlPanel
                settings={settings}
                onChange={patch}
                onReset={() => updateSettings(DEFAULT_SETTINGS)}
                calibrating={calibrating}
                onToggleCalibrating={toggleCalibrating}
                calibrationValid={radar.calibrationValid}
                modelLocked={running || busy}
              />
              <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
                <strong>Prueba de concepto.</strong> La velocidad es una estimación basada en la
                calibración y en el ángulo de la cámara. No sirve como prueba legal.
              </p>
            </>
          )}
          {sheet === "violations" && (
            <ViolationsPanel
              violations={radar.violations}
              units={settings.units}
              onClear={radar.clearViolations}
            />
          )}
        </Sheet>
      </main>
    </div>
  );
}

/** En una pantalla grande la app no cambia: solo avisa que es para el celular. */
function DesktopHint() {
  return (
    <p className="pointer-events-none fixed top-1/2 left-8 hidden w-56 -translate-y-1/2 text-xs leading-relaxed text-slate-500 xl:block">
      <strong className="block text-slate-300">QCar Radar es una app de celular.</strong>
      Abrí esta página en el teléfono: necesita la cámara trasera apuntando a la calle. Acá la
      ves tal cual se ve en un móvil.
    </p>
  );
}

function StatusBadge({ status, fps }: { status: string; fps: number }) {
  const tone =
    status === "running"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "error"
        ? "bg-red-500/15 text-red-300"
        : "bg-slate-500/15 text-slate-300";

  const text =
    status === "running"
      ? `En vivo · ${fps} fps`
      : status === "loading-model"
        ? "Cargando…"
        : status === "starting"
          ? "Iniciando…"
          : status === "error"
            ? "Error"
            : "Detenido";

  return (
    <span
      data-testid="radar-status"
      data-status={status}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      {/* Los fps cambian varias veces por segundo: anunciar eso sería ruido.
          Lo que le sirve a un lector de pantalla es solo el cambio de estado. */}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "running" ? "En vivo" : text}
      </span>
    </span>
  );
}

/** Contadores flotando sobre el video: una sola fila, para no tapar la calzada. */
function StatsStrip({
  vehicles,
  detected,
  measuring,
  speeding,
  limit,
  max,
}: {
  vehicles: number;
  detected: number;
  measuring: number;
  speeding: number;
  limit: string;
  max: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap gap-1 p-1.5">
      <Chip label="Autos" tone={vehicles > 0 ? "live" : "default"}>
        <strong data-testid="stat-vehicles" className="text-white">
          {vehicles}
        </strong>
        <span className="text-slate-300">
          /<span data-testid="stat-detected">{detected}</span>
        </span>
        <span className="text-slate-400"> max {max}</span>
      </Chip>
      <Chip label="Midiendo">
        <strong data-testid="stat-measuring" className="text-white">
          {measuring}
        </strong>
      </Chip>
      <Chip label="Exceso" tone={speeding > 0 ? "alert" : "default"}>
        <strong data-testid="stat-speeding" className="text-white">
          {speeding}
        </strong>
      </Chip>
      <Chip label="Límite">
        <strong data-testid="stat-limit" className="text-white">
          {limit}
        </strong>
      </Chip>
    </div>
  );
}

function Chip({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "default" | "alert" | "live";
}) {
  const tones = {
    default: "bg-black/55 text-slate-300",
    live: "bg-black/55 text-emerald-300",
    alert: "bg-red-500/80 text-white",
  } as const;
  return (
    <span
      className={`rounded-lg px-1.5 py-1 text-xs font-medium tabular-nums backdrop-blur-sm ${tones[tone]}`}
    >
      {label} {children}
    </span>
  );
}
