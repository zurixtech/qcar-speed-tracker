import { expect, test } from "@playwright/test";

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
    await expect(page.getByTestId("speed-limit")).toHaveValue("60");
    await expect(page.getByTestId("stat-limit")).toHaveText("60 km/h");
  });

  test("ofrece el video de demo porque esta publicado", async ({ page }) => {
    await expect(page.getByTestId("start-demo")).toBeVisible();
  });

  test("cambia el limite y las unidades", async ({ page }) => {
    await page.getByTestId("speed-limit").fill("40");
    await expect(page.getByTestId("stat-limit")).toHaveText("40 km/h");

    await page.getByTestId("units-mph").click();
    await expect(page.getByTestId("stat-limit")).toHaveText("40 mph");
  });

  test("conserva la configuracion despues de recargar", async ({ page }) => {
    await page.getByTestId("speed-limit").fill("33");
    await page.getByTestId("units-mph").click();
    await page.getByTestId("show-trails").uncheck();

    await page.reload();

    await expect(page.getByTestId("speed-limit")).toHaveValue("33");
    await expect(page.getByTestId("stat-limit")).toHaveText("33 mph");
    await expect(page.getByTestId("show-trails")).not.toBeChecked();
  });

  test("restaura los valores por defecto", async ({ page }) => {
    await page.getByTestId("speed-limit").fill("120");
    await page.getByTestId("reset-settings").click();
    await expect(page.getByTestId("speed-limit")).toHaveValue("60");
  });

  test("sanea valores fuera de rango guardados en el navegador", async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem(
        "qcar-speed-tracker:settings:v1",
        JSON.stringify({ speedLimit: 99999, units: "nudos", minScore: 5 }),
      );
    });
    await page.reload();
    await expect(page.getByTestId("speed-limit")).toHaveValue("400");
    await expect(page.getByTestId("stat-limit")).toHaveText("400 km/h");
  });
});

test.describe("calibracion", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("muestra y oculta las esquinas de la zona", async ({ page }) => {
    await expect(page.getByTestId("calib-handle-0")).toBeHidden();

    await page.getByTestId("toggle-calibration").click();
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId(`calib-handle-${i}`)).toBeVisible();
    }

    await page.getByTestId("toggle-calibration").click();
    await expect(page.getByTestId("calib-handle-0")).toBeHidden();
  });

  test("mueve una esquina con el teclado y lo guarda", async ({ page }) => {
    await page.getByTestId("toggle-calibration").click();
    const handle = page.getByTestId("calib-handle-0");
    const before = await handle.evaluate((el) => (el as HTMLElement).style.left);

    await handle.focus();
    await handle.press("ArrowRight");
    await handle.press("ArrowRight");

    const after = await handle.evaluate((el) => (el as HTMLElement).style.left);
    expect(after).not.toBe(before);
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));

    await page.reload();
    await page.getByTestId("toggle-calibration").click();
    const persisted = await page
      .getByTestId("calib-handle-0")
      .evaluate((el) => (el as HTMLElement).style.left);
    expect(parseFloat(persisted)).toBeCloseTo(parseFloat(after), 4);
  });

  test("avisa cuando la zona queda cruzada", async ({ page }) => {
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
    await expect(page.getByTestId("calibration-warning")).toBeVisible();
  });

  test("acepta cambiar las medidas reales de la zona", async ({ page }) => {
    await page.getByTestId("calib-width").fill("10.5");
    await page.getByTestId("calib-length").fill("40");
    await page.reload();
    await expect(page.getByTestId("calib-width")).toHaveValue("10.5");
    await expect(page.getByTestId("calib-length")).toHaveValue("40");
  });
});
