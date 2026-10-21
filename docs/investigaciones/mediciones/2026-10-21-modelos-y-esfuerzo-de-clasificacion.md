# Haiku 5.5, Sonnet 5.5 y esfuerzo de clasificación, 2026-10-21

Resultado: Sonnet 5.5 asigna mejor (conjunto exacto de destinatarios 80,0 % contra 53,0 %, p 0,002 a pares) y se juzga algo más útil, a 17 veces el costo por entrada y 1,4 veces el tiempo. Cobertura y área no se separan. El modelo por omisión sigue siendo Haiku 5.5 (UD-058). El esfuerzo `medium` en la clasificación no mejora a `low`: el área baja de 94,7 % a 87,1 % (p 0,008) y 2 de 33 corridas privadas quedan inválidas. DeepSeek no se midió: no hay llave. Gasto: 9,14 USD de 10.

## Qué se corrió

| Elemento | Detalle |
|---|---|
| Código y prompts | `main` en 23b5a3b, sin cambios en `src/`, `templates/areas.json` ni prompts |
| Casos públicos | 8 casos, 3 repeticiones por modelo (24 corridas) |
| Casos privados | 12 casos elegidos por la regla de abajo, con equipo (`bench/private/team.json`) y proyecto (`bench/private/project.md`, 197.259 caracteres). Haiku: 3 repeticiones. Sonnet: 1 |
| Comparación privada | 11 casos comunes. A Sonnet le falta `w03-mp4-0947` porque el tope de gasto cortó la corrida |
| Referencia | Unión de los dos lectores (`expected-b.json`) |
| Configuración | Haiku: la de producción (`thinking` desactivado). Sonnet: `{"classifyThinking":null,"decomposeThinking":null}`, porque rechaza `thinking: disabled` (H-1100) |
| Juez de utilidad | Pooled y ciego, 4 mensajes por variante y caso, sin proyecto en el prompt. Dos jueces: Sonnet 5.5 y Haiku 5.5 |
| Informe | `node bench/h80-report.mjs` (ver «Cómo repetirlo») |

Elección de los 12 casos, fijada antes de ver un resultado: se agrupan los 39 casos por `kind` del manifiesto, se reparten 12 plazas por mayor resto (imagen 2, documento Word 3, video 3, chat 1, reunión 2, audio 1, tabla 0) y dentro de cada tipo, ordenado por id, se toma el índice `floor((j + 0,5) · n / k)`. Resultan c02, u03, d02, r06, u01, d03, u07, w03, u11, r10, u12 y w01. El tipo tabla (un caso) queda sin plaza.

## Modelos

Intervalos de Wilson al 95 % sobre mensajes de referencia distintos (las repeticiones no agregan observaciones).

| Medida | Haiku 5.5 | Sonnet 5.5 |
|---|---:|---:|
| Privados, cobertura | 47,8 % [38–58] | 54,3 % [44–64] |
| Privados, área por mensaje | 94,7 % [85–99] | 94,0 % [84–98] |
| Privados, destinatarios, conjunto exacto | 53,0 % [38–66] | 80,0 % [67–89] |
| Privados, destinatarios, precisión | 82,0 % [71–90] | 96,4 % [88–99] |
| Privados, destinatarios, recall | 77,1 % [63–86] | 82,7 % [70–91] |
| Privados, marcas de IA por mensaje | 0,052 | 0,040 |
| Públicos, cobertura | 95,8 % [88–99] | 97,7 % [90–99] |
| Públicos, clasificación (unidades con mensaje) | 96,5 % [94–98] | 96,7 % [95–98] |
| Públicos, marcas de IA por mensaje | 0,036 | 0,038 |
| Utilidad, juez Sonnet (media, 4 o 5) | 2,89 (33 %) | 3,27 (46 %) |
| Utilidad, juez Haiku (media, 4 o 5) | 3,15 (41 %) | 3,31 (54 %) |
| Privados, tiempo p50 / p95 (s) | 8,9 / 36,7 | 12,8 / 46,7 |
| Públicos, tiempo p50 / p95 (s) | 5,5 / 15,6 | 6,2 / 22,7 |
| Privados, costo por entrada (USD) | 0,0184 | 0,5690 |
| Privados, costo por entrada con caché tibia (USD) | 0,0172 | 0,3120 |
| Públicos, costo por entrada (USD) | 0,0029 | 0,0517 |

Comparación de a pares sobre los mismos puntos de referencia (tasa por punto sobre las repeticiones; puntos donde gana Haiku / gana Sonnet / empatan; prueba de signos):

| Medida | Haiku / Sonnet / empate | p |
|---|---:|---:|
| Cobertura, privados | 8 / 15 / 69 | 0,210 |
| Área, privados | 3 / 2 / 39 | 1,000 |
| Conjunto exacto, privados | 4 / 20 / 20 | 0,002 |
| Cobertura, públicos | 0 / 4 / 67 | 0,125 |

Lectura:

- Destinatarios: es la única diferencia que se separa del ruido. Se explica por la precisión (96 % contra 82 %): Sonnet asigna a menos personas que no corresponden.
- Cobertura y área: sin diferencia detectable. El límite de la cobertura lo pone la partición del input, no el modelo.
- Utilidad: ambos jueces ponen a Sonnet arriba, pero con 26 a 27 mensajes por variante los intervalos del 4 o 5 se traslapan (por ejemplo 33 % [19–52] contra 46 % [29–65]). Cada juez califica a su propio modelo en una de las dos filas; la dirección coincide en los dos.
- Costo: la mitad del costo privado de Sonnet es escritura de caché (1,23 M de tokens a 2,50 USD por millón), porque el proyecto de 66.000 tokens se reescribía en cada caso. Con la caché tibia (lotes de trabajos seguidos) son 0,31 USD por entrada, 18 veces Haiku.
- Tiempo: Haiku corrió en parte con otros procesos a la vez y Sonnet solo, así que la diferencia de latencia es un mínimo. El p95 privado lo fija `u12` (50 a 60 llamadas). Ambos quedan muy bajo los 900 s por trabajo.

Límites: Sonnet tiene una repetición en los casos privados, de modo que su variación entre corridas no está medida (la de Haiku: conjunto exacto entre 45 % y 58 %, cobertura entre 46 % y 51 %). El cociente de costo es de lista; Sonnet va con razonamiento adaptativo y Haiku sin él, así que la comparación es de configuraciones y no solo de modelos. Los jueces no vieron el proyecto.

## Esfuerzo de clasificación (H-15)

Haiku 5.5, `classifyEffort` `low` (omisión) contra `medium`, mismos 11 casos y 3 repeticiones.

| Medida | low | medium |
|---|---:|---:|
| Privados, área por mensaje | 94,7 % [85–99] | 87,1 % [74–95] |
| Privados, clasificación (unidades con mensaje) | 85,6 % [83–87] | 81,4 % [79–84] |
| Privados, cobertura | 47,8 % [38–58] | 44,9 % [35–55] |
| Privados, conjunto exacto | 53,0 % [38–66] | 54,0 % [39–68] |
| Privados, corridas inválidas | 0 de 33 | 2 de 33 |
| Entre repeticiones, área por mensaje | 93–96 % | 74–94 % |
| Entre repeticiones, cobertura | 46–51 % | 36–53 % |
| Públicos, cobertura | 95,8 % | 95,3 % |
| Utilidad, juez Sonnet | 2,89 | 2,70 |
| Privados, tiempo p50 (s) | 8,9 | 7,4 |

De a pares, `low` gana en área en 8 puntos y `medium` en 0 (p 0,008). En cobertura `low` gana en 20 y `medium` en 11 (p 0,150), sin separarse. Las dos corridas inválidas de `medium` fallaron en la clasificación (plantilla que no pertenece al área) y en la descomposición (unidad inexistente). La variación entre repeticiones de H-15 no baja con `medium`: el área de una de sus tres repeticiones cae a 73,8 %. Se mantiene `low`.

## DeepSeek

No se corrió. Comprobación del 2026-10-21: `~/.config/team-platform/env` define `ANTHROPIC_API_KEY` y `GROQ_API_KEY` y ninguna `DEEPSEEK_API_KEY`; el entorno del proceso tampoco. `TEXT_PROVIDER=deepseek node bench/run-private.mjs run --plan` responde «SIN TARIFA» y `Plan: NO ejecutable`. La página de modelos de DeepSeek (`api-docs.deepseek.com`, consultada el 2026-10-21) nombra `deepseek-flash` y `deepseek-v4-pro` y no trae precios, así que `bench/pricing.js` no recibe tarifa sin fuente (H-1101).

## Gasto

9,14 USD de 10, según `bench/results/h80/private-spend.jsonl`.

| Concepto | USD |
|---|---:|
| Haiku, casos privados (3 repeticiones) | 0,62 |
| Haiku, casos públicos (3 repeticiones) | 0,07 |
| Haiku `medium`, privados (3) y públicos (3) | 0,59 |
| Sonnet, casos públicos (3 repeticiones) | 1,24 |
| Sonnet, casos privados (11 casos, 1 repetición) | 6,26 |
| Jueces (Sonnet 0,25, Haiku 0,01) | 0,26 |
| Pruebas de humo de Sonnet | 0,09 |

## Cómo repetirlo

```sh
set -a; . ~/.config/team-platform/env; set +a
CASOS=$(cat bench/results/h80/casos.txt)
TEXT_MODEL=claude-haiku-5-5 node bench/run-private.mjs run --cases $CASOS --variant h80-haiku-r1 --team bench/private/team.json --project bench/private/project.md --results-dir bench/results/h80 --budget 10
TEXT_MODEL=claude-sonnet-5-5 node bench/run-private.mjs run --cases $CASOS --variant h80-sonnet-r1 --config '{"classifyThinking":null,"decomposeThinking":null}' --team bench/private/team.json --project bench/private/project.md --results-dir bench/results/h80 --budget 10
node bench/h80-report.mjs --dir bench/results/h80 --private-dir bench/private --private haiku-low=h80-haiku-r1,h80-haiku-r2,h80-haiku-r3 --private sonnet=h80-sonnet-r1,h80-sonnet-r1-extra --public haiku-low=publico-claude-haiku-5-5.json --public sonnet=publico-claude-sonnet-5-5.json
```
