import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUAD,
  DEFAULT_SETTINGS,
  limitToMps,
  sanitizeSettings,
  type Settings,
} from "@/lib/settings";

describe("sanitizeSettings", () => {
  it("devuelve los valores por defecto para un objeto vacio", () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("devuelve los valores por defecto para null/undefined", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("acota speedLimit al rango [1, 400]", () => {
    expect(sanitizeSettings({ speedLimit: -10 }).speedLimit).toBe(1);
    expect(sanitizeSettings({ speedLimit: 0 }).speedLimit).toBe(1);
    expect(sanitizeSettings({ speedLimit: 9999 }).speedLimit).toBe(400);
    expect(sanitizeSettings({ speedLimit: 120 }).speedLimit).toBe(120);
  });

  it("acota minScore al rango [0.05, 0.95]", () => {
    expect(sanitizeSettings({ minScore: -1 }).minScore).toBe(0.05);
    expect(sanitizeSettings({ minScore: 5 }).minScore).toBe(0.95);
    expect(sanitizeSettings({ minScore: 0.6 }).minScore).toBe(0.6);
  });

  it("acota smoothing al rango [0.05, 1]", () => {
    expect(sanitizeSettings({ smoothing: -1 }).smoothing).toBe(0.05);
    expect(sanitizeSettings({ smoothing: 10 }).smoothing).toBe(1);
    expect(sanitizeSettings({ smoothing: 0.5 }).smoothing).toBe(0.5);
  });

  it("acota confirmReadings al rango [1, 15] y lo redondea", () => {
    expect(sanitizeSettings({ confirmReadings: 0 }).confirmReadings).toBe(1);
    expect(sanitizeSettings({ confirmReadings: 100 }).confirmReadings).toBe(15);
    expect(sanitizeSettings({ confirmReadings: 4.6 }).confirmReadings).toBe(5);
  });

  it("acota widthMeters y lengthMeters de la calibracion", () => {
    const tooSmall = sanitizeSettings({ calibration: { widthMeters: 0.01, lengthMeters: 0.01 } });
    expect(tooSmall.calibration.widthMeters).toBe(0.5);
    expect(tooSmall.calibration.lengthMeters).toBe(0.5);

    const tooBig = sanitizeSettings({ calibration: { widthMeters: 999, lengthMeters: 9999 } });
    expect(tooBig.calibration.widthMeters).toBe(200);
    expect(tooBig.calibration.lengthMeters).toBe(500);

    const ok = sanitizeSettings({ calibration: { widthMeters: 8, lengthMeters: 40 } });
    expect(ok.calibration.widthMeters).toBe(8);
    expect(ok.calibration.lengthMeters).toBe(40);
  });

  it("cae al default con valores basura (strings, NaN, null, undefined)", () => {
    const garbage = sanitizeSettings({
      speedLimit: "rapido" as unknown as number,
      minScore: NaN,
      smoothing: null as unknown as number,
      confirmReadings: undefined,
      calibration: { widthMeters: "ancho" as unknown as number, lengthMeters: NaN },
    });
    expect(garbage.speedLimit).toBe(DEFAULT_SETTINGS.speedLimit);
    expect(garbage.minScore).toBe(DEFAULT_SETTINGS.minScore);
    expect(garbage.smoothing).toBe(DEFAULT_SETTINGS.smoothing);
    expect(garbage.confirmReadings).toBe(DEFAULT_SETTINGS.confirmReadings);
    expect(garbage.calibration.widthMeters).toBe(DEFAULT_SETTINGS.calibration.widthMeters);
    expect(garbage.calibration.lengthMeters).toBe(DEFAULT_SETTINGS.calibration.lengthMeters);
  });

  it("sanea un quad de longitud incorrecta al quad por defecto", () => {
    const result = sanitizeSettings({ calibration: { quad: [{ x: 0.1, y: 0.1 }] } });
    expect(result.calibration.quad).toEqual(DEFAULT_QUAD);
  });

  it("sanea un quad que no es un array al quad por defecto", () => {
    const result = sanitizeSettings({ calibration: { quad: "no-es-un-array" } });
    expect(result.calibration.quad).toEqual(DEFAULT_QUAD);
  });

  it("sanea coordenadas no numericas de un punto del quad al valor por defecto de ese punto", () => {
    const result = sanitizeSettings({
      calibration: {
        quad: [
          { x: "malo", y: null },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
      },
    });
    expect(result.calibration.quad[0]).toEqual({ x: DEFAULT_QUAD[0].x, y: DEFAULT_QUAD[0].y });
    expect(result.calibration.quad[1]).toEqual({ x: 0.5, y: 0.5 });
  });

  it("acota las coordenadas del quad fuera de 0..1", () => {
    const result = sanitizeSettings({
      calibration: {
        quad: [
          { x: -5, y: 5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
      },
    });
    expect(result.calibration.quad[0]).toEqual({ x: 0, y: 1 });
  });

  it("units solo acepta 'kmh' o 'mph'", () => {
    expect(sanitizeSettings({ units: "mph" }).units).toBe("mph");
    expect(sanitizeSettings({ units: "kmh" }).units).toBe("kmh");
    expect(sanitizeSettings({ units: "furlongs" as unknown as string }).units).toBe("kmh");
    expect(sanitizeSettings({ units: 123 as unknown as string }).units).toBe("kmh");
  });

  it("modelVariant solo acepta los dos valores validos", () => {
    expect(sanitizeSettings({ modelVariant: "mobilenet_v2" }).modelVariant).toBe("mobilenet_v2");
    expect(sanitizeSettings({ modelVariant: "lite_mobilenet_v2" }).modelVariant).toBe(
      "lite_mobilenet_v2",
    );
    expect(sanitizeSettings({ modelVariant: "otro_modelo" as unknown as string }).modelVariant).toBe(
      "lite_mobilenet_v2",
    );
  });

  it("un objeto valido sobrevive intacto al round-trip", () => {
    const valid: Settings = {
      units: "mph",
      speedLimit: 45,
      minScore: 0.6,
      modelVariant: "mobilenet_v2",
      calibration: {
        quad: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.2 },
          { x: 0.95, y: 0.9 },
          { x: 0.05, y: 0.9 },
        ],
        widthMeters: 10,
        lengthMeters: 40,
      },
      requireInZone: false,
      smoothing: 0.7,
      showZone: false,
      showTrails: false,
      soundAlerts: false,
      confirmReadings: 5,
    };
    expect(sanitizeSettings(valid)).toEqual(valid);
  });
});

describe("limitToMps", () => {
  it("convierte 60 km/h a ~16.667 m/s", () => {
    expect(limitToMps({ speedLimit: 60, units: "kmh" })).toBeCloseTo(16.667, 3);
  });

  it("convierte 60 mph a ~26.822 m/s", () => {
    expect(limitToMps({ speedLimit: 60, units: "mph" })).toBeCloseTo(26.822, 3);
  });
});
