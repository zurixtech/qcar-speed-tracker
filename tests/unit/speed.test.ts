import { describe, expect, it } from "vitest";

import { createProjector } from "@/lib/homography";
import {
  DEFAULT_SPEED_OPTIONS,
  estimateSpeed,
  fitVelocity,
  fromKmh,
  fromMph,
  toKmh,
  toMph,
} from "@/lib/speed";
import { groundPoint } from "@/lib/tracker";
import type { BBox, Track, TrackSample } from "@/lib/types";
import { SCENE_CALIBRATION, simulateApproach } from "./helpers/scene";

const projector = createProjector(SCENE_CALIBRATION)!;

function trackFrom(samples: TrackSample[]): Track {
  return {
    id: 1,
    label: "car",
    score: 0.9,
    samples,
    missed: 0,
    hits: samples.length,
    firstSeen: samples[0]?.t ?? 0,
    lastSeen: samples.at(-1)?.t ?? 0,
  };
}

function sample(t: number, bbox: BBox): TrackSample {
  return { t, bbox, ground: groundPoint(bbox) };
}

/** Track sintetico de un auto que recorre la zona a la velocidad indicada. */
function trackAt(mps: number, frames = 30): Track {
  const sim = simulateApproach({ mps, frames });
  return trackFrom(sim.map((f) => sample(f.t, f.detections[0].bbox)));
}

describe("conversion de unidades", () => {
  it("convierte m/s a km/h y mph", () => {
    expect(toKmh(10)).toBeCloseTo(36, 9);
    expect(toMph(10)).toBeCloseTo(22.369362, 5);
  });

  it("las conversiones son reversibles", () => {
    expect(toKmh(fromKmh(87))).toBeCloseTo(87, 9);
    expect(toMph(fromMph(55))).toBeCloseTo(55, 9);
  });

  it("60 km/h equivale a 16.667 m/s y 60 mph a 26.822 m/s", () => {
    expect(fromKmh(60)).toBeCloseTo(16.6667, 4);
    expect(fromMph(60)).toBeCloseTo(26.8224, 4);
  });
});

describe("fitVelocity", () => {
  it("recupera exactamente la pendiente de un movimiento uniforme", () => {
    const times = [0, 0.1, 0.2, 0.3, 0.4];
    const pts = times.map((t) => ({ x: 2 + 3 * t, y: 1 - 4 * t }));
    const fit = fitVelocity(times, pts)!;
    expect(fit.vx).toBeCloseTo(3, 9);
    expect(fit.vy).toBeCloseTo(-4, 9);
    expect(fit.r2).toBeCloseTo(1, 9);
  });

  it("promedia el ruido y baja el r2", () => {
    const times = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const noise = [0.02, -0.03, 0.01, -0.02, 0.03, -0.01];
    const pts = times.map((t, i) => ({ x: 10 * t + noise[i], y: 0 }));
    const fit = fitVelocity(times, pts)!;
    expect(fit.vx).toBeCloseTo(10, 0);
    expect(fit.r2).toBeLessThan(1);
    expect(fit.r2).toBeGreaterThan(0.9);
  });

  it("da r2 = 1 y velocidad cero si el vehiculo esta quieto", () => {
    const times = [0, 0.1, 0.2, 0.3];
    const pts = times.map(() => ({ x: 5, y: 5 }));
    const fit = fitVelocity(times, pts)!;
    expect(fit.vx).toBeCloseTo(0, 12);
    expect(fit.vy).toBeCloseTo(0, 12);
    expect(fit.r2).toBe(1);
  });

  it("devuelve null sin datos suficientes o sin variacion temporal", () => {
    expect(fitVelocity([1], [{ x: 0, y: 0 }])).toBeNull();
    expect(fitVelocity([2, 2, 2], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(fitVelocity([0, 1], [{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("estimateSpeed", () => {
  it("mide la velocidad real de una pasada sintetica", () => {
    const truth = fromKmh(72);
    const result = estimateSpeed(trackAt(truth), projector);
    expect(result.mps).not.toBeNull();
    expect(result.mps!).toBeCloseTo(truth, 4);
    expect(result.quality).toBeGreaterThan(0.9);
  });

  it("informa falta de calibracion cuando no hay proyector", () => {
    const result = estimateSpeed(trackAt(fromKmh(60)), null);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("no-calibration");
    expect(result.quality).toBe(0);
  });

  it("pide mas muestras antes de arriesgar una lectura", () => {
    const sim = simulateApproach({ mps: fromKmh(60), frames: 2 });
    const track = trackFrom(sim.map((f) => sample(f.t, f.detections[0].bbox)));
    const result = estimateSpeed(track, projector);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("insufficient-samples");
  });

  it("pide una ventana temporal minima aunque sobren muestras", () => {
    // 10 frames en 50 ms: muchas muestras, casi sin tiempo entre ellas.
    const sim = simulateApproach({ mps: fromKmh(60), frames: 10, fps: 200 });
    const track = trackFrom(sim.map((f) => sample(f.t, f.detections[0].bbox)));
    const result = estimateSpeed(track, projector);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("insufficient-time");
  });

  it("descarta el vehiculo si esta fuera de la zona calibrada", () => {
    const samples: TrackSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push(sample(1000 + i * 40, { x: 0.01, y: 0.01, w: 0.05, h: 0.04 }));
    }
    const result = estimateSpeed(trackFrom(samples), projector);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("outside-zone");
  });

  it("mide fuera de la zona si requireInZone esta desactivado", () => {
    const truth = fromKmh(60);
    const strict = estimateSpeed(trackAt(truth), projector, {
      ...DEFAULT_SPEED_OPTIONS,
      requireInZone: true,
    });
    const loose = estimateSpeed(trackAt(truth), projector, {
      ...DEFAULT_SPEED_OPTIONS,
      requireInZone: false,
    });
    expect(strict.mps).not.toBeNull();
    expect(loose.mps).not.toBeNull();
  });

  it("rechaza lecturas implausibles (tipico cruce de identidades)", () => {
    // A 300 km/h la zona de 30 m se cruza en ~0,36 s: hace falta muestrear mas
    // rapido para juntar suficientes puntos dentro de la zona.
    const sim = simulateApproach({ mps: fromKmh(300), frames: 40, fps: 120, startY: 29 });
    const track = trackFrom(sim.map((f) => sample(f.t, f.detections[0].bbox)));

    const result = estimateSpeed(track, projector, {
      ...DEFAULT_SPEED_OPTIONS,
      maxMps: fromKmh(150),
    });
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("implausible");

    // Con un techo mas alto, la misma pasada se mide sin problema.
    const permissive = estimateSpeed(track, projector, {
      ...DEFAULT_SPEED_OPTIONS,
      maxMps: fromKmh(400),
    });
    expect(permissive.mps!).toBeCloseTo(fromKmh(300), 3);
  });

  it("un track vacio no rompe nada", () => {
    const result = estimateSpeed(trackFrom([]), projector);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("insufficient-samples");
  });

  it("solo usa las muestras dentro de la ventana temporal", () => {
    const recent = trackAt(fromKmh(60));
    // Una muestra vieja y lejana no debe contaminar la lectura actual.
    const stale = sample(recent.samples[0].t - 5000, { x: 0.5, y: 0.9, w: 0.1, h: 0.08 });
    const withStale = trackFrom([stale, ...recent.samples]);

    const a = estimateSpeed(recent, projector);
    const b = estimateSpeed(withStale, projector);
    expect(b.mps!).toBeCloseTo(a.mps!, 6);
  });
});
