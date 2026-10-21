# Banco de referencia

Mide la descomposición de un input en mensajes (MASTER-SPEC §7.11). Reporta MECE por aritmética de conjuntos sobre `unit_ids`, exactitud de la clasificación, tiempo total y por paso, tokens y costo por llamada.

```sh
node --test bench/                 # pruebas con proveedores falsos, sin red ni llaves
node bench/run.mjs --fake perfect  # reporte con proveedores falsos
node bench/run.mjs --repeat 5      # proveedores reales (src/providers, desde el entorno), 5 repeticiones
cd bench && npm ci && npm run eval # promptfoo sobre los mismos casos
```

Las pruebas y `run.mjs` no necesitan `npm ci` en `bench/`. Sólo `npm run eval` usa promptfoo.

## Casos

Cada carpeta de `cases/` tiene `input.json` (texto y adjuntos ya extraídos, como los recibe el analizador) y `expected.json`. Los textos son inventados y no contienen datos de personas reales.

| Caso | Input | Mensajes esperados |
|---|---|---|
| `01-chat-grupo` | Captura de un chat de grupo, 16 líneas | 3 |
| `02-docx-40-puntos` | Documento de retroalimentación, 47 unidades | 40 |
| `03-monologo-prueba` | Transcripción de 10 minutos, 50 segmentos | 10 |
| `04-reporte-de-error` | Reporte con pasos y una captura | 1 |
| `05-idea-suelta` | Cuatro párrafos | 1 |
| `06-mensaje-mezclado` | Un mensaje con tres pedidos de tres áreas | 3 |
| `07-video-de-pantalla` | Voz y fotogramas de un video de un minuto | 4 |
| `08-reunion-10-minutos` | Transcripción de una reunión de equipo de diez minutos, con bloques de proceso (ramas, contrato, incorporación) que son puntos aunque no sean producto | 9 |

Las unidades las numera `src/analyze/units.js` (`numberUnits`). `expected.json` cita esos números, y `cases.test.js` falla si la segmentación cambia y deja de coincidir. Cada mensaje esperado es un punto atómico: dos puntos en un mensaje cuentan como fusión. `area_id` y `template_id` van por mensaje; una lista significa que cualquiera de esos ids es correcto. Los ids son los del juego inicial de `templates/areas.json`.

La referencia es una primera versión escrita a mano. Informe 02 §5.1: se audita contra las salidas de los modelos antes de tomarla como verdad. Una referencia manual omitió 227 intervalos en un estudio de 2026.

## Puntaje

`score.js` recibe las unidades, `expected.json` y la propuesta. Definiciones del informe 02 §5.2:

| Medida | Cuenta |
|---|---|
| Cobertura | Puntos con todas sus unidades dentro de un mismo mensaje, sobre los puntos esperados |
| Repetición | Puntos completos en un mensaje y tocados por otro, sobre los puntos esperados |
| Mensajes de más | Mensajes que no tocan ningún punto, sobre los mensajes obtenidos |
| Partidos | Puntos repartidos entre mensajes sin quedar completos en ninguno |
| Fusionados | Mensajes que tocan dos o más puntos, sobre los mensajes obtenidos |
| Clasificación | Unidades cuyo mensaje tiene el área y la plantilla esperadas, sobre las unidades esperadas |

Una unidad en dos mensajes de áreas distintas, o en ninguno, cuenta como errada. Además se informan unidades en dos mensajes, unidades en ninguno ni en `discarded`, y unidades inventadas. `mece` es verdadero cuando la cobertura es 1 y todo lo demás es 0. La clasificación se califica aparte.

## Analizador y proveedores

`runCase` llama `analyze(bundle, { providers, onProgress })` de `src/analyze` y mide:

- Tiempo total y por paso, desde los eventos `onProgress`. Un paso dura hasta el siguiente evento.
- Llamadas, tokens y duración del modelo, desde `result.calls`.
- Costo: `pricing.js` aplica la tarifa de lista de Haiku 5.5 (MASTER-SPEC §3, informe 02). Un modelo sin tarifa da `sin tarifa`.

Si el estado no es `ok`, se puntúa el borrador (`draft`) para ver qué falló, y el caso cuenta como no MECE.

`fake-providers.js` arma `createFakeProviders` con la referencia. En modo `perfect` responde la clasificación y la descomposición esperadas. En modo `noisy` cambia el área de un grupo, fusiona dos mensajes, parte un tercero, repite una unidad y quita uno. El analizador lo rechaza como `invalid` y el banco muestra la causa. Los tokens del falso son el largo en caracteres de lo enviado, un relleno determinista.

## promptfoo

`bench/package.json` fija promptfoo en la versión exacta 0.124.1 (MIT, consultada en npm el 2026-10-20). `provider.mjs` ejecuta el analizador y `assert.mjs` es la aserción JavaScript que importa `score.js`. `npm run eval` desactiva la telemetría para no enviar datos fuera. El árbol de dependencias de promptfoo incluye paquetes con otras licencias; ninguno entra a la imagen.

## Casos privados

Para medir con material real que no puede publicarse, `run-private.mjs` lee casos de `bench/private/` y escribe en `bench/results/`. Ambas carpetas están en `.gitignore`: nada de lo que contienen entra a git.

```sh
node bench/run-private.mjs list
node bench/run-private.mjs extract [--case id ...]     adjuntos por src/extract con proveedores reales; guarda el texto extraído
node bench/run-private.mjs units --case id             unidades numeradas, para escribir expected.json
node bench/run-private.mjs check                       cada unidad en un mensaje esperado o descartada, una sola vez
node bench/run-private.mjs run [--case id ...] [--repeat n] [--budget 5]
```

Cada caso es una carpeta con `manifest.json` y `expected.json`. El manifiesto apunta a los archivos originales por ruta absoluta y no los copia: `{ id, title, kind, source, text?, text_path?, attachments?: [{ id, kind, path, mime }] }`. `expected.json` tiene la forma de los casos públicos (`messages`, `discarded`) y admite un `secondary` informativo para los puntos que una unidad compuesta no deja medir.

La numeración de unidades depende del texto extraído, y la descripción de una imagen o un fotograma cambia entre corridas. Por eso `extract` guarda el resultado en `bench/private/.cache/<id>.json` y `run` mide siempre contra esa extracción. El resultado de cada corrida (`private-<fecha>.json`) lleva, por caso, los tiempos y llamadas de la extracción, los pasos y llamadas del análisis y el puntaje.

El gasto se suma en `bench/results/private-spend.jsonl` (una línea por llamada) y `--budget` corta antes de que el acumulado pase del 90 % del tope.

Voz: `--speech auto` usa Groq si hay `GROQ_API_KEY`; sin llave usa `local-speech.mjs`, que lanza `local-whisper.py` (faster-whisper) con el Python de `LOCAL_WHISPER_PYTHON`. `--speech local` lo fuerza y `--speech none` omite la transcripción. El resultado declara qué proveedor de voz se usó.

## Contexto bajo prueba (H-77)

`run-private.mjs run` acepta el contexto que recibe el analizador, armado como lo arma `src/domain/pipeline.js`: `members` con `profile` y `project = { name, description }`.

```sh
node bench/run-private.mjs run --variant name-only --team bench/private/team.json --no-profile
node bench/run-private.mjs run --variant profiles --team bench/private/team.json
node bench/run-private.mjs run --variant profiles+project --team bench/private/team.json --project bench/private/project.md --project-name Devalis
node bench/judge-usefulness.mjs bench/results/private-<variante>-<fecha>.json --project bench/private/project.md
node bench/run-private.mjs compare bench/results/private-<a>.json bench/results/private-<b>.json
```

`--cases a,b,c` acota los casos, `--private-dir` (o `BENCH_PRIVATE_DIR`) apunta a los casos desde un worktree y `--results-dir` mueve los resultados y el registro de gasto.

El puntaje de destinatarios (`score.js`, clave `assignment`) empareja cada mensaje esperado con `assignee_ids` con el mensaje obtenido que contiene todas sus unidades (el más estrecho si hay varios) y compara los dos conjuntos: exactitud de conjunto, precisión y recall, en total y por miembro. Un punto que ningún mensaje cubre no tiene pareja.

`judge-usefulness.mjs` pide al proveedor de texto una nota de 1 a 5 por mensaje con una rúbrica fija y salida estructurada. El juez no ve la variante ni los perfiles. Escribe `<resultado>.usefulness.json` con las notas por mensaje y la mediana por caso, y `compare` la lee si existe. Es medición: nada de esto corre en el producto.

## Modo oráculo y segunda referencia (H-90)

`run --oracle` corre la clasificación con la agrupación de referencia (`bench/oracle.mjs`, con los constructores de `src/analyze/`) y la descomposición una vez por grupo. Todas las variantes se puntúan sobre los mismos mensajes. `expected-b.json` es la etiqueta de un segundo lector; `--reference a|b|union` elige contra cuál se puntúa y `compare --ceiling` agrega el otro lector como si fuera el analizador (el techo del desacuerdo). `compare` informa la clasificación solo sobre lo que recibió mensaje, intervalos de Wilson, la comparación de a pares con prueba de signos y `--common-cases` para variantes que se cortaron por el tope de gasto. `judge-usefulness.mjs --pooled --same-points --judge-model <id>` juzga los mismos puntos de todas las variantes en una llamada, sin etiquetas.

## Descripciones de área (H-600)

`areas-classify.mjs --variant <nombre>` corre solo la clasificación (sin descomposición) con las descripciones de `bench/area-variants/<nombre>.mjs`. Sin banderas, el modelo recibe la agrupación de referencia; con `--no-grouping` arma sus grupos con ventanas, validación y reparación como el pipeline. `compare a.json b.json` cuenta los mensajes donde solo acierta uno y `report` reimprime una corrida. Mide exactitud por unidad y por mensaje contra el lector A, el B y la unión, y los pares más confundidos. Lee `bench/private/` (`BENCH_PRIVATE_DIR`). Cada corrida cuesta unos 0,05 USD y se suma en `bench/results/private-spend.jsonl`.

## Comparación de modelos (H-80)

`h80-report.mjs` agrupa archivos de resultado por modelo o esfuerzo y calcula cobertura, área, asignación, marcas de IA, tiempo p50 y p95, costo por entrada (también con caché tibia), la comparación de a pares por punto con prueba de signos (`h80.js`) y la utilidad de los archivos del juez agrupado. Sonnet 5.5 necesita `--config '{"classifyThinking":null,"decomposeThinking":null}'` (H-1100). La medición está en `docs/investigaciones/mediciones/2026-10-21-modelos-y-esfuerzo-de-clasificacion.md`.

