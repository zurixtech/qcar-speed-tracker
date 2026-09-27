"use client";

import { useEffect } from "react";

import { restoreDefaultSettings } from "@/lib/settingsStore";

/**
 * Limite de errores de Next: si algo revienta en el render (por ejemplo un
 * ajuste guardado que se cuela mal saneado), en el celular la unica salida
 * sin esto es recargar a mano, y si el dato malo persiste en localStorage el
 * crash vuelve enseguida.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[radar] error de render", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
      <div className="w-full max-w-xs space-y-4 text-center">
        <p className="text-base font-semibold text-slate-100">Algo se rompio en la app</p>
        <p className="text-sm leading-relaxed text-slate-400">
          Pasó un error inesperado. Podés reintentar, o restaurar los ajustes guardados si
          seguís viendo lo mismo.
        </p>
        <div className="space-y-2">
          <button
            type="button"
            data-testid="error-retry"
            onClick={reset}
            className="min-h-11 w-full rounded-2xl bg-sky-500 py-3 text-sm font-semibold text-white active:bg-sky-600"
          >
            Reintentar
          </button>
          <button
            type="button"
            data-testid="error-reset-settings"
            onClick={() => {
              restoreDefaultSettings();
              reset();
            }}
            className="min-h-11 w-full rounded-2xl border border-edge py-3 text-sm font-medium text-slate-200 active:bg-panel"
          >
            Restaurar ajustes
          </button>
        </div>
      </div>
    </div>
  );
}
