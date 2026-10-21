# Trabajo en curso: team-platform

> Documento de traspaso. Quien retome (otra sesión, otro modelo, otra cuenta) lo lee antes de actuar y lo mantiene al día en cada cambio de estado: una rama fusionada, un agente lanzado o terminado, una decisión de Martín, una medición. Sin llaves ni datos privados. Última actualización: 2026-10-21 01:50.

## Estado de `main`

- Último commit: `99a7c0c` (UD-027 y H-89). `npm test` en verde (568 pruebas del servidor), `node --test bench/` (64), panel (55). Publicado en https://github.com/kirlts/team-platform.
- Todo lo especificado está en `docs/MASTER-SPEC.md`; las decisiones, con las palabras de Martín, en `docs/USER-DECISIONS.md` (UD-001 a UD-027); las pruebas y sus prohibiciones en `docs/TEST.md`; **todo hallazgo abierto en `docs/HALLAZGOS.md`** (regla de Martín: el 100 % de los hallazgos queda atendido, ninguno huérfano ni a medio hacer). Las investigaciones con fuentes fechadas están en `docs/investigaciones/`.
- Reglas del repositorio: `docs/RULES.md`. Dos que se rompen fácil: la documentación pública no nombra otros proyectos del autor (lenguaje neutro), y el código y sus comentarios van en inglés (UD-015) mientras que la interfaz y la documentación van en español.

## Cómo se trabaja en esta sesión

- Martín da instrucciones sueltas durante el turno; cada una se convierte en una UD con sus palabras, entra a `docs/HALLAZGOS.md` si deja trabajo, y se asigna a un subagente (Sonnet, alto razonamiento) con su propio worktree bajo `.claude/worktrees/<nombre>` (ignorado por git). La sesión coordinadora fusiona a `main` con `git merge --no-edit <rama>`, corre `node scripts/check-conflict-markers.mjs`, `npm test`, y empuja. Nunca se fusiona con un conflicto sin resolver (el gancho de pre-commit lo impide).
- Se paraleliza todo lo independiente. La ruta crítica manda sobre la suma.
- Ningún subagente cierra con números parciales ni con un plazo que invente la sesión: trabaja hasta cumplir el objetivo medido o hasta que algo externo lo bloquee, y entonces dice qué.
- Martín pide, cada cierto tiempo, **la tabla de progreso**: una fila por arreglo en curso y por lo ya entregado, con «Cómo se ve» en lenguaje de producto y una hora estimada medida, no supuesta.
- Presupuesto de API de Anthropic: 25 USD en total (UD-027). Cada encargo declara su parte; los guiones de gasto dejan el rastro en `bench/results/` (ignorado por git).
- Llaves: `~/.config/team-platform/env` (modo 600; `node scripts/llave.mjs [NOMBRE]` pide, prueba y guarda). Nunca en el repositorio.

## En curso

| Qué | Dónde | Estado al cierre de este documento | Cómo se retoma |
|---|---|---|---|
| Prompts del analizador en dos idiomas, contrato de redacción sin marcas de IA, reuniones largas, asignación por perfil (H-80, H-84 a H-86 y lo de UD-021, UD-025, UD-026) | worktree `ingles`, rama `wt-ingles`, 18 commits sobre `main`, último `2f0a6a5` | Midiendo ventanas de clasificación y los tres idiomas; 7 USD de presupuesto propio | Leer `git log main..wt-ingles`, `docs/investigaciones/mediciones/` de la rama y los objetivos en `docs/HALLAZGOS.md`; fusionar `main` antes de seguir (hay bloques de perfil y proyecto que tienen que quedar en los dos juegos de prompts) |
| Semáforo único de llamadas en vuelo por proveedor (H-83) | worktree `semaforo`, rama `wt-semaforo` | Recién lanzado, sin commits | Ver la descripción de H-83; medir el tope de simultáneas de Anthropic subiendo de a 4; fijar `QUEUE_CONCURRENCY` con medición; 2 USD |
| Variante «listas» contra «perfiles» y juez de utilidad con otro modelo (H-87, H-88) | worktree `banco-contexto-2`, rama `wt-banco-contexto-2` | Recién lanzado; 3 USD | `bench/run-private.mjs --team … --variant …`, `bench/judge-usefulness.mjs --judge-model` |
| Despliegue en el VPS del autor, por Tailscale, sólo tailnet (H-89) | VPS del autor; detalle de acceso en `~/.config/team-platform/vps-admin` (URL, usuario, contraseña) y repositorio clonado en `~/team-platform` del VPS | Imagen para ARM compilándose con un solo hilo (`BUILD_JOBS=1`), registro en `~/team-platform-build.log` del VPS | Ver «Despliegue en el VPS» abajo |

Fusionado y sin trabajo pendiente: núcleo (API, cola, identidad), extractores, proveedores, analizador base, telemetría OpenTelemetry, panel (UD-016 a UD-026), cola para envíos seguidos con concurrencia 3 medida (UD-025), banco con perfiles y proyecto (H-77), batería de 20 prohibiciones, imagen de 306 MB con ffmpeg LGPL propio y `NOTICE` (UD-020), documentación sincronizada.

## Despliegue en el VPS

1. Estado (2026-10-21 01:50): imagen compilada para ARM, contenedor sano, `curl http://127.0.0.1:3200/health` responde `ok`. Publicado sólo para la tailnet en `https://toolset-oci-1-1.tail2d4c18.ts.net:8444` (`tailscale serve`, sin Funnel). Acceso en `~/.config/team-platform/vps-admin`.
2. Prueba de punta a punta hecha con texto mixto: login, input, propuesta de 3 mensajes en 4 s, 4 llamadas, 12.547 tokens de entrada. Falta probar audio y video con los proveedores reales, y publicar y responder desde el panel.
3. Actualizar: `git pull && docker compose build --build-arg BUILD_JOBS=1 && docker compose up -d --wait`.
4. Bajarlo: `docker compose down` y `sudo tailscale serve --https=8444 off`.
5. Si el compilado de ffmpeg falla en ARM, la rama de ensamblador (`nasm`) del `Dockerfile` está escrita pero no se había ejecutado nunca: arreglarla ahí y volver a empujar. Actualizar el VPS: `git pull && docker compose build --build-arg BUILD_JOBS=1 && docker compose up -d`.
6. Bajarlo: `docker compose down` y `sudo tailscale serve --https=8444 off`.

## Lo que sigue, en orden

1. Esperar las tres ramas en curso, fusionarlas una por una (`git merge --no-edit`, `node scripts/check-conflict-markers.mjs`, `npm test`, `node --test bench/`) y empujar.
2. Repetir el banco privado completo con los prompts nuevos y el equipo de cuatro personas; comparar contra `docs/investigaciones/mediciones/2026-10-21-perfiles-y-proyecto.md`.
3. Comparar Haiku 5.5 con Sonnet 5.5 y DeepSeek con los mismos prompts (H-80), sobre los 7 casos públicos y 12 privados.
4. Cerrar en el VPS la prueba de punta a punta y repetir a los jueces de pantalla sin darles contexto de lo que se cambió.
5. Lo que no se puede ejecutar desde esta máquina: micrófono en Safari e iPhone (H-56), foto HEIC real de iPhone (H-21), SSE detrás de un proxy con búfer (H-57). Dejar a Martín el comando o el paso de una línea.

## Lo privado que existe sólo en este equipo

- `bench/private/` (ignorado por git): casos reales con sus referencias, el equipo de cuatro personas (`team.json`), la descripción del proyecto para la prueba y las referencias reetiquetadas. Nunca se copia, se commitea ni se nombra a su dueño en un archivo público. Hay respaldos de las referencias anteriores en subcarpetas con nombre `.referencia-*`; los guiones que reescriben referencias están apartados en `.scripts-que-reescriben/`.
- `bench/results/` (ignorado): resultados y gasto de cada corrida.
- `~/.config/team-platform/`: llaves y acceso al VPS.
