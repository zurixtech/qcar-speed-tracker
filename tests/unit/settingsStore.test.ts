import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  flushSettings,
  getSettingsSnapshot,
  resetSettingsStore,
  SAVE_DEBOUNCE_MS,
  subscribeSettings,
  updateSettings,
} from "@/lib/settingsStore";

// Ventana minima: el store solo usa localStorage y addEventListener. Se evita
// jsdom para que los tests unitarios sigan siendo codigo puro.
function fakeWindow() {
  const store = new Map<string, string>();
  const handlers = new Map<string, Set<() => void>>();
  const setItem = vi.fn((k: string, v: string) => void store.set(k, v));
  return {
    setItem,
    store,
    fire(type: string) {
      for (const h of handlers.get(type) ?? []) h();
    },
    window: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem,
        removeItem: (k: string) => void store.delete(k),
      },
      addEventListener: (type: string, h: () => void) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(h);
      },
      removeEventListener: (type: string, h: () => void) => handlers.get(type)?.delete(h),
    },
  };
}

let win: ReturnType<typeof fakeWindow>;

beforeEach(() => {
  vi.useFakeTimers();
  win = fakeWindow();
  vi.stubGlobal("window", win.window);
  resetSettingsStore();
});

afterEach(() => {
  resetSettingsStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("settingsStore", () => {
  it("no notifica ni guarda si el valor saneado no cambia", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    updateSettings((prev) => ({ ...prev }));
    // Un valor fuera de rango que el saneo deja igual al actual tampoco cuenta.
    updateSettings((prev) => ({ ...prev, maxVehicles: 2 as const }));
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);

    expect(listener).not.toHaveBeenCalled();
    expect(win.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("actualiza y notifica al instante pero agrupa las escrituras", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    for (let i = 1; i <= 5; i++) updateSettings((prev) => ({ ...prev, speedLimit: 40 + i }));

    expect(getSettingsSnapshot().speedLimit).toBe(45);
    expect(listener).toHaveBeenCalledTimes(5);
    expect(win.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(win.setItem).toHaveBeenCalledTimes(1);
    const [, saved] = win.setItem.mock.calls[0];
    expect(JSON.parse(saved).speedLimit).toBe(45);
    unsubscribe();
  });

  it("escribe lo pendiente en pagehide", () => {
    updateSettings((prev) => ({ ...prev, units: "mph" }));
    expect(win.setItem).not.toHaveBeenCalled();

    win.fire("pagehide");
    expect(win.setItem).toHaveBeenCalledTimes(1);

    // El timer ya no tiene nada que escribir.
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(win.setItem).toHaveBeenCalledTimes(1);
  });

  it("flushSettings sin nada pendiente no escribe", () => {
    flushSettings();
    expect(win.setItem).not.toHaveBeenCalled();
  });

  it("sanea antes de guardar", () => {
    updateSettings({ ...DEFAULT_SETTINGS, speedLimit: 9999 });
    expect(getSettingsSnapshot().speedLimit).toBe(400);
    flushSettings();
    const [, saved] = win.setItem.mock.calls[0];
    expect(JSON.parse(saved).speedLimit).toBe(400);
  });
});
