"use client";

import { unitLabel } from "@/lib/format";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  calibrating: boolean;
  onToggleCalibrating: () => void;
  calibrationValid: boolean;
  modelLocked: boolean;
};

export default function ControlPanel({
  settings,
  onChange,
  onReset,
  calibrating,
  onToggleCalibrating,
  calibrationValid,
  modelLocked,
}: Props) {
  const cal = settings.calibration;
  const patchCal = (patch: Partial<Settings["calibration"]>) =>
    onChange({ calibration: { ...cal, ...patch } });

  return (
    <div className="space-y-5">
      <Section title="Limite de velocidad">
        <div className="flex items-center gap-3">
          <input
            type="number"
            data-testid="speed-limit"
            min={1}
            max={400}
            value={settings.speedLimit}
            onChange={(e) => onChange({ speedLimit: Number(e.target.value) })}
            className="w-24 rounded-lg border border-edge bg-ink px-3 py-2 text-lg font-semibold tabular-nums"
          />
          <div className="flex overflow-hidden rounded-lg border border-edge">
            {(["kmh", "mph"] as const).map((u) => (
              <button
                key={u}
                type="button"
                data-testid={`units-${u}`}
                onClick={() => onChange({ units: u })}
                className={`px-3 py-2 text-sm font-medium transition ${
                  settings.units === u ? "bg-sky-500 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        </div>
        <input
          type="range"
          min={10}
          max={settings.units === "kmh" ? 160 : 100}
          step={5}
          value={settings.speedLimit}
          onChange={(e) => onChange({ speedLimit: Number(e.target.value) })}
          className="mt-3 w-full accent-sky-500"
          aria-label="Limite de velocidad"
        />
      </Section>

      <Section
        title="Calibracion de la zona"
        hint="Sin esto no hay escala: el radar no puede saber cuantos metros mide un pixel."
      >
        <button
          type="button"
          data-testid="toggle-calibration"
          onClick={onToggleCalibrating}
          className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
            calibrating ? "bg-sky-500 text-white" : "border border-edge text-slate-200 hover:bg-panel"
          }`}
        >
          {calibrating ? "Listo, ocultar esquinas" : "Ajustar zona sobre la calzada"}
        </button>

        {!calibrationValid && (
          <p
            data-testid="calibration-warning"
            className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300"
          >
            La zona esta cruzada o es demasiado chica. Acomoda las 4 esquinas en orden:
            1 y 2 en el extremo lejano, 3 y 4 en el cercano.
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField
            label="Ancho (m)"
            testId="calib-width"
            value={cal.widthMeters}
            min={0.5}
            max={200}
            step={0.5}
            onChange={(widthMeters) => patchCal({ widthMeters })}
          />
          <NumberField
            label="Largo (m)"
            testId="calib-length"
            value={cal.lengthMeters}
            min={0.5}
            max={500}
            step={0.5}
            onChange={(lengthMeters) => patchCal({ lengthMeters })}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Referencia rapida: un carril suele medir 3,5 m de ancho y la linea blanca
          discontinua de ruta 4,5 m con 7,5 m de separacion.
        </p>
      </Section>

      <Section title="Deteccion">
        <RangeField
          label="Confianza minima"
          testId="min-score"
          value={settings.minScore}
          min={0.1}
          max={0.9}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(minScore) => onChange({ minScore })}
        />
        <RangeField
          label="Suavizado"
          testId="smoothing"
          value={settings.smoothing}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(smoothing) => onChange({ smoothing })}
        />
        <RangeField
          label="Lecturas para confirmar"
          testId="confirm-readings"
          value={settings.confirmReadings}
          min={1}
          max={10}
          step={1}
          format={(v) => `${v}`}
          onChange={(confirmReadings) => onChange({ confirmReadings })}
        />
        <label className="mt-3 block text-xs font-medium text-slate-400">
          Modelo
          <select
            data-testid="model-variant"
            value={settings.modelVariant}
            disabled={modelLocked}
            onChange={(e) => onChange({ modelVariant: e.target.value as Settings["modelVariant"] })}
            className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            <option value="lite_mobilenet_v2">Lite MobileNet V2 (rapido)</option>
            <option value="mobilenet_v2">MobileNet V2 (mas preciso)</option>
          </select>
          {modelLocked && (
            <span className="mt-1 block text-[11px] text-slate-500">
              Detene la sesion para cambiar de modelo.
            </span>
          )}
        </label>
      </Section>

      <Section title="Vista">
        <Toggle
          label="Medir solo dentro de la zona"
          testId="require-in-zone"
          checked={settings.requireInZone}
          onChange={(requireInZone) => onChange({ requireInZone })}
        />
        <Toggle
          label="Mostrar zona"
          testId="show-zone"
          checked={settings.showZone}
          onChange={(showZone) => onChange({ showZone })}
        />
        <Toggle
          label="Mostrar trayectorias"
          testId="show-trails"
          checked={settings.showTrails}
          onChange={(showTrails) => onChange({ showTrails })}
        />
        <Toggle
          label="Alerta sonora"
          testId="sound-alerts"
          checked={settings.soundAlerts}
          onChange={(soundAlerts) => onChange({ soundAlerts })}
        />
      </Section>

      <button
        type="button"
        data-testid="reset-settings"
        onClick={onReset}
        className="w-full rounded-lg border border-edge px-3 py-2 text-xs text-slate-400 transition hover:bg-panel hover:text-slate-200"
      >
        Restaurar valores por defecto ({DEFAULT_SETTINGS.speedLimit} km/h)
      </button>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {hint && <p className="mt-1 mb-3 text-xs leading-relaxed text-slate-400">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  testId: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      {label}
      <input
        type="number"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm font-semibold tabular-nums text-slate-100"
      />
    </label>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  testId: string;
}) {
  return (
    <label className="mb-3 block text-xs font-medium text-slate-400">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-slate-200">{format(value)}</span>
      </span>
      <input
        type="range"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-sky-500"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm text-slate-300">
      {label}
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-sky-500"
      />
    </label>
  );
}
