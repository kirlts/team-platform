# Arranque de una sesión del modelo ligero

Fecha: 2026-10-25. Pedido de Martín, 01:55: cuidar los tokens con Haiku, reglas que no se puedan omitir y un índice pequeño del código. Medido con Claude Code 2.1.284 y `claude -p --output-format json`, que devuelve `usage` de la primera petición: la cifra es la del API, no una estimación. Guion: `scripts/medir-arranque.mjs`. Cuenta de la sesión, sin `ANTHROPIC_API_KEY` (cuota, no dólares).

Resultado:

| Qué pesa en el arranque | Antes | Después |
|---|---|---|
| Definiciones de herramientas y sistema de Claude Code (sin prompt del arnés) | 53.938 tokens | 29.302 tokens con siete herramientas (`Bash,Read,Edit,Write,Grep,Glob,Agent`); 25.214 sin `Agent` |
| Prompt del arnés con las reglas del anfitrión (2.597 palabras) | 12.346 tokens | 3.892 tokens con el prompt mínimo, las reglas mínimas del anfitrión (313 palabras) y el mapa del repositorio |
| Total de la primera petición | 66.303 tokens | 33.194 tokens (−50 %) |

Unos 24.600 de los 33.100 tokens ahorrados son herramientas que la sesión no usa: `--tools` las deja fuera y ninguna petición las repite. El prompt mínimo y las reglas mínimas del anfitrión ahorran unos 8.500. El mapa del repositorio cuesta unos 260 tokens (estimado a 3 caracteres por token; tope 800).

## Un trabajo pequeño completo

Cambiar el rótulo «Cerrar» por «Finalizar» en la tarjeta de mensaje, con Haiku 5.5 y la misma instrucción. Una corrida por variante (n = 1: orientativo).

| | Antes | Después |
|---|---|---|
| Pasos | 9 | 21 |
| Tokens de entrada leídos por paso (media) | 56.009 | 21.043 (−62 %) |
| Tokens escritos en caché | 75.345 | 54.216 |
| Tokens de salida | 2.837 | 7.826 |
| Costo que informa la CLI | 0,417 USD | 0,374 USD (−10 %) |
| Costo con los precios publicados (0,10 entrada, 0,50 salida, 0,125 escritura de caché y 0,01 lectura por millón) | 0,015 USD | 0,015 USD |

Dos hallazgos. Cada paso costó 38 % del anterior, pero Haiku dio 2,3 veces más pasos con el prompt mínimo. El trabajo entero costó casi lo mismo: el ahorro por paso no es el ahorro por trabajo.

La CLI informa para Haiku 5.5 un costo 28 veces mayor que el de los precios publicados para esos tokens. Fuente de los precios: platform.claude.com/docs/en/about-claude/pricing, leído el 2026-10-25. No se explicó. El tope diario usa la cifra de la CLI: mide de más y protege por exceso.

## Qué no se hizo

- No hay tope de pasos ni de tokens por nivel (Martín, 2026-10-25: «sin tope de pasos por nivel, solamente el tope de presupuesto diario»). Lo que se ahorra es lo que se carga al empezar: herramientas, prompt, reglas y mapa.
- Las reglas duras no se piden en el prompt. `team guard` (gancho `PreToolUse`) impide empujar `main` y forzar un push.
- `EXECUTE_DIRECT_STOP_COMMAND` es el gancho `Stop` con el que el anfitrión exige sus pruebas críticas antes de terminar.

## Reglas del anfitrión que pasan de prosa a gancho

Las instrucciones del arnés del anfitrión (`instrucciones-del-harness.md`, 2.597 palabras) mezclan descripción del espacio con reglas que no deben depender de que el modelo las recuerde. La plataforma ya trae el mecanismo (`--settings` con ganchos de Claude Code); lo que sigue es el reparto entre lo que la plataforma hace cumplir y lo que le corresponde declarar al anfitrión.

| Regla de la prosa | Gancho | Quién lo escribe |
|---|---|---|
| Nunca empujar `main`; no forzar un push | `PreToolUse` sobre Bash: `team guard` | Plataforma (hecho) |
| La rama del trabajo es la única que se empuja | `team guard` rechaza un push a `main` o `master` en cualquier forma (`HEAD:main`, `-C ruta push`) | Plataforma (hecho) |
| Las pruebas críticas pasan antes de terminar | `Stop`: `EXECUTE_DIRECT_STOP_COMMAND` | Anfitrión (la plataforma lo declara y lo ejecuta) |
| Un cambio de pantalla deja su video | `Stop` del anfitrión (ya existe `exigir-el-video.sh`) | Anfitrión |
| El juez distinto del autor marca el árbol antes de entregar | `Stop` del anfitrión que lee el último `Juzgado-por` | Anfitrión |
| No usar `sleep`, sondeos ni `npx vitest run` sin archivos | `PreToolUse` sobre Bash del anfitrión | Anfitrión |
| Producción sólo se lee | Cuenta `solo_lectura` (el servidor responde 403) | Anfitrión (ya existe) |
| Ninguna credencial en un archivo | Gancho de commit del repositorio | Anfitrión (ya existe) |

Lo que queda como prosa es lo que describe el espacio: dónde está el repositorio, cómo se mira producción, cómo se arma la pila propia y cómo se redacta la respuesta final. Un borrador de esa versión mínima (313 palabras) se midió en este documento; el anfitrión lo adopta con `EXECUTE_DIRECT_HOST_INSTRUCTIONS`.
