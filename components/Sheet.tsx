"use client";

import { useEffect, useId, useRef } from "react";

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
 *
 * Es un dialog modal de verdad: foco adentro al abrir, foco devuelto al
 * cerrar, y el resto de la pantalla marcado inert para que un lector de
 * pantalla o el tab no se vayan de paseo por la camara mientras esta abierta.
 */
export default function Sheet({ open, title, onClose, children }: Props) {
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // El resto de la app (camara, nav) queda fuera del tab y del arbol de
  // accesibilidad mientras la hoja esta abierta, marcandolo `inert` en vez de
  // duplicar el manejo de foco boton por boton.
  useEffect(() => {
    const rest = document.querySelectorAll<HTMLElement>("[data-inert-behind-sheet]");
    for (const el of rest) {
      if (open) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
    return () => {
      for (const el of rest) el.removeAttribute("inert");
    };
  }, [open]);

  if (!open) return null;

  return (
    <div data-testid="sheet" className="absolute inset-0 z-40 flex flex-col justify-end">
      <div
        aria-hidden="true"
        data-testid="sheet-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <section
        ref={sectionRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88%] flex-col rounded-t-3xl border-t border-edge bg-panel"
      >
        <header className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
          <span className="mx-auto h-1 w-10 rounded-full bg-slate-600" aria-hidden />
        </header>
        <div className="flex shrink-0 items-center justify-between px-4 pb-2">
          <h2 id={titleId} className="text-sm font-semibold text-slate-200">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="close-sheet"
            onClick={onClose}
            className="flex min-h-11 items-center rounded-lg px-3 text-xs font-medium text-slate-400 active:bg-ink"
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
