import { describe, expect, it } from "vitest";

import { RadarEngine } from "@/lib/engine";
import { createProjector } from "@/lib/homography";
import { DEFAULT_SPEED_OPTIONS } from "@/lib/speed";
import { fromKmh, toKmh } from "@/lib/speed";
import { SCENE_CALIBRATION, mulberry32, simulateApproach } from "./helpers/scene";

const projector = createProjector(SCENE_CALIBRATION)!;

/** Corre la simulacion completa y devuelve el ultimo estado del vehiculo. */
function run(
  opts: Parameters<typeof simulateApproach>[0],
  engineOpts: ConstructorParameters<typeof RadarEngine>[0] = {},
) {
  const engine = new RadarEngine({
    // Sin suavizado: asi el test mide el estimador, no el filtro.
    smoothing: 1,
    ...engineOpts,
  });
  const frames = simulateApproach(opts);
  let last = engine.update([], frames[0].t - 100, projector);
  const violations = [];
  for (const frame of frames) {
    last = engine.update(frame.detections, frame.t, projector);
    violations.push(...last.newViolations);
  }
  return { last, violations, frames };
}

describe("RadarEngine sobre una escena sintetica", () => {
  it("mide la velocidad real de un vehiculo a 60 km/h", () => {
    const truth = fromKmh(60);
    const { last } = run({ mps: truth, frames: 40 });

    expect(last.vehicles).toHaveLength(1);
    const car = last.vehicles[0];
    expect(car.mps).not.toBeNull();
    expect(car.mps!).toBeCloseTo(truth, 4);
    expect(toKmh(car.mps!)).toBeCloseTo(60, 3);
  });

  it.each([30, 50, 80, 110])("mide correctamente a %i km/h", (kmh) => {
    const truth = fromKmh(kmh);
    const { last } = run({ mps: truth, frames: 40, startY: 28 });
    const car = last.vehicles[0];
    expect(car.mps).not.toBeNull();
    // 1 % de tolerancia absorbe el error numerico de la homografia.
    expect(toKmh(car.mps!)).toBeGreaterThan(kmh * 0.99);
    expect(toKmh(car.mps!)).toBeLessThan(kmh * 1.01);
  });

  it("mantiene un unico track a lo largo de toda la pasada", () => {
    const { frames } = run({ mps: fromKmh(70), frames: 40 });
    const engine = new RadarEngine({ smoothing: 1 });
    const ids = new Set<number>();
    for (const f of frames) {
      for (const v of engine.update(f.detections, f.t, projector).vehicles) ids.add(v.id);
    }
    expect(ids.size).toBe(1);
  });

  it("tolera ruido en las cajas del detector", () => {
    const truth = fromKmh(70);
    // 8 px de ruido sobre un cuadro de 640 px de ancho.
    const { last } = run({
      mps: truth,
      frames: 45,
      jitter: 8 / 640,
      rng: mulberry32(7),
    });
    const car = last.vehicles[0];
    expect(car.mps).not.toBeNull();
    expect(Math.abs(toKmh(car.mps!) - 70)).toBeLessThan(7);
  });

  it("no reporta velocidad si no hay calibracion ni escala automatica", () => {
    const engine = new RadarEngine({
      smoothing: 1,
      speed: { ...DEFAULT_SPEED_OPTIONS, autoScale: false },
    });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 20 });
    let result = engine.update([], frames[0].t - 100, null);
    for (const f of frames) result = engine.update(f.detections, f.t, null);

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].mps).toBeNull();
    expect(result.vehicles[0].reason).toBe("no-calibration");
    expect(result.newViolations).toHaveLength(0);
  });

  it("sin calibracion cae a la escala automatica y marca la lectura como aproximada", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 20 });
    let result = engine.update([], frames[0].t - 100, null);
    for (const f of frames) result = engine.update(f.detections, f.t, null);

    expect(result.vehicles[0].mps).not.toBeNull();
    expect(result.vehicles[0].source).toBe("auto");
  });
});

describe("deteccion de infracciones", () => {
  it("no marca infraccion por debajo del limite", () => {
    const { violations, last } = run(
      { mps: fromKmh(45), frames: 45 },
      { limitMps: fromKmh(60) },
    );
    expect(violations).toHaveLength(0);
    expect(last.vehicles[0].speeding).toBe(false);
  });

  it("marca una sola infraccion por vehiculo en exceso", () => {
    const { violations, last } = run(
      { mps: fromKmh(95), frames: 45 },
      { limitMps: fromKmh(60) },
    );
    expect(violations).toHaveLength(1);
    expect(toKmh(violations[0].mps)).toBeGreaterThan(60);
    expect(toKmh(violations[0].limitMps)).toBeCloseTo(60, 6);
    expect(violations[0].label).toBe("car");
    expect(last.vehicles[0].speeding).toBe(true);
  });

  it("respeta la cantidad de lecturas de confirmacion", () => {
    const strict = run(
      { mps: fromKmh(95), frames: 45 },
      { limitMps: fromKmh(60), confirmReadings: 12 },
    );
    const loose = run(
      { mps: fromKmh(95), frames: 45 },
      { limitMps: fromKmh(60), confirmReadings: 1 },
    );
    expect(loose.violations).toHaveLength(1);
    expect(strict.violations).toHaveLength(1);
    // Con mas confirmaciones la infraccion se registra mas tarde.
    expect(strict.violations[0].id).not.toBe(loose.violations[0].id);
  });

  it("el pico de velocidad nunca queda por debajo de la lectura actual", () => {
    const { last } = run({ mps: fromKmh(80), frames: 45 });
    const car = last.vehicles[0];
    expect(car.peakMps).not.toBeNull();
    expect(car.peakMps!).toBeGreaterThanOrEqual(car.mps!);
  });
});

describe("zona de medicion", () => {
  it("ignora vehiculos fuera de la zona cuando requireInZone esta activo", () => {
    const engine = new RadarEngine({
      smoothing: 1,
      speed: { ...DEFAULT_SPEED_OPTIONS, requireInZone: true, autoScale: false },
    });
    // Caja en la esquina superior izquierda: muy lejos del trapecio calibrado.
    let result = engine.update([], 900, projector);
    for (let i = 0; i < 20; i++) {
      result = engine.update(
        [{ label: "car", score: 0.9, bbox: { x: 0.02, y: 0.02, w: 0.08, h: 0.06 } }],
        1000 + i * 40,
        projector,
      );
    }
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].mps).toBeNull();
    expect(result.vehicles[0].inZone).toBe(false);
  });

  it("la escala aproximada no pisa una lectura ya medida sobre la zona", () => {
    // El auto cruza la zona y se va: en los ultimos frames la homografia se
    // queda sin muestras y solo queda la estimacion por tamano, que es peor.
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(110), frames: 40, startY: 28 });
    let result = engine.update([], frames[0].t - 100, projector);
    for (const f of frames) result = engine.update(f.detections, f.t, projector);

    expect(result.vehicles[0].source).toBe("zone");
    expect(toKmh(result.vehicles[0].mps!)).toBeCloseTo(110, 0);
  });

  it("marca inZone a los vehiculos sobre la calzada calibrada", () => {
    const { last } = run({ mps: fromKmh(60), frames: 40 });
    expect(last.vehicles[0].inZone).toBe(true);
  });
});

describe("la calibracion fija la escala", () => {
  // Propiedad clave del sistema, y la razon por la que la UI insiste tanto con
  // la calibracion: la homografia es lineal en el tamano del rectangulo del
  // mundo, asi que declarar el doble de largo duplica exactamente la velocidad
  // medida. Un error al cargar los metros se traslada entero al resultado.
  it("declarar el doble de largo duplica la velocidad medida", () => {
    const truth = fromKmh(60);

    const read = (lengthMeters: number) => {
      const cal = { ...SCENE_CALIBRATION, lengthMeters };
      const proj = createProjector(cal)!;
      const engine = new RadarEngine({ smoothing: 1 });
      const frames = simulateApproach({
        mps: truth,
        frames: 40,
        // La simulacion usa la escena original: solo cambia lo que se declara.
        calibration: SCENE_CALIBRATION,
      });
      let result = engine.update([], frames[0].t - 100, proj);
      for (const f of frames) result = engine.update(f.detections, f.t, proj);
      return result.vehicles[0].mps!;
    };

    const base = read(SCENE_CALIBRATION.lengthMeters);
    const doble = read(SCENE_CALIBRATION.lengthMeters * 2);
    const mitad = read(SCENE_CALIBRATION.lengthMeters / 2);

    expect(base).toBeCloseTo(truth, 4);
    expect(doble / base).toBeCloseTo(2, 3);
    expect(mitad / base).toBeCloseTo(0.5, 3);
  });
});

describe("equipos lentos", () => {
  // Sin aceleracion por GPU el detector baja a unos pocos fps. Todo el pipeline
  // tiene que seguir funcionando: era el caso que rompia con umbrales contados
  // en frames en vez de en milisegundos.
  it("mide igual a 3 fps estirando la ventana de ajuste", () => {
    const truth = fromKmh(80);
    const { last } = run({ mps: truth, frames: 10, fps: 3, startY: 29 });

    expect(last.vehicles).toHaveLength(1);
    expect(last.vehicles[0].mps).not.toBeNull();
    expect(toKmh(last.vehicles[0].mps!)).toBeGreaterThan(80 * 0.97);
    expect(toKmh(last.vehicles[0].mps!)).toBeLessThan(80 * 1.03);
  });

  it("no deja cajas fantasma cuando el vehiculo sale de cuadro a 2 fps", () => {
    const engine = new RadarEngine({ smoothing: 1 });
    const frames = simulateApproach({ mps: fromKmh(60), frames: 8, fps: 2, startY: 29 });
    for (const f of frames) engine.update(f.detections, f.t, projector);

    // Un solo frame vacio, 500 ms despues: el track ya tiene que haber expirado.
    const after = engine.update([], frames.at(-1)!.t + 500, projector);
    expect(after.vehicles).toHaveLength(0);
  });
});

describe("suavizado", () => {
  // Con velocidad constante el EMA converge al mismo valor con cualquier alfa,
  // asi que el retardo solo se ve sobre una senal que cambia: un auto acelerando.
  const accelerating = { mps: fromKmh(50), accelMps2: 4, frames: 40 } as const;

  it("un suavizado bajo reacciona mas lento que uno alto", () => {
    const fast = run({ ...accelerating }, { smoothing: 1 });
    const slow = run({ ...accelerating }, { smoothing: 0.1 });

    const fastSpeed = fast.last.vehicles[0].mps!;
    const slowSpeed = slow.last.vehicles[0].mps!;
    // Ambos siguen a un vehiculo que acelera: el filtro lento queda atras.
    expect(slowSpeed).toBeGreaterThan(0);
    expect(slowSpeed).toBeLessThan(fastSpeed);
  });

  it("sigue a un vehiculo que acelera", () => {
    const { last, frames } = run({ ...accelerating }, { smoothing: 1 });
    const elapsed = (frames.at(-1)!.t - frames[0].t) / 1000;
    // La regresion promedia una ventana, asi que reporta la velocidad de su
    // punto medio: comparamos contra ese instante, no contra el ultimo frame.
    const windowCenter = elapsed - DEFAULT_SPEED_OPTIONS.windowMs / 2000;
    const expected = accelerating.mps + accelerating.accelMps2 * windowCenter;
    expect(last.vehicles[0].mps!).toBeCloseTo(expected, 1);
  });
});
