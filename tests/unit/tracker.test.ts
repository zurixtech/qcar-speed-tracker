import { describe, expect, it } from "vitest";
import { bboxCenter, groundPoint, iou, VehicleTracker,
  predictBBox,
  proximityScore,
} from "@/lib/tracker";
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

  it("un track sin detecciones sobrevive hasta maxMissedMs y luego desaparece", () => {
    const tracker = new VehicleTracker({ maxMissedMs: 300 });
    const bbox: BBox = { x: 0, y: 0, w: 10, h: 10 };

    tracker.update([det(bbox)], 1000);
    expect(tracker.getTracks()).toHaveLength(1);

    tracker.update([], 1200); // 200 ms sin match: sobrevive
    expect(tracker.getTracks()).toHaveLength(1);
    expect(tracker.getTracks()[0].missed).toBe(1);

    tracker.update([], 1300); // justo en el limite: todavia sobrevive
    expect(tracker.getTracks()).toHaveLength(1);
    expect(tracker.getTracks()[0].missed).toBe(2);

    tracker.update([], 1301); // pasado el limite: se descarta
    expect(tracker.getTracks()).toHaveLength(0);
  });

  it("la expiracion depende del tiempo y no de la cantidad de frames", () => {
    // Muchos frames en poco tiempo (equipo rapido): el track sigue vivo.
    const fast = new VehicleTracker({ maxMissedMs: 300 });
    fast.update([det({ x: 0, y: 0, w: 10, h: 10 })], 1000);
    for (let i = 1; i <= 8; i++) fast.update([], 1000 + i * 30);
    expect(fast.getTracks()).toHaveLength(1);

    // Pocos frames pero muy espaciados (equipo lento): se descarta igual.
    const slow = new VehicleTracker({ maxMissedMs: 300 });
    slow.update([det({ x: 0, y: 0, w: 10, h: 10 })], 1000);
    slow.update([], 1500);
    expect(slow.getTracks()).toHaveLength(0);
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
    const tracker = new VehicleTracker({ historyMs: 120, iouThreshold: 0.2, maxMissedMs: 100_000 });
    const bbox: BBox = { x: 0, y: 0, w: 10, h: 10 };

    for (const t of [0, 50, 100, 150, 200]) {
      tracker.update([det(bbox)], t);
    }

    const [track] = tracker.getTracks();
    // cutoff final = 200 - 120 = 80: solo quedan las muestras con t >= 80.
    expect(track.samples.map((s) => s.t)).toEqual([100, 150, 200]);
  });

  it("nunca poda por debajo de 2 muestras aunque el cutoff las excluya a todas menos una", () => {
    const tracker = new VehicleTracker({ historyMs: 1, iouThreshold: 0.2, maxMissedMs: 100_000 });
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

describe("matching con prediccion y cercania", () => {
  it("predice la caja extrapolando la velocidad de las ultimas dos muestras", () => {
    const tracker = new VehicleTracker();
    tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 1000);
    tracker.update([det({ x: 10, y: 0, w: 10, h: 10 })], 1100);

    const [track] = tracker.getTracks();
    // 10 px por cada 100 ms: 100 ms mas adelante, 10 px mas a la derecha.
    const predicted = predictBBox(track, 1200)!;
    expect(predicted.x).toBeCloseTo(20, 6);
    expect(predicted.y).toBeCloseTo(0, 6);
    expect(predicted.w).toBe(10);
  });

  it("limita cuanto se extrapola hacia adelante", () => {
    const tracker = new VehicleTracker();
    tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 1000);
    tracker.update([det({ x: 10, y: 0, w: 10, h: 10 })], 1100);

    const [track] = tracker.getTracks();
    // Pedimos 10 s pero el tope son 600 ms: 10 px/100 ms * 600 ms = 60 px.
    const predicted = predictBBox(track, 11_100, 600)!;
    expect(predicted.x).toBeCloseTo(70, 6);
  });

  it("proximityScore decae con la distancia y nunca supera al IoU", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    const cerca = proximityScore(box, { x: 4, y: 0, w: 10, h: 10 }, 2);
    const lejos = proximityScore(box, { x: 12, y: 0, w: 10, h: 10 }, 2);

    expect(cerca).toBeGreaterThan(0);
    expect(lejos).toBeGreaterThan(0);
    expect(cerca).toBeGreaterThan(lejos);
    // Siempre por debajo del umbral de IoU, asi el solapamiento real gana.
    expect(cerca).toBeLessThan(0.2);
  });

  it("proximityScore descarta cajas lejanas o de tamano muy distinto", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(proximityScore(box, { x: 500, y: 500, w: 10, h: 10 }, 2)).toBe(0);
    // Area 25 veces mayor: no puede ser el mismo vehiculo entre dos frames.
    expect(proximityScore(box, { x: 2, y: 2, w: 50, h: 50 }, 2)).toBe(0);
  });

  it("engancha el mismo vehiculo aunque no haya solapamiento entre frames", () => {
    const tracker = new VehicleTracker();
    // Desplazamiento de 12 px con cajas de 10 px: IoU = 0, pero esta cerca.
    tracker.update([det({ x: 0, y: 0, w: 10, h: 10 })], 1000);
    tracker.update([det({ x: 12, y: 0, w: 10, h: 10 })], 1100);

    const tracks = tracker.getTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].hits).toBe(2);
  });

  it("no confunde dos vehiculos distintos que pasan cerca", () => {
    const tracker = new VehicleTracker();
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 30, y: 0, w: 10, h: 10 };

    tracker.update([det(a), det(b)], 1000);
    expect(tracker.getTracks()).toHaveLength(2);
    const [idA, idB] = tracker.getTracks().map((t) => t.id);

    // Ambos avanzan en paralelo: cada uno tiene que quedarse con su propio id.
    tracker.update([det({ ...a, x: 6 }), det({ ...b, x: 36 })], 1100);
    const tracks = tracker.getTracks();
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.id).sort()).toEqual([idA, idB].sort());
    for (const t of tracks) expect(t.hits).toBe(2);
  });
});
