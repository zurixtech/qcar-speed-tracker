import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cameraUnavailableReason,
  describeError,
  FriendlyError,
  MESSAGES,
  withTimeout,
} from "@/lib/errors";

function named(name: string, message = "raw english text"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("describeError", () => {
  it("traduce los errores de getUserMedia", () => {
    expect(describeError(named("NotAllowedError"))).toBe(MESSAGES.cameraDenied);
    expect(describeError(named("NotFoundError"))).toBe(MESSAGES.cameraNotFound);
    expect(describeError(named("NotReadableError"))).toBe(MESSAGES.cameraBusy);
    expect(describeError(named("OverconstrainedError"))).toBe(MESSAGES.cameraUnavailable);
    expect(describeError(named("AbortError"))).toBe(MESSAGES.cameraAborted);
    expect(describeError(named("SecurityError"))).toBe(MESSAGES.cameraBlocked);
  });

  it("acepta objetos con name aunque no sean Error (OverconstrainedError en Safari)", () => {
    expect(describeError({ name: "OverconstrainedError", constraint: "deviceId" })).toBe(
      MESSAGES.cameraUnavailable,
    );
  });

  it("con un archivo, NotAllowedError es autoplay y no permiso de camara", () => {
    expect(describeError(named("NotAllowedError"), "file")).toBe(MESSAGES.playBlocked);
    expect(describeError(named("NotSupportedError"), "file")).toBe(MESSAGES.videoUnsupported);
  });

  it("nunca devuelve el mensaje crudo del navegador", () => {
    const raw = new TypeError("Cannot read properties of undefined (reading 'getUserMedia')");
    expect(describeError(raw)).toBe(MESSAGES.unexpected);
    expect(describeError(new Error("Failed to fetch"), "file")).toBe(MESSAGES.unexpected);
    expect(describeError("boom")).toBe(MESSAGES.unexpected);
    expect(describeError(null)).toBe(MESSAGES.unexpected);
  });

  it("respeta los errores ya pensados para el usuario", () => {
    const err = new FriendlyError(MESSAGES.modelLoad, { cause: new Error("403") });
    expect(describeError(err)).toBe(MESSAGES.modelLoad);
    expect(describeError(err, "file")).toBe(MESSAGES.modelLoad);
  });
});

describe("cameraUnavailableReason", () => {
  it("pide https si el contexto no es seguro", () => {
    expect(cameraUnavailableReason({ isSecureContext: false, hasGetUserMedia: false })).toBe(
      MESSAGES.insecure,
    );
  });

  it("avisa si el navegador no tiene getUserMedia", () => {
    expect(cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: false })).toBe(
      MESSAGES.noCamera,
    );
  });

  it("no objeta nada si esta todo disponible", () => {
    expect(cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: true })).toBeNull();
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resuelve con el valor si llega a tiempo", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, () => new Error("t"))).resolves.toBe(42);
  });

  it("propaga el rechazo original", async () => {
    const err = new Error("original");
    await expect(withTimeout(Promise.reject(err), 1000, () => new Error("t"))).rejects.toBe(err);
  });

  it("rechaza con el error de timeout si la promesa no termina", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => {}), 500, () => new FriendlyError("tarde"));
    const assertion = expect(pending).rejects.toThrow("tarde");
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});
