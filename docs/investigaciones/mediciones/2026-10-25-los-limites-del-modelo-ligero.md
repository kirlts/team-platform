# Los límites del modelo ligero

Fecha: 2026-10-25. Pedido de Martín, 02:25: «empujar un poco los límites de Haiku para poder utilizarlo en problemas que no sean ridículamente triviales … hay que entender cuáles son sus límites … quiero ahorrar costos». Y poder pasar a Sonnet cuando haga falta.

Resultado:

1. Haiku 5.5 cerró 6 de 7 corridas de seis tareas reales de este repositorio, desde un cambio de rótulo hasta una migración con API y pantalla. Sonnet 5.5 cerró las seis.
2. Ninguna estimación del analizador separa la corrida que falló de las que cerraron. Con estos datos no hay límite que derivar. `EXECUTE_LIGHT_LIMITS` queda sin límite (`create=1 irreversibility=1 certainty=0`) hasta que los juicios de cada trabajo acumulen casos.
3. Con los precios publicados Haiku costó 0,055 USD las seis tareas y Sonnet 0,557 USD: diez veces menos. El costo que informa la CLI dice lo contrario: 2,18 USD contra 0,86 USD. No se explicó la diferencia. Antes de afirmar un ahorro hay que leer el informe de uso de la consola de Anthropic.
4. Haiku tardó 48 minutos en las seis tareas y Sonnet 10; tres tareas de Haiku pasaron de 10 minutos. Las corridas compartieron la máquina con otras sesiones (carga de 10 a 45): el tiempo es orientativo.

## Método

Guion: `bench/model-limits.mjs` (una corrida por tarea y modelo; `--estimate` pide al modelo de análisis las estimaciones de cada tarea). Cada tarea es un clon limpio de este repositorio con la misma instrucción del arnés (la mínima, `compact`), las mismas herramientas (`--tools Bash,Read,Edit,Write,Grep,Glob,Agent`) y sin tope de pasos; sólo cambia el modelo. El resultado lo decide una comprobación que corre sobre el clon, nunca lo que dice el modelo. T3 y T4 parten de un defecto sembrado (una función cambiada) y su comprobación es una prueba que el modelo no ve, porque las pruebas del repositorio no distinguen el defecto. Carga acotada con `systemd-run` (2 CPU y 4 GB por corrida). Cuenta de la sesión, sin `ANTHROPIC_API_KEY`: gasta cuota.

Las estimaciones de cada tarea (crear, irreversibilidad, certeza) son las que devolvió Haiku 5.5 con las mismas definiciones que usa el analizador (una llamada por tarea).

## Resultados

| Tarea | Estimaciones del analizador (crear, irreversibilidad, certeza) | Modelo | Resultado | Pasos | Minutos | Tokens leídos | Costo de la CLI (USD) | Costo con precios publicados (USD) |
|---|---|---|---|---|---|---|---|---|
| T1 texto | 0.05 · 0.02 · 0.80 | Haiku 5.5 | cierra | 12 | 4,7 | 249.367 | 0,241 | 0,009 |
| T1 texto | 0.05 · 0.02 · 0.80 | Sonnet 5.5 | cierra | 7 | 2,6 | 143.212 | 0,149 | 0,096 |
| T2 pantalla chica | 0.10 · 0.02 · 0.70 | Haiku 5.5 | cierra | 5 | 0,5 | 140.679 | 0,142 | 0,005 |
| T2 pantalla chica | 0.10 · 0.02 · 0.70 | Sonnet 5.5 | cierra | 4 | 0,5 | 64.631 | 0,083 | 0,053 |
| T3 defecto con causa clara | 0.20 · 0.05 · 0.75 | Haiku 5.5 | cierra | 15 | 12,6 | 447.466 | 0,285 | 0,012 |
| T3 defecto con causa clara | 0.20 · 0.05 · 0.75 | Sonnet 5.5 | cierra | 9 | 0,4 | 106.221 | 0,103 | 0,068 |
| T4 defecto sin causa clara | 0.25 · 0.35 · 0.60 | Haiku 5.5 | cierra | 20 | 11,1 | 759.268 | 0,413 | 0,017 |
| T4 defecto sin causa clara | 0.25 · 0.35 · 0.60 | Sonnet 5.5 | cierra | 8 | 1,2 | 149.313 | 0,103 | 0,064 |
| T5 unificación de dos piezas | 0.20 · 0.05 · 0.60 | Haiku 5.5 | no cierra | 7 | 2,3 | 180.471 | 0,170 | 0,006 |
| T5 unificación de dos piezas | 0.20 · 0.05 · 0.60 | Sonnet 5.5 | cierra | 6 | 0,8 | 89.943 | 0,104 | 0,068 |
| T5 unificación de dos piezas, segunda corrida | igual | Haiku 5.5 | cierra, `cannot_close` true | 13 | 10,9 | 350.298 | 0,253 | 0,010 |
| T6 migración, API y pantalla | 0.40 · 0.20 · 0.60 | Haiku 5.5 | cierra | 5 | 16,8 | 373.716 | 0,929 | 0,005 |
| T6 migración, API y pantalla | 0.40 · 0.20 · 0.60 | Sonnet 5.5 | cierra | 15 | 4,3 | 509.850 | 0,321 | 0,209 |

Costo con precios publicados: lectura de caché, escritura de caché y salida a 0,01, 0,125 y 0,50 USD por millón en Haiku 5.5 (prompts de hasta 100.000 tokens) y a 0,10, 2,50 y 10 en Sonnet 5.5; platform.claude.com/docs/en/about-claude/pricing, leído el 2026-10-25. Los tokens son los de la conversación principal: en T6 Haiku usó subagentes, cuyo uso no entra en `usage` aunque sí en el costo de la CLI, así que su cifra publicada queda corta.

## Lo que dicen los datos

| Pregunta | Respuesta medida |
|---|---|
| ¿Hasta dónde llegó Haiku? | Hasta la migración con API y pantalla (T6), que cerró en una corrida sin ayuda. Con un defecto sin causa clara (T4) también cerró |
| ¿Dónde falló? | En la unificación de dos piezas (T5), en la primera corrida: terminó sin cambiar ningún archivo y sin decir que no podía (`cannot_close` false). En la segunda cerró, y dijo `cannot_close` true |
| ¿Lo predice alguna estimación? | No. T5 tiene las mismas estimaciones de crear e irreversibilidad que T3, que cerró, y la misma certeza que T4 y T6, que cerraron |
| ¿Qué cuesta más, Haiku o Sonnet? | Por los precios publicados, Haiku diez veces menos. Por la CLI, Haiku 2,5 veces más. Sin resolver |
| ¿Y en tiempo? | En T3 y T4 Haiku dio 1,7 y 2,5 veces más pasos y tardó 31 y 9 veces más minutos |

Dos consecuencias para el diseño. Primera: el fallo de Haiku no avisó. La escalada por `cannot_close` o `blocked` no lo habría visto. Lo ven la comprobación del anfitrión (gancho `Stop`) y el juicio del trabajo.

Segunda: la autoevaluación también se equivoca al revés. En la segunda corrida de T5 pidió escalar un trabajo que ya estaba bien. Una escalada de más cuesta una pasada de Sonnet; una que falta deja un trabajo que no hace lo que dice.

## Qué falta para derivar límites

Con n = 1 por tarea no se separa una dimensión. El criterio queda escrito: el límite es el valor medio entre la mayor estimación de lo que Haiku cerró y la menor de lo que no cerró. Se fija sólo cuando esos dos rangos no se cruzan en al menos 20 trabajos juzgados.

Esos trabajos los acumula el juicio del trabajo de cada trabajo real (`execute_judgments`). El guion se repite con `node bench/model-limits.mjs --model claude-haiku-5-5` y con `--model claude-sonnet-5-5`, y suma casos.

## Costo de la corrida

Las 13 corridas (siete de Haiku y seis de Sonnet) gastaron cuota de la cuenta de la sesión. Suman 3,30 USD equivalentes por la CLI y 0,62 USD por los precios publicados.
