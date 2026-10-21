# Trabajo en curso

> Documento de traspaso. Quien retome (otra sesión, otro modelo, otra cuenta) lo lee antes de actuar y lo mantiene al día en cada cambio de estado. Sin llaves ni datos privados. Última actualización: 2026-10-21 06:30 (hora de Chile).

## Estado de `main`

- `main` está en `59cb1d2`; la rama `wt-cierre` (sobre `59cb1d2`) trae el cierre de esta sesión y espera la fusión del dueño. Las 17 ramas `wt-*` anteriores están fusionadas en `main` (`git rev-list --count main..<rama>` da 0 en todas).
- Pruebas ejecutadas el 2026-10-21 sobre `wt-cierre`: `npm test` 669 pruebas, 664 pasan y 5 se omiten (las que necesitan proveedor real o Docker); `node --test bench/` 70 de 70; panel `npx vitest run` 77 de 77; navegador, en `panel/`, `npm run test:fit` 10 de 10 y `npm run test:flows` 118 de 118 (H-900 cuenta las corridas anteriores que fallaron); `node scripts/check-conflict-markers.mjs` limpio.
- Lo especificado está en `docs/MASTER-SPEC.md`. Las decisiones, con las palabras de Martín, en `docs/USER-DECISIONS.md` (UD-001 a UD-037). Las pruebas y sus prohibiciones, en `docs/TEST.md`. Los hallazgos, todos, en `docs/HALLAZGOS.md`: regla de Martín, el 100 % queda atendido, ninguno huérfano ni a medio hacer. Las investigaciones y mediciones con fuentes fechadas, en `docs/investigaciones/`.
- Reglas del repositorio: `docs/RULES.md`. Dos se rompen fácil. La documentación pública no nombra otros proyectos del autor. El código y sus comentarios van en inglés (UD-015); la interfaz y la documentación, en español.
- En el libro de hallazgos quedan abiertas cuatro filas. H-56 (iPhone real), H-80 (comparación de modelos) y H-602 (corrida completa) dicen qué las bloquea y traen su comando en la sección «Filas bloqueadas por causa externa». H-900 es una prueba de navegador que falló de forma intermitente y no se reprodujo sola. La sección «Decisiones del dueño» lista lo que las sesiones decidieron por él, con la cifra y cómo se revierte cada una.

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
- Prueba de punta a punta del 2026-10-21 06:09, con `node scripts/vps-check.mjs`. `GET /` y `GET /health` responden 200 (`{"status":"ok","version":"0.1.0"}`). El panel servido tiene los mismos archivos compilados que este árbol (`/assets/index-DhGVCPpF.js` y `/assets/index-D_WgRPHG.css`): es la interfaz nueva. El inicio de sesión responde 200. Un texto mixto corto (un reporte de contraste y un pedido de filtro) entra con 202 y produce una propuesta de 2 mensajes en 4,8 s. El envío de prueba se descarta.
- Costo de esa prueba: estimado, no medido, porque la API no lo devuelve por envío. La prueba equivalente anterior usó 4 llamadas y 12.547 tokens de entrada. A la tarifa de lista de `bench/pricing.js` son centésimas de dólar como mucho, bajo el tope de 0,05 USD.
- Repetir la prueba: `node scripts/vps-check.mjs` (con `--keep` deja el envío en la bandeja; con `--last` sólo describe el último envío). Necesita `panel/dist` compilado para comparar la interfaz (`cd panel && npx vite build`).
- Actualizar, como el usuario que tiene el repositorio clonado en el VPS: `cd ~/team-platform && git pull && docker compose build --build-arg BUILD_JOBS=1 && docker compose up -d --wait`. Con `BUILD_JOBS=1` el compilado de ffmpeg para ARM tarda lo que tarda un solo hilo.
- Bajarlo: `docker compose down` y `sudo tailscale serve --https=8444 off`.
- Estado visto desde otro usuario del mismo VPS: contenedor `team-platform-team-platform-1`, imagen `team-platform:local` creada el 2026-10-21 08:42 UTC, sano. El directorio del clon no es legible desde otros usuarios (`Permission denied`), de modo que actualizar exige el usuario dueño del clon.
- Cuando cambia `main`, el despliegue es el comando de actualizar; no hay despliegue automático.

## Presupuesto de API (UD-027)

- Tope: 25 USD. Gastado: cerca de 24 USD según la cuenta de la sesión.
- Lo que se suma con archivo en mano: perfiles 2,79 y 4,96 USD, prompts y marcas de IA unos 8,5, áreas 1,34, concurrencia 1,25. Son unos 19 USD en mediciones documentadas. El resto son pruebas en el VPS, corridas del semáforo y corridas intermedias.
- El libro de gasto local (`bench/results/private-spend.jsonl`) suma sólo 10,7 USD entre `main` y los worktrees, porque no todas las corridas escribieron en él. Los libros de los worktrees retirados están en `~/.local/share/team-platform/archivo-de-worktrees/`.
- Quedan cerca de 1 USD. Con ese margen no cabe nada de H-80 ni de H-602: están bloqueados hasta que el dueño suba el tope.

## Ramas y worktrees

- Retirados con `git worktree remove` (todas fusionadas en `main`, sin cambios sin confirmar): `areas`, `audio-unidades`, `banco-contexto`, `banco-contexto-2`, `hallazgos`, `inicio`, `panel-2`, `rafaga`, `ronda1-a`, `ronda1-b`, `ronda2-a`, `ronda2-b`, `ronda3-a`, `semaforo`, `vps-media`. Antes se copiaron sus resultados de banco y capturas, que git ignora, a `~/.local/share/team-platform/archivo-de-worktrees/`. Las ramas `wt-*` siguen existiendo; se borran con `git branch -d wt-<nombre>` (git se niega si no están fusionadas).
- Quedan dos worktrees por una causa concreta cada uno, ambos fusionados y sin cambios:
  - `.claude/worktrees/ingles` (`wt-ingles`): hay un intérprete de comandos de una sesión anterior con ese directorio abierto y la carpeta `bench/private` de ese árbol. Retirar con `git worktree remove --force .claude/worktrees/ingles` cuando se compruebe que esa sesión terminó (`lsof +D .claude/worktrees/ingles`).
  - `.claude/worktrees/ronda3-b` (`wt-ronda3-b`): un servidor de desarrollo de la ronda 3 (`node dev-server.mjs`, puerto 8881) tiene ese directorio como cwd. Retirar con `git worktree remove .claude/worktrees/ronda3-b` después de que ese servidor termine.
- `wt-cierre` (este árbol): `git worktree remove .claude/worktrees/cierre` después de fusionarla.

## Lo que sigue, en orden

1. Fusionar el cierre (dueño: Martín). Desde la raíz del repositorio: `git merge --no-edit wt-cierre && node scripts/check-conflict-markers.mjs && npm test && node --test bench/ && git push`.
2. Actualizar el VPS con la interfaz de `wt-cierre`: el comando de «Actualizar» de arriba, y después `node scripts/vps-check.mjs` (debe imprimir `OK` en las siete líneas).
3. H-56, micrófono en iPhone (dueño: Martín, necesita el aparato): los dos comandos de la sección «H-56» de `docs/HALLAZGOS.md`.
4. Subir el tope de API (dueño: Martín) y correr H-602 y H-80 con los comandos de esa sección. H-602 va primero: costó 0,27 USD sin proyecto y con el proyecto no está medido, por eso su comando lleva `--budget 3` y corta solo al 90 %. H-80 va después y cuesta cerca de 3 USD. El resultado de H-602 decide si se mantienen las descripciones de área v2 (criterio: 82,6 % o más).
5. H-900 (dueño: la sesión coordinadora): correr `cd panel && npm run test:flows` solo, sin otra prueba de navegador a la vez; si falla sola, endurecer `startPanel` como dice la fila.
6. Revisar «Decisiones del dueño» de `docs/HALLAZGOS.md` (dueño: Martín). No bloquea nada: si no hay respuesta, todo queda como está.
7. Una ronda 4 de jueces de pantalla (dueño: la sesión coordinadora). Mismo encargo, sin decirles qué cambió. Mide si bajan las gravedades 5 y 4 de la ronda 3, que es la línea base.

## Cómo se trabaja en esta sesión

- Martín da instrucciones sueltas durante el turno; cada una se convierte en una UD con sus palabras, entra a `docs/HALLAZGOS.md` si deja trabajo, y se asigna a un subagente (Sonnet, alto razonamiento) con su propio worktree bajo `.claude/worktrees/<nombre>` (ignorado por git). La sesión coordinadora fusiona a `main` con `git merge --no-edit <rama>`, corre `node scripts/check-conflict-markers.mjs`, `npm test` y `node --test bench/`, y empuja. Nunca se fusiona con un conflicto sin resolver (el gancho de pre-commit lo impide).
- Se paraleliza todo lo independiente. La ruta crítica manda sobre la suma.
- Ningún subagente cierra con números parciales ni con un plazo que invente la sesión: trabaja hasta cumplir el objetivo medido o hasta que algo externo lo bloquee, y entonces dice qué.
- Llaves: `~/.config/team-platform/env` (modo 600; `node scripts/llave.mjs [NOMBRE]` pide, prueba y guarda). Nunca en el repositorio.

## Lo privado que existe sólo en este equipo

- `bench/private/` (ignorado por git): casos reales con sus referencias, el equipo de cuatro personas (`team.json`), la descripción del proyecto para la prueba y las referencias reetiquetadas. Nunca se copia, se commitea ni se nombra a su dueño en un archivo público. Hay respaldos de las referencias anteriores en subcarpetas con nombre `.referencia-*`; los guiones que reescriben referencias están apartados en `.scripts-que-reescriben/`.
- `bench/results/` (ignorado): resultados y gasto de cada corrida.
- `~/.config/team-platform/`: llaves y acceso al VPS.
- `~/.local/share/team-platform/archivo-de-worktrees/`: resultados de banco y capturas de los worktrees retirados.
