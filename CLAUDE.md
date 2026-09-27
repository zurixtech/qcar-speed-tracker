# QCar Radar

POC de radar de velocidad **solo para celular**: la camara detecta hasta dos
vehiculos, estima su velocidad y la dibuja adentro del recuadro. Todo corre en
el navegador (Next.js + TensorFlow.js/COCO-SSD sobre WebGL), sin backend.

## Comandos

```bash
npm run dev        # http://localhost:3000
npm test           # unitarios (Vitest)
npm run test:e2e   # end-to-end (Playwright, Pixel 5 emulado)
npm run check      # typecheck + eslint + unitarios
npm run test:cov   # unitarios con umbral de cobertura (lo corre CI)
npm run build      # prebuild baja y verifica el modelo a public/models
```

Antes de commitear: `npm run check`. Si tocaste UI o pipeline,
tambien `npm run test:e2e` (baja el modelo la primera vez, ~17 MB).

Playwright levanta un build nuevo en cada corrida; solo reusa un server ya
levantado con `PW_REUSE_SERVER=1` (y ahi puede servir un build viejo).

## Reglas del proyecto

- **Es una app de celular.** Una sola pantalla, botones grandes, todo lo que no
  es la camara va en la hoja inferior (`components/Sheet.tsx`). No agregar
  layouts de escritorio ni breakpoints `lg:`.
- **Como maximo 1 o 2 vehiculos** medidos y dibujados (`maxVehicles`). El resto
  se cuenta en pantalla y nada mas.
- **La velocidad se dibuja adentro de la caja**, grande. Si no hay lectura, va
  el motivo debajo; si salio de la escala automatica, un `~` adelante.
- **Hay dos escalas y no se mezclan.** La zona calibrada manda; `autoscale.ts`
  es el respaldo aproximado. Un vehiculo que ya se midio sobre la zona no
  vuelve a leerse por el respaldo, y al pasar de auto a zona su lectura
  arranca de cero (ver `engine.ts`). Solo las lecturas de zona labran
  infracciones.
- Las coordenadas del pipeline son del frame (0..1). Para pasarlas a pantalla
  siempre via `lib/view.ts`: el video va `object-contain` y casi nunca coincide
  la relacion de aspecto.
- El bucle de frames no pasa por el estado de React: dibuja en canvas y solo
  empuja contadores con throttling.
- La sesion (`useRadar.ts`) usa un id de generacion: despues de cada `await`
  hay que chequear que la sesion siga vigente antes de tocar motor, canvas o
  estado. Los errores al usuario salen de `lib/errors.ts`, nunca `err.message`.
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
lib/autoscale.ts          Escala sin calibrar, por tamano del vehiculo
lib/draw.ts + lib/view.ts Overlay y geometria de la vista
lib/settings.ts           Config, saneo y persistencia (localStorage)
```

Ver el README para la calibracion, el rango util segun fps y las limitaciones.
