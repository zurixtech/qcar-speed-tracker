/**
 * Bucle de frames de video.
 *
 * Preferimos `requestVideoFrameCallback`: entrega cada frame una sola vez y da
 * su `mediaTime` exacto. Eso importa mucho aca, porque la velocidad se calcula
 * dividiendo por el tiempo: si usaramos el reloj de pared y el procesamiento no
 * llega a tiempo real (tipico al analizar un archivo), las velocidades saldrian
 * infladas. Con `mediaTime` el resultado es correcto aunque el analisis vaya
 * mas lento que la reproduccion.
 */

/**
 * `isActive` vale false en cuanto se cancela el bucle. El callback lo tiene que
 * consultar despues de cada `await`: un frame en vuelo al momento de detener
 * no debe tocar el motor ni dibujar cajas viejas sobre la fuente nueva.
 */
export type FrameCallback = (timestampMs: number, isActive: () => boolean) => void | Promise<void>;

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (video as VideoWithRVFC).requestVideoFrameCallback === "function";
}

/**
 * Llama a `cb` una vez por frame presentado. La siguiente iteracion se agenda
 * recien cuando `cb` termina, asi que un frame lento nunca encola trabajo.
 * Devuelve la funcion para cancelar el bucle.
 */
export function runFrameLoop(video: HTMLVideoElement, cb: FrameCallback): () => void {
  const el = video as VideoWithRVFC;
  let cancelled = false;
  let rvfcHandle: number | null = null;
  let rafHandle: number | null = null;

  const useRvfc = supportsVideoFrameCallback(video);

  const isActive = () => !cancelled;

  const step = async (timestampMs: number) => {
    if (cancelled) return;
    try {
      await cb(timestampMs, isActive);
    } catch (err) {
      console.error("[frames] error procesando frame", err);
    }
    schedule();
  };

  const schedule = () => {
    if (cancelled) return;
    if (useRvfc) {
      rvfcHandle = el.requestVideoFrameCallback!((_now, metadata) => {
        void step(metadata.mediaTime * 1000);
      });
    } else {
      rafHandle = requestAnimationFrame(() => {
        void step(video.currentTime * 1000);
      });
    }
  };

  schedule();

  return () => {
    cancelled = true;
    if (rvfcHandle !== null) el.cancelVideoFrameCallback?.(rvfcHandle);
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
  };
}
