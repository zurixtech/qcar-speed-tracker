"use client";

import { useEffect, useRef, useState } from "react";

import { formatSpeed, formatTime, unitLabel, vehicleLabel } from "@/lib/format";
import { speedIn } from "@/lib/format";
import type { Units, Violation } from "@/lib/types";

type Props = {
  violations: readonly Violation[];
  units: Units;
  onClear: () => void;
};

// Ventana para el segundo toque que confirma "Limpiar". Pasado este tiempo el
// boton vuelve a su estado normal y hay que empezar de nuevo.
const CLEAR_CONFIRM_MS = 3000;

export default function ViolationsPanel({ violations, units, onClear }: Props) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  const handleClearClick = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_MS);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingClear(false);
    onClear();
  };

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">
          Registradas{" "}
          <span data-testid="violation-count" className="text-slate-400 tabular-nums">
            ({violations.length})
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="export-violations"
            onClick={() => downloadCsv(violations, units)}
            disabled={violations.length === 0}
            className="flex min-h-11 items-center rounded-lg border border-edge px-3 text-xs text-slate-300 transition active:bg-ink disabled:opacity-40"
          >
            CSV
          </button>
          <button
            type="button"
            data-testid="clear-violations"
            onClick={handleClearClick}
            disabled={violations.length === 0}
            className={`flex min-h-11 items-center rounded-lg border px-3 text-xs transition disabled:opacity-40 ${
              confirmingClear
                ? "border-red-500/50 bg-red-500/15 text-red-300 active:bg-red-500/25"
                : "border-edge text-slate-300 active:bg-ink"
            }`}
          >
            {confirmingClear ? "¿Borrar todo?" : "Limpiar"}
          </button>
        </div>
      </header>

      {violations.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">
          Todavía no hay vehículos por encima del límite.
        </p>
      ) : (
        <ul data-testid="violation-list" className="space-y-2">
          {violations.map((v) => (
            <li
              key={v.id}
              data-testid="violation-item"
              className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2"
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
                  {/* "auto" es el respaldo sin calibrar: no deberia llegar a una
                      infraccion (ver engine.ts), pero si pasa se marca igual
                      que en el HUD, con "~" adelante. */}
                  {v.source === "auto" ? "~" : ""}
                  {formatSpeed(v.mps, units)} {unitLabel(units)}
                  <span className="ml-1 text-xs font-normal text-red-300/70">
                    (límite {formatSpeed(v.limitMps, units)})
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
  // Revocar en el mismo tick le puede ganar de mano a la descarga en algunos
  // navegadores de celular (Safari sobre todo); un delay corto la deja arrancar.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
