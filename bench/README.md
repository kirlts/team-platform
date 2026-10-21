# Banco de referencia

Mide la descomposición de un input en mensajes (MASTER-SPEC §7.11): MECE por aritmética de conjuntos sobre `unit_ids`, tiempo total y por paso, tokens y costo por llamada.

```sh
node --test bench/                 # pruebas con el analizador falso, sin red ni llaves
node bench/run.mjs --fake perfect  # reporte con el analizador falso
node bench/run.mjs --repeat 5      # analizador real (src/analyze/index.js), 5 repeticiones
cd bench && npm ci && npm run eval # promptfoo sobre los mismos casos
```

Las pruebas y `run.mjs` no necesitan `npm ci`. Sólo `npm run eval` usa promptfoo.

## Casos

Cada carpeta de `cases/` tiene `input.json` y `expected.json`. Los textos son inventados y no contienen datos de personas reales.

| Caso | Input | Mensajes esperados |
|---|---|---|
| `01-chat-grupo` | Captura de un chat de grupo, 16 líneas | 3 |
| `02-docx-40-puntos` | Documento de retroalimentación, 52 unidades | 40 |
| `03-monologo-prueba` | Transcripción de 10 minutos, 50 segmentos | 9 |
| `04-reporte-de-error` | Reporte con pasos y una captura | 1 |
| `05-idea-suelta` | Cuatro líneas | 1 |
| `06-mensaje-mezclado` | Un mensaje con tres pedidos | 3 |
| `07-video-de-pantalla` | Voz y fotogramas de un video de un minuto | 4 |

`input.json` numera las unidades (`u1`, `u2`, …). `source` es `t` para el texto escrito por la persona o el id de un adjunto. `expected.json` asigna cada unidad a un mensaje o a `discarded`, con su motivo. Cada mensaje esperado es un punto atómico: dos puntos en un mensaje cuentan como fusión. `area` y `template` aceptan una lista cuando el input mezcla temas.

La referencia es una primera versión escrita a mano. Informe 02 §5.1: se audita contra las salidas de los modelos antes de tomarla como verdad, porque una referencia manual omitió 227 intervalos en un estudio de 2026.

## Puntaje

`score.js` recibe las unidades, `expected.json` y la propuesta. Definiciones del informe 02 §5.2:

| Medida | Cuenta |
|---|---|
| Cobertura | Puntos con todas sus unidades dentro de un mismo mensaje, sobre los puntos esperados |
| Repetición | Puntos completos en un mensaje y tocados por otro, sobre los puntos esperados |
| Mensajes de más | Mensajes que no tocan ningún punto, sobre los mensajes obtenidos |
| Partidos | Puntos repartidos entre mensajes sin quedar completos en ninguno |
| Fusionados | Mensajes que tocan dos o más puntos, sobre los mensajes obtenidos |

Además informa unidades en dos mensajes, unidades en ninguno ni en `discarded`, unidades inventadas, y si área y plantilla coinciden. `mece` es verdadero cuando la cobertura es 1 y todo lo demás es 0.

## Integración con el analizador

`runCase` llama `analyze(bundle, { onProgress, onCall })` con la firma de §7.5. Supuestos que el núcleo tiene que cumplir o `lib.js` ajustar:

- `bundle.units` trae la numeración de la referencia (`[{ id, text }]`). Si el analizador numera por su cuenta, tiene que producir los mismos ids para estos casos.
- La propuesta incluye `messages[].unit_ids`, `discarded` (ids o `{ unit_id, reason }`), `area_id` y `template_id`.
- Cada paso emite `onProgress({ percent, phrase })`. El tiempo de un paso corre hasta el siguiente evento.
- Cada llamada al proveedor se informa con `onCall({ input_tokens, output_tokens, cached_tokens, cost_usd })`, o en `llm_calls` de la propuesta.

`fake-analyzer.js` cumple esos supuestos y llama a un proveedor falso con la forma de §7.6. Modo `perfect` devuelve la referencia; `noisy` la corrompe para comprobar que el banco detecta fusiones, repeticiones y mensajes de más. Su costo usa los precios de lista del MASTER-SPEC §3 (0,10 USD entrada, 0,50 salida, 0,01 lectura de caché por millón de tokens).

## promptfoo

`bench/package.json` fija promptfoo en la versión exacta 0.124.1 (MIT, consultada en npm el 2026-10-20). `provider.mjs` ejecuta el analizador y `assert.mjs` es la aserción JavaScript que importa `score.js`. Para no enviar datos fuera, `npm run eval` desactiva la telemetría. El árbol de dependencias de promptfoo incluye paquetes con otras licencias; ninguno entra a la imagen.
