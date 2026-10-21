# Trabajo en curso

> Documento de traspaso. Quien retome (otra sesión, otro modelo, otra cuenta) lo lee antes de actuar y lo mantiene al día en cada cambio de estado. Sin llaves ni datos privados. Última actualización: 2026-10-21 hacia las 13:00 (hora de Chile). Si la cuota de una cuenta se agota, otra sesión retoma desde «Trabajo en vuelo» sin contexto previo. Si la cuota de una cuenta se agota, otra sesión retoma desde la sección «Trabajo en vuelo» sin contexto previo.

## Estado de `main`

- `main` está en `66fdf7b` y empujado a origin. Fusionadas hoy: galería de medios (UD-059), HEIC con el `ffmpeg` de la imagen (UD-040), comparación de modelos (UD-058, Haiku 5.5 sigue por omisión), tabla de capacidades por modelo (H-1100), publicación automática y edición por el autor (UD-070 a UD-072, migraciones 0006 y 0007), descripciones de área v2 y regla de descomposición de H-1600 (UD-060), cierre de las pruebas bajo carga (H-901, H-905, H-906) los tres estados con la vista de área (UD-041, UD-042) el lenguaje de instrumento con su guardia (UD-050, H-1502), la telemetría de la interfaz y los jueces acotados (UD-090 a UD-092) Inicio según la maqueta con color por área (UD-045 a UD-047, migración 0008) y cobertura y estabilidad en reuniones largas (UD-080; `coveragePasses` y `classifyContextUnits`).
- Pruebas sobre `main` el 2026-10-21: `npm test` 725 pasan y 0 fallan, `node --test bench/` 74 de 74, panel `npx vitest run` 99 de 99, `tsc` limpio. Las suites de navegador (`test:fit`, `test:flows`) se corren con puertos propios: `PANEL_FIT_PORT=89xx PANEL_FLOWS_PORT=89xx PANEL_FLOWS_2A_PORT=89xx`.
- Lo especificado está en `docs/MASTER-SPEC.md`. Las decisiones, con las palabras de Martín, en `docs/USER-DECISIONS.md`. Las pruebas, en `docs/TEST.md`. Los hallazgos, todos, en `docs/HALLAZGOS.md`: el 100 % queda atendido. Investigaciones y mediciones con fuentes fechadas, en `docs/investigaciones/`.
- La maqueta inicial del dueño es `Plataforma Team.png` en la raíz y manda sobre cualquier decisión posterior de una sesión.
- Reglas: `docs/RULES.md`. La documentación pública no nombra otros proyectos del autor. Código, comentarios y nombres de pruebas en inglés (detector HP-008); interfaz y documentación en español. Nunca se envía una señal (`pkill`, `kill`) a procesos que la propia sesión no lanzó: dos agentes lo hicieron hoy y cortaron pruebas de otras sesiones.

<!-- vivo:inicio -->
### Estado vivo (generado con `node scripts/traspaso-vivo.mjs`)

- `main`: 8cb1eae Merge branch 'wt-barra-lateral'. Empujado a origin: `8cb1eae`.
- Ramas con commits sin fusionar: `wt-configuracion` 22 (hace 8 minutos), `wt-deuda` 13 (hace 2 minutos), `wt-inicio-respira` 7 (hace 4 minutos), `wt-banco-abiertos` 3 (hace 10 minutos), `wt-h904` 1 (hace 23 minutos).
- Worktrees abiertos: `team-platform`, `areas2`, `auto-publicar`, `banco-abiertos`, `cierre`, `configuracion`, `deuda`, `estados-areas`, `galeria`, `h900`, `h901`, `h904`, `h904-old`, `heic`, `ingles`, `inicio-maqueta`, `inicio-respira`, `modelos`, `reuniones`, `ronda3-b`, `telemetria-ui`, `thinking`, `voz`.
- Últimos commits en `main`:
- `8cb1eae` Merge branch 'wt-barra-lateral' (hace 2 minutos)
- `b5553d0` Flows: J2-A-41 and J2-A-47 read the row box of the sidebar (UD-130) (hace 3 minutos)
- `e890d6c` Merge main into wt-barra-lateral (hace 10 minutos)
- `dfe5ead` Traspaso: barra superior y telemetría fusionadas (hace 11 minutos)
- `1005e84` UD-130, H-2300 to H-2302 and tokens of the sidebar (hace 14 minutos)
- `c837d82` Sidebar: the row is the box that lights; the link no longer covers the count column (hace 15 minutos)
- `63dc519` Merge branch 'wt-telemetria-2' (hace 16 minutos)
- `cc61ef3` ui-detectors: sibling-alignment rule (hace 17 minutos)
Actualizado 2026-10-21 18:36 UTC.
<!-- vivo:fin -->

## Trabajo en vuelo

**Plan de cierre:** `docs/PLAN-DE-CIERRE.md` (2026-10-21 15:00). La sesión anterior murió a las 14:42 con la cuota de su cuenta agotada; sus agentes murieron con ella. Quien retome ejecuta ese plan desde la Fase 0: rescata lo sin commit de `configuracion`, `inicio-respira` y `barra-superior`, relanza los encargos A, B, C y G, y sigue el orden de fusión que dice. Encargo nuevo del dueño de hoy: la barra lateral (alineación, contadores sin contenedor, hover), encargo G.

**Avance 15:40.** En `main` también la barra lateral (`8cb1eae`). La deuda técnica vuelve a su rama: el dueño descartó derivar `VERIFICATION.md` (H-45) y el agente lo retira.

**Avance 15:25.** En `main` también la barra superior (`f0f5a2c`) y la telemetría pendiente (`63dc519`). Abierto: H-2000 y H-2001. Las ramas de Inicio y barra lateral deben fusionar `main`.

**Avance 15:15.** Fusionado en `main` el encargo del VPS (`402faf6`): restauración con adjuntos, `IMAGE_TAG` para una segunda instancia, respaldos en modo 600, `trusted-header` documentado. Abiertos: H-2605 (cualquier proceso local suplanta a un miembro en ese modo; el botón «Cerrar sesión» da 404, decisión del dueño). En vuelo: barra superior, barra lateral, Inicio, Configuración, telemetría, H-904 y Firefox, banco, deuda técnica.

Tres encargos siguen abiertos, cada uno en su worktree bajo `.claude/worktrees/<nombre>` y su rama `wt-<nombre>`. Los agentes no sobreviven a la sesión: la memoria de cada encargo es su rama y su fila de aquí. Para retomar: `git -C .claude/worktrees/<nombre> log --oneline main..HEAD`, leer sus filas en `docs/HALLAZGOS.md` y sus UD, y continuar en ese worktree. Ninguno empuja a `main`. Se fusiona con `git merge --no-edit wt-<nombre>`, luego `node scripts/check-conflict-markers.mjs`, `npm test`, `node --test bench/`, `cd panel && npx vitest run && npx tsc --noEmit` y las suites de navegador con puertos propios. Si dos ramas chocan en UD o H, se renumera la que entra después. Si una rama choca con `main` en más de dos archivos, se le pide a su agente (o a quien la retome) que haga `git merge main` en su rama y resuelva allí.

| Rama | Pedido del dueño (textual o resumido) | Criterio de cierre | Rangos reservados |
|---|---|---|---|
| `wt-barra-superior` | «Todo esto (Para mí y Por área) debería quedar integrado de manera eficiente, ordenada y no redundante en la barra superior del sitio, siempre visible, pero NO en Inicio. Inicio ya tiene demasiados elementos» | Resumen de «Para mí» y por área en la barra superior de todas las páginas, sin repetirlo en la insignia de Mensajes ni en los contadores de la barra lateral; la franja sale de Inicio; pruebas migradas | UD-100.., H-2000.. |
| `wt-inicio-respira` | «La barra de texto necesita respirar mucho más, la UI debe ocupar mejor el ancho en pantalla, tener más espacio negativo. Mira la página de Gemini para inspiración» | Compositor grande y centrado, contenedor que crece con la ventana, espacio entre secciones como tokens, envíos y desplegable sólo cuando hay un envío; UD-017 enmendada sin debilitar `test:fit`; capturas de 1280 a 2560 px | UD-110.., H-2100.. |
| `wt-configuracion` | «La descripción del proyecto tiene texto truncado que obliga a desplazarse dentro de la página. No hay forma segura de reemplazar un proveedor o retirar una clave de API; no es utilizable para agregar un proveedor, reemplazar una clave o diagnosticar. Los rótulos no tienen explicación: Publicación y Telemetría de uso no significan nada» | Editor de descripción grande sin scroll interno; gestión de proveedores con claves cifradas, prueba previa al reemplazo, retiro con bloqueo, diagnóstico clasificado y auditoría sin valores (migración 0009); explicación breve en cada ajuste (enmienda de la regla de texto de ayuda sólo para Configuración) | UD-120.., H-2200.. |
| `wt-voz` (barrido final) | Barrido de los textos nuevos de Inicio, Configuración, Áreas y telemetría con la guardia `ui-voice` | Hash de la rama con `main` fusionado y validada; no renombra abierto, respondido, cerrado, «Publicado» ni «Propuesta lista» | H-1500.. |

Orden de fusión: `wt-inicio-maqueta` es la última rama en vuelo; fusiona `main` en su rama y entra cuando dé su hash, porque toca `Home.tsx`, los catálogos de textos y las pruebas de flujos que todas las demás tocaron. Tras fusionar Inicio: barrido de `wt-voz` sobre los textos nuevos, una ronda de jueces acotados y la actualización del VPS.

## Qué se midió

Todas las cifras tienen su archivo en `docs/investigaciones/mediciones/` con el comando para repetirlas.

| Qué | Resultado | Archivo |
|---|---|---|
| Perfiles de miembros y descripción del proyecto | Con solo nombres el modelo deja sin destinatario el 69 % de los mensajes; con perfiles en prosa, 1,6 %. El conjunto de destinatarios coincide con el de algún lector en 51,0 % con perfiles y en 10,5 % con solo nombres. La descripción del proyecto empeora la asignación (19 % sin destinatario, 36,2 % de coincidencia). Las listas de responsabilidades no se distinguen de la prosa (53,1 % contra 51,0 %, p 0,64) | `2026-10-21-perfiles-y-proyecto-corregida.md` (reemplaza a `…-perfiles-y-proyecto.md`) |
| Prompts en dos idiomas y marcas de IA | 39 casos privados, 3 repeticiones, 117 corridas: ninguna `invalid` (antes 6 a 9 de 39 por corrida); asignación exacta de 26 % a 50,6 %; marcas de escritura de IA de 0,3 a 0,02 por mensaje en español y 0,05 en inglés | `2026-10-21-prompts-en-ingles-y-marcas-de-ia.md` |
| Exactitud de área (descripciones largas v2) | 86,4 % y 85,5 % en dos corridas del pipeline de clasificación contra 82,6 % con las descripciones cortas y 75,8 % con las largas de la primera versión. La ventaja sobre las cortas (3 a 4 puntos) cae dentro del ruido de 4 puntos entre corridas de la misma variante. Techo de acuerdo entre lectores: 95,5 % | `2026-10-21-descripciones-de-area-largas.md` |
| Semáforo por proveedor y tope | Tope de Anthropic 7 (sondeado tres veces), `QUEUE_CONCURRENCY` 8. Ráfaga de 16 envíos: 24,6 s sin fallos, contra 5 de 64 envíos fallidos por 429 sin tope a 8 trabajos | `2026-10-21-concurrencia-de-la-cola.md` |
| Medios probados en el VPS con proveedores reales | Foto de teléfono de 12 MP (salía como PNG de 13 MB y Anthropic la rechazaba; ahora JPEG de 553 KB), enlace, video de 4 minutos con voz y fotogramas (pico de 202 MiB, sin reinicios) y SSE durante 660 s a través de `tailscale serve` | filas H-130 a H-137 y H-57 de `docs/HALLAZGOS.md`; `2026-10-21-pdf-enlaces-heic-y-flujo-sse-reales.md` |
| Justificado de los párrafos | Se justifica desde 29,2 rem (438 px); debajo, a la izquierda | `2026-10-21-justificado-por-ancho.md` |

## La interfaz después de tres rondas de jueces

Dos jueces de pantalla. El A mira Inicio, Mensajes, Áreas, Configuración y la navegación. El B mira enviar, analizar, revisar y publicar. Cada ronda se hizo sobre la interfaz real, con capturas a 1440×900 y 390×844 en claro y oscuro. Los informes completos están en `~/.cache/claude-tmp/juicios/ronda{1,2,3}-{A,B}.md`, fuera del repositorio; si alguien limpia esa caché se pierden. Cada hallazgo, con su arreglo, su refutación medida o su decisión, está en `docs/HALLAZGOS.md`.

| Ronda | Hallazgos A / B | De gravedad 5 | De gravedad 4 | Notas por vista (A / B) |
|---|---|---|---|---|
| 1 | 57 / 30 | 2 | 8 | 2,0 a 3,0 / 1 a 3 |
| 2 | 48 / 27 | 4 | 12 | 1 a 3 / 2 a 2,5 |
| 3 | 51 / 31 | 3 | 10 | 2 a 3 / 2 a 3 |

La gravedad 5 fue 2, 4 y 3; la gravedad 4 fue 8, 12 y 10. El recuento no baja de ronda en ronda y ninguna nota pasó de 3. Qué cambió:

- Ronda 1: escala tipográfica con más de un tamaño y fila de mensaje en tres niveles. Plantillas como formulario, no como YAML ni markdown crudos. Estados vacíos, selección con barra, menús opacos.
- Ronda 2: la campana como único relleno saturado. Intro ya no publica (H-412). Acciones de fila siempre visibles. Plantilla eliminada con Deshacer en su lugar. Estados de carga con reintento. Bandeja de envíos con su progreso y un solo menú de cuenta.
- Ronda 3: justificado por ancho y avisos en peso callado. Fila de mensaje con una línea de metadatos y una lista por vez en el teléfono. Campana con «Ver todos», Cerrar sesión al pie y Conexiones sin submenú. «Crear mensaje» desde las partes sin mensaje.
- Cierre (esta sesión): una ventana más baja que una fila ya no dibuja la fila sobre el paginador (H-96).

## VPS (H-89)

- Dirección, sólo para la tailnet (`tailscale serve`, sin Funnel): `https://toolset-oci-1-1.tail2d4c18.ts.net:8444`. Usuario y contraseña del Editor en `~/.config/team-platform/vps-admin` (modo 600; nunca se imprimen ni se copian).
- Prueba de punta a punta del 2026-10-21 06:09, con `node scripts/vps-check.mjs`. `GET /` y `GET /health` responden 200 (`{"status":"ok","version":"0.1.0"}`). El panel servido tiene los mismos archivos compilados que este árbol (`/assets/index-DhGVCPpF.js` y `/assets/index-D_WgRPHG.css`): es la interfaz nueva. El inicio de sesión responde 200. Un texto mixto corto entra con 202. Produce una propuesta de 2 mensajes en 4,8 s. El envío de prueba se descarta.
- Costo de esa prueba: estimado, no medido, porque la API no lo devuelve por envío. La prueba equivalente anterior usó 4 llamadas y 12.547 tokens de entrada. A la tarifa de lista de `bench/pricing.js` son centésimas de dólar como mucho, bajo el tope de 0,05 USD.
- Repetir la prueba: `node scripts/vps-check.mjs` (con `--keep` deja el envío en la bandeja; con `--last` sólo describe el último envío). Necesita `panel/dist` compilado para comparar la interfaz (`cd panel && npx vite build`).
- Actualizar, como el usuario que tiene el repositorio clonado en el VPS: `cd ~/team-platform && git pull && docker compose build --build-arg BUILD_JOBS=1 && docker compose up -d --wait`. Con `BUILD_JOBS=1` el compilado de ffmpeg para ARM tarda lo que tarda un solo hilo.
- Bajarlo: `docker compose down` y `sudo tailscale serve --https=8444 off`.
- Estado visto desde otro usuario del mismo VPS: contenedor `team-platform-team-platform-1`, imagen `team-platform:local` creada el 2026-10-21 08:42 UTC, sano. El directorio del clon no es legible desde otros usuarios (`Permission denied`), de modo que actualizar exige el usuario dueño del clon.
- Cuando cambia `main`, el despliegue es el comando de actualizar; no hay despliegue automático.

## Presupuesto de API (UD-027 y UD-038)

- Tope: 25 USD (UD-027) más 50 USD que el dueño sumó el 2026-10-21 (UD-038, «subo el presupuesto 50 dólares»), 75 en total. Si el dueño quiso decir un tope total de 50, quedan unos 4 USD.
- Gastado según las cuentas de los agentes: unos 24 USD antes de UD-038, 9,1 en la comparación de modelos, 10,1 en exactitud de área, menos de 0,2 en el arreglo de capacidades y pruebas en vivo: unos 50 USD (con 6,0 de reuniones largas). Quedan unos 25 USD sobre los 75.
- Ningún encargo con gasto de API sigue corriendo. Cada encargo declara su gasto acumulado y se detiene en su parte. Libros de gasto: `bench/results/private-spend.jsonl` y los de cada worktree; los de worktrees retirados están en `~/.local/share/team-platform/archivo-de-worktrees/`.

## Ramas y worktrees

- Fusionados en `main` y todavía con worktree: `areas2`, `auto-publicar`, `estados-areas`, `galeria`, `heic`, `modelos`, `thinking`, `h901`, `h900`, `cierre`, `ingles` y `ronda3-b`. Se retiran con `git worktree remove .claude/worktrees/<nombre>` tras copiar a `~/.local/share/team-platform/archivo-de-worktrees/<nombre>` sus resultados de banco y capturas, que git ignora. `ingles` tiene un intérprete de comandos de una sesión anterior (`lsof +D .claude/worktrees/ingles`). Las ramas `wt-*` se borran con `git branch -d wt-<nombre>`.
- En vuelo: los cuatro de «Trabajo en vuelo».

## Lo que sigue, en orden

1. Fusionar las ramas en vuelo en el orden de «Trabajo en vuelo». Dueño: la sesión coordinadora.
2. El VPS corre `6c971d1` desde las 17:16 UTC del 2026-10-21: Inicio con color por área, tres estados, galería, HEIC, publicación automática y telemetría. Medido: la reconstrucción completa, con `ffmpeg` recompilado en ARM con `BUILD_JOBS=1` y prioridad baja, tardó 4 min 52 s. `node scripts/vps-check.mjs` imprime `OK` en todas las líneas. Las migraciones 0006, 0007 y 0008 corrieron solas.
3. Cuando entren `wt-barra-superior` y `wt-inicio-respira`: barrido de `wt-voz` sobre los textos nuevos y una ronda con jueces acotados en paralelo (`node scripts/juicios.mjs preparar --out DIR`; no lanzarla antes, porque el diseño de Inicio cambia) (marco de `wt-telemetria-ui`) sobre Inicio, Mensajes, Áreas y el flujo de envío. Línea base de la ronda 3: 3 hallazgos de gravedad 5 y 10 de gravedad 4.
4. Hallazgos abiertos con dueño: H-1903 (`classifyDraws` sin medir, 1,7 USD) y H-1904 (grosor de los grupos); H-1101 (llave de DeepSeek: `node scripts/llave.mjs DEEPSEEK_API_KEY`, la pone el dueño); H-1102 y H-1103 (Sonnet, sólo si se adopta); H-1804 cerrado; H-904 y H-1803 (Inicio).
5. Revisar «Decisiones del dueño» de `docs/HALLAZGOS.md`: colores de área frente a colores de estado, UD-034 (justificado por ancho), UD-035 («Crear mensaje»), UD-072 (borrador por envío, decisión de la sesión), el retiro de Intro en la revisión y el orden del catálogo de áreas. No bloquea nada.
6. H-56 (iPhone real): decisión del dueño UD-039, no se prueba todavía.

## Peticiones del dueño que cambian el diseño y no se pueden perder

- Dueño, textual: «Yo NO pedí esto, en la barra superior SOLO íconos de abierto, respondido y cerrado». La barra superior no lleva contadores por área. Una instrucción precisada se aplica a lo precisado, sin conservar el resto «por si acaso».
- Dueño, textual: «Los rótulos Abierto, Respondido o Cerrado no deben aparecer en la barra superior; bastan los íconos de color con un número, que al clic desplieguen un pequeño desplegable para ver rápidamente los elementos sin salir de la página donde se está».
- Dueño, textual: «quien dijo esto de que por atender es distinto a abierto, no lo entiendo, yo creo que fui súper explícito: mensajes abiertos, mensajes respondidos y mensajes cerrados o atendidos. Esos son los tres estados que quiero ver en esta interfaz».
- Dueño, textual: «si hago clic en Idea no espero que sea el lugar donde sólo puedo editar las plantillas; también quiero ver al tiro los mensajes asociados a esa área».
- Dueño, textual: «cada área debe poder tener su color y eso determina el chip de cada mensaje; si el área es verde, el recuadro de análisis de la IA tiene un verde secundario; el usuario sólo escoge un color; si cambio de área también cambian los colores».
- Dueño, textual: «la barra de Para mí y por área debería estar arriba de todo, con la barra de texto más abajo; el panel de la izquierda más compacto y ocultable».
- Dueño, textual: «el archivo adjunto no tiene la prioridad que puse en la maqueta; quiero ver al tiro la foto, la galería de fotos o la galería de medios con un carrusel abajo, reutilizado en todo el sitio».
- Dueño, textual: «lo del iPhone me da lo mismo, no lo vamos a usar todavía». Y sobre el HEIC asume que el código ya es compatible: hoy no lo era, por eso `wt-heic`.
- Dueño, textual: «rótulos y textos que parecen estar hablándole directamente al lector… reemplazar por lenguaje estándar de software, como un instrumento que se ocupa».
- Procesos: hasta 8 agentes simultáneos más 2 jueces de interfaz. El juez encarna a un usuario que se satura con jerarquía visual plana; hubo tres rondas. Cada hallazgo se atiende al 100 % y cada instrucción del dueño termina como UD con sus palabras.
- Dueño, textual: «el estado respondido debe aplicarse siempre automáticamente cuando exista una respuesta, independiente de si agrega información. Si un problema no tiene respuesta, es abierto; con una o más respuestas, respondido; si alguien lo marcó cerrado, cerrado». Hecho en UD-042 con una prohibición de la batería.
- Dueño, textual: «el programa ya funciona bastante bien para categorizar»; la herramienta debe perder cero contenido accionable (`wt-reuniones`, H-1600).
- Dueño: las capturas del servidor de ejemplo son simuladas y se marcan «Simulado»; el análisis real se comprueba con `node scripts/analizar.mjs "<texto>"` (usa `~/.config/team-platform/env`).
- Dueño, sobre procesos: tiempo de agentes acotado (un agente que lleva horas se cierra con lo medido), y el trabajo se paraleliza al máximo: hasta 8 agentes más 2 jueces.

## Cómo se trabaja en esta sesión

- Martín da instrucciones sueltas durante el turno. Cada una se convierte en una UD con sus palabras y entra a `docs/HALLAZGOS.md` si deja trabajo. Se asigna a un subagente (Sonnet, alto razonamiento) con su propio worktree bajo `.claude/worktrees/<nombre>`, ignorado por git. La sesión coordinadora fusiona a `main` con `git merge --no-edit <rama>`, corre `node scripts/check-conflict-markers.mjs`, `npm test` y `node --test bench/`, y empuja. El gancho de pre-commit impide fusionar con un conflicto sin resolver.
- Se paraleliza todo lo independiente. La ruta crítica manda sobre la suma.
- Ningún subagente cierra con números parciales ni con un plazo que invente la sesión. Trabaja hasta cumplir el objetivo medido o hasta que algo externo lo bloquee, y entonces dice qué.
- Llaves: `~/.config/team-platform/env` (modo 600; `node scripts/llave.mjs [NOMBRE]` pide, prueba y guarda). Nunca en el repositorio.

## Lo privado que existe sólo en este equipo

- `bench/private/` (ignorado por git): casos reales con sus referencias, el equipo de cuatro personas (`team.json`), la descripción del proyecto para la prueba y las referencias reetiquetadas. Nunca se copia, se commitea ni se nombra a su dueño en un archivo público. Hay respaldos de las referencias anteriores en subcarpetas con nombre `.referencia-*`; los guiones que reescriben referencias están apartados en `.scripts-que-reescriben/`.
- `bench/results/` (ignorado): resultados y gasto de cada corrida.
- `~/.config/team-platform/`: llaves y acceso al VPS.
- `~/.local/share/team-platform/archivo-de-worktrees/`: resultados de banco y capturas de los worktrees retirados.
