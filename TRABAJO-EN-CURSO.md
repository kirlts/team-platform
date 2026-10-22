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

- `main`: 8e73dd7 Áreas: «N plantillas» bajo el nombre y contadores centrados; pruebas al día con Inicio apilado y plantillas abiertas. Empujado a origin: `8e73dd7`.
- Ramas con commits sin fusionar: ninguna.
- Worktrees abiertos: `team-platform`.
- Últimos commits en `main`:
- `8e73dd7` Áreas: «N plantillas» bajo el nombre y contadores centrados; pruebas al día con Inicio apilado y plantillas abiertas (hace 16 segundos)
- `426764e` MASTER-SPEC al día con UD-253: sin confirmaciones, casillas, respuestas editables, avisos y listas de Inicio (hace 10 minutos)
- `fb8b49b` Traspaso: UD-253 completo en main (hace 15 minutos)
- `bfc4555` Merge wt-inicio-listas (hace 19 minutos)
- `f376d5c` HALLAZGOS: H-3718 done in wt-inicio-listas (hace 19 minutos)
- `84042d0` Merge wt-sin-confirmaciones (hace 21 minutos)
- `e46343b` Merge wt-borrado-multiple (hace 22 minutos)
- `fee305c` Pruebas: openTemplates no pulsa una sección de plantillas ya abierta (hace 23 minutos)
Actualizado 2026-10-22 02:56 UTC.
<!-- vivo:fin -->

## Trabajo en vuelo

UD-253 completo en `main` `bfc4555` (23:45): respuestas editables, borrado de varios, sin confirmaciones, avisos efímeros centrados, listas de Inicio parejas; eje documental al día. VPS subiendo en cadena. Batería de navegador corriendo sobre main.

Tu VPS corre `4543d45` desde las 22:51 (`vps-check` OK): papeleras, adjuntos en la ficha, restaurar tras recargar y el arreglo del fotograma vacío (H-3713). Corrección de las 22:40 por reclamo del dueño («no veo un botón para borrar mensajes», «tampoco veo cómo borrar areas», «los elementos no tienen la misma altura»): ícono de borrar en cada tarjeta de mensaje, en cada fila de Áreas y en la vista de un área; título de tarjeta en una línea (UD-241 enmendada); dev-server con borrado de áreas. Auditoría de paridad terminada (`~/.cache/claude-tmp/auditoria-paridad.md`) y sus cuatro arreglos en `main` `8f15e1d` (23:02): restaurar tras recargar, adjuntos en la ficha, cola y auditoría, contraseña ajena, sembrar y plantillas a la vista (H-3706 a H-3712). VPS corre ese hash desde las 23:03 (`vps-check` OK). Sin hacer: editar respuestas y borrado en lote (esperan al dueño).

Encargo UD-240 (borrar y vaciar), lanzado el 2026-10-21 21:17, cuatro agentes a la vez:

| Rama | Qué | Migración |
|---|---|---|
| (fusionadas 21:30 a 21:40) | borrar mensajes y respuestas, borrar envíos, eliminar miembros, vaciar y sembrar: en `main` `9c15614` | 0010, 0011 |
| (fusionada 21:42) | tarjetas de altura uniforme y primer vistazo (UD-241, H-3705): en `main` `8e06914` | ninguna |

Todo fusionado; VPS en `300c83b` desde las 22:05 (`vps-check` OK). Batería sobre `main` 300c83b: servidor 894 de 902 (fallas sensibles a carga pasan solas), panel 188 de 188, ajuste 26 de 26, flujos 240 de 241 (1 omitida), contraste OK.

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
- **Actualización 2026-10-21 (UD-140):** el dueño subió el tope total a 100 USD, «de los 200 dólares que me da Anthropic por este plan, van a quedar 100» para el otro proyecto. Quedan unos 50 USD por gastar. No pasar de 100 de gasto acumulado sin confirmar la lectura (UD-140, condiciones de reversión).
- Ningún encargo con gasto de API sigue corriendo. Cada encargo declara su gasto acumulado y se detiene en su parte. Libros de gasto: `bench/results/private-spend.jsonl` y los de cada worktree; los de worktrees retirados están en `~/.local/share/team-platform/archivo-de-worktrees/`.

## Ramas y worktrees

- Fusionados en `main` y todavía con worktree: `areas2`, `auto-publicar`, `estados-areas`, `galeria`, `heic`, `modelos`, `thinking`, `h901`, `h900`, `cierre`, `ingles` y `ronda3-b`. Se retiran con `git worktree remove .claude/worktrees/<nombre>` tras copiar a `~/.local/share/team-platform/archivo-de-worktrees/<nombre>` sus resultados de banco y capturas, que git ignora. `ingles` tiene un intérprete de comandos de una sesión anterior (`lsof +D .claude/worktrees/ingles`). Las ramas `wt-*` se borran con `git branch -d wt-<nombre>`.
- En vuelo: los cuatro de «Trabajo en vuelo».

## Lo que sigue

Todo lo que queda necesita al dueño, una llave o dinero. Cada fila está en `docs/HALLAZGOS.md` con su comando: `grep -nE '\| (decisión|bloqueado|encargo)' docs/HALLAZGOS.md`.

1. H-1101: `cd ~/team-platform && node scripts/llave.mjs DEEPSEEK_API_KEY`, luego medir DeepSeek.
2. H-1102 y H-1103: sólo si se adopta Sonnet 5.5 (unos 5 USD). «Haiku se queda» las cierra.
3. H-2605: el botón «Cerrar sesión» ya se oculta con identidad delegada que no lo soporta (UD-190); queda declarado el límite de `trusted-header`.
4. H-3008: la nota de la pantalla de entrada no dice a quién pedir una cuenta; agregar un ajuste de contacto es decisión del dueño (UD-170).
5. H-139: crear el área «Novedad» (decisión del dueño).
6. H-56: iPhone real, UD-039 lo difiere.
7. HP-019 y HP-020 (DT-007): repetir los siete casos con `node bench/run.mjs --repeat 5` (presupuesto de API) y mirar las capturas de cada pantalla.
8. Presupuesto de API: tope total 100 USD (UD-140); gastados unos 55.

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
