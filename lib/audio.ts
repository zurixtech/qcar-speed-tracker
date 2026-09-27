/** Bip de alerta para infracciones, generado con WebAudio (sin assets). */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Los navegadores exigen un gesto del usuario antes de reproducir audio, y iOS
 * solo lo acepta si `resume()` se llama sincronicamente dentro del handler del
 * toque: por eso hay que llamar a esta funcion ANTES del primer `await`. La
 * promesa que devuelve se puede ignorar.
 */
export function unlockAudio(): Promise<void> {
  const audio = getContext();
  // iOS usa el estado "interrupted" (llamada, Siri) ademas de "suspended".
  if (!audio || audio.state === "running" || audio.state === "closed") return Promise.resolve();
  return audio.resume().catch(() => {
    // Si no se puede desbloquear, simplemente no suena.
  });
}

/**
 * Re-desbloquea el audio con cualquier toque en la pantalla: iOS vuelve a
 * suspender el contexto tras una interrupcion y el siguiente gesto lo revive.
 * Devuelve la funcion para quitar el listener.
 */
export function installAudioUnlock(): () => void {
  if (typeof document === "undefined") return () => {};
  const onPointerDown = () => {
    // Solo si ya existe: crear el contexto sin que haya radar no aporta nada.
    if (ctx && ctx.state !== "running") void unlockAudio();
  };
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
}

export function playAlert(): void {
  const audio = getContext();
  if (!audio || audio.state === "closed") return;
  // Fuera de un gesto el resume puede fallar; si funciona, el bip agendado
  // suena igual porque el reloj del contexto arranca desde donde quedo.
  if (audio.state !== "running") void unlockAudio();

  const now = audio.currentTime;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  gain.connect(audio.destination);

  const osc = audio.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(660, now + 0.11);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.24);
}
