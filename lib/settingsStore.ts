/**
 * Store externo de la configuracion.
 *
 * Se lee con `useSyncExternalStore` en vez de `useState` + `useEffect` porque
 * el valor inicial vive en `localStorage`, que no existe en el servidor. React
 * renderiza el snapshot del servidor (los defaults) durante la hidratacion y
 * despues se reconcilia solo con el valor guardado, sin mismatch de HTML ni un
 * setState extra dentro de un efecto.
 */
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, type Settings } from "./settings";

let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettingsSnapshot(): Settings {
  current ??= loadSettings();
  return current;
}

export function getServerSettingsSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

export function subscribeSettings(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Actualiza la configuracion, la sanea, la persiste y notifica a los suscriptores. */
export function updateSettings(next: Settings | ((prev: Settings) => Settings)): void {
  const previous = getSettingsSnapshot();
  const value = typeof next === "function" ? next(previous) : next;
  const sanitized = sanitizeSettings(value);
  if (sanitized === previous) return;
  current = sanitized;
  saveSettings(sanitized);
  for (const listener of listeners) listener();
}

/** Solo para tests: vuelve el store a su estado inicial. */
export function resetSettingsStore(): void {
  current = null;
  for (const listener of listeners) listener();
}
