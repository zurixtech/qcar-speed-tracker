import { expect, test } from "@playwright/test";

/** Los ajustes viven en la hoja que sube desde abajo: hay que abrirla primero. */
async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("sheet")).toBeVisible();
}

test.describe("UI del radar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("muestra la pantalla inicial con los controles principales", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /QCar Radar/ })).toBeVisible();
    await expect(page.getByTestId("radar-status")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("start-camera")).toBeVisible();
    await expect(page.getByTestId("pick-file")).toBeVisible();
    await expect(page.getByTestId("video-stage")).toBeVisible();
    await expect(page.getByTestId("stat-limit")).toHaveText("60 km/h");

    await openSettings(page);
    await expect(page.getByTestId("speed-limit")).toHaveValue("60");
  });

  test("entra entera en la pantalla del telefono, sin scroll", async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("ofrece el video de demo porque esta publicado", async ({ page }) => {
    await expect(page.getByTestId("start-demo")).toBeVisible();
  });

  test("cambia el limite y las unidades", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("speed-limit").fill("40");
    await page.getByTestId("close-sheet").click();
    await expect(page.getByTestId("stat-limit")).toHaveText("40 km/h");

    await openSettings(page);
    await page.getByTestId("units-mph").click();
    await page.getByTestId("close-sheet").click();
    await expect(page.getByTestId("stat-limit")).toHaveText("40 mph");
  });

  test("sigue uno o dos vehiculos, y lo recuerda", async ({ page }) => {
    // Por defecto son dos: el maximo que entra legible en una pantalla chica.
    await expect(page.getByTestId("stat-vehicles")).toHaveText("0");

    await openSettings(page);
    await expect(page.getByTestId("max-vehicles-2")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("max-vehicles-1").click();
    await expect(page.getByTestId("max-vehicles-1")).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId("max-vehicles-1")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("max-vehicles-2")).toHaveAttribute("aria-pressed", "false");
  });

  test("conserva la configuracion despues de recargar", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("speed-limit").fill("33");
    await page.getByTestId("units-mph").click();
    await page.getByTestId("show-trails").uncheck();

    await page.reload();

    await expect(page.getByTestId("stat-limit")).toHaveText("33 mph");
    await openSettings(page);
    await expect(page.getByTestId("speed-limit")).toHaveValue("33");
    await expect(page.getByTestId("show-trails")).not.toBeChecked();
  });

  test("restaura los valores por defecto", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("speed-limit").fill("120");
    await page.getByTestId("reset-settings").click();
    await expect(page.getByTestId("speed-limit")).toHaveValue("60");
  });

  test("sanea valores fuera de rango guardados en el navegador", async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem(
        "qcar-speed-tracker:settings:v1",
        JSON.stringify({ speedLimit: 99999, units: "nudos", minScore: 5, maxVehicles: 9 }),
      );
    });
    await page.reload();
    await expect(page.getByTestId("stat-limit")).toHaveText("400 km/h");
    await openSettings(page);
    await expect(page.getByTestId("speed-limit")).toHaveValue("400");
    await expect(page.getByTestId("max-vehicles-2")).toHaveAttribute("aria-pressed", "true");
  });

  test("la hoja se cierra tocando el fondo", async ({ page }) => {
    await openSettings(page);
    // Arriba de todo: la parte del fondo que la hoja no tapa.
    await page.getByTestId("sheet-backdrop").click({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("sheet")).toBeHidden();
  });
});

test.describe("calibracion", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("muestra y oculta las esquinas de la zona", async ({ page }) => {
    await expect(page.getByTestId("calib-handle-0")).toBeHidden();

    await openSettings(page);
    await page.getByTestId("toggle-calibration").click();
    // Calibrar es tocar el video: la hoja se va del medio sola.
    await expect(page.getByTestId("sheet")).toBeHidden();
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId(`calib-handle-${i}`)).toBeVisible();
    }

    await page.getByTestId("finish-calibration").click();
    await expect(page.getByTestId("calib-handle-0")).toBeHidden();
  });

  test("arrastra una esquina con el dedo y lo guarda", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("toggle-calibration").click();

    const handle = page.getByTestId("calib-handle-0");
    const before = await handle.boundingBox();
    expect(before).not.toBeNull();

    const target = {
      x: before!.x + before!.width / 2 + 60,
      y: before!.y + before!.height / 2 + 20,
    };
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();

    const after = await handle.boundingBox();
    expect(after!.x).toBeGreaterThan(before!.x);

    // La esquina se guarda en coordenadas del frame (0..1), no en pixeles.
    const guardada = await page.evaluate(() => {
      const raw = window.localStorage.getItem("qcar-speed-tracker:settings:v1");
      return JSON.parse(raw ?? "{}").calibration.quad[0] as { x: number; y: number };
    });
    expect(guardada.x).toBeGreaterThan(0.3);

    await page.reload();
    await openSettings(page);
    await page.getByTestId("toggle-calibration").click();

    const stage = (await page.getByTestId("video-stage").boundingBox())!;
    const persisted = (await page.getByTestId("calib-handle-0").boundingBox())!;
    const centro = {
      x: persisted.x + persisted.width / 2 - stage.x,
      y: persisted.y + persisted.height / 2 - stage.y,
    };
    expect(centro.x).toBeCloseTo(guardada.x * stage.width, 0);
    expect(centro.y).toBeCloseTo(guardada.y * stage.height, 0);
  });

  test("avisa cuando la zona queda cruzada", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId("calibration-warning")).toBeHidden();

    // Cruzamos dos esquinas: el cuadrilatero deja de ser convexo.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "qcar-speed-tracker:settings:v1",
        JSON.stringify({
          calibration: {
            quad: [
              { x: 0.3, y: 0.45 },
              { x: 0.7, y: 0.45 },
              { x: 0.05, y: 0.92 },
              { x: 0.95, y: 0.92 },
            ],
            widthMeters: 7,
            lengthMeters: 25,
          },
        }),
      );
    });
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId("calibration-warning")).toBeVisible();
  });

  test("acepta cambiar las medidas reales de la zona", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("calib-width").fill("10.5");
    await page.getByTestId("calib-length").fill("40");
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId("calib-width")).toHaveValue("10.5");
    await expect(page.getByTestId("calib-length")).toHaveValue("40");
  });
});
