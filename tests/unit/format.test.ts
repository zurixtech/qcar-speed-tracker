import { describe, expect, it } from "vitest";

import { formatSpeed, speedHint, speedIn, unitLabel, vehicleLabel } from "@/lib/format";
import { fromKmh, fromMph } from "@/lib/speed";

describe("formatSpeed", () => {
  it("muestra -- cuando no hay lectura o no es finita", () => {
    expect(formatSpeed(null, "kmh")).toBe("--");
    expect(formatSpeed(Number.NaN, "kmh")).toBe("--");
    expect(formatSpeed(Number.POSITIVE_INFINITY, "mph")).toBe("--");
  });

  it("redondea en la unidad elegida", () => {
    expect(formatSpeed(fromKmh(59.6), "kmh")).toBe("60");
    expect(formatSpeed(fromKmh(59.4), "kmh")).toBe("59");
    expect(formatSpeed(fromMph(30), "mph")).toBe("30");
    expect(formatSpeed(0, "kmh")).toBe("0");
  });
});

describe("speedIn / unitLabel", () => {
  it("convierte m/s a la unidad pedida", () => {
    expect(speedIn(10, "kmh")).toBeCloseTo(36, 9);
    expect(speedIn(fromMph(50), "mph")).toBeCloseTo(50, 9);
  });

  it("nombra la unidad", () => {
    expect(unitLabel("kmh")).toBe("km/h");
    expect(unitLabel("mph")).toBe("mph");
  });
});

describe("speedHint", () => {
  it("explica cada motivo sin lectura", () => {
    expect(speedHint("no-calibration")).toBe("sin escala");
    expect(speedHint("outside-zone")).toBe("fuera de zona");
    expect(speedHint("too-small")).toBe("muy lejos");
    expect(speedHint("implausible")).toBe("lectura dudosa");
    expect(speedHint("insufficient-samples")).toBe("midiendo…");
    expect(speedHint("insufficient-time")).toBe("midiendo…");
  });

  it("sin motivo, esta midiendo", () => {
    expect(speedHint(undefined)).toBe("midiendo…");
  });
});

describe("vehicleLabel", () => {
  it("traduce las clases de COCO con tildes (es texto de UI)", () => {
    expect(vehicleLabel("car")).toBe("Auto");
    expect(vehicleLabel("truck")).toBe("Camión");
    expect(vehicleLabel("bus")).toBe("Colectivo");
    expect(vehicleLabel("motorcycle")).toBe("Moto");
    expect(vehicleLabel("bicycle")).toBe("Bici");
  });

  it("deja pasar una etiqueta desconocida tal cual", () => {
    expect(vehicleLabel("xyz")).toBe("xyz");
  });
});
