# QCar Radar

POC de radar de velocidad **solo para celular**: la camara detecta hasta dos
vehiculos, estima su velocidad y la dibuja adentro del recuadro. Todo corre en
el navegador (Next.js + TensorFlow.js/COCO-SSD sobre WebGL), sin backend.

## Comandos

```bash
npm run dev        # http://localhost:3000
npm test           # unitarios (Vitest)
npm run test:e2e   # end-to-end (Playwright, Pixel 5 emulado)
npm run typecheck && npx eslint . && npm run build
```

Antes de commitear: typecheck + eslint + `npm test`. Si tocaste UI o pipeline,
tambien `npm run test:e2e` (baja el modelo la primera vez, ~17 MB).

Si un test e2e falla raro, revisa que no haya quedado un `next-server` viejo
corriendo: Playwright reusa el server existente y sirve un build anterior.

## Reglas del proyecto

- **Es una app de celular.** Una sola pantalla, botones grandes, todo lo que no
  es la camara va en la hoja inferior (`components/Sheet.tsx`). No agregar
  layouts de escritorio ni breakpoints `lg:`.
- **Como maximo 1 o 2 vehiculos** medidos y dibujados (`maxVehicles`). El resto
  se cuenta en pantalla y nada mas.
- **La velocidad se dibuja adentro de la caja**, grande.
- Las coordenadas del pipeline son del frame (0..1). Para pasarlas a pantalla
  siempre via `lib/view.ts`: el video va `object-contain` y casi nunca coincide
  la relacion de aspecto.
- El bucle de frames no pasa por el estado de React: dibuja en canvas y solo
  empuja contadores con throttling.
- Codigo y comentarios en castellano **sin tildes**; README y textos de UI, con
  tildes. Comentar el *por que*, no el *que*.
- Los tests unitarios son codigo puro (sin DOM ni TF.js); la escena sintetica
  esta en `tests/unit/helpers/scene.ts`.

## Mapa rapido

```
components/RadarApp.tsx   Pantalla del celular (HUD + acciones + hoja)
hooks/useRadar.ts         Sesion: fuente, modelo, bucle, infracciones
lib/engine.ts             Pipeline puro: tracking -> seleccion -> velocidad
lib/{tracker,speed,homography}.ts   Matematica del radar
lib/draw.ts + lib/view.ts Overlay y geometria de la vista
lib/settings.ts           Config, saneo y persistencia (localStorage)
```

Ver el README para la calibracion, el rango util segun fps y las limitaciones.
