# Drivers del trabajo `execute`

Team Platform no conoce ninguna nube. El trabajo `execute` corre la sesión desatendida de Claude Code por un contrato de órdenes de shell que declara el anfitrión en `.env`. Un driver es el conjunto de guiones que cumple ese contrato para una infraestructura. Este directorio tiene el driver de referencia y la explicación para escribir otro.

| Directorio | Infraestructura | Estado |
|---|---|---|
| `docker-local/` | Docker en la misma máquina del trabajador | Probado en `src/execute/drivers-docker-local.test.js` |

El contrato vive en `src/execute/runners.js` (máquina) y `src/execute/deliver.js` (entrega). Lo que sigue es su resumen. Si difiere del código, manda el código.

## Qué es del núcleo y qué es del anfitrión

| Del núcleo | Del anfitrión |
|---|---|
| Armar el directorio del trabajo: `run.sh`, `env.sh` (modo 600, lleva el secreto del agente), `prompt.md`, `bin/team` | Dónde corre la sesión: una VM, un contenedor, una Machine |
| Interpretar el NDJSON de `claude -p`, publicar respuestas, medir costo y tiempo | Cómo llega `claude` a esa máquina y con qué credencial de Anthropic |
| Llamar create, run, collect y destroy en ese orden, y destroy siempre | Cuántas máquinas caben (el código 75 y `##team quota`) |
| El presupuesto diario, los plazos y el reintento por infraestructura | De dónde sale el repositorio de trabajo y a dónde empuja la rama `tp/<id>` |
| Esperar y reintentar ante 75 sin gastar intento | El camino de la rama a producción (`deliver`) y sus reglas |
| Adjuntar capturas y documentos que la máquina deja en `{workdir}` | Dónde se guarda la transcripción y por cuánto tiempo |

## Los ganchos de máquina

Con `EXECUTE_RUNNER=machine` son obligatorios create, run y destroy. Collect es opcional. El trabajador pone cada marcador entre comillas simples de shell antes de correr la orden. El plazo de create y run juntos es `EXECUTE_TIMEOUT_MS`.

| Gancho | Variable | Marcadores | Hace | Salida | Códigos |
|---|---|---|---|---|---|
| create | `EXECUTE_MACHINE_CREATE` | `{job_id}` `{workdir}` | Deja lista una máquina para un trabajo | Última línea no vacía de stdout: el nombre de la máquina, que pasa como `{machine}` a los demás (vacío: `team-job-<job_id>`). Todo lo demás, a stderr | 0 creada. 75 ahora no hay capacidad: el trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve sin gastar intento. Otro: fallo permanente. En 75 se puede agregar a stderr `##team quota machines=<N>` |
| run | `EXECUTE_MACHINE_RUN` | `{job_id}` `{workdir}` `{machine}` | Copia `{workdir}` a la máquina, corre `bash run.sh` y devuelve su salida | stdout: sólo el NDJSON de la sesión, línea a línea y sin buffer. Todo lo demás, a stderr | El código de la sesión. Distinto de 0 sin resultado es fallo de infraestructura y se reintenta una vez |
| collect | `EXECUTE_MACHINE_COLLECT` | `{job_id}` `{workdir}` `{machine}` | Antes de destruir, saca lo que la sesión dejó. Copia `captures/` y `attachments/` de la máquina a `{workdir}` y guarda la transcripción | Última línea de stdout: dónde quedó la transcripción (ruta o clave de objeto), que se guarda como `transcript_ref` | 0 con referencia. Cualquier otro valor se registra y el trabajo sigue igual. Corre sólo si run llegó a ejecutarse |
| destroy | `EXECUTE_MACHINE_DESTROY` | `{job_id}` `{workdir}` `{machine}` | Retira la máquina | Nada que el núcleo lea | Corre siempre: tras éxito, fallo, plazo, cancelación y un create que falló a medias. Tiene que ser idempotente: una máquina que no existe ya está destruida y sale 0 |

`run.sh` espera en la máquina `bash`, `node` (lo usa el comando `team`), `claude` en el `PATH` o en `EXECUTE_MACHINE_CLAUDE_BIN`, y red hacia `EXECUTE_TEAM_URL`. Si existe `TEAM_REPO_DIR`, la sesión entra ahí; si no, trabaja en el directorio del trabajo. Las variables `TEAM_*` viajan en `env.sh`, nunca en la línea de órdenes.

Reglas que el contrato no dice y que el driver de referencia cumple:

1. Un id de trabajo entra en nombres y rutas: sólo letras, dígitos, punto, guion y guion bajo.
2. destroy toca únicamente lo que su driver creó, por nombre exacto y por etiqueta. Nunca borra por patrón: la máquina del anfitrión la comparten otros procesos.
3. Contar las máquinas vivas y crear la siguiente es un solo paso, bajo un candado. Así dos trabajos a la vez no ven lugar para la última.
4. Un secreto viaja por nombre de variable o por la entrada estándar, nunca como argumento.
5. Claude Code se niega a correr desatendido como root: la sesión corre con un usuario sin privilegios.

## La entrega

`EXECUTE_DELIVER_COMMAND` es el punto donde cada anfitrión pone su camino a producción. Con la orden declarada, la sesión termina al empujar la rama `tp/<id>`. Después un trabajo `deliver`, sin IA, corre la orden en el host del trabajador.

| Elemento | Contrato |
|---|---|
| Marcadores | `{message_id}` `{job_id}` `{branch}` `{workdir}` |
| Entorno | `TEAM_MESSAGE_ID`, `TEAM_JOB_ID`, `TEAM_BRANCH`, `TEAM_WORKDIR`, `TEAM_DELIVER_ROUND`, `TEAM_DELIVER_ATTEMPT`, `TEAM_OUTPUT_JSON`, `TEAM_BEFORE_CAPTURES` |
| Código 0 | Quedó en producción. Última línea de stdout: la referencia (un commit, una URL, una etiqueta) |
| Código 75 | Ahora no. Marca `##team wait before-machine` en stdout: vale la pena esperar y repetir (otra entrega en curso). Marca `##team wait in-machine`: la causa se repetirá en cada intento (falta una herramienta, un ajuste está mal) y el trabajo falla de inmediato como infraestructura. Sin marca cuenta como `before-machine` |
| Código 76 | Espera la revisión de una persona. Última línea de stdout: el motivo en lenguaje llano |
| Otro código | El cambio falló. stdout y stderr vuelven a Claude como motivo mientras alcance el presupuesto |
| Fases | Las líneas `##team phase verify` y `##team phase deploy` de stdout mueven el progreso |
| Repetición | Debe poder correr dos veces sobre la misma rama |

`EXECUTE_DELIVER_CHECK_COMMAND` corre antes y con los mismos marcadores menos `{workdir}`. Con código 0 la rama ya está en producción (última línea: la referencia) y la orden de entrega no corre. Cualquier otro resultado entrega como siempre. En un anfitrión sin una verificación barata se deja vacía.

`EXECUTE_HOST_INSTRUCTIONS` apunta a un `.md` del anfitrión que se agrega al prompt de cada sesión: sus reglas de código, pruebas y ramas. `EXECUTE_CAPTURES_OPEN_ZONE` es la única zona declarada con la que se adjunta una captura sin datos ocultos; el núcleo no conoce otras.

## Driver `docker-local`

Cuatro ganchos más una entrega de ejemplo, en `drivers/docker-local/`.

```sh
docker build -t team-platform-agent:local drivers/docker-local

EXECUTE_RUNNER=machine
EXECUTE_TEAM_URL=http://host.docker.internal:3000
EXECUTE_MACHINE_CREATE=bash /opt/team-platform/drivers/docker-local/create.sh {job_id} {workdir}
EXECUTE_MACHINE_RUN=bash /opt/team-platform/drivers/docker-local/run.sh {job_id} {workdir} {machine}
EXECUTE_MACHINE_COLLECT=bash /opt/team-platform/drivers/docker-local/collect.sh {job_id} {workdir} {machine}
EXECUTE_MACHINE_DESTROY=bash /opt/team-platform/drivers/docker-local/destroy.sh {job_id} {workdir} {machine}
EXECUTE_DELIVER_COMMAND=bash /opt/team-platform/drivers/docker-local/deliver.sh {message_id} {job_id} {branch} {workdir}
```

| Ajuste del entorno del trabajador | Efecto |
|---|---|
| `TP_DOCKER_IMAGE` | Imagen de la máquina. Omisión `team-platform-agent:local` |
| `TP_DOCKER_REPO` | Ruta del repositorio del anfitrión. Se monta en la máquina, la sesión lo clona, trabaja en `tp/<id>` y empuja la rama de vuelta. `deliver.sh` la busca ahí |
| `TP_DOCKER_BASE_REF` | De dónde nace la rama. Omisión: el HEAD del repositorio |
| `TP_DOCKER_MAX_CONTAINERS` | Máquinas vivas a la vez. Pasado ese número create responde 75 con `##team quota`. Vacío: sin tope, porque el tope lo declara el anfitrión |
| `TP_DOCKER_MEMORY`, `TP_DOCKER_CPUS` | Límites de `docker run` |
| `TP_DOCKER_PASS_ENV` | Variables que pasan del trabajador a la sesión, por nombre. Omisión `ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN` |
| `TP_DOCKER_STATE` | Candado de creación y transcripciones (`transcripts/<job_id>`) |

Si el trabajador corre dentro de un contenedor, necesita el cliente `docker` y el socket del host montado. `EXECUTE_TEAM_URL` tiene que ser una dirección que la máquina alcance: `127.0.0.1` es el contenedor mismo, por eso el ejemplo usa `host.docker.internal`, que create.sh agrega a cada máquina.

Diferencias con un anfitrión de producción. run.sh no se reengancha: si el trabajador se reinicia con una sesión en curso, el trabajo siguiente vuelve a copiar y a empezar. La entrega de ejemplo sólo comprueba que la rama existe y sale 0 con el commit como referencia. El anfitrión reemplaza lo que hay entre `##team phase deploy` y la última línea.

## Escribir un driver para otra nube

Un driver son cuatro guiones que cumplen la tabla de arriba. Se prueba con el `runMachine` real del trabajador y un `claude` falso dentro de la máquina; `src/execute/drivers-docker-local.test.js` es la plantilla. Las preguntas que cada nube resuelve:

1. Cómo se nombra una máquina por trabajo y cómo se vuelve a encontrar por ese nombre en run, collect y destroy.
2. Cómo llega el directorio `{workdir}` y cómo salen las capturas y la transcripción.
3. Cuál es su 75: la cuota o el stock que la nube niega, y dónde se cuenta para no pasarse.
4. Qué retira la máquina si el trabajador muere sin llamar a destroy: una vida máxima declarada en la propia nube.

### Esbozo para Fly Machines

Documentación consultada el 2026-10-26. [`fly machine run`](https://docs.fly.io/machines/flyctl/fly-machine-run), [`fly machine destroy`](https://docs.fly.io/flyctl/machine-destroy), [`fly machine exec`](https://docs.fly.io/flyctl/machine-exec) y [Fly Volumes](https://docs.fly.io/volumes/overview). Los flags citados están en esas páginas; el esbozo no se ejecutó contra una cuenta de Fly.

| Gancho | Esbozo |
|---|---|
| create | `fly machine run <imagen con claude, node y bash> --app <app> --name tp-job-{job_id} --region <región> --vm-size <tamaño> --restart no --metadata team_platform=job sleep infinity`. `--restart no` evita que Fly reviva una máquina que ya terminó. Se imprime el nombre como última línea. Si Fly responde que no hay capacidad en la región, el guion sale 75 |
| run | Copia `{workdir}` con `--file-local` al crear la máquina para los archivos chicos, o con `fly ssh sftp` para el resto, y corre `fly machine exec <máquina> 'bash /job/run.sh' --app <app> --timeout <EXECUTE_TIMEOUT_MS en segundos>`. La salida de `exec` es la del comando; hay que comprobar que llega línea a línea y sin mezcla con stderr. La página de `exec` no documenta stdin, y `run.sh` lee `prompt.md` de un archivo, así que no lo necesita |
| collect | `fly ssh sftp get` de `/job/claude/projects`, `/job/captures` y `/job/attachments`, y la transcripción se sube al almacenamiento del anfitrión (un depósito de objetos, o el volumen de Team Platform si corre en Fly) |
| destroy | `fly machine destroy tp-job-{job_id} --app <app> --force`, idempotente. `--force` hace que funcione con la máquina corriendo, como exige el contrato. Un `not found` sale 0 |

Si Team Platform mismo corre en Fly, su `/data` (la base SQLite, los adjuntos y `{workdir}`) va en un volumen. Un volumen se monta en una sola Machine y vive en una sola región. El trabajador y su volumen son una unidad: no hay dos trabajadores sobre el mismo `/data`. Las máquinas de las sesiones no montan ese volumen. Reciben `{workdir}` por copia y devuelven capturas y transcripción por collect, igual que con Docker.

El tope de máquinas lo hace cumplir create, contando las máquinas vivas con la metadata `team_platform=job` bajo un candado (regla 3). Para un trabajador muerto, `--restart no` detiene la máquina al terminar el comando. La documentación consultada no menciona una vida máxima por máquina, así que el barrido de las que queden queda a cargo del anfitrión.

## El canario

`scripts/canary.mjs` envía un mensaje trivial a un miembro agente en un área declarada y espera por el flujo de eventos la respuesta «OK». Cierra el mensaje y sale 0. Sale 3 con el tramo donde se quedó (`identity`, `agent`, `area`, `send`, `analysis`, `publish`, `session`, `reply`, `cost`). Gasta una sesión del agente. Conviene correrlo tras un despliegue que toque la cadena de `execute`, con un área propia de modelo barato.

```sh
TEAM_URL=https://team.ejemplo.cl TEAM_EMAIL=… TEAM_PASSWORD=… CANARY_AREA="Canario" node scripts/canary.mjs
```

Las variables y los códigos están en la cabecera del guion.
