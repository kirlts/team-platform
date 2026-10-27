# Juicios de interfaz

Método para evaluar la interfaz con jueces acotados en paralelo (UD-092). Fuentes: `docs/investigaciones/10 - Evaluación de interfaz con jueces acotados.md` y `09 - Telemetría de la interfaz.md`.

## Orden de los instrumentos

1. Detectores en navegador (`panel/scripts/ui-detectors.mjs`). Miden solapes, objetivos táctiles de menos de 24 px, escala tipográfica, contraste y desbordes. También miden el scroll horizontal, el alto de página, los elementos de igual peso visual y el lenguaje de instrumento. Este último usa los patrones de `panel/src/ui-voice-patterns.mjs`, los de la guardia `ui-voice.test.ts`; `--voice-lang en` elige el inglés y el texto de las personas no se juzga. Una pasada de 9 pantallas, 2 ventanas y 2 temas dura unos 80 s.
2. Telemetría de uso (`GET /api/telemetry/ui-summary`, `scripts/ui-report.mjs`): duración, clics y desplazamientos por tarea, errores, abandono, CLS, INP, tareas largas.
3. Jueces acotados: sólo lo que los dos instrumentos no ven (significado de rótulos, jerarquía, composición, consistencia, flujo).

## Comandos

```sh
node scripts/juicios.mjs preparar --out DIR [--items home,settings] [--detectors FILE] [--telemetry FILE]
# un subagente por elemento de DIR/manifest.json, todos a la vez, con su campo `prompt`
node scripts/juicios.mjs consolidar --out DIR
node scripts/juicios.mjs calibrar
```

`preparar` toma las capturas y corre los detectores a la vez, porque no dependen entre sí. Después lee la telemetría y escribe un encargo por pantalla o flujo en `DIR/encargos/`. Elementos: `home`, `messages`, `message-detail`, `areas`, `team`, `settings`, `connections`, `login`, `flow-send`, `flow-reply-close`. Sin `--telemetry` usa la de la propia pasada de capturas, que es sintética; con datos reales: `node scripts/ui-report.mjs --db /data/team.db --json > uso.json` y `--telemetry uso.json`.

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

El parecido es la similitud de Jaccard entre los títulos con raíces de cinco letras. El umbral es 0,35, el de mejor F1 medido sobre el propio libro (`calibrar`). Precisión 0,67 y exhaustividad 0,35 al detectar las repeticiones que el libro declara. Es un generador de candidatos y no un veredicto; no borra nada. Medición: `docs/investigaciones/mediciones/2026-10-21-umbral-de-repeticion-en-el-libro.md`.

Un hallazgo cuenta cuando se reproduce con captura o se mide; el acuerdo entre jueces no lo valida (informe 10, §2.2).

## Nota

Por omisión 2. Sube sólo con evidencia citada; un 4 nombra el producto de referencia con su fecha; un hallazgo de severidad 5 deja la nota en 1. No hay mínimo de hallazgos: un encargo sin hallazgos válidos devuelve lista vacía.

## Medición del marco

`docs/investigaciones/mediciones/2026-10-21-jueces-acotados-contra-juez-unico.md`.

## Veredictos por vista

Estado al 2026-10-27 sobre `origin/desarrollo` en `8ce12dcb`. Cada fila es un informe de un juez, escrito con capturas en 1440x900 y 390x844, claro y oscuro, y mediciones en el navegador. Los informes y las capturas están fuera del repositorio y no se versionan; cada fila los identifica por vista, ronda y sha juzgado.

Nombres de las vistas: Entrada es `01-entrada` e Inicio es `1-inicio`. Envío nuevo reúne `2-nuevo` y `2-nuevo-para`. Lista reúne `3-mensajes` y `3-mensajes-vacio`. Ficha es `4-detalle` e Hilo es `5-hilo`. Equipo, Áreas, Área, Configuración y Conexiones son `10-equipo`, `20-areas`, `21-area`, `30-configuracion` y `31-conexiones`.

La ronda cuenta los juicios de esa vista en orden. La ronda 1 juzgó `08fd1dea` y las siguientes juzgaron la rama que arreglaba lo anterior, sin decirle al juez qué cambió. Una nota sin pareja es la única que el juez dio para la vista. Los hallazgos compartidos entre vistas de una misma fila se cuentan una vez. La última ronda de cada vista manda; las anteriores quedan como historia.

| Vista | Ronda | Sha juzgado | Nota (escritorio / teléfono) | Graves | Medios | Bajos | Capacidades aprobadas | Capacidades rechazadas y motivo | Estado |
|---|---|---|---|---|---|---|---|---|---|
| Entrada | 1 (2026-10-26) | `08fd1dea` | 3 | 0 | 1 | 2 | Tema y piel | Identidad local y delegada: con la página abierta y la sesión vencida el panel no lleva a la entrada | Fusionado en desarrollo |
| Entrada | 2 (2026-10-27) | `37ea68bc` | 3 | 0 | 0 | 2 | Identidad local y delegada, Tema y piel | Ninguna | En rama `wt-inicio-d3`, sin fusionar |
| Inicio | 1 (2026-10-26) | `08fd1dea` | 4 / 2 | 1 | 6 | 2 | Mensajes, Envío que se reparte en varios mensajes (escritorio), Adjuntos, Estados y cierre, Borrar y restaurar, Pantallas al día en vivo, Tema y piel | Envío que se reparte en varios mensajes, en teléfono: el encabezado del cajón Análisis se superpone con una propuesta por revisar | Fusionado en desarrollo |
| Inicio | 2 (2026-10-27) | `37ea68bc` | 3 / 2 | 0 | 4 | 4 | Identidad, Mensajes, Envío que se reparte en varios mensajes, Estados y cierre, Adjuntos (foto y audio sin probar), Reintentar y retomar, Pantallas al día en vivo, Tema y piel | Borrar y restaurar: «Borrar envío» borra sin Deshacer y la capacidad promete Deshacer para envíos | En rama `wt-inicio-d3`, sin fusionar. La rama avanzó a `f8c7a170` con el borrado reversible de envíos, Enviar N mensajes a la vista en teléfono y destinos de 44 px; sin nuevo juicio |
| Envío nuevo | 1 (2026-10-26) | `08fd1dea` | 3 en `2-nuevo`, 2 en `2-nuevo-para` | 1 | 4 | 6 | Mensajes, Adjuntos, Tema y piel | Ninguna | Fusionado en desarrollo. Sustituida por la ronda 4 |
| Envío nuevo | 2 (2026-10-27) | `ddb25a75` | 3 en ambas | 0 | 3 | 6 | Mensajes, Adjuntos | Ninguna | Fusionado en desarrollo. Sustituida por la ronda 4 |
| Envío nuevo | 3 (2026-10-27) | `3bad5ac1` | 4 en ambas | 0 | 3 | 4 | Adjuntos | Mensajes: enviar como otra persona no deja rastro en la pantalla de quien envía | Fusionado en desarrollo. Sustituida por la ronda 4 |
| Envío nuevo | 4 (2026-10-27) | `1e327dbf` | 3 en `2-nuevo`, 4 en `2-nuevo-para` | 0 | 4 | 3 | Mensajes, Adjuntos, Envío que se reparte en varios mensajes, Sesión de Claude, Roles de equipo, Idioma, Tema y piel | Ninguna | Fusionado en desarrollo. Los cuatro medios siguen abiertos en el informe |
| Lista | 1 (2026-10-26) | `08fd1dea` | 4 / 3 en `3-mensajes`, 3 en `3-mensajes-vacio` | 0 | 2 | 3 | Mensajes, Estados y cierre, Borrar y restaurar (el aviso con Deshacer no se ejecutó) | Ninguna | Fusionado en desarrollo |
| Lista | 2 (2026-10-27) | `825b2085` | 3 / 2 en ambas | 1 | 3 | 5 | Mensajes, Estados y cierre, Borrar y restaurar, Adjuntos (medios visibles), Pantallas al día en vivo, Tema y piel | Ninguna | En rama `wt-lista-d3`, sin fusionar. El grave es una regresión de la rama (la marca de la cabecera se parte en teléfono). La rama avanzó a `f6d7392a` con ese arreglo, el de los dos medios de teléfono y Deshacer al cerrar; sin nuevo juicio |
| Ficha | 1 (2026-10-26) | `08fd1dea` | 3 | 0 | 6 | 6 | Respuestas e hilos, Menciones, Estados y cierre, Adjuntos, Reintentar y retomar, Entrega aparte y en espera, Avisos de progreso, Capturas en la respuesta, Sesión de Claude, Reenviar con motivo, Borrar y restaurar | Revisión por persona: la línea «Cambio listo para revisar» no dice cómo aprobar, descartar ni pedir cambios | Fusionado en desarrollo |
| Hilo | 1 (2026-10-26) | `08fd1dea` | 3 / 3 | 0 | 4 | 6 | Respuestas e hilos, Estados y cierre, Reenviar con motivo, Reintentar y retomar, Avisos de progreso, Borrar y restaurar (respuestas), Roles de equipo | Ninguna | Fusionado en desarrollo |
| Ficha e Hilo | 2 (2026-10-27) | `9d567915` | 3 en Ficha, 3,5 en Hilo | 1 | 4 | 7 | Mensajes, Respuestas e hilos, Menciones, Miembros y perfiles, Estados y cierre, Adjuntos, Envío que se reparte en varios mensajes, Reintentar y retomar, Entrega aparte y en espera, Límite de la idea (condicionada al grave), Traspaso a una persona, Capturas en la respuesta, Reenviar con motivo, Avisos de progreso, Sesión de Claude, Borrar y restaurar, Idioma | Revisión por persona: el botón «Responder a Claude» de la línea de revisión contradice UD-280 (la revisión se hace respondiendo, sin botones) | En rama `wt-ficha-d3`, sin fusionar. El grave se resuelve quitando el botón o enmendando UD-280 con la palabra del dueño; no hay commit posterior a lo juzgado |
| Equipo, Áreas, Área, Configuración, Conexiones | 1 (2026-10-27) | `08fd1dea` | 3, 3, 3, 2 y 2 | 3 | 8 | 7 | 19 aprobaciones por vista, de estas capacidades: Miembros y perfiles, Roles de equipo, Identidad (cambio de contraseña), Áreas y plantillas, Borrar y restaurar (áreas), Estados y cierre, Traspaso, Avisos de progreso, Proveedores y claves, Descripción del proyecto, Idioma, Tema y piel, Telemetría, Envío que se reparte (Publicación), Datos de prueba | Borrar y restaurar en Equipo: la capacidad prometía lista y restauración de miembros, que UD-292 no admite. Límite de la idea: la ventana Límites usa la casilla del navegador y no tiene relleno. Cola, traza y auditoría: el conteo de la cola dibuja ceros cuando falla la lectura | Fusionado en desarrollo. Sustituida por la ronda 2 |
| Equipo, Áreas, Área, Configuración, Conexiones | 2 (2026-10-27) | `704ee422` | 3 en las cinco | 0 | 3 | 11 | Miembros y perfiles, Roles de equipo, Borrar y restaurar (eliminar miembros y áreas), Áreas y plantillas, Estados y cierre, Avisos de progreso, Proveedores y claves (reserva: un proveedor caído no se ve con el pliegue cerrado), Datos de prueba, Cola traza y auditoría, Idioma, Descripción del proyecto, Tema y piel | Ninguna | Fusionado en desarrollo. Los tres medios siguen abiertos en el informe |

En la primera ronda del Envío nuevo el resumen del informe dice 5 bajos y la lista trae 6; la tabla usa la lista. Los veredictos de las ramas sin fusionar cuentan cuando la rama entra en desarrollo. Son Entrada e Inicio, Lista, y Ficha e Hilo, todos de la ronda 2. Los hallazgos abiertos de cada vista fusionada son los de su última ronda fusionada.
