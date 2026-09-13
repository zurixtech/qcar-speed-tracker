/** Bip de alerta para infracciones, generado con WebAudio (sin assets). */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Los navegadores exigen un gesto del usuario antes de reproducir audio. */
export async function unlockAudio(): Promise<void> {
  const audio = getContext();
  if (audio && audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      // Si no se puede desbloquear, simplemente no suena.
    }
  }
}

export function playAlert(): void {
  const audio = getContext();
  if (!audio || audio.state !== "running") return;

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
