import { describe, expect, it } from "vitest";

import { containRect, fromView, toView } from "@/lib/view";

describe("containRect", () => {
  it("llena el contenedor cuando las proporciones coinciden", () => {
    expect(containRect(400, 300, 800, 600)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("deja bandas arriba y abajo con un frame apaisado en una pantalla vertical", () => {
    // 16:9 dentro de 400x800: el video ocupa 400x225 centrado.
    const view = containRect(400, 800, 1280, 720);
    expect(view.w).toBeCloseTo(400, 6);
    expect(view.h).toBeCloseTo(225, 6);
    expect(view.x).toBeCloseTo(0, 6);
    expect(view.y).toBeCloseTo(287.5, 6);
  });

  it("deja bandas a los costados con un frame vertical en una pantalla apaisada", () => {
    const view = containRect(800, 400, 720, 1280);
    expect(view.h).toBeCloseTo(400, 6);
    expect(view.w).toBeCloseTo(225, 6);
    expect(view.y).toBeCloseTo(0, 6);
    expect(view.x).toBeCloseTo(287.5, 6);
  });

  it("cae al contenedor entero si todavia no se conoce el tamano del frame", () => {
    expect(containRect(400, 800, 0, 0)).toEqual({ x: 0, y: 0, w: 400, h: 800 });
    expect(containRect(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("toView / fromView", () => {
  const view = containRect(400, 800, 1280, 720);

  it("el centro del frame cae en el centro del video dibujado", () => {
    const p = toView(view, 0.5, 0.5);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });

  it("son inversas una de la otra", () => {
    for (const [nx, ny] of [
      [0, 0],
      [0.25, 0.8],
      [1, 1],
    ]) {
      const p = toView(view, nx, ny);
      const back = fromView(view, p.x, p.y);
      expect(back.x).toBeCloseTo(nx, 6);
      expect(back.y).toBeCloseTo(ny, 6);
    }
  });

  it("un toque sobre la banda negra se acota al borde del frame", () => {
    // y = 10 px cae arriba del video (que empieza en 287.5).
    expect(fromView(view, 200, 10)).toEqual({ x: 0.5, y: 0 });
    expect(fromView(view, 200, 790)).toEqual({ x: 0.5, y: 1 });
  });
});
