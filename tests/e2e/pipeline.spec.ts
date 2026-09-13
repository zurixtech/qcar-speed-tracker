import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Pipeline completo sobre un video real de trafico: carga del modelo COCO-SSD,
 * deteccion frame a frame, tracking, medicion de velocidad y alta de
 * infracciones. El fixture es VP9/WebM porque el Chromium de CI no trae
 * decodificador H.264 (el video de demo publicado si es H.264, para navegadores
 * reales).
 */
const FIXTURE = path.join(__dirname, "..", "fixtures", "traffic.webm");

/** La lista de infracciones vive en la hoja que sube desde abajo. */
async function openViolations(page: Page): Promise<void> {
  await page.getByTestId("open-violations").click();
  await expect(page.getByTestId("sheet")).toBeVisible();
}

/** Los ajustes tambien: abrirlos, tocar algo y volver a la camara. */
async function withSettings(page: Page, fn: () => Promise<void>): Promise<void> {
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await fn();
  await page.getByTestId("close-sheet").click();
  await expect(page.getByTestId("sheet")).toBeHidden();
}

async function loadFixture(page: Page): Promise<void> {
  await page.getByTestId("file-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("radar-status")).toHaveAttribute("data-status", "running", {
    // Bajar el modelo (~18 MB) e inicializar WebGL por software lleva su tiempo.
    timeout: 150_000,
  });
}

test.describe("pipeline de deteccion", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("detecta autos en un video de trafico real", async ({ page }) => {
    await loadFixture(page);

    // El contador de vehiculos en cuadro tiene que despegar de cero.
    await expect
      .poll(async () => Number(await page.getByTestId("stat-detected").innerText()), {
        timeout: 90_000,
        message: "el detector nunca encontro un vehiculo",
      })
      .toBeGreaterThan(0);
  });

  test("nunca sigue mas vehiculos que el maximo elegido", async ({ page }) => {
    await loadFixture(page);

    // El video tiene trafico: el detector ve varios, pero el radar sigue 2.
    await expect
      .poll(async () => Number(await page.getByTestId("stat-detected").innerText()), {
        timeout: 90_000,
        message: "el detector nunca encontro un vehiculo",
      })
      .toBeGreaterThan(0);

    const seguidos: number[] = [];
    for (let i = 0; i < 25; i++) {
      seguidos.push(Number(await page.getByTestId("stat-vehicles").innerText()));
      await page.waitForTimeout(200);
    }
    expect(Math.max(...seguidos)).toBeLessThanOrEqual(2);

    await withSettings(page, async () => {
      await page.getByTestId("max-vehicles-1").click();
    });

    const conUno: number[] = [];
    for (let i = 0; i < 25; i++) {
      conUno.push(Number(await page.getByTestId("stat-vehicles").innerText()));
      await page.waitForTimeout(200);
    }
    expect(Math.max(...conUno)).toBeLessThanOrEqual(1);
  });

  test("dibuja las cajas sobre el canvas del overlay", async ({ page }) => {
    await loadFixture(page);

    // Contamos pixeles no transparentes: si el overlay dibuja algo, hay pintura.
    await expect
      .poll(
        async () =>
          page.getByTestId("radar-overlay").evaluate((el) => {
            const canvas = el as HTMLCanvasElement;
            const ctx = canvas.getContext("2d");
            if (!ctx || canvas.width === 0) return 0;
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let painted = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
            return painted;
          }),
        { timeout: 90_000, message: "el overlay quedo en blanco" },
      )
      .toBeGreaterThan(100);
  });

  test("mide velocidades una vez calibrada la zona", async ({ page }) => {
    await loadFixture(page);

    await expect
      .poll(async () => Number(await page.getByTestId("stat-measuring").innerText()), {
        timeout: 120_000,
        message: "ningun vehiculo llego a tener una lectura de velocidad",
      })
      .toBeGreaterThan(0);
  });

  test("registra infracciones con un limite muy bajo", async ({ page }) => {
    // 1 km/h: cualquier vehiculo en movimiento queda en infraccion.
    await withSettings(page, async () => {
      await page.getByTestId("speed-limit").fill("1");
      await page.getByTestId("sound-alerts").uncheck();
    });
    await loadFixture(page);

    await expect
      .poll(async () => Number((await page.getByTestId("violation-badge").innerText()).replace(/\D/g, "")), {
        timeout: 120_000,
        message: "nunca se registro una infraccion",
      })
      .toBeGreaterThan(0);

    await openViolations(page);
    await expect(page.getByTestId("violation-item").first()).toBeVisible();

    const rows = page.getByTestId("violation-item");
    expect(await rows.count()).toBeGreaterThan(0);
    // Cada fila muestra la velocidad medida y el limite vigente.
    await expect(rows.first()).toContainText("km/h");
    await expect(rows.first()).toContainText("limite 1");
  });

  test("no registra infracciones con un limite inalcanzable", async ({ page }) => {
    await withSettings(page, async () => {
      await page.getByTestId("speed-limit").fill("400");
    });
    await loadFixture(page);

    await expect
      .poll(async () => Number(await page.getByTestId("stat-measuring").innerText()), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);

    await openViolations(page);
    await expect(page.getByTestId("violation-count")).toHaveText("(0)");
  });

  test("detener libera la fuente y limpia el estado", async ({ page }) => {
    await loadFixture(page);
    await page.getByTestId("stop").click();

    await expect(page.getByTestId("radar-status")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("stat-vehicles")).toHaveText("0");
    await expect(page.getByTestId("stat-detected")).toHaveText("0");
    await expect(page.getByTestId("start-camera")).toBeVisible();
  });
});

test.describe("camara", () => {
  test("arranca con la camara sintetica del navegador", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    await page.goto("/");
    await page.getByTestId("start-camera").click();

    await expect(page.getByTestId("radar-status")).toHaveAttribute("data-status", "running", {
      timeout: 150_000,
    });
    // El patron de prueba de Chromium no tiene autos, pero el pipeline corre:
    // lo que verificamos es que la camara se abre y el bucle avanza.
    await expect
      .poll(async () => Number(await page.getByTestId("radar-status").innerText().then(
        (t) => t.match(/(\d+) fps/)?.[1] ?? "0",
      )), { timeout: 60_000, message: "el bucle de frames nunca avanzo" })
      .toBeGreaterThan(0);
  });
});
