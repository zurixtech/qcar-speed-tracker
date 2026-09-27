/**
 * Mensajes de error para el usuario.
 *
 * Los errores del navegador (getUserMedia, play(), TF.js) llegan en ingles y
 * con jerga tecnica; en el celular eso no le sirve a nadie. Aca se traducen a
 * un texto corto que dice que hacer. El detalle original se loguea en consola,
 * nunca se muestra.
 */

export const MESSAGES = {
  insecure: "La cámara necesita una conexión segura. Abrí la app desde una dirección https.",
  noCamera: "Este navegador no permite usar la cámara. Probá con Chrome o Safari.",
  cameraDenied: "Permiso de cámara denegado. Habilitalo en el navegador y volvé a intentar.",
  cameraNotFound: "No se encontró ninguna cámara disponible.",
  cameraBusy: "La cámara está siendo usada por otra aplicación. Cerrala y volvé a intentar.",
  cameraUnavailable: "La cámara elegida no está disponible. Probá con la otra.",
  cameraAborted: "No se pudo abrir la cámara. Volvé a intentar.",
  cameraBlocked: "El navegador bloqueó el acceso a la cámara en esta página.",
  cameraEnded: "La cámara se desconectó. Tocá Cámara para reanudar.",
  playBlocked: "El navegador no dejó reproducir el video. Tocá de nuevo para reintentar.",
  videoUnsupported: "El navegador no puede reproducir este video. Probá con un MP4 o WebM.",
  videoUnreadable: "No se pudo leer el video.",
  videoTimeout: "El video no arrancó a tiempo. Volvé a intentar.",
  modelLoad: "No se pudo descargar el modelo de detección. Revisá la conexión y reintentá.",
  modelTimeout: "La descarga del modelo tardó demasiado. Revisá la conexión y reintentá.",
  gpuLost: "Se perdió la aceleración gráfica. Tocá Cámara para reintentar.",
  unexpected: "Ocurrió un error inesperado. Volvé a intentar.",
} as const;

/**
 * Error cuyo `message` ya esta listo para mostrarse. Se usa para los fallos
 * que detectamos nosotros (timeouts, contexto inseguro, modelo) y conserva la
 * causa original para el log.
 */
export class FriendlyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FriendlyError";
  }
}

export type SourceKind = "camera" | "file";

/**
 * Traduce cualquier error a un texto para el usuario. Se mira `name` y no
 * `instanceof DOMException` porque `OverconstrainedError` no hereda de
 * DOMException en todos los navegadores.
 */
export function describeError(err: unknown, kind: SourceKind = "camera"): string {
  if (err instanceof FriendlyError) return err.message;
  const name = errorName(err);
  if (kind === "camera") {
    switch (name) {
      case "NotAllowedError":
        return MESSAGES.cameraDenied;
      case "NotFoundError":
        return MESSAGES.cameraNotFound;
      case "NotReadableError":
        return MESSAGES.cameraBusy;
      case "OverconstrainedError":
        return MESSAGES.cameraUnavailable;
      case "AbortError":
        return MESSAGES.cameraAborted;
      case "SecurityError":
        return MESSAGES.cameraBlocked;
    }
  } else {
    // Con un archivo, NotAllowedError viene de play() (autoplay), no de permisos.
    switch (name) {
      case "NotAllowedError":
        return MESSAGES.playBlocked;
      case "NotSupportedError":
        return MESSAGES.videoUnsupported;
    }
  }
  return MESSAGES.unexpected;
}

function errorName(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/**
 * Devuelve el motivo por el que no se puede pedir la camara, o null si se
 * puede. Sin contexto seguro (http en una IP de la LAN) `mediaDevices` ni
 * existe y el error nativo seria un TypeError incomprensible.
 */
export function cameraUnavailableReason(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}): string | null {
  if (!env.isSecureContext) return MESSAGES.insecure;
  if (!env.hasGetUserMedia) return MESSAGES.noCamera;
  return null;
}

/**
 * Rechaza con `onTimeout()` si la promesa no se resuelve en `ms`. La promesa
 * original sigue corriendo: quien llama decide que hacer con su resultado.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
