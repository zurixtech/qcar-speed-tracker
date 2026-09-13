import { describe, expect, it } from "vitest";
import {
  applyHomography,
  computeHomography,
  createProjector,
  isUsableQuad,
  pointInPolygon,
  signedArea,
  worldQuad,
  type Quad,
} from "@/lib/homography";
import type { Point } from "@/lib/types";

/** Cuadrado unitario en sentido antihorario (y hacia arriba). */
const UNIT_SQUARE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Trapecio tipo "vista desde la banquina": se angosta hacia arriba (horizonte lejano). */
const TRAPEZOID: Quad = [
  { x: 0.3, y: 0.2 },
  { x: 0.7, y: 0.2 },
  { x: 0.95, y: 0.9 },
  { x: 0.05, y: 0.9 },
];

describe("computeHomography / applyHomography", () => {
  it("mapea el cuadrado unitario a si mismo (identidad)", () => {
    const h = computeHomography(UNIT_SQUARE, UNIT_SQUARE);
    expect(h).not.toBeNull();
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.75 },
    ];
    for (const p of pts) {
      const mapped = applyHomography(h!, p);
      expect(mapped).not.toBeNull();
      expect(mapped!.x).toBeCloseTo(p.x, 9);
      expect(mapped!.y).toBeCloseTo(p.y, 9);
    }
  });

  it("escala puramente un quad rectangular (sin perspectiva) a W x L metros", () => {
    const dst = worldQuad({ widthMeters: 7, lengthMeters: 25 });
    const h = computeHomography(UNIT_SQUARE, dst);
    expect(h).not.toBeNull();

    // Al ser el quad de origen un rectangulo (no un trapecio), la homografia
    // es una escala afin pura: cada punto se mapea proporcionalmente.
    const center = applyHomography(h!, { x: 0.5, y: 0.5 });
    expect(center).not.toBeNull();
    expect(center!.x).toBeCloseTo(3.5, 9);
    expect(center!.y).toBeCloseTo(12.5, 9);

    const mid = applyHomography(h!, { x: 0.25, y: 0.75 });
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(1.75, 9);
    expect(mid!.y).toBeCloseTo(18.75, 9);
  });

  it("las 4 esquinas de un trapecio (perspectiva) mapean exactamente a las 4 esquinas del mundo", () => {
    const dst = worldQuad({ widthMeters: 7, lengthMeters: 25 });
    const h = computeHomography(TRAPEZOID, dst);
    expect(h).not.toBeNull();

    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h!, TRAPEZOID[i]);
      expect(mapped).not.toBeNull();
      expect(mapped!.x).toBeCloseTo(dst[i].x, 6);
      expect(mapped!.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("la perspectiva real: el punto medio vertical de la imagen NO cae en L/2 del mundo", () => {
    const widthMeters = 7;
    const lengthMeters = 25;
    const dst = worldQuad({ widthMeters, lengthMeters });
    const h = computeHomography(TRAPEZOID, dst);
    expect(h).not.toBeNull();

    // Centro de la linea que promedia el borde lejano y el borde cercano del trapecio.
    const topMid = { x: (TRAPEZOID[0].x + TRAPEZOID[1].x) / 2, y: (TRAPEZOID[0].y + TRAPEZOID[1].y) / 2 };
    const bottomMid = { x: (TRAPEZOID[2].x + TRAPEZOID[3].x) / 2, y: (TRAPEZOID[2].y + TRAPEZOID[3].y) / 2 };
    const imageMid = { x: (topMid.x + bottomMid.x) / 2, y: (topMid.y + bottomMid.y) / 2 };

    const mapped = applyHomography(h!, imageMid);
    expect(mapped).not.toBeNull();
    // La compresion perspectiva hace que el punto medio de la imagen no
    // corresponda a la mitad de la distancia real: como el trapecio se
    // angosta hacia el borde lejano (y=0.2), esa zona lejana concentra mas
    // metros por pixel, y el punto medio de imagen cae del lado cercano
    // (mas alla de la mitad real de la distancia).
    expect(mapped!.y).not.toBeCloseTo(lengthMeters / 2, 3);
    expect(mapped!.y).toBeGreaterThan(lengthMeters / 2);
  });

  it("ida y vuelta: toWorld seguido de toImage recupera el punto original", () => {
    const projector = createProjector({ quad: TRAPEZOID, widthMeters: 7, lengthMeters: 25 });
    expect(projector).not.toBeNull();

    const originals: Point[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.8 },
      { x: 0.1, y: 0.85 },
    ];
    for (const p of originals) {
      const world = projector!.toWorld(p);
      expect(world).not.toBeNull();
      const back = projector!.toImage(world!);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(p.x, 6);
      expect(back!.y).toBeCloseTo(p.y, 6);
    }
  });

  it("devuelve null para puntos colineales", () => {
    const collinear: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const dst = worldQuad({ widthMeters: 7, lengthMeters: 25 });
    expect(computeHomography(collinear, dst)).toBeNull();
    expect(createProjector({ quad: collinear, widthMeters: 7, lengthMeters: 25 })).toBeNull();
  });

  it("devuelve null para puntos todos iguales", () => {
    const samePoint: Quad = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    const dst = worldQuad({ widthMeters: 7, lengthMeters: 25 });
    expect(computeHomography(samePoint, dst)).toBeNull();
    expect(createProjector({ quad: samePoint, widthMeters: 7, lengthMeters: 25 })).toBeNull();
  });
});

describe("isUsableQuad", () => {
  it("acepta un quad convexo en sentido antihorario", () => {
    expect(isUsableQuad(UNIT_SQUARE)).toBe(true);
  });

  it("acepta un quad convexo en sentido horario", () => {
    const clockwise: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(isUsableQuad(clockwise)).toBe(true);
  });

  it("rechaza un quad autointersectado (moño)", () => {
    // Bowtie con area no nula: los productos cruzados cambian de signo entre
    // vertices consecutivos, asi que no es convexo.
    const bowtie: Quad = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(isUsableQuad(bowtie)).toBe(false);
  });

  it("rechaza un quad de area casi nula", () => {
    const sliver: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.0001 },
      { x: 0, y: 0.0001 },
    ];
    expect(isUsableQuad(sliver)).toBe(false);
  });
});

describe("pointInPolygon", () => {
  it("detecta un punto dentro del poligono", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, UNIT_SQUARE)).toBe(true);
  });

  it("detecta un punto fuera del poligono", () => {
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, UNIT_SQUARE)).toBe(false);
  });

  it("trata los bordes/vertices como parte de adentro", () => {
    expect(pointInPolygon({ x: 0.5, y: 0 }, UNIT_SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, UNIT_SQUARE)).toBe(true);
  });
});

describe("signedArea", () => {
  it("da signo positivo para sentido antihorario y magnitud correcta", () => {
    expect(signedArea(UNIT_SQUARE)).toBeCloseTo(1, 9);
  });

  it("da signo negativo para sentido horario, misma magnitud", () => {
    const clockwise: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(signedArea(clockwise)).toBeCloseTo(-1, 9);
  });
});

describe("createProjector: validacion de medidas", () => {
  it("devuelve null si widthMeters es 0", () => {
    expect(createProjector({ quad: TRAPEZOID, widthMeters: 0, lengthMeters: 25 })).toBeNull();
  });

  it("devuelve null si widthMeters es negativo", () => {
    expect(createProjector({ quad: TRAPEZOID, widthMeters: -5, lengthMeters: 25 })).toBeNull();
  });

  it("devuelve null si lengthMeters es 0", () => {
    expect(createProjector({ quad: TRAPEZOID, widthMeters: 7, lengthMeters: 0 })).toBeNull();
  });

  it("devuelve null si lengthMeters es negativo", () => {
    expect(createProjector({ quad: TRAPEZOID, widthMeters: 7, lengthMeters: -1 })).toBeNull();
  });
});
