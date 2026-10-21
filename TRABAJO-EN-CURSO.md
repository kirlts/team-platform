# Trabajo en curso

> Documento de traspaso. Quien retome (otra sesión, otro modelo, otra cuenta) lo lee antes de actuar y lo mantiene al día en cada cambio de estado. Sin llaves ni datos privados. Última actualización: 2026-10-21 hacia las 08:00 (hora de Chile). Si la cuota de una cuenta se agota, otra sesión retoma desde la sección «Trabajo en vuelo» sin contexto previo.

## Estado de `main`

- `main` está en `23b5a3b`, empujado a origin y desplegado en el VPS hasta `fafe5ab` (la interfaz de tres rondas de jueces). Todo lo anterior a esta fecha está fusionado: `wt-cierre`, `wt-h900` y las 17 ramas de la noche (`git rev-list --count main..<rama>` da 0).
- Pruebas ejecutadas sobre `main` el 2026-10-21: `npm test` 664 pasan y 5 se omiten. `node --test bench/` 70 de 70. Panel `npx vitest run` 81 de 81. `npm run test:fit` y `npm run test:flows` en verde con puertos propios (`PANEL_FIT_PORT`, `PANEL_FLOWS_PORT`, `PANEL_FLOWS_2A_PORT`). H-900 (prueba intermitente de AreaChips) está cerrado de raíz; H-901 (otras pruebas sensibles a la carga) está en vuelo.
- Lo especificado está en `docs/MASTER-SPEC.md`. Las decisiones, con las palabras de Martín, en `docs/USER-DECISIONS.md` (hasta UD-039; las ramas en vuelo reservan UD-040 en adelante). Las pruebas, en `docs/TEST.md`. Los hallazgos, en `docs/HALLAZGOS.md`: el 100 % queda atendido, ninguno huérfano ni a medio hacer. Investigaciones con fuentes fechadas, en `docs/investigaciones/`.
- La maqueta inicial del dueño es `Plataforma Team.png` en la raíz y manda sobre cualquier decisión posterior de una sesión. Inicio lleva «Para mí» y por área arriba, y «Nuevo mensaje» con la barra de texto. Debajo va un desplegable en línea con el original a la izquierda y el análisis de la IA a la derecha. Abajo van «Últimos mensajes» y «Últimas respuestas», con pestaña de área. El panel izquierdo se oculta con un botón junto al usuario.
- Reglas del repositorio: `docs/RULES.md`. Dos se rompen fácil. La documentación pública no nombra otros proyectos del autor. El código, sus comentarios y los nombres de pruebas van en inglés (UD-015, detector HP-008); la interfaz y la documentación, en español.

## Trabajo en vuelo

Ocho encargos corren en paralelo, cada uno en su worktree bajo `.claude/worktrees/<nombre>` y su rama `wt-<nombre>`, desde `main` `23b5a3b`. Los agentes no sobreviven a la sesión: la memoria de cada encargo es su rama (commits desde el primer minuto) y la fila de aquí. Para retomar uno: `git -C .claude/worktrees/<nombre> log --oneline main..HEAD`, leer sus filas nuevas en `docs/HALLAZGOS.md` y su UD, y continuar en ese worktree con el objetivo y los criterios de la fila. Ninguno empuja a `main`: lo fusiona la sesión coordinadora (`git merge --no-edit wt-<nombre>`, luego `node scripts/check-conflict-markers.mjs`, `npm test`, `node --test bench/`, `cd panel && npm test`, `npm run test:fit` y `npm run test:flows` con puertos propios), y renumera UD y H si dos ramas chocan.

| Rama | Pedido del dueño (textual o resumido) | Criterio de cierre | Rangos reservados |
|---|---|---|---|
| `wt-inicio-maqueta` | «Cuando envío, la única retroalimentación es una barra de carga; tengo que hacer clic y bajar a la bandeja para ver cómo quedó. En la maqueta puse un desplegable dinámico debajo de la barra de texto» | Inicio como la maqueta: franja «Para mí» y por área arriba; desplegable en línea que se abre al enviar con original editable a la izquierda y análisis de la IA a la derecha; sin diálogo «Envíos» ni «N para revisar»; color por área (campo `color`, secundario derivado, chip de área, fondo del análisis, cambia al cambiar el área); panel izquierdo compacto y ocultable. Enmienda UD-030 | UD-045.., H-1400.. |
| `wt-estados-areas` | «Mensajes abiertos, respondidos y cerrados: esos son los tres estados que quiero ver» y «si hago clic en Idea quiero ver al tiro los mensajes de esa área» | Palabras de estado únicas (abierto rojo, respondido amarillo, cerrado azul, nunca solo color); contadores «N abiertos»; prueba que prohíbe «Por atender», «Pendiente», «Novedad»; ruta `/areas/:id` con mensajes primero y descripción y plantillas plegadas. Enmienda UD-029 | UD-041.., H-1300.. |
| `wt-galeria` | «Ver al tiro la foto, la galería o la galería de medios con un carrusel abajo, y reutilizarlo en todo el sitio» | Componente `MediaGallery` ya listo (API: `items`, `variant` inline/compact/dialog, `MediaGalleryDialog`); falta UD, endpoint de transcripción del servidor real, capturas y `test:fit`; entra a `main` antes que `wt-inicio-maqueta`, que lo usa en el desplegable | UD-040.., H-1200.. |
| `wt-voz` | «Rótulos que parecen hablarle al lector, como una conversación: investiga qué se dice en 2026 y púrgalo; lenguaje estándar de software como un instrumento» (ejemplo: «Nota de voz con su transcripción») | `docs/investigaciones/08-lenguaje-de-instrumento-en-interfaces.md` con fuentes fechadas, purga de catálogos es-419 y en, literales, `aria-label`, errores y avisos, y prueba `panel/src/ui-voice.test.ts` que falla ante el patrón. Después de fusionar las otras ramas hay un barrido final de los textos nuevos | UD-050.., H-1500.. |
| `wt-h901` | «Las condiciones de carrera están prohibidas y se atacan de raíz» | 10 corridas completas seguidas de `test:flows` en verde con carga alta y 10 con carga moderada; el servidor de ejemplo avanza análisis por orden de la prueba, no por reloj | H-901 |
| `wt-heic` | El dueño asume que el sistema ya acepta fotos de iPhone; hoy un HEIC se rechaza (`image_heic_unsupported`) | Decodificar HEIC/HEIF con licencia compatible (UD-020), tamaño de imagen declarado, tope de píxeles, fixtures reales | H-21 |
| `wt-areas2` | «Es difícil confiar en la herramienta si no clasifica bien por área» | H-602 con el pipeline completo con proyecto, 3 repeticiones, ≥ 82,6 % de exactitud de área; variantes sólo si ganan con significación; tope 12 USD | H-1000.. |
| `wt-modelos` | Comparar Haiku, Sonnet y DeepSeek (H-80) y esfuerzo medium (H-15) | Tabla por modelo con cobertura, área, asignación, marcas de IA, utilidad, tiempo y costo; recomendación; tope 10 USD | H-1100.. |

Orden de fusión recomendado: `wt-galeria`, `wt-estados-areas`, `wt-inicio-maqueta`, `wt-h901`, `wt-heic`, `wt-areas2`, `wt-modelos` y al final `wt-voz` con su barrido (usa los textos de todas las demás). Un conflicto esperado: `panel/src/pages/Home.tsx`, `panel/src/i18n/*`, `docs/HALLAZGOS.md`, `docs/USER-DECISIONS.md`.

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

- Tope: 25 USD (UD-027) más 50 USD que el dueño sumó el 2026-10-21 (UD-038, «subo el presupuesto 50 dólares»), 75 en total. Si el dueño quiso decir un tope total de 50, quedan unos 26 USD sobre lo gastado.
- Gastado al 2026-10-21 antes de este tramo: cerca de 24 USD según la cuenta de la sesión, unos 19 USD en mediciones documentadas.
- Partes asignadas: `wt-areas2` 12 USD, `wt-modelos` 10 USD. Cada encargo declara su gasto acumulado y se detiene en su parte. El libro de gasto es `bench/results/private-spend.jsonl` y el de cada worktree; los de los worktrees retirados están en `~/.local/share/team-platform/archivo-de-worktrees/`.

## Ramas y worktrees

- Fusionados y retirados con `git worktree remove` (sus resultados de banco y capturas, que git ignora, se copiaron a `~/.local/share/team-platform/archivo-de-worktrees/`): `areas`, `audio-unidades`, `banco-contexto`, `banco-contexto-2`, `hallazgos`, `inicio`, `panel-2`, `rafaga`, `ronda1-a`, `ronda1-b`, `ronda2-a`, `ronda2-b`, `ronda3-a`, `semaforo`, `vps-media`. Las ramas `wt-*` siguen existiendo; se borran con `git branch -d wt-<nombre>`.
- Fusionados y con worktree por una causa concreta: `ingles` y `ronda3-b`. En `ingles` hay un intérprete de comandos de una sesión anterior (`lsof +D .claude/worktrees/ingles`). En `ronda3-b` un servidor de desarrollo tiene el directorio como cwd. `cierre`, `h900` y `h901-base` no tienen trabajo propio.
- En vuelo: los ocho de «Trabajo en vuelo».

## Lo que sigue, en orden

1. Fusionar las ramas en vuelo en el orden de «Trabajo en vuelo», con renumeración de UD y H si chocan, y empujar. Dueño: la sesión coordinadora.
2. Actualizar el VPS después de cada fusión grande: `ssh opc@toolset-oci-1-1 'cd ~/team-platform && git pull && docker compose build --build-arg BUILD_JOBS=1 && docker compose up -d --wait'` y luego `node scripts/vps-check.mjs` (debe imprimir `OK` en las siete líneas). Acceso en `~/.config/team-platform/vps-admin`.
3. Barrido final de `wt-voz` sobre los textos nuevos de las demás ramas. Después, una ronda 4 de jueces con las mismas dos lentes y sin decirles qué cambió. Línea base de la ronda 3: 3 hallazgos de gravedad 5 y 10 de gravedad 4.
4. Cerrar H-602, H-80 y H-15 con las mediciones de `wt-areas2` y `wt-modelos`. Si H-602 da menos de 82,6 %, volver a las descripciones cortas o adoptar la variante ganadora de `wt-areas2`. El commit `5a66b37` tiene las cortas y la etiqueta `areas-largas-v1` marca las largas originales.
5. Revisar «Decisiones del dueño» de `docs/HALLAZGOS.md`. UD-029 y UD-036 quedan reemplazadas por los tres estados abierto, respondido y cerrado. Siguen UD-034 (justificado por ancho), UD-035 («Crear mensaje») y el retiro de Intro en la revisión. No bloquea nada.
6. H-56 (iPhone real): decisión del dueño UD-039, no se prueba todavía.

## Peticiones del dueño que cambian el diseño y no se pueden perder

- Dueño, textual: «quien dijo esto de que por atender es distinto a abierto, no lo entiendo, yo creo que fui súper explícito: mensajes abiertos, mensajes respondidos y mensajes cerrados o atendidos. Esos son los tres estados que quiero ver en esta interfaz».
- Dueño, textual: «si hago clic en Idea no espero que sea el lugar donde sólo puedo editar las plantillas; también quiero ver al tiro los mensajes asociados a esa área».
- Dueño, textual: «cada área debe poder tener su color y eso determina el chip de cada mensaje; si el área es verde, el recuadro de análisis de la IA tiene un verde secundario; el usuario sólo escoge un color; si cambio de área también cambian los colores».
- Dueño, textual: «la barra de Para mí y por área debería estar arriba de todo, con la barra de texto más abajo; el panel de la izquierda más compacto y ocultable».
- Dueño, textual: «el archivo adjunto no tiene la prioridad que puse en la maqueta; quiero ver al tiro la foto, la galería de fotos o la galería de medios con un carrusel abajo, reutilizado en todo el sitio».
- Dueño, textual: «lo del iPhone me da lo mismo, no lo vamos a usar todavía». Y sobre el HEIC asume que el código ya es compatible: hoy no lo era, por eso `wt-heic`.
- Dueño, textual: «rótulos y textos que parecen estar hablándole directamente al lector… reemplazar por lenguaje estándar de software, como un instrumento que se ocupa».
- Procesos: hasta 8 agentes simultáneos más 2 jueces de interfaz. El juez encarna a un usuario que se satura con jerarquía visual plana; hubo tres rondas. Cada hallazgo se atiende al 100 % y cada instrucción del dueño termina como UD con sus palabras.

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
