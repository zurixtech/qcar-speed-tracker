# QCar Radar

Prueba de concepto de un radar de velocidad **para el celular**: apuntás la
cámara a la calzada, la página sigue **uno o dos vehículos** —el más cercano y,
si querés, el que lo sigue— les dibuja un recuadro y muestra **la velocidad
adentro del recuadro**, grande. Si pasan del límite que configuraste, el
recuadro se pone rojo, suena una alerta y la infracción queda registrada con una
captura.

**Es una app de celular, no de escritorio.** Una sola pantalla: la cámara ocupa
todo, los contadores flotan arriba, los botones grandes abajo y el resto
(ajustes, calibración, infracciones) vive en una hoja que sube desde abajo. En
una pantalla grande se ve esa misma columna angosta, centrada: no hay layout de
escritorio. Los tests end-to-end corren sobre un teléfono emulado (Pixel 5).

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

En el teléfono (o en el navegador con el modo dispositivo activado):

1. **Cámara** para usar la de atrás, **Video** para abrir uno grabado, o
   **Demo** para probar con `public/demo/traffic.mp4`.
2. **Ajustes → Ajustar zona sobre la calzada**: la hoja se corre sola y acomodás
   las 4 esquinas con el dedo, sobre el tramo de ruta que querés medir.
3. Cargá el **ancho** y el **largo** reales de ese tramo, en metros.
4. Poné el límite de velocidad y, si querés medir de a un auto por vez, elegí
   **Un auto** en *Vehículos a seguir*.

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
| Tracking | `lib/tracker.ts` | Asocia las cajas de un frame con las del anterior por IoU sobre la posición **predicha**, con respaldo por cercanía. Sin esto no hay "mismo auto" y no hay velocidad. |
| Escala | `lib/homography.ts` | Homografía de 4 puntos: convierte el punto de contacto del auto con el asfalto a metros sobre el plano de la calzada. |
| Velocidad | `lib/speed.ts` | Regresión lineal de la posición en el mundo sobre una ventana de ~0,9 s. La pendiente es el vector velocidad. |
| Selección | `lib/engine.ts` | Se queda con **1 o 2** vehículos: los de caja más grande (los más cercanos), con premio al que está en la zona y al que ya se venía siguiendo. |
| Infracciones | `lib/engine.ts` | Suavizado exponencial, confirmación por N lecturas y alta de la infracción (una sola vez por vehículo). |

### Decisiones que importan

**Por qué regresión y no restar dos frames.** La caja del detector "tiembla"
varios píxeles por frame. Derivar entre dos frames consecutivos amplifica ese
ruido y da velocidades que saltan de 40 a 120 km/h. Ajustar una recta a toda la
ventana promedia el error y da una lectura estable.

**Por qué solo uno o dos autos.** En una pantalla de 6 pulgadas, media docena de
recuadros con su número encima no se leen: se pisan entre sí y tapan justamente
la calzada. El detector y el tracker siguen viendo todo el tráfico (el contador
`Autos 2/4` lo muestra), pero se mide y se dibuja el auto más cercano —el único
que la homografía resuelve bien— y opcionalmente el siguiente. La elección tiene
histeresis: el que ya estaba elegido conserva el recuadro salvo que otro sea
claramente más grande, si no el cartel salta de auto en auto frame a frame.

**Por qué la velocidad va adentro del recuadro.** Sostenido a un brazo de
distancia, un cartelito arriba de la caja no se lee, y se corta cuando el auto
toca el borde superior del cuadro. El número va centrado en la caja, del tamaño
de la caja, y el tipo de vehículo queda como etiqueta chica.

**Por qué el overlay no dibuja sobre todo el canvas.** El video se muestra
"contenido" en la pantalla, y en el celular casi nunca coincide la relación de
aspecto: quedan bandas negras. Las cajas vienen en coordenadas del frame (0..1),
así que hay que mapearlas al rectángulo donde el frame realmente cae
(`lib/view.ts`). Sin eso, los recuadros aparecen corridos respecto del auto. La
misma cuenta ubica las esquinas de calibración, que por eso se pueden arrastrar
con el dedo y quedan pegadas al píxel del video que estás tocando.

**Por qué el tracker predice en vez de comparar contra la última caja.** A 25 fps
un auto se mueve poco entre frames y su caja solapa consigo misma, así que basta
con IoU. Pero si el equipo no tiene GPU el detector baja a 2-3 fps, y a esa
cadencia un auto a 80 km/h recorre más de 7 m por frame: su caja nueva no toca a
la vieja, el track se parte en uno nuevo cada frame y nunca se junta historial
para medir. Por eso el matching se hace contra la posición extrapolada de la
última velocidad conocida, más un respaldo por cercanía (acotado por similitud
de tamaño) que permite arrancar el track cuando todavía no hay velocidad. Ver
`lib/tracker.ts`.

Por la misma razón los umbrales van en **milisegundos y no en frames**: un track
caduca a los 400 ms sin detección, no a los N frames. Contando frames, un valor
razonable a 25 fps deja cajas fantasma cinco segundos sobre asfalto vacío a
2 fps.

**Por qué `requestVideoFrameCallback` y no el reloj de pared.** La velocidad se
calcula dividiendo por el tiempo. Si usáramos `performance.now()` y el análisis
no llega a tiempo real (típico al procesar un archivo en una máquina lenta), las
velocidades saldrían infladas. `mediaTime` da el instante exacto de cada frame
dentro del video, así que el resultado es correcto aunque el análisis vaya más
lento que la reproducción. Ver `lib/frames.ts`.

### Rango útil según los fps

La ventana de ajuste se estira sola (hasta 2,4 s) cuando faltan muestras, pero
hay un límite físico: si el vehículo cruza la zona calibrada en menos de medio
segundo, no hay puntos suficientes. Medido sobre la escena sintética, con una
zona de 30 m:

| fps | 30 km/h | 50 km/h | 80 km/h | 110 km/h |
|---|---|---|---|---|
| 2  | ✅ | ✅ | ❌ | ❌ |
| 3  | ✅ | ✅ | ✅ | ❌ |
| 5  | ✅ | ✅ | ✅ | ✅ |
| 12+ | ✅ | ✅ | ✅ | ✅ |

Con GPU (celular o notebook normal) `lite_mobilenet_v2` corre bastante por
encima de 12 fps, así que el rango completo está cubierto. Si tu equipo queda
corto, alargá la zona calibrada: más metros = más tiempo dentro de cuadro.

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

**El error de calibración se traslada entero al resultado.** La homografía es
lineal en el tamaño del rectángulo declarado: si cargás 30 m donde en realidad
hay 90, todas las velocidades salen a un tercio. Hay un test que fija esa
propiedad (`declarar el doble de largo duplica la velocidad medida`). Dicho de
otra forma: el modelo y la matemática no son la fuente de error acá, la cinta
métrica sí.

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
| Vehículos a seguir | Uno o dos. Es el máximo que se mide, se dibuja y puede generar infracciones. |
| Límite y unidades | Umbral de infracción, en km/h o mph. |
| Zona + ancho/largo | La calibración. Sin esto no hay medición. |
| Confianza mínima | Umbral del detector. Más alto = menos falsos positivos, más autos perdidos. |
| Suavizado | Qué tan rápido reacciona la lectura. Bajo = más estable pero con retardo. |
| Lecturas para confirmar | Cuántas lecturas seguidas sobre el límite hacen falta para dar el alta. Evita infracciones por un pico aislado. |
| Modelo | `lite_mobilenet_v2` (rápido, ideal en celular) o `mobilenet_v2` (más preciso, más pesado). |
| Medir solo dentro de la zona | Recomendado: fuera del cuadrilátero calibrado la proyección extrapola y el error se dispara. |

Todo queda guardado en `localStorage`, así que sobrevive a recargas.

---

## El modelo: CDN o self-hosted

Por defecto los pesos se bajan del CDN de Google, que es el comportamiento de
`@tensorflow-models/coco-ssd`. Si preferís servirlos desde tu propio dominio
—red corporativa que bloquea `storage.googleapis.com`, o simplemente no querer
depender de un tercero:

```bash
npm run fetch:model                      # lite_mobilenet_v2 (17 MB)
npm run fetch:model mobilenet_v2         # o la variante grande (65 MB)
```

Eso deja los archivos en `public/models/`, y la app los detecta sola y los usa en
lugar del CDN. La carpeta está en `.gitignore` para no meter 17 MB en el repo; si
querés que el deploy los sirva, corré el script antes del build y sacá esa línea.

Los tests end-to-end corren este script automáticamente, así que el pipeline
completo se testea sin depender de internet.

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

Con la configuración por defecto el modelo se baja del CDN de Google la primera
vez (~17 MB para `lite_mobilenet_v2`, ~65 MB para `mobilenet_v2`) y después
queda en la caché del navegador. No cuenta contra el ancho de banda de Vercel.
Si lo self-hosteás, ese tráfico pasa a ser tuyo.

---

## Tests

```bash
npm test          # unitarios (Vitest)
npm run test:e2e  # end-to-end (Playwright)
npm run typecheck
```

**107 unitarios** — toda la matemática, sin DOM ni TensorFlow. `tests/unit/helpers/scene.ts`
arma una cámara sintética: proyecta un auto que se mueve a una velocidad
*conocida* con perspectiva real (la caja se agranda al acercarse, como en un
video de verdad) y se verifica que el motor mida esa velocidad. Entre 30 y
110 km/h el error es menor al 1 %, y con 8 px de ruido en las cajas se mantiene
dentro de 7 km/h.

Además de la escena sintética, `tests/unit/selection.test.ts` fija el límite de
1-2 vehículos (a quién elige, la histeresis, que solo los elegidos labran
infracción) y `tests/unit/view.test.ts` la geometría del frame dentro de la
pantalla.

**21 end-to-end**, todos sobre un **Pixel 5 emulado** — `tests/e2e/ui.spec.ts`
cubre la pantalla del celular (que entre sin scroll), la hoja de ajustes, la
persistencia y la calibración arrastrando una esquina con el dedo.
`tests/e2e/pipeline.spec.ts` corre el pipeline completo sobre un video real de
tráfico: carga el modelo, detecta, mide, comprueba que nunca siga más autos que
el máximo elegido y registra infracciones.

> El fixture de test es VP9/WebM porque el Chromium de CI viene sin
> decodificador H.264. El video de demo publicado sí es H.264, que es lo que
> soportan todos los navegadores reales.

---

## Estructura

```
app/                 Next.js App Router (una sola página)
components/          RadarApp (pantalla del celular), VideoStage, Sheet,
                     ControlPanel, ViolationsPanel
hooks/useRadar.ts    Sesión: fuente de video, modelo, bucle de frames, infracciones
lib/
  detector.ts        COCO-SSD sobre TensorFlow.js
  tracker.ts         Tracker multi-objeto por IoU
  homography.ts      Píxeles → metros
  speed.ts           Estimación de velocidad
  engine.ts          Pipeline completo (código puro, testeable)
  draw.ts            Overlay en canvas (velocidad dentro del recuadro)
  view.ts            Dónde cae el frame dentro de la pantalla
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
- **Sin WebGL**: cae a CPU, que anda pero a pocos frames por segundo (ver la
  tabla de rango útil más arriba).
- **Solo 1 o 2 autos**: es una decisión de producto, no una limitación técnica.
  Si pasan tres juntos, el tercero se ve en el contador pero no se mide.

---

## Licencia

Código bajo MIT. El video de demo es de Pexels (ver `public/demo/CREDITS.md`).
