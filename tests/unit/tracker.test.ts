import { describe, expect, it } from "vitest";
import { bboxCenter, groundPoint, iou, VehicleTracker } from "@/lib/tracker";
import type { BBox, Detection } from "@/lib/types";

function det(bbox: BBox, label = "car", score = 0.9): Detection {
  return { bbox, label, score };
}

describe("iou", () => {
  it("da 1 cuando las cajas se solapan por completo", () => {
    const a: BBox = { x: 0, y: 0, w: 10, h: 10 };
    const b: BBox = { x: 0, y: 0, w: 10, h: 10 };
    expect(iou(a, b)).toBeCloseTo(1, 9);
  });

  it("da 0 cuando las cajas no se solapan", () => {
    const a: BBox = { x: 0, y: 0, w: 10, h: 10 };
    const b: BBox = { x: 100, y: 100, w: 10, h: 10 };
    expect(iou(a, b)).toBe(0);
  });

  it("calcula un solapamiento parcial (verificado a mano)", () => {
    // Interseccion 5x5=25, union 100+100-25=175 -> iou = 1/7.
    const a: BBox = { x: 0, y: 0, w: 10, h: 10 };
    const b: BBox = { x: 5, y: 5, w: 10, h: 10 };
    expect(iou(a, b)).toBeCloseTo(1 / 7, 9);
  });
});

describe("groundPoint / bboxCenter", () => {
  const b: BBox = { x: 2, y: 3, w: 4, h: 6 };

  it("groundPoint devuelve el centro del borde inferior", () => {
    expect(groundPoint(b)).toEqual({ x: 4, y: 9 });
  });

  it("bboxCenter devuelve el centro de la caja", () => {
    expect(bboxCenter(b)).toEqual({ x: 4, y: 6 });
  });
});

describe("VehicleTracker", () => {
  it("mantiene el mismo id para una deteccion que se mueve suavemente y acumula hits", () => {
    const tracker = new VehicleTracker();
    let id: number | undefined;

    for (let i = 0; i < 5; i++) {
      const bbox: BBox = { x: i, y: 0, w: 10, h: 10 };
      const tracks = tracker.update([det(bbox)], i * 40);
      expect(tracks).toHaveLength(1);
      if (id === undefined) id = tracks[0].id;
      expect(tracks[0].id).toBe(id);
    }

    const [track] = tracker.getTracks();
    expect(track.hits).toBe(5);
    expect(track.missed).toBe(0);
  });

  it("asigna ids distintos a dos vehiculos separados sin confundirlos", () => {
    const tracker = new VehicleTracker();
    let idA: number | undefined;
    let idB: number | undefined;

    for (let i = 0; i < 3; i++) {
      const bboxA: BBox = { x: i, y: 0, w: 10, h: 10 };
      const bboxB: BBox = { x: 100 + i, y: 0, w: 10, h: 10 };
      const tracks = tracker.update([det(bboxA), det(bboxB)], i * 40);
      expect(tracks).toHaveLength(2);

      const trackA = tracks.find((t) => t.samples.at(-1)!.bbox.x === bboxA.x);
      const trackB = tracks.find((t) => t.samples.at(-1)!.bbox.x === bboxB.x);
      expect(trackA).toBeDefined();
      expect(trackB).toBeDefined();

      if (idA === undefined) idA = trackA!.id;
      if (idB === undefined) idB = trackB!.id;
      expect(trackA!.id).toBe(idA);
      expect(trackB!.id).toBe(idB);
    }

    expect(idA).not.toBe(idB);
    for (const track of tracker.getTracks()) {
      expect(track.hits).toBe(3);
    }
  });

  it("un track sin detecciones sobrevive hasta maxMissed frames y luego desaparece", () => {
    const tracker = new VehicleTracker({ maxMissed: 2 });
    const bbox: BBox = { x: 0, y: 0, w: 10, h: 10 };

    tracker.update([det(bbox)], 0);
    expect(tracker.getTracks()).toHaveLength(1);

    tracker.update([], 1); // missed = 1
    expect(tracker.getTracks()).toHaveLength(1);
    expect(tracker.getTracks()[0].missed).toBe(1);

    tracker.update([], 2); // missed = 2, todavia sobrevive (missed <= maxMissed)
    expect(tracker.getTracks()).toHaveLength(1);
    expect(tracker.getTracks()[0].missed).toBe(2);

    tracker.update([], 3); // missed = 3 > maxMissed -> se descarta
    expect(tracker.getTracks()).toHaveLength(0);
  });

  it("una deteccion que salta demasiado lejos (IoU bajo el umbral) crea un track nuevo", () => {
    const tracker = new VehicleTracker({ iouThreshold: 0.2 });
    tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 0);
    expect(tracker.getTracks()).toHaveLength(1);
    const firstId = tracker.getTracks()[0].id;

    // Sin solapamiento con la caja anterior: no puede ser el mismo track.
    tracker.update([det({ x: 100, y: 100, w: 10, h: 10 })], 40);
    const tracks = tracker.getTracks();
    expect(tracks).toHaveLength(2);

    const oldTrack = tracks.find((t) => t.id === firstId)!;
    const newTrack = tracks.find((t) => t.id !== firstId)!;
    expect(oldTrack.missed).toBe(1);
    expect(newTrack.hits).toBe(1);
    expect(newTrack.id).not.toBe(firstId);
  });

  it("poda el historial segun historyMs pero nunca deja menos de 2 muestras", () => {
    const tracker = new VehicleTracker({ historyMs: 120, iouThreshold: 0.2, maxMissed: 100 });
    const bbox: BBox = { x: 0, y: 0, w: 10, h: 10 };

    for (const t of [0, 50, 100, 150, 200]) {
      tracker.update([det(bbox)], t);
    }

    const [track] = tracker.getTracks();
    // cutoff final = 200 - 120 = 80: solo quedan las muestras con t >= 80.
    expect(track.samples.map((s) => s.t)).toEqual([100, 150, 200]);
  });

  it("nunca poda por debajo de 2 muestras aunque el cutoff las excluya a todas menos una", () => {
    const tracker = new VehicleTracker({ historyMs: 1, iouThreshold: 0.2, maxMissed: 100 });
    const bbox: BBox = { x: 0, y: 0, w: 10, h: 10 };

    for (const t of [0, 100, 200]) {
      tracker.update([det(bbox)], t);
    }

    const [track] = tracker.getTracks();
    expect(track.samples.length).toBeGreaterThanOrEqual(2);
    expect(track.samples.map((s) => s.t)).toEqual([100, 200]);
  });

  it("reset() limpia todos los tracks y reinicia la numeracion de ids", () => {
    const tracker = new VehicleTracker();
    tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 0);
    expect(tracker.getTracks()).toHaveLength(1);

    tracker.reset();
    expect(tracker.getTracks()).toHaveLength(0);

    const tracks = tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 0);
    expect(tracks[0].id).toBe(1);
  });
});
