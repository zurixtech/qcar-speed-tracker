/**
 * Store externo de la configuracion.
 *
 * Se lee con `useSyncExternalStore` en vez de `useState` + `useEffect` porque
 * el valor inicial vive en `localStorage`, que no existe en el servidor. React
 * renderiza el snapshot del servidor (los defaults) durante la hidratacion y
 * despues se reconcilia solo con el valor guardado, sin mismatch de HTML ni un
 * setState extra dentro de un efecto.
 */
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type Settings,
} from "./settings";

/**
 * Arrastrar una esquina de la calibracion dispara un update por pointermove;
 * escribir `localStorage` (sincronico) en cada uno traba el hilo principal en
 * celulares lentos. Se agrupan las escrituras y se fuerzan al salir.
 */
export const SAVE_DEBOUNCE_MS = 300;

let current: Settings | null = null;
// Serializacion del valor vigente: sanitizeSettings siempre devuelve un objeto
// nuevo, asi que comparar por referencia nunca detectaba "sin cambios".
let currentJson: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideInstalled = false;
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
  const json = JSON.stringify(sanitized);
  currentJson ??= JSON.stringify(previous);
  if (json === currentJson) return;
  current = sanitized;
  currentJson = json;
  scheduleSave();
  for (const listener of listeners) listener();
}

/** Escribe ya lo pendiente (si hay algo). */
export function flushSettings(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (current) saveSettings(current);
}

function scheduleSave(): void {
  installPagehideFlush();
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (current) saveSettings(current);
  }, SAVE_DEBOUNCE_MS);
}

// `pagehide` es el ultimo evento confiable en el celular (iOS no dispara
// `beforeunload`), y si el sistema mata la app en segundo plano ni eso llega:
// por eso tambien se escribe al quedar oculta.
function installPagehideFlush(): void {
  if (pagehideInstalled || typeof window === "undefined") return;
  pagehideInstalled = true;
  window.addEventListener("pagehide", flushSettings);
  window.addEventListener("visibilitychange", flushWhenHidden);
}

function flushWhenHidden(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") flushSettings();
}

/**
 * Vuelve a los valores por defecto desde la pantalla de error. Borrar solo la
 * clave no alcanza: el store tiene cacheado el valor en memoria (y quiza una
 * escritura pendiente que lo volveria a guardar), asi que el reintento
 * renderizaria la misma configuracion que rompio.
 */
export function restoreDefaultSettings(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  current = sanitizeSettings(DEFAULT_SETTINGS);
  currentJson = JSON.stringify(current);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin localStorage (modo privado, cuota) igual quedan los defaults en memoria.
  }
  for (const listener of listeners) listener();
}

/** Solo para tests: vuelve el store a su estado inicial. */
export function resetSettingsStore(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  current = null;
  currentJson = null;
  pagehideInstalled = false;
  for (const listener of listeners) listener();
}
