import { describe, expect, it } from "vitest";

import { RadarEngine } from "@/lib/engine";
import { createProjector } from "@/lib/homography";
import type { Detection } from "@/lib/types";
import { SCENE_CALIBRATION } from "./helpers/scene";

const projector = createProjector(SCENE_CALIBRATION)!;

/** Un auto de tamano fijo, quieto donde se lo pone. */
function car(x: number, y: number, size: number): Detection {
  return { label: "car", score: 0.9, bbox: { x, y, w: size, h: size * 0.75 } };
}

/** Alimenta al motor con los mismos vehiculos durante varios frames. */
function feed(
  engine: RadarEngine,
  frames: Detection[][],
  proj = projector,
  startT = 1000,
  stepMs = 40,
) {
  let last = engine.update([], startT - stepMs, proj);
  frames.forEach((detections, i) => {
    last = engine.update(detections, startT + i * stepMs, proj);
  });
  return last;
}

const repeat = <T,>(value: T, times: number): T[] => Array.from({ length: times }, () => value);

describe("el radar sigue uno o dos vehiculos, no mas", () => {
  const chico = car(0.1, 0.5, 0.06);
  const mediano = car(0.4, 0.55, 0.12);
  const grande = car(0.7, 0.6, 0.2);
  const escena = repeat([chico, mediano, grande], 12);

  it("con maxVehicles=2 sigue a los dos mas grandes y descarta el resto", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 2 });
    const last = feed(engine, escena);

    expect(last.vehicles).toHaveLength(2);
    const anchos = last.vehicles.map((v) => v.bbox.w).sort((a, b) => a - b);
    expect(anchos).toEqual([mediano.bbox.w, grande.bbox.w]);
  });

  it("con maxVehicles=1 se queda solo con el mas cercano", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 1 });
    const last = feed(engine, escena);

    expect(last.vehicles).toHaveLength(1);
    expect(last.vehicles[0].bbox.w).toBe(grande.bbox.w);
  });

  it("informa cuantos vehiculos hay en el cuadro aunque no los siga a todos", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 1 });
    const last = feed(engine, escena);

    expect(last.detected).toBe(3);
    expect(last.vehicles).toHaveLength(1);
  });

  it("no inventa vehiculos si hay menos que el maximo", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 2 });
    const last = feed(engine, repeat([grande], 12));
    expect(last.vehicles).toHaveLength(1);
    expect(last.detected).toBe(1);
  });

  it("solo labra infracciones de los vehiculos que sigue", () => {
    // Limite ridiculamente bajo: cualquier movimiento es infraccion.
    const engine = new RadarEngine({
      smoothing: 1,
      maxVehicles: 1,
      limitMps: 0.1,
      confirmReadings: 1,
      minQuality: 0,
    });

    // Los tres se mueven hacia la camara, pero solo uno se mide.
    const frames = Array.from({ length: 20 }, (_, i) => [
      car(0.1, 0.5 + i * 0.004, 0.06),
      car(0.4, 0.55 + i * 0.004, 0.12),
      car(0.66, 0.6 + i * 0.004, 0.2),
    ]);

    const violations: number[] = [];
    let result = engine.update([], 960, projector);
    frames.forEach((detections, i) => {
      result = engine.update(detections, 1000 + i * 40, projector);
      violations.push(...result.newViolations.map((v) => v.trackId));
    });

    expect(result.vehicles).toHaveLength(1);
    expect(new Set(violations).size).toBeLessThanOrEqual(1);
    for (const trackId of violations) expect(trackId).toBe(result.vehicles[0].id);
  });
});

describe("a quien elige el radar", () => {
  it("prefiere al que esta dentro de la zona calibrada antes que a uno mas grande afuera", () => {
    const dentro = car(0.44, 0.72, 0.07);
    const afuera = car(0.02, 0.02, 0.085);

    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 1 });
    const last = feed(engine, repeat([dentro, afuera], 12));

    expect(last.vehicles).toHaveLength(1);
    expect(last.vehicles[0].inZone).toBe(true);
    expect(last.vehicles[0].bbox.w).toBe(dentro.bbox.w);
  });

  it("no salta de auto por una diferencia menor de tamano", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 1 });
    const elegido = car(0.2, 0.5, 0.12);

    feed(engine, repeat([elegido], 10));
    const antes = engine.update([elegido], 1400, projector).vehicles[0].id;

    // Aparece otro apenas mas grande: no alcanza para robarle el recuadro.
    const rival = car(0.7, 0.5, 0.13);
    let last = engine.update([elegido, rival], 1440, projector);
    for (let i = 0; i < 10; i++) {
      last = engine.update([elegido, rival], 1480 + i * 40, projector);
    }

    expect(last.vehicles).toHaveLength(1);
    expect(last.vehicles[0].id).toBe(antes);
  });

  it("cambia de auto cuando el nuevo es claramente mas cercano", () => {
    const engine = new RadarEngine({ smoothing: 1, maxVehicles: 1 });
    const lejano = car(0.2, 0.5, 0.1);

    feed(engine, repeat([lejano], 10));
    const antes = engine.update([lejano], 1400, projector).vehicles[0].id;

    const cercano = car(0.6, 0.55, 0.3);
    let last = engine.update([lejano, cercano], 1440, projector);
    for (let i = 0; i < 10; i++) {
      last = engine.update([lejano, cercano], 1480 + i * 40, projector);
    }

    expect(last.vehicles).toHaveLength(1);
    expect(last.vehicles[0].id).not.toBe(antes);
    expect(last.vehicles[0].bbox.w).toBe(cercano.bbox.w);
  });
});
