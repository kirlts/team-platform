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
