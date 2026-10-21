# Juicios de interfaz

Método para evaluar la interfaz con jueces acotados en paralelo (UD-062). Fuentes: `docs/investigaciones/10 - Evaluación de interfaz con jueces acotados.md` y `09 - Telemetría de la interfaz.md`.

## Orden de los instrumentos

1. Detectores en navegador (`panel/scripts/ui-detectors.mjs`): solapes, objetivos táctiles de menos de 24 px, escala tipográfica, contraste, desbordes, scroll horizontal, alto de página, elementos de igual peso visual y lenguaje de instrumento. Una pasada de 9 pantallas, 2 ventanas y 2 temas dura unos 80 s.
2. Telemetría de uso (`GET /api/telemetry/ui-summary`, `scripts/ui-report.mjs`): duración, clics y desplazamientos por tarea, errores, abandono, CLS, INP, tareas largas.
3. Jueces acotados: sólo lo que los dos instrumentos no ven (significado de rótulos, jerarquía, composición, consistencia, flujo).

## Comandos

```sh
node scripts/juicios.mjs preparar --out DIR [--items home,settings] [--detectors FILE] [--telemetry FILE]
# un subagente por elemento de DIR/manifest.json, todos a la vez, con su campo `prompt`
node scripts/juicios.mjs consolidar --out DIR
node scripts/juicios.mjs calibrar
```

`preparar` toma las capturas y corre los detectores a la vez (no dependen entre sí), lee la telemetría y escribe un encargo por pantalla o flujo en `DIR/encargos/`. Elementos: `home`, `messages`, `message-detail`, `areas`, `team`, `settings`, `connections`, `login`, `flow-send`, `flow-reply-close`. Sin `--telemetry` usa la de la propia pasada de capturas, que es sintética; con datos reales: `node scripts/ui-report.mjs --db /data/team.db --json > uso.json` y `--telemetry uso.json`.

## El encargo

Plantilla: `scripts/juicios/plantilla-encargo.md`. Dura unos 5 minutos y lleva:

- las capturas de la pantalla (1440x900 y 390x844, claro y oscuro);
- los hallazgos de los detectores y la telemetría de esa pantalla;
- las decisiones del dueño que la rigen y los hallazgos ya refutados, extraídos de `docs/USER-DECISIONS.md` y `docs/HALLAZGOS.md`, como reglas del alcance;
- la forma del resultado: JSON con hasta 8 hallazgos, cada uno con captura o medida, y una nota que parte en 2.

El encargo no dice qué se cambió desde la ronda anterior (informe 10, recomendación 7). Los hallazgos resueltos tampoco entran: si el juez repite uno, el consolidador lo marca.

## Consolidación

`consolidar` marca cada hallazgo contra el libro y contra los otros jueces:

| Estado | Significa |
|---|---|
| `nuevo` | Sin parecido en el libro ni en la ronda: lo valida quien coordina, con la captura o la medida |
| `refutado-antes` | Se parece a una fila refutada; se muestra la fila |
| `repetido-de-resuelto` | Se parece a una fila resuelta: regresión o falso positivo, se comprueba |
| `ya-decidido` | Se parece a una fila que espera una decisión del dueño |
| `repetido-en-la-ronda` | Otro juez de la misma ronda lo reportó antes |
| `sin-evidencia` | No trae captura ni medida; no cuenta |

El parecido es la similitud de Jaccard entre los títulos con raíces de cinco letras. Umbral 0,35, el de mejor F1 medido sobre el propio libro (`calibrar`): precisión 0,67 y exhaustividad 0,35 al detectar las repeticiones que el libro declara. Es un generador de candidatos y no un veredicto; no borra nada. Medición: `docs/investigaciones/mediciones/2026-10-21-umbral-de-repeticion-en-el-libro.md`.

Un hallazgo cuenta cuando se reproduce con captura o se mide; el acuerdo entre jueces no lo valida (informe 10, §2.2).

## Nota

Por omisión 2. Sube sólo con evidencia citada; un 4 nombra el producto de referencia con su fecha; un hallazgo de severidad 5 deja la nota en 1. No hay mínimo de hallazgos: un encargo sin hallazgos válidos devuelve lista vacía.

## Medición del marco

`docs/investigaciones/mediciones/2026-10-21-jueces-acotados-contra-juez-unico.md`.
