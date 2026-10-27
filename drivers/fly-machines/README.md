# Driver `fly-machines`

Cumple el contrato de anfitrión (`docs/CONTRATO-DE-ANFITRION.md`, versión 1) sobre la API de Fly Machines. Cada trabajo `execute` corre en una máquina propia, de una imagen declarada, que Fly destruye sola al terminar su vida máxima. Ningún archivo de este directorio nombra a un anfitrión: la app, la región, el token y la imagen entran por variables.

Documentación de Fly consultada el 2026-10-26 y el 2026-10-27: [crear máquina y esquema de configuración](https://docs.fly.io/machines/api/machines-resource), [especificación OpenAPI de la API](https://docs.fly.io/api/machines/openapi.json), [`fly machine exec`](https://docs.fly.io/flyctl/machine-exec) y [precios](https://docs.fly.io/about/pricing). Lo que esas páginas no dicen se midió contra la API real el 2026-10-27 y está en «Límites medidos».

## Uso

```sh
docker build -t registry.fly.io/<app>:tp-agent drivers/fly-machines
docker push registry.fly.io/<app>:tp-agent        # con docker login registry.fly.io -u x, el token como contraseña

EXECUTE_RUNNER=machine
EXECUTE_CONTRACT_VERSION=1
EXECUTE_TEAM_URL=https://<dirección que la máquina alcance>
EXECUTE_MACHINE_CREATE=bash /opt/team-platform/drivers/fly-machines/create.sh {job_id} {workdir}
EXECUTE_MACHINE_RUN=bash /opt/team-platform/drivers/fly-machines/run.sh {job_id} {workdir} {machine}
EXECUTE_MACHINE_COLLECT=bash /opt/team-platform/drivers/fly-machines/collect.sh {job_id} {workdir} {machine}
EXECUTE_MACHINE_DESTROY=bash /opt/team-platform/drivers/fly-machines/destroy.sh {job_id} {workdir} {machine}
EXECUTE_DELIVER_COMMAND=bash /opt/team-platform/drivers/fly-machines/deliver.sh {message_id} {job_id} {branch} {workdir}
```

El trabajador necesita `node` 22 o superior (usa `fetch`), `bash`, `flock`, `tar` y `git`. La imagen del servicio trae `node`, `flock` y `tar`; `bash` y `git` los agrega `compose.driver.example.yml`, y los guiones de este driver viajan en `/app/drivers/fly-machines` (recorrido completo y comprobación en `docs/INSTALACION.md`, «Un driver dentro del contenedor»). Instalado así, el trabajador lee el token de un archivo montado (`TP_FLY_TOKEN_FILE`) y guarda su estado en el volumen (`TP_FLY_STATE=/data/driver-state`). La imagen de la máquina necesita `bash`, `node`, `git`, `tar`, `base64` y `runuser` (todos están en la imagen base del `Dockerfile`).

| Variable del trabajador | Omisión | Efecto |
|---|---|---|
| `TP_FLY_APP` | obligatoria | App de Fly cuyas máquinas gestiona el driver |
| `FLY_API_TOKEN` o `TP_FLY_TOKEN_FILE` | obligatoria una de las dos | Token de la API. Nunca viaja en un argumento. Un token de despliegue de la app basta para crear, listar, ejecutar y destruir máquinas |
| `TP_FLY_IMAGE` | obligatoria en create | Imagen de la máquina |
| `TP_FLY_REGION` | vacía | Región. Vacía: elige Fly |
| `TP_FLY_CPU_KIND`, `TP_FLY_CPUS`, `TP_FLY_MEMORY_MB` | `shared`, 1, 256 | Tamaño. Son las omisiones de la API. Claude Code necesita más de 256 MB: el anfitrión que lo corre declara `TP_FLY_MEMORY_MB` |
| `TP_FLY_MAX_LIFE_S` | 7200 | Vida máxima de cada máquina. 7200 s son dos veces `EXECUTE_TIMEOUT_MS` (RUN y COLLECT tienen cada uno ese plazo) |
| `TP_FLY_MAX_MACHINES` | sin tope | Máquinas vivas del driver a la vez. Pasado el tope create responde 75 con `##team quota machines=<N>`. El tope lo declara el anfitrión |
| `TP_FLY_USER` | `node` | Usuario de la imagen que corre la sesión. Claude Code no corre desatendido como root |
| `TP_FLY_PASS_ENV` | `ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN` | Variables que pasan del trabajador a la sesión, por nombre |
| `TP_FLY_REPO` | vacía | Repositorio del anfitrión en el trabajador. La sesión recibe un clon, trabaja en `tp/<id>` y collect trae la rama de vuelta aquí, que es donde `deliver.sh` la busca |
| `TP_FLY_BASE_REF` | HEAD del clon | De dónde nace la rama |
| `TP_FLY_STATE` | `~/.local/state/team-platform-fly` | Candado de creación y transcripciones (`transcripts/<job_id>`) |
| `TP_FLY_API` | `https://api.machines.dev` | URL base de la API |
| `TP_FLY_START_TIMEOUT_S` | 60 | Espera de create a que la máquina arranque. Es la omisión del endpoint `wait` |
| `TP_FLY_POLL_WAIT_S` | 45 | Espera de cada consulta de salida de la sesión |
| `TP_FLY_EXEC_GAP_MS` | 1000 | Separación mínima entre dos `exec` de una consulta |
| `TP_FLY_UPLOAD_PARALLEL` | 3 | `exec` simultáneos al subir archivos |

La organización no es una variable: la API de Machines direcciona por app y el token ya pertenece a una organización.

## Cómo cumple cada orden

| Orden | Qué hace |
|---|---|
| create | Lista las máquinas del driver (metadata `team_platform_driver` y `team_platform_job`), responde 75 si se alcanzó `TP_FLY_MAX_MACHINES`, crea `tp-job-<id>` con `auto_destroy: true`, `restart: no`, el tamaño pedido y `init.exec = ["sleep", "<vida>"]`, espera a que arranque e imprime el nombre. Cuenta y crea bajo un candado (`flock`). Repetida para un trabajo con máquina viva, devuelve esa máquina |
| run | Sube el directorio del trabajo (y el repositorio como `git bundle`), lanza la sesión aparte con `setsid` como usuario sin privilegios y la sigue con consultas largas. Su stdout es sólo el NDJSON de la sesión, línea a línea; el stderr de la sesión va al stderr. Sale con el código de la sesión |
| collect | Trae `captures/` y `attachments/` a `{workdir}`, trae al repositorio del anfitrión los commits que la sesión empujó a `tp/<id>` y copia la transcripción a `$TP_FLY_STATE/transcripts/<job_id>`, que imprime. Sale 3 si no hay transcripción |
| destroy | Busca la máquina por su metadata (nunca por patrón de nombre) y la destruye con `force`. Una máquina que no existe sale 0. Una máquina sin la metadata del driver no se toca |
| deliver | Ejemplo igual al de `docker-local`: comprueba que la rama exista en `TP_FLY_REPO` y entrega el commit como referencia. El anfitrión reemplaza lo que hay entre `##team phase deploy` y la última línea |

### Códigos de create

| Respuesta de Fly | Salida |
|---|---|
| 200 o 201 | 0 |
| 429 (tras esperar el `Retry-After` hasta 6 veces), 503, la API no contesta | 75 |
| 409, 412 o 422 con «insufficient», «capacity», «could not reserve resource» o «no available» en el texto | 75 |
| Cualquier otra | 1 |

Fly no documenta un estado para la falta de capacidad: la documentación dice sólo que crear «puede fallar» cuando una región está llena. El 412 con ese texto es lo que reportan los usuarios en el foro de Fly. No se pudo provocar una falta de capacidad real; el caso se prueba con el doble de la API.

## Vida máxima

Fly no documenta un campo de vida máxima de una máquina (sólo `auto_destroy` y `schedule`, que reinicia). El driver la garantiza del lado de Fly con lo que sí documenta: el único proceso de la máquina es `sleep <vida>`, la política de reinicio es `no` y `auto_destroy` es verdadero, así que Fly destruye la máquina cuando el proceso termina, sin trabajador vivo. Medido el 2026-10-27: una máquina creada con `sleep 120` ya no estaba en la app dos minutos después. `destroy` la retira antes si el trabajo termina.

## Límites medidos de la API (2026-10-27)

| Qué | Medición | Cómo lo resuelve el driver |
|---|---|---|
| `exec` devuelve la salida al terminar el comando | No hay salida en vivo por este canal | La sesión corre aparte (`setsid`) y `run` la sigue con `machine/poll.mjs`: cada `exec` espera, dentro de la máquina, a que el sistema de archivos avise de salida nueva (`fs.watch`) y la devuelve en ese momento. La espera de la consulta es el único plazo |
| Un `exec` se corta con HTTP 408 a los 65 s aproximadamente, aunque `timeout` sea 100 | Una consulta que espera 100 s devolvió 408 a los 65,5 s | La consulta espera 45 s y vuelve sola. Un 408 se repite con los mismos desplazamientos y no pierde nada |
| El cuerpo de un `exec` admite hasta 16.072 bytes y se rechaza a los 17.072 | Con HTTP 200, `exit_code` 0 y «Unhandled rejection: PayloadTooLarge» en stderr | `exec()` trata ese stderr como error. Los archivos suben como argumentos base64 de 12.000 caracteres, hasta 3 a la vez, y se verifican con tamaño y sha256 |
| `stdin` del `exec` no llega al comando (lee `/dev/null`) | `cat \| wc -c` con `stdin` de 1 MB devolvió 0 | Los datos viajan como argumentos |
| La respuesta de un `exec` admite 10.485.760 bytes tras codificar en JSON | Con 8 MB de salida: HTTP 413 | La consulta devuelve como máximo 1 MiB de líneas completas. Las descargas van en trozos de 4 MiB de texto base64 |
| El cuerpo de crear o actualizar una máquina con `files` admite menos de 1 MB (512 KB pasó, 1,2 MB no) y una máquina con `auto_destroy` no se puede actualizar | HTTP 400 en ambos | Los archivos no van en la configuración: suben por `exec` después de create, porque el directorio del trabajo no existe al crear |
| `GET /machines/<nombre>` responde 404 | Se direcciona por id | El driver busca el id por la metadata |
| Límite de tasa | «1 solicitud por segundo por acción, ráfaga hasta 3» ([foro de Fly, personal de Fly](https://community.fly.io/t/understanding-fly-io-api-rate-hard-limits/20636), consultado el 2026-10-27; la documentación de la API no da cifras) | Separación mínima de 1 s entre consultas, 3 `exec` en vuelo al subir, y espera del `Retry-After` ante un 429 |

Consecuencias que se declaran:

- La salida de la sesión llega con la latencia de una ida y vuelta (unos 0,4 s medidos por llamada) y una separación mínima de 1 s entre consultas, no byte a byte.
- Subir un directorio de trabajo cuesta una llamada de unos 0,4 s por cada 9 KB de datos comprimidos. El de una sesión típica (`bin/team` más el prompt) son pocas llamadas. Un directorio de varios MB tarda decenas de segundos.
- Si la salida de la sesión tiene bytes que no son UTF-8 válido, los desplazamientos de lectura se desfasan. Claude Code escribe UTF-8.
- RUN repetido (el trabajador se reinicia con la sesión viva) reenvía la salida desde la primera línea.

## Prueba

```sh
node --test src/execute/drivers-fly-machines.test.js
```

No gasta: un doble de la API de Fly (`src/execute/fly-api-double.js`) cuyas máquinas son contenedores de Docker de la misma imagen. Reproduce los comportamientos medidos de la tabla anterior. Necesita Docker.

Conformidad contra Fly de verdad (crea máquinas reales en la app, cada una de la configuración mínima, con vida de 15 minutos, y los casos las destruyen):

```sh
TP_FLY_APP=<app> FLY_API_TOKEN=<token> node scripts/host-conformance.mjs --driver drivers/fly-machines
```

`conformance.sh` construye la imagen sin Claude Code (la sesión es el doble del guion) y la sube a `registry.fly.io/<app>` con una etiqueta que lleva el hash del `Dockerfile`; el inicio de sesión de Docker usa un directorio de configuración temporal que se borra al terminar. Con `TP_FLY_IMAGE` declarada usa esa imagen y no construye nada.

## Costo

Fly cobra una máquina por segundo mientras corre; la `shared-cpu-1x` de 256 MB cuesta 2,19 USD al mes en `iad` ([precios](https://docs.fly.io/about/pricing), consultado el 2026-10-27), es decir 8,45e-7 USD por segundo (2,19 / 2.592.000 s). Con 1 GB son 6,70 USD al mes, 2,58e-6 USD por segundo. La documentación de precios no da cifra del almacenamiento de imágenes del registro.

Medición del 2026-10-27, cuenta de desarrollo: la corrida de conformidad completa (13 casos) tardó 171 s, creó 7 máquinas de 256 MB y las destruyó todas. Cota superior: 7 máquinas por 171 s son 1.197 s de máquina, 0,001 USD. Las tres máquinas de prueba de los límites de la API sumaron unos 1.500 s en cota superior, otros 0,0013 USD. Total menor que 0,01 USD, contra el tope de 0,75 USD diarios.

## Diferencias con `docker-local`

- El repositorio no se monta: viaja como `git bundle` de todas sus referencias y la rama vuelve como un bundle de los commits nuevos. Un repositorio de cientos de MB hace lenta cada subida; para esos casos conviene un repositorio remoto al que la máquina empuje, que este driver no incluye.
- Una máquina no ve el `host.docker.internal` del trabajador: `EXECUTE_TEAM_URL` tiene que ser una dirección pública o de la red privada de Fly.
- La vida máxima la impone Fly. En `docker-local` no existe.
