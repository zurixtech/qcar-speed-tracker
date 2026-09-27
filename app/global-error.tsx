"use client";

import { useEffect } from "react";

import { STORAGE_KEY } from "@/lib/settings";

/**
 * Red de salvataje si revienta el layout mismo (error.tsx no cubre eso: React
 * necesita su propio <html>/<body> cuando el arbol de arriba tambien fallo).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[radar] error global", error);
  }, [error]);

  // Estilos en linea: si lo que reventó fue el layout, el <head> con
  // globals.css puede no estar montado, y esta pantalla tiene que verse bien
  // igual sin depender de Tailwind.
  return (
    <html lang="es">
      <body
        style={{
          minHeight: "100dvh",
          margin: 0,
          background: "#060a14",
          color: "#e6ecf8",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>La app no pudo arrancar</p>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#94a3b8", marginTop: 8 }}>
            Pasó un error inesperado al cargar. Reintentá, o restaurá los ajustes guardados si
            persiste.
          </p>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              data-testid="error-retry"
              onClick={reset}
              style={{
                minHeight: 44,
                width: "100%",
                borderRadius: 16,
                border: "none",
                background: "#0ea5e9",
                color: "white",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Reintentar
            </button>
            <button
              type="button"
              data-testid="error-reset-settings"
              onClick={() => {
                try {
                  window.localStorage.removeItem(STORAGE_KEY);
                } catch {
                  // sin localStorage no hay nada que restaurar; igual reintentamos.
                }
                reset();
              }}
              style={{
                minHeight: 44,
                width: "100%",
                borderRadius: 16,
                border: "1px solid #1e2a42",
                background: "transparent",
                color: "#e6ecf8",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Restaurar ajustes
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
