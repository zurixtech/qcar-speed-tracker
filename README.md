# QCar Radar

Prueba de concepto de un radar de velocidad: apuntás la cámara a la calzada, la
página detecta los vehículos, les dibuja un recuadro y estima a qué velocidad
van. Si pasan del límite que configuraste, el recuadro se pone rojo, suena una
alerta y la infracción queda registrada con una captura.

**Todo corre en el navegador.** No hay backend, no se sube ni un frame a ningún
servidor: el modelo de detección se descarga una vez y la inferencia se hace con
WebGL en el dispositivo. Por eso el deploy en Vercel es un sitio estático.

> ⚠️ **Es un POC.** La velocidad es una estimación que depende enteramente de la
> calibración que cargues y del ángulo de la cámara. No sirve como prueba legal
> ni reemplaza a un radar homologado.

---

## Arranque rápido

```bash
npm install
npm run dev        # http://localhost:3000
```

En la página:

1. **Cargar video** y elegí `public/demo/traffic.mp4` (o el botón **Video de
   demo**), o bien **Usar cámara** si estás en HTTPS o en localhost.
2. Tocá **Ajustar zona sobre la calzada** y acomodá las 4 esquinas sobre el
   tramo de ruta que querés medir.
3. Cargá el **ancho** y el **largo** reales de ese tramo, en metros.
4. Poné el límite de velocidad y listo.

> La cámara solo funciona en `localhost` o sobre HTTPS. Es una restricción de
> los navegadores, no de la app.

---

## Cómo funciona

```
<video>  ──►  COCO-SSD        ──►  tracker IoU   ──►  homografía   ──►  regresión
 frame        (TensorFlow.js)      (mismo auto        (píxeles →        (posición vs
              cajas + clase         entre frames)      metros)           tiempo = m/s)
```

| Paso | Archivo | Qué hace |
|---|---|---|
| Detección | `lib/detector.ts` | COCO-SSD sobre WebGL. Filtra a `car`, `truck`, `bus`, `motorcycle`, `bicycle` y normaliza las cajas a 0..1. |
| Tracking | `lib/tracker.ts` | Asocia las cajas de un frame con las del anterior por IoU (asignación voraz). Sin esto no hay "mismo auto" y no hay velocidad. |
| Escala | `lib/homography.ts` | Homografía de 4 puntos: convierte el punto de contacto del auto con el asfalto a metros sobre el plano de la calzada. |
| Velocidad | `lib/speed.ts` | Regresión lineal de la posición en el mundo sobre una ventana de ~0,9 s. La pendiente es el vector velocidad. |
| Infracciones | `lib/engine.ts` | Suavizado exponencial, confirmación por N lecturas y alta de la infracción (una sola vez por vehículo). |

### Dos decisiones que importan

**Por qué regresión y no restar dos frames.** La caja del detector "tiembla"
varios píxeles por frame. Derivar entre dos frames consecutivos amplifica ese
ruido y da velocidades que saltan de 40 a 120 km/h. Ajustar una recta a toda la
ventana promedia el error y da una lectura estable.

**Por qué `requestVideoFrameCallback` y no el reloj de pared.** La velocidad se
calcula dividiendo por el tiempo. Si usáramos `performance.now()` y el análisis
no llega a tiempo real (típico al procesar un archivo en una máquina lenta), las
velocidades saldrían infladas. `mediaTime` da el instante exacto de cada frame
dentro del video, así que el resultado es correcto aunque el análisis vaya más
lento que la reproducción. Ver `lib/frames.ts`.

---

## Calibración: de esto depende toda la precisión

La cámara no sabe cuántos metros mide un píxel. Se lo tenés que decir vos, y es
lo único que separa una medición decente de un número inventado.

Las 4 esquinas van **en este orden**:

```
   1 ─────────── 2      1 y 2: extremo LEJANO del tramo
   │             │
   │   calzada   │      ancho  = distancia real entre 1 y 2 (o entre 4 y 3)
   │             │      largo  = distancia real entre 1 y 4 (o entre 2 y 3)
   4 ─────────── 3      4 y 3: extremo CERCANO
```

Si el cuadrilátero queda cruzado o es demasiado chico, la app te avisa y deja de
medir en vez de mostrar números falsos.

**Medidas de referencia** (Argentina / norma habitual):

| Referencia | Medida |
|---|---|
| Ancho de carril | 3,5 m |
| Línea blanca discontinua (trazo) | 4,5 m |
| Separación entre trazos | 7,5 m |
| Trazo + separación (paso completo) | 12 m |

Contar trazos de la línea discontinua es la forma más práctica de sacar el
largo sin salir a medir con cinta.

**Para que la medición sirva:**

- La cámara tiene que estar **quieta**. Trípode, soporte, apoyada en algo. Si se
  mueve, la calibración deja de valer.
- El cuadrilátero tiene que estar sobre el **asfalto**, no sobre los autos.
- Cuanto más **oblicua** la vista (más cerca del horizonte), más error. Lo ideal
  es un ángulo de unos 20-45° respecto de la ruta.
- Un tramo **más largo** (20-40 m) da mejores resultados que uno corto.

---

## Configuración

| Control | Para qué sirve |
|---|---|
| Límite y unidades | Umbral de infracción, en km/h o mph. |
| Zona + ancho/largo | La calibración. Sin esto no hay medición. |
| Confianza mínima | Umbral del detector. Más alto = menos falsos positivos, más autos perdidos. |
| Suavizado | Qué tan rápido reacciona la lectura. Bajo = más estable pero con retardo. |
| Lecturas para confirmar | Cuántas lecturas seguidas sobre el límite hacen falta para dar el alta. Evita infracciones por un pico aislado. |
| Modelo | `lite_mobilenet_v2` (rápido, ideal en celular) o `mobilenet_v2` (más preciso, más pesado). |
| Medir solo dentro de la zona | Recomendado: fuera del cuadrilátero calibrado la proyección extrapola y el error se dispara. |

Todo queda guardado en `localStorage`, así que sobrevive a recargas.

---

## Deploy en Vercel

El proyecto es un Next.js estándar: Vercel lo detecta solo, sin configuración.

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # producción
```

O desde la web: **Add New → Project**, importás el repo, y **Deploy**. No hay
variables de entorno que cargar.

Vercel sirve todo por HTTPS, que es justamente lo que el navegador exige para
darle acceso a la cámara. Desde el celular, abrís la URL y ya podés apuntar a la
ruta.

### Costo de red

El modelo se baja del CDN de Google (`storage.googleapis.com/tfjs-models`) la
primera vez: ~18 MB para `lite_mobilenet_v2`, ~65 MB para `mobilenet_v2`.
Después queda en la caché del navegador. No cuenta contra el ancho de banda de
Vercel.

---

## Tests

```bash
npm test          # unitarios (Vitest)
npm run test:e2e  # end-to-end (Playwright)
npm run typecheck
```

**Unitarios** — toda la matemática, sin DOM ni TensorFlow. `tests/unit/helpers/scene.ts`
arma una cámara sintética: proyecta un auto que se mueve a una velocidad
*conocida* con perspectiva real (la caja se agranda al acercarse, como en un
video de verdad) y se verifica que el motor mida esa velocidad. Entre 30 y
110 km/h el error es menor al 1 %, y con 8 px de ruido en las cajas se mantiene
dentro de 7 km/h.

**End-to-end** — `tests/e2e/ui.spec.ts` cubre la UI, la persistencia y la
calibración. `tests/e2e/pipeline.spec.ts` corre el pipeline completo sobre un
video real de tráfico: baja el modelo, detecta, mide y registra infracciones.

> El fixture de test es VP9/WebM porque el Chromium de CI viene sin
> decodificador H.264. El video de demo publicado sí es H.264, que es lo que
> soportan todos los navegadores reales.

---

## Estructura

```
app/                 Next.js App Router (una sola página)
components/          RadarApp, VideoStage, ControlPanel, ViolationsPanel
hooks/useRadar.ts    Sesión: fuente de video, modelo, bucle de frames, infracciones
lib/
  detector.ts        COCO-SSD sobre TensorFlow.js
  tracker.ts         Tracker multi-objeto por IoU
  homography.ts      Píxeles → metros
  speed.ts           Estimación de velocidad
  engine.ts          Pipeline completo (código puro, testeable)
  draw.ts            Overlay en canvas
  settings.ts        Configuración, validación y persistencia
  frames.ts          Bucle de frames con mediaTime
tests/unit/          Vitest
tests/e2e/           Playwright
```

El bucle de detección **no pasa por el estado de React**: dibuja directo sobre el
canvas y solo empuja datos livianos (fps, contadores, infracciones) con
throttling. Re-renderizar React 30 veces por segundo mataría el frame rate.

---

## Limitaciones conocidas

- **Cámara en movimiento**: invalida la calibración. Tiene que estar fija.
- **Oclusiones**: si un camión tapa un auto, el tracker pierde el track y el auto
  vuelve con un ID nuevo.
- **Tráfico denso**: con autos muy pegados, el matching por IoU puede cruzar
  identidades. Las lecturas absurdas se descartan (tope de 300 km/h), pero no
  todos los cruces dan un número absurdo.
- **Motos y bicis**: el punto de contacto con el suelo es menos estable que en un
  auto, así que la lectura es más ruidosa.
- **Noche y lluvia**: COCO-SSD baja bastante su tasa de detección.
- **Sin WebGL**: cae a CPU, que anda pero a pocos frames por segundo.

---

## Licencia

Código bajo MIT. El video de demo es de Pexels (ver `public/demo/CREDITS.md`).
