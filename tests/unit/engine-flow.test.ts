/**
 * Casos de borde del motor: linea de tiempo (loops, saltos, frames repetidos),
 * separacion de escalas y flujo completo de infracciones.
 */
import { describe, expect, it } from "vitest";

import { RadarEngine } from "@/lib/engine";
import { createProjector, type Projector } from "@/lib/homography";
import { DEFAULT_SPEED_OPTIONS, fromKmh, toKmh } from "@/lib/speed";
import type { Detection, Violation } from "@/lib/types";
import { SCENE_CALIBRATION, simulateApproach, type SimFrame } from "./helpers/scene";

const projector = createProjector(SCENE_CALIBRATION)!;

function feed(engine: RadarEngine, frames: SimFrame[], proj: Projector | null = projector) {
  let last = engine.update([], frames[0].t - 100, proj);
  const violations: Violation[] = [...last.newViolations];
  for (const f of frames) {
    last = engine.update(f.detections, f.t, proj);
    violations.push(...last.newViolations);
  }
  return { last, violations };
}

/** El frame de la infraccion viene codificado en el id: `track-t-secuencia`. */
const frameOf = (v: Violation) => Number(v.id.split("-")[1]);

describe("linea de tiempo", () => {
  it("un rebobinado (video en loop) descarta los tracks del recorrido anterior", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    feed(engine, simulateApproach({ mps: fromKmh(60), frames: 40, startT: 10_000 }));

    // El video vuelve a 0: sin reinicio, el track viejo seguiria vivo (t - lastSeen < 0).
    const after = engine.update([], 0, projector);
    expect(after.vehicles).toHaveLength(0);
    expect(after.detected).toBe(0);
  });

  it("despues de un rebobinado vuelve a medir con normalidad", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    feed(engine, simulateApproach({ mps: fromKmh(60), frames: 40, startT: 10_000 }));
    const { last } = feed(engine, simulateApproach({ mps: fromKmh(80), frames: 40, startT: 200 }));

    expect(last.vehicles).toHaveLength(1);
    expect(toKmh(last.vehicles[0].mps!)).toBeCloseTo(80, 1);
  });

  it("un salto grande hacia adelante no reusa historial ni lectura vieja", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 40 });
    const { last } = feed(engine, frames);
    expect(last.vehicles[0].mps).not.toBeNull();

    // Pestana pausada 30 s: misma caja, pero es otro momento.
    const resumed = engine.update(frames.at(-1)!.detections, frames.at(-1)!.t + 30_000, projector);
    expect(resumed.vehicles).toHaveLength(1);
    expect(resumed.vehicles[0].mps).toBeNull();
    expect(resumed.vehicles[0].reason).toBe("insufficient-samples");
  });

  it("un frame con el mismo timestamp devuelve el resultado anterior sin tocar el tracker", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 5 });
    const { last } = feed(engine, frames);
    const t = frames.at(-1)!.t;

    let repeated = last;
    for (let i = 0; i < 50; i++) repeated = engine.update(frames.at(-1)!.detections, t, projector);

    // La estela es el historial del track: si el frame repetido entrara, crece.
    expect(repeated.vehicles[0].trail).toHaveLength(last.vehicles[0].trail.length);
    expect(repeated.vehicles).toEqual(last.vehicles);
  });

  it("un frame repetido no vuelve a emitir la misma infraccion", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(60), confirmReadings: 1 });
    const frames = simulateApproach({ mps: fromKmh(95), frames: 45 });
    let total = 0;
    engine.update([], frames[0].t - 100, projector);
    for (const f of frames) {
      total += engine.update(f.detections, f.t, projector).newViolations.length;
      total += engine.update(f.detections, f.t, projector).newViolations.length;
    }
    expect(total).toBe(1);
  });

  it("ignora timestamps no finitos", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 10 });
    const { last } = feed(engine, frames);
    const bad = engine.update(frames.at(-1)!.detections, Number.NaN, projector);
    expect(bad.vehicles).toEqual(last.vehicles);
  });
});

describe("las dos escalas no se mezclan", () => {
  // Arranca afuera de la zona (y > 30 m): primero lo mide la escala automatica
  // con un campo de vision equivocado a proposito, despues entra al trapecio.
  const setup = (fovDeg = 90) => ({
    engine: new RadarEngine({ speed: { ...DEFAULT_SPEED_OPTIONS, fovDeg } }),
    frames: simulateApproach({ mps: fromKmh(60), frames: 40, startY: 36 }),
  });

  it("al pasar de la escala automatica a la zona, la primera lectura ya es la calibrada", () => {
    const { engine, frames } = setup();
    const readings: { source?: string; mps: number | null }[] = [];
    engine.update([], frames[0].t - 100, projector);
    for (const f of frames) {
      const v = engine.update(f.detections, f.t, projector).vehicles[0];
      if (v) readings.push({ source: v.source, mps: v.mps });
    }

    const firstAuto = readings.findIndex((r) => r.source === "auto");
    const firstZone = readings.findIndex((r) => r.source === "zone");
    expect(firstAuto).toBeGreaterThanOrEqual(0);
    expect(firstZone).toBeGreaterThan(firstAuto);
    // Sin reinicio, el EMA arrastraria la lectura aproximada (muy baja aca).
    expect(toKmh(readings[firstZone].mps!)).toBeCloseTo(60, 0);
  });

  it("el pico tampoco arrastra valores de la escala automatica", () => {
    // Campo de vision angosto: la escala automatica lee de mas.
    const { engine, frames } = setup(25);
    let autoPeak = 0;
    let last = engine.update([], frames[0].t - 100, projector);
    for (const f of frames) {
      last = engine.update(f.detections, f.t, projector);
      const v = last.vehicles[0];
      if (v?.source === "auto") autoPeak = Math.max(autoPeak, toKmh(v.mps!));
    }
    expect(autoPeak).toBeGreaterThan(70);
    expect(last.vehicles[0].source).toBe("zone");
    expect(toKmh(last.vehicles[0].peakMps!)).toBeCloseTo(60, 0);
  });

  it("cambiar la calibracion a mitad de pasada reinicia la lectura en la escala nueva", () => {
    const engine = new RadarEngine({ smoothing: 0.35 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 40 });
    const doubled = createProjector({
      ...SCENE_CALIBRATION,
      lengthMeters: SCENE_CALIBRATION.lengthMeters * 2,
    })!;

    engine.update([], frames[0].t - 100, projector);
    for (const f of frames.slice(0, 25)) engine.update(f.detections, f.t, projector);
    const after = engine.update(frames[25].detections, frames[25].t, doubled).vehicles[0];

    // Con el EMA viejo mezclado, el primer valor quedaria entre 60 y 120.
    expect(toKmh(after.mps!)).toBeCloseTo(120, 0);
    expect(toKmh(after.peakMps!)).toBeCloseTo(120, 0);
  });

  it("cambiar la calibracion no habilita a la escala automatica a releer un vehiculo ya medido en zona", () => {
    const engine = new RadarEngine();
    const frames = simulateApproach({ mps: fromKmh(60), frames: 40 });
    // Una zona chica en otro lado del cuadro: el auto queda afuera.
    const lejos = createProjector({
      ...SCENE_CALIBRATION,
      quad: [
        { x: 0.05, y: 0.05 },
        { x: 0.2, y: 0.05 },
        { x: 0.2, y: 0.15 },
        { x: 0.05, y: 0.15 },
      ],
    })!;

    engine.update([], frames[0].t - 100, projector);
    for (const f of frames.slice(0, 25)) engine.update(f.detections, f.t, projector);
    for (const f of frames.slice(25)) {
      const v = engine.update(f.detections, f.t, lejos).vehicles[0];
      expect(v?.source).not.toBe("auto");
    }
  });
});

describe("flujo de infracciones", () => {
  it("la escala automatica marca exceso pero nunca labra la infraccion", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(5), minQuality: 0 });
    const { last, violations } = feed(
      engine,
      simulateApproach({ mps: fromKmh(95), frames: 45 }),
      null,
    );
    expect(last.vehicles[0].source).toBe("auto");
    expect(last.vehicles[0].speeding).toBe(true);
    expect(violations).toHaveLength(0);
  });

  it("las infracciones labradas vienen de la zona calibrada", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(60) });
    const { violations } = feed(engine, simulateApproach({ mps: fromKmh(95), frames: 45 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe("zone");
  });

  it("no labra infraccion si la calidad es menor a minQuality", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(60), minQuality: 1.01 });
    const { last, violations } = feed(engine, simulateApproach({ mps: fromKmh(95), frames: 45 }));
    expect(last.vehicles[0].speeding).toBe(true);
    expect(violations).toHaveLength(0);
  });

  it("subir el limite a mitad de pasada no genera infraccion", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(60) });
    const frames = simulateApproach({ mps: fromKmh(95), frames: 45 });
    const violations: Violation[] = [];
    engine.update([], frames[0].t - 100, projector);
    frames.forEach((f, i) => {
      if (i === 5) engine.setOptions({ limitMps: fromKmh(200) });
      violations.push(...engine.update(f.detections, f.t, projector).newViolations);
    });
    expect(violations).toHaveLength(0);
  });

  it("con mas confirmaciones la infraccion se labra en un frame posterior", () => {
    const frames = simulateApproach({ mps: fromKmh(95), frames: 45 });
    const strict = feed(
      new RadarEngine({ smoothing: 1, limitMps: fromKmh(60), confirmReadings: 12 }),
      frames,
    );
    const loose = feed(
      new RadarEngine({ smoothing: 1, limitMps: fromKmh(60), confirmReadings: 1 }),
      frames,
    );
    expect(frameOf(strict.violations[0])).toBeGreaterThan(frameOf(loose.violations[0]));
  });

  it("un vehiculo que pierde y recupera el foco no repite la infraccion", () => {
    const engine = new RadarEngine({
      smoothing: 1,
      maxVehicles: 1,
      limitMps: fromKmh(20),
      confirmReadings: 1,
    });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 45 });
    // Un camion quieto y mucho mas grande, del otro lado del cuadro.
    const truck: Detection = {
      label: "truck",
      score: 0.9,
      bbox: { x: 0.6, y: 0.2, w: 0.38, h: 0.3 },
    };

    const byTrack = new Map<number, number>();
    const focused: number[] = [];
    engine.update([], frames[0].t - 100, projector);
    frames.forEach((f, i) => {
      const detections = i >= 15 && i < 25 ? [...f.detections, truck] : f.detections;
      const r = engine.update(detections, f.t, projector);
      focused.push(r.vehicles[0].id);
      for (const v of r.newViolations) byTrack.set(v.trackId, (byTrack.get(v.trackId) ?? 0) + 1);
    });

    const carId = focused[0];
    // El camion le robo el foco un rato y despues el auto lo recupero.
    expect(focused.slice(18, 25).some((id) => id !== carId)).toBe(true);
    expect(focused.at(-1)).toBe(carId);
    expect(byTrack.get(carId)).toBe(1);
  });

  it("los ids de infraccion no se repiten al reiniciar el motor con el mismo video", () => {
    const engine = new RadarEngine({ smoothing: 1, limitMps: fromKmh(60) });
    const frames = simulateApproach({ mps: fromKmh(95), frames: 45 });
    const first = feed(engine, frames).violations;
    engine.reset();
    const second = feed(engine, frames).violations;

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].trackId).toBe(second[0].trackId);
    expect(first[0].id).not.toBe(second[0].id);
  });
});
