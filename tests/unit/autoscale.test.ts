import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOV_DEG,
  focalFromFov,
  monocularPoint,
  vehicleWidthMeters,
} from "@/lib/autoscale";
import { DEFAULT_SPEED_OPTIONS, estimateSpeed, fromKmh, toKmh } from "@/lib/speed";
import { groundPoint } from "@/lib/tracker";
import type { BBox, Track, TrackSample } from "@/lib/types";

const FOCAL = focalFromFov(DEFAULT_FOV_DEG)!;

/**
 * Camara estenopeica sintetica: dada la posicion de un auto en metros (x cruza
 * la calzada, z hacia adelante), devuelve la caja que veria el detector. Es la
 * inversa exacta de `monocularPoint`, asi que sirve para comprobar que la
 * estimacion recupera la velocidad con la que se genero la escena.
 */
function boxAt(x: number, z: number, label = "car", focal = FOCAL): BBox {
  const w = (focal * vehicleWidthMeters(label)) / z;
  const h = w * 0.8;
  const center = 0.5 + (x * focal) / z;
  return { x: center - w / 2, y: 0.5 - h / 2, w, h };
}

function trackFrom(samples: TrackSample[], label = "car"): Track {
  return {
    id: 1,
    label,
    score: 0.9,
    samples,
    missed: 0,
    hits: samples.length,
    firstSeen: samples[0]?.t ?? 0,
    lastSeen: samples.at(-1)?.t ?? 0,
  };
}

/** Auto alejandose en linea recta a velocidad constante, sin calibracion. */
function recedingTrack(mps: number, { frames = 25, fps = 25, startZ = 20, laneX = 1.5 } = {}) {
  const samples: TrackSample[] = [];
  for (let i = 0; i < frames; i++) {
    const dt = i / fps;
    const bbox = boxAt(laneX, startZ + mps * dt);
    samples.push({ t: 1000 + dt * 1000, bbox, ground: groundPoint(bbox) });
  }
  return trackFrom(samples);
}

describe("focalFromFov", () => {
  it("a 90 grados la focal vale medio ancho de cuadro", () => {
    expect(focalFromFov(90)!).toBeCloseTo(0.5, 9);
  });

  it("un campo de vision mas angosto da una focal mas larga", () => {
    expect(focalFromFov(40)!).toBeGreaterThan(focalFromFov(80)!);
  });

  it("rechaza angulos sin sentido", () => {
    expect(focalFromFov(0)).toBeNull();
    expect(focalFromFov(180)).toBeNull();
    expect(focalFromFov(-30)).toBeNull();
    expect(focalFromFov(NaN)).toBeNull();
  });
});

describe("monocularPoint", () => {
  it("una caja mas chica esta mas lejos", () => {
    const cerca = monocularPoint({ x: 0.4, y: 0.5, w: 0.2, h: 0.16 }, "car", FOCAL)!;
    const lejos = monocularPoint({ x: 0.45, y: 0.5, w: 0.05, h: 0.04 }, "car", FOCAL)!;
    expect(lejos.y).toBeGreaterThan(cerca.y);
    // La distancia es inversamente proporcional al ancho aparente.
    expect(lejos.y / cerca.y).toBeCloseTo(4, 6);
  });

  it("un vehiculo centrado no tiene corrimiento lateral", () => {
    const p = monocularPoint({ x: 0.45, y: 0.5, w: 0.1, h: 0.08 }, "car", FOCAL)!;
    expect(p.x).toBeCloseTo(0, 12);
  });

  it("recupera la posicion con la que se genero la caja", () => {
    const p = monocularPoint(boxAt(2.5, 30), "car", FOCAL)!;
    expect(p.x).toBeCloseTo(2.5, 6);
    expect(p.y).toBeCloseTo(30, 6);
  });

  it("un colectivo con la misma caja esta mas lejos que un auto", () => {
    const bbox = { x: 0.4, y: 0.5, w: 0.2, h: 0.16 };
    const auto = monocularPoint(bbox, "car", FOCAL)!;
    const bondi = monocularPoint(bbox, "bus", FOCAL)!;
    expect(bondi.y / auto.y).toBeCloseTo(2.55 / 1.8, 6);
  });

  it("descarta cajas demasiado chicas, donde la distancia se dispara", () => {
    expect(monocularPoint({ x: 0.5, y: 0.5, w: 0.005, h: 0.004 }, "car", FOCAL)).toBeNull();
    expect(monocularPoint({ x: 0.5, y: 0.5, w: 0, h: 0 }, "car", FOCAL)).toBeNull();
  });

  it("una clase desconocida cae al ancho de un auto", () => {
    expect(vehicleWidthMeters("nave-espacial")).toBe(vehicleWidthMeters("car"));
  });
});

describe("estimateSpeed sin calibracion", () => {
  it("mide un auto que se aleja usando su propio tamano como escala", () => {
    const truth = fromKmh(60);
    const result = estimateSpeed(recedingTrack(truth), null);

    expect(result.mps).not.toBeNull();
    expect(result.source).toBe("auto");
    expect(toKmh(result.mps!)).toBeCloseTo(60, 3);
  });

  it.each([30, 50, 80, 110])("mide correctamente a %i km/h", (kmh) => {
    const result = estimateSpeed(recedingTrack(fromKmh(kmh)), null);
    expect(toKmh(result.mps!)).toBeGreaterThan(kmh * 0.99);
    expect(toKmh(result.mps!)).toBeLessThan(kmh * 1.01);
  });

  it("la lectura aproximada vale menos que una sobre la zona calibrada", () => {
    const result = estimateSpeed(recedingTrack(fromKmh(60)), null);
    expect(result.quality).toBeGreaterThan(0);
    expect(result.quality).toBeLessThan(1);
  });

  it("no mide nada si la escala automatica esta apagada", () => {
    const result = estimateSpeed(recedingTrack(fromKmh(60)), null, {
      ...DEFAULT_SPEED_OPTIONS,
      autoScale: false,
    });
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("no-calibration");
  });

  it("avisa que el vehiculo esta demasiado lejos para estimar la escala", () => {
    const samples: TrackSample[] = [];
    for (let i = 0; i < 20; i++) {
      const bbox = { x: 0.5, y: 0.3, w: 0.004, h: 0.003 };
      samples.push({ t: 1000 + i * 40, bbox, ground: groundPoint(bbox) });
    }
    const result = estimateSpeed(trackFrom(samples), null);
    expect(result.mps).toBeNull();
    expect(result.reason).toBe("too-small");
  });

  it("el campo de vision escala la lectura: declarar el doble la duplica", () => {
    const track = recedingTrack(fromKmh(60));
    const read = (fovDeg: number) =>
      estimateSpeed(track, null, { ...DEFAULT_SPEED_OPTIONS, fovDeg, maxMps: 200 }).mps!;

    // La focal (y con ella la profundidad) es proporcional a 1/tan(fov/2): el
    // error de campo de vision se traslada entero al numero, igual que el de la
    // cinta metrica en la calibracion manual.
    const halfTan = Math.tan((DEFAULT_FOV_DEG * Math.PI) / 360);
    const angostoDeg = (2 * Math.atan(halfTan / 2) * 180) / Math.PI;

    expect(read(angostoDeg) / read(DEFAULT_FOV_DEG)).toBeCloseTo(2, 3);
  });
});
