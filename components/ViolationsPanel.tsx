"use client";

import { formatSpeed, formatTime, unitLabel, vehicleLabel } from "@/lib/format";
import { speedIn } from "@/lib/format";
import type { Units, Violation } from "@/lib/types";

type Props = {
  violations: readonly Violation[];
  units: Units;
  onClear: () => void;
};

export default function ViolationsPanel({ violations, units, onClear }: Props) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">
          Infracciones{" "}
          <span data-testid="violation-count" className="text-slate-500 tabular-nums">
            ({violations.length})
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="export-violations"
            onClick={() => downloadCsv(violations, units)}
            disabled={violations.length === 0}
            className="rounded-lg border border-edge px-2.5 py-1 text-xs text-slate-300 transition hover:bg-ink disabled:opacity-40"
          >
            CSV
          </button>
          <button
            type="button"
            data-testid="clear-violations"
            onClick={onClear}
            disabled={violations.length === 0}
            className="rounded-lg border border-edge px-2.5 py-1 text-xs text-slate-300 transition hover:bg-ink disabled:opacity-40"
          >
            Limpiar
          </button>
        </div>
      </header>

      {violations.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">
          Todavia no hay vehiculos por encima del limite.
        </p>
      ) : (
        <ul data-testid="violation-list" className="max-h-96 space-y-2 overflow-y-auto">
          {violations.map((v) => (
            <li
              key={v.id}
              data-testid="violation-item"
              className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2"
            >
              {v.snapshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.snapshot}
                  alt={`Captura de ${vehicleLabel(v.label)}`}
                  className="h-12 w-20 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-12 w-20 shrink-0 rounded bg-black/40" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-200">
                  {formatSpeed(v.mps, units)} {unitLabel(units)}
                  <span className="ml-1 text-xs font-normal text-red-300/70">
                    (limite {formatSpeed(v.limitMps, units)})
                  </span>
                </p>
                <p className="truncate text-xs text-slate-400">
                  {vehicleLabel(v.label)} · #{v.trackId} · {formatTime(v.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function downloadCsv(violations: readonly Violation[], units: Units): void {
  const unit = unitLabel(units);
  const rows = [
    ["fecha_hora", "track", "vehiculo", `velocidad_${units}`, `limite_${units}`],
    ...violations.map((v) => [
      new Date(v.at).toISOString(),
      String(v.trackId),
      v.label,
      speedIn(v.mps, units).toFixed(1),
      speedIn(v.limitMps, units).toFixed(1),
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `infracciones-${unit.replace("/", "")}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
