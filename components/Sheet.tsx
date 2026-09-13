"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Hoja que sube desde abajo, el patron nativo de celular para todo lo que no
 * es la camara. Se monta solo cuando esta abierta: asi nada de lo que hay
 * adentro compite con los controles de la pantalla principal.
 */
export default function Sheet({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div data-testid="sheet" className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Cerrar"
        data-testid="sheet-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <section className="relative flex max-h-[88%] flex-col rounded-t-3xl border-t border-edge bg-panel">
        <header className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
          <span className="mx-auto h-1 w-10 rounded-full bg-slate-600" aria-hidden />
        </header>
        <div className="flex shrink-0 items-center justify-between px-4 pb-2">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <button
            type="button"
            data-testid="close-sheet"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 active:bg-ink"
          >
            Cerrar
          </button>
        </div>
        <div
          className="overflow-y-auto overscroll-contain px-4 pt-1"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
