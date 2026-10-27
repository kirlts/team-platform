# Contrato de anfitrión

contract_version: 1

Un anfitrión es un proyecto que instala Team Platform y le conecta un driver para que Claude trabaje mensajes sin supervisión. Este documento manda sobre MASTER-SPEC §7.5 en todo lo que toca al anfitrión. Si el código y este documento difieren, manda el código (`src/config.js`, `src/execute/runners.js`, `src/execute/deliver.js`) y se corrige este documento.

El anfitrión aporta variables de entorno, cinco órdenes de shell, un archivo de instrucciones, una hoja de estilos opcional y la identidad de sus personas. El núcleo no conoce ninguna nube, ningún repositorio ni ningún cliente.

## Versión del contrato

`contract_version` es un entero. Es la versión mayor: sólo cambia con un cambio incompatible.

| Cambio | Clase | Sube `contract_version` |
|---|---|---|
| Variable `EXECUTE_*` nueva con valor por omisión | Aditivo | No |
| Orden nueva y opcional | Aditivo | No |
| Campo nuevo en `GET /health` | Aditivo | No |
| Marcador `##team` nuevo que un driver puede ignorar | Aditivo | No |
| Variable de entorno nueva en las órdenes, sin que ninguna deje de recibirse | Aditivo | No |
| Quitar o renombrar una variable, un marcador de plantilla o un campo de `/health` | Incompatible | Sí |
| Cambiar el significado de un código de salida o de lo que una orden debe imprimir | Incompatible | Sí |
| Cambiar un valor por omisión de modo que un anfitrión sin ajustes cambie de comportamiento | Incompatible | Sí |
| Volver obligatoria una orden opcional | Incompatible | Sí |

Mientras el primer anfitrión estabiliza su camino a producción, el contrato sólo cambia de forma aditiva (UD-311).

### Dónde se publica y cómo se declara

| Elemento | Qué hace |
|---|---|
| `GET /health` | Publica `contract_version` (entero, hoy 1) en la respuesta básica, la que ve una sonda anónima |
| `EXECUTE_CONTRACT_VERSION` | Variable opcional. El driver declara con ella la versión que cumple |

Con `EXECUTE_CONTRACT_VERSION` declarada y una versión mayor distinta de la del núcleo, el trabajador no arranca y dice por qué. Sin declararla, arranca igual: el contrato es aditivo y un driver anterior a la variable sigue siendo válido.

## Variables `EXECUTE_*`

Se leen en `src/config.js`. Un valor entero o decimal fuera de rango, o un valor fuera de la lista permitida, detiene el arranque con el nombre de la variable. Ninguna es obligatoria salvo en el caso que dice la fila de `EXECUTE_RUNNER`.

### Dónde corre la sesión

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_RUNNER` | `local` | `local` corre `claude -p` en la máquina del trabajador. `machine` usa las órdenes de máquina. Con `machine` deben estar `EXECUTE_MACHINE_CREATE`, `EXECUTE_MACHINE_RUN` y `EXECUTE_MACHINE_DESTROY`, o la instancia no arranca | UD-254 |
| `EXECUTE_CLAUDE_BIN` | `claude` | Ejecutable de `claude` del runner local | Nombre estándar del binario |
| `EXECUTE_MACHINE_CLAUDE_BIN` | `claude` | Ejecutable de `claude` dentro de la máquina | Nombre estándar del binario |
| `EXECUTE_REPO_DIR` | vacía | Repositorio del anfitrión. El runner local trabaja en un worktree suyo, en la rama `tp/<message_id>`. Con ella declarada, el núcleo comprueba que la rama exista antes de encolar la entrega | Sin repositorio la sesión trabaja en el directorio del trabajo |
| `EXECUTE_WORK_ROOT` | vacía | Directorio donde nace el directorio de cada trabajo. Vacía: `$DATA_DIR/tmp` | Volumen de datos de la instancia |
| `EXECUTE_TEAM_URL` | vacía | Dirección de la API que la sesión llama con `team`. Vacía: `http://127.0.0.1:$PORT`. Con una máquina debe ser una dirección que la máquina alcance | Puerto del propio servidor |

### Modelo, esfuerzo y gasto

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_MODEL` | `claude-sonnet-5-5` | Modelo de la sesión y modelo al que escala un mensaje liviano | UD-255 |
| `EXECUTE_LIGHT_MODEL` | `claude-haiku-5-5` | Modelo liviano de un área que no eligió el suyo | UD-295 |
| `EXECUTE_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` o `max`, para `--effort` | UD-255; niveles de `claude --help` 2.1.284 |
| `EXECUTE_MAX_BUDGET_USD` | `10` | Tope de una sesión (`--max-budget-usd`). Mínimo 0,01 | UD-255 |
| `EXECUTE_DAILY_BUDGET_USD` | `10` | Tope del día del servidor (zona `TZ`, UTC si falta) para todos los trabajos `execute`. Con saldo agotado el trabajo espera a la medianoche sin gastar intento | UD-256 |
| `EXECUTE_SESSION_RESERVE_USD` | sin declarar | Lo que cada sesión reserva del día. Sin ella: percentil 90 del costo de los trabajos terminados del mismo modelo | UD-305 |
| `EXECUTE_SESSION_RESERVE_FALLBACK_USD` | `10` | Reserva mientras el modelo no tiene un trabajo terminado con costo | Cortesía declarada, valor de UD-255 |
| `EXECUTE_MACHINE_COST_USD` | `0` | Costo fijo que se suma al día por cada trabajo con runner `machine` | El anfitrión declara el suyo |
| `EXECUTE_MAX_TURNS` | `60` | Turnos de la sesión. `0` quita el tope y gobierna sólo el presupuesto | Encargo H-3724; `0` por UD-283 |
| `EXECUTE_MAX_SUBAGENTS` | `3` | Subagentes simultáneos que la sesión puede usar | UD-255 |
| `EXECUTE_LIGHT_LIMITS` | `create=1 irreversibility=1 certainty=0` | Estimaciones del analizador (0 a 1) sobre las cuales el área usa su modelo mayor | UD-295; medición `bench/model-limits.mjs` |

### Plazos, intentos y espera

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_TIMEOUT_MS` | `3600000` | Plazo de CREATE y RUN juntos. COLLECT y DESTROY tienen cada uno el suyo, del mismo valor | Cortesía declarada: acota una máquina o sesión colgada |
| `EXECUTE_KILL_GRACE_MS` | `10000` | Tiempo entre SIGTERM y SIGKILL al grupo de procesos que lanzó el trabajador | Cortesía declarada |
| `EXECUTE_MAX_ATTEMPTS` | `1` | Intentos de la cola para un trabajo `execute`. Una falla de infraestructura tiene un segundo intento aunque aquí valga 1 | UD-255; segundo intento por decisión del 2026-10-23 |
| `EXECUTE_CAPACITY_WAIT_MS` | `30000` | Espera cuando una orden responde 75 o el saldo del día no alcanza. Mínimo 1000 | Medición del 2026-10-22: crear una máquina tardó 32 s |
| `EXECUTE_INFRA_RETRY_WAIT_MS` | `30000` | Espera antes del segundo intento de un trabajo que falló por infraestructura | Medición del 2026-10-22 |
| `EXECUTE_RUNS_RETENTION_DAYS` | `365` | Días que se conserva el historial de `execute_runs` | UD-262 |

### Órdenes de máquina

| Variable | Omisión | Obligatoria |
|---|---|---|
| `EXECUTE_MACHINE_CREATE` | vacía | Con `EXECUTE_RUNNER=machine` |
| `EXECUTE_MACHINE_RUN` | vacía | Con `EXECUTE_RUNNER=machine` |
| `EXECUTE_MACHINE_COLLECT` | vacía | No |
| `EXECUTE_MACHINE_DESTROY` | vacía | Con `EXECUTE_RUNNER=machine` |

Su comportamiento está en «Las cinco órdenes».

### Entrega

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_DELIVER_COMMAND` | vacía | Orden DELIVER. Vacía: no hay entrega aparte y `execute` publica su respuesta final | UD-263 |
| `EXECUTE_DELIVER_TIMEOUT_MS` | `900000` | Plazo de DELIVER | Cortesía declarada |
| `EXECUTE_DELIVER_CHECK_COMMAND` | vacía | Pregunta previa: si ya está en producción, DELIVER no corre | UD-296 |
| `EXECUTE_DELIVER_RETRIES` | sin tope | Vueltas que una verificación fallida puede dar de vuelta a Claude. `0` informa el primer fallo | UD-298 |
| `EXECUTE_DELIVER_MAX_ATTEMPTS` | `2` | Intentos del trabajo `deliver`. El código 75 no gasta ninguno | UD-263 |
| `EXECUTE_DELIVER_CONCURRENCY` | `1` | Entregas simultáneas | Cortesía declarada: dos a la vez chocan en la misma rama principal |

### Capturas y cierre

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_CAPTURES_MAX` | `3` | Capturas por respuesta | Cortesía declarada |
| `EXECUTE_CAPTURES_OPEN_ZONE` | `ninguna` | Única zona de la salida con la que se adjunta una captura sin datos ocultos | UD-268 |
| `EXECUTE_CAPTURES_UNMASKED` | `denied` | `allowed` o `1` acepta capturas con datos de personas, sea cual sea la zona. `denied` y `0` mantienen la regla de la zona | UD-270 |
| `EXECUTE_AUTO_CLOSE` | `on` | `off` o `0` impide que el sistema cierre solo un mensaje terminado | UD-271, UD-310 |

### Instrucciones y entorno de la sesión

| Variable | Omisión | Qué gobierna | Origen de la omisión |
|---|---|---|---|
| `EXECUTE_HOST_INSTRUCTIONS` | vacía | Ruta de un `.md` con las reglas del anfitrión | UD-255 |
| `EXECUTE_DIRECT_HOST_INSTRUCTIONS` | vacía | Versión mínima de esas reglas para una sesión del modelo liviano. Vacía: se usa `EXECUTE_HOST_INSTRUCTIONS` | UD-295 |
| `EXECUTE_SESSION_ENV` | vacía | Pares `CLAVE=valor` separados por espacios, para el entorno de `claude -p` | UD-262 |
| `EXECUTE_DIRECT_SESSION_ENV` | vacía | Lo mismo, sólo para sesiones del modelo liviano | UD-295 |
| `EXECUTE_OTEL_ENV` | vacía | Pares `CLAVE=valor` para la telemetría propia de `claude -p` (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_*`) | UD-262 |
| `EXECUTE_DIRECT_STOP_COMMAND` | vacía | Orden del gancho `Stop` de una sesión liviana. Código de salida 2 con el motivo en stderr devuelve la sesión al trabajo | UD-295 |
| `EXECUTE_DIRECT_TOOLS` | `Bash,Read,Edit,Write,Grep,Glob,Agent` | Herramientas de una sesión liviana (`--tools`). Vacía: todas | Medición del 2026-10-25: 29.302 tokens con estas siete contra 53.938 con todas |
| `EXECUTE_STABLE_AS_SYSTEM` | `0` | `1` envía la parte estable del prompt como `--append-system-prompt-file`, que la API guarda en caché entre sesiones | Medición `2026-10-23-tokens-y-cache.md` |
| `EXECUTE_CONTRACT_VERSION` | sin declarar | Versión del contrato que cumple el driver (ver «Versión del contrato») | Este documento |

En `EXECUTE_SESSION_ENV`, `EXECUTE_DIRECT_SESSION_ENV` y `EXECUTE_OTEL_ENV` una clave debe ser un nombre de variable en mayúsculas. No puede empezar con `TEAM_` (esas llevan el secreto del agente) ni ser `TRACEPARENT`. Un valor no puede contener espacios.

### Otras variables que el anfitrión fija

| Variable | Omisión | Qué gobierna |
|---|---|---|
| `TZ` | UTC | Día del tope de gasto y zona de la hora en «En producción desde HH:MM» |
| `TEAM_WORKER_VERSION` | hash de los archivos fuente | Identidad del código del trabajador. Un trabajo que falló por infraestructura se vuelve a lanzar una vez por versión |
| `THEME_CSS` | vacía | Ver «Tema» |
| `ANTHROPIC_API_KEY` o `CLAUDE_CODE_OAUTH_TOKEN` | sin valor | `claude` los necesita. El núcleo no los lee: con runner local salen del entorno del trabajador, con `machine` los pone el driver |

## Las cinco órdenes

Las órdenes se declaran como texto de shell y corren con `/bin/sh -c` en la máquina del trabajador. Cada marcador de plantilla se reemplaza por su valor entre comillas simples de shell. Un marcador que esa orden no recibe queda escrito tal cual (en CREATE, `{machine}` no se reemplaza).

| Orden | Marcadores | Entorno que recibe, además del del trabajador |
|---|---|---|
| CREATE | `{job_id}`, `{workdir}` | `TEAM_JOB_ID`, `TEAM_WORKDIR` |
| RUN | `{job_id}`, `{workdir}`, `{machine}` | `TEAM_JOB_ID`, `TEAM_WORKDIR` |
| COLLECT | `{job_id}`, `{workdir}`, `{machine}` | `TEAM_JOB_ID`, `TEAM_WORKDIR` |
| DESTROY | `{job_id}`, `{workdir}`, `{machine}` | `TEAM_JOB_ID`, `TEAM_WORKDIR` |
| DELIVER | `{message_id}`, `{job_id}`, `{branch}`, `{workdir}` | Ver «DELIVER» |

`{workdir}` de las órdenes de máquina contiene `run.sh` (la invocación de `claude`), `env.sh` (modo 600, lleva el secreto del agente), `prompt.md` y `bin/team`. Además `system.md` con `EXECUTE_STABLE_AS_SYSTEM`, `thread/` cuando el trabajo atiende una mención, y los directorios `captures/` y `attachments/` donde la sesión deja capturas y documentos.

Las señales van sólo al grupo de procesos que lanzó el trabajador. Nunca se señala a un proceso padre.

### CREATE

Deja lista una máquina para un trabajo.

| Elemento | Contrato |
|---|---|
| stdout | La última línea no vacía es el nombre de la máquina, que pasa como `{machine}` a las demás órdenes. Vacía: `team-job-<job_id>`. Lo demás va a stderr |
| Código 0 | Máquina creada |
| Código 75 | Sin capacidad ahora (cuota o existencias). El trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve sin gastar intento. stderr puede llevar `##team quota machines=<N>` con las máquinas que la cuota admitió |
| Otro código | Falla de infraestructura (`machine_create_failed`). Se reintenta una vez tras `EXECUTE_INFRA_RETRY_WAIT_MS` y el segundo fallo pasa a una persona |
| Compuerta | Tras un 75, los CREATE siguientes del mismo trabajador reciben 75 sin correr la orden durante `EXECUTE_CAPACITY_WAIT_MS`. La compuerta se abre antes si termina una sesión |
| Plazo | `EXECUTE_TIMEOUT_MS`, compartido con RUN |

### RUN

Copia `{workdir}` a la máquina, corre ahí `bash run.sh` y devuelve su salida.

| Elemento | Contrato |
|---|---|
| stdout | Sólo el NDJSON de la sesión, línea a línea y sin acumular. Todo lo demás va a stderr. Una línea que no es JSON se descarta y se cuenta como inválida |
| Línea `result` | Cierra el trabajo. Debe traer `structured_output`, o el trabajo falla con `invalid_output` |
| Código de salida | El de la sesión. Un código distinto de 0 sin línea `result` es falla de infraestructura (`execute_no_result`): un segundo intento y después una persona |
| Plazo | `EXECUTE_TIMEOUT_MS` menos lo que gastó CREATE. Al vencer: SIGTERM, y SIGKILL tras `EXECUTE_KILL_GRACE_MS`. El trabajo falla con `execute_timeout` |
| Apagado del trabajador | Si el trabajador se apaga en orden (un despliegue) con la sesión en curso, cancela RUN con SIGTERM, omite COLLECT y llama DESTROY. El trabajo vuelve a la cola sin gastar el intento y el intento siguiente llama CREATE y RUN de nuevo, con una máquina nueva. RUN no tiene que reengancharse a una sesión anterior |

Dentro de la máquina `run.sh` necesita `bash`, `node` (lo usa `team`), `claude` y red hacia `EXECUTE_TEAM_URL`. Hace `cd` a `$TEAM_REPO_DIR` si el entorno de la máquina la define, y al directorio del trabajo si no. `TEAM_REPO_DIR` no puede venir de `EXECUTE_SESSION_ENV`, que rechaza claves `TEAM_*`. `bypassPermissions` no arranca como root fuera de un sandbox, así que la sesión corre con un usuario sin privilegios.

Las líneas NDJSON son las de `claude -p --output-format stream-json --verbose --include-partial-messages`. El núcleo lee los eventos `system` (subtipo `init`), `assistant`, `user` y `result`.

### COLLECT

Opcional. Saca de la máquina lo que la sesión dejó antes de destruirla.

| Elemento | Contrato |
|---|---|
| Qué copia | `captures/` y `attachments/` de la máquina a `{workdir}/captures` y `{workdir}/attachments`, y la transcripción de la sesión a donde el anfitrión la conserve |
| stdout | La última línea no vacía es la ruta o la clave de objeto de la transcripción. Queda en `execute_runs.transcript_ref` |
| Cuándo corre | Después de RUN y antes de DESTROY, también si la sesión falló o venció. No corre si CREATE falló ni si el trabajo se abortó |
| Código distinto de 0 o sin salida | La referencia queda vacía, el motivo se guarda en `transcript_error` y el trabajo sigue |
| Plazo | `EXECUTE_TIMEOUT_MS` |

### DESTROY

Retira la máquina.

| Elemento | Contrato |
|---|---|
| Cuándo corre | Siempre: tras éxito, tras fallo, tras plazo vencido, tras abortarse el trabajo, en el apagado ordenado del trabajador y cuando CREATE falló a medias. No corre si la compuerta respondió 75 sin ejecutar CREATE, porque no se creó nada |
| Idempotente | Una máquina que no existe ya está destruida y la orden sale con 0. Un error (permiso, red, un servicio que no contesta) nunca es «no existe»: sale distinto de 0 |
| Código distinto de 0 | No falla el trabajo. El núcleo lo deja registrado con el motivo y la máquina sigue anotada como viva: se reintenta cuando arranca el trabajador, y `GET /health` pasa a `degraded` con `machines.failed` mientras tanto |
| Máquinas huérfanas | El núcleo anota cada máquina en `execute_machines` antes de llamar CREATE, con `{job_id}`, `{workdir}` y el nombre por omisión `team-job-<job_id>`, y cierra la fila cuando DESTROY sale con 0. Si el trabajador muere sin aviso (SIGKILL, corte de luz), la fila queda abierta. El trabajador siguiente llama DESTROY de cada fila abierta cuyo trabajo ya no corre con arriendo vigente, al arrancar y cuando vence un arriendo. Para esa llamada `{machine}` es el nombre que imprimió CREATE (o el de omisión si murió antes) y `{workdir}` es la ruta que el trabajo tuvo, que a esa hora ya no existe: DESTROY no puede depender de su contenido. Una máquina del anfitrión sin fila en la base (creada fuera del núcleo, o por un CREATE que no llegó a anotarse) no la barre el núcleo: es del anfitrión |
| Vida máxima | Sigue siendo prudente que el driver declare una vida máxima a cada máquina: es el último respaldo si el anfitrión no contesta DESTROY durante días |
| Plazo | `EXECUTE_TIMEOUT_MS` |

### DELIVER

Lleva la rama `tp/<message_id>` a producción. Corre en el trabajo `deliver`, sin IA y sin máquina, en la máquina del trabajador.

| Elemento | Contrato |
|---|---|
| Entorno | `TEAM_JOB_ID`, `TEAM_MESSAGE_ID`, `TEAM_BRANCH`, `TEAM_WORKDIR`, `TEAM_DELIVER_ROUND` (0 la primera vez), `TEAM_DELIVER_ATTEMPT`, `TEAM_OUTPUT_JSON` (la salida estructurada de la sesión sin `summary`, JSON compacto), `TEAM_CAPTURES_VIDEO` (`1` si la sesión dejó un video del recorrido, `0` si no), `TEAM_BEFORE_CAPTURES` (lista JSON `[{ place, as, width, height }]` de los «antes» de la primera respuesta) y `TEAM_REVIEWED_BY` (la persona que aprobó la entrega, vacío si nadie) |
| Directorio | `{workdir}` nace vacío, con `captures/` dentro, y se borra al terminar |
| Código 0 | Quedó en producción. La última línea de stdout que no empieza con `##team ` es la referencia (commit, URL o etiqueta, hasta 500 caracteres) |
| Código 75 | No puede ahora. El trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve sin gastar intento. Ver «Marcadores `##team`» para `##team wait` |
| Código 76 | Espera la revisión de una persona. La última línea de stdout es el motivo en lenguaje llano. No se reintenta ni vuelve a Claude: el trabajo termina `done` con `delivered = 0` y `delivery_held = 1` en `execute_runs`, y el mensaje pasa a quien decide en el área. Un anfitrión no debe responder 76 cuando `TEAM_REVIEWED_BY` llega con valor: una persona ya aprobó. Si la entrega la lanzó una persona a mano (`requested_by`), el 76 cuenta como falla de la orden |
| Otro código | Falla de la verificación. stdout y stderr son el motivo y, mientras alcance el presupuesto diario, vuelven a Claude en un `execute` nuevo (`EXECUTE_DELIVER_RETRIES` acota las vueltas). Las líneas `FALLA prueba: <archivo> › <nombre>` dan al autor el nombre de la primera prueba caída |
| Falla del entorno | Plazo vencido, señal, códigos 124, 126, 127, 129 a 159 y 255, o una salida que dice que el entorno de entrega no está listo: no es falla del cambio. Se repite una vez y el segundo fallo pasa a una persona. Claude no lo ve |
| Plazo | `EXECUTE_DELIVER_TIMEOUT_MS` |
| Repetible | Debe poder correr dos veces sobre la misma rama. Un trabajador que muere en mitad de la entrega la repite |

Antes de DELIVER, el núcleo corre `EXECUTE_DELIVER_CHECK_COMMAND`, si existe, con `{message_id}`, `{job_id}` y `{branch}`, y con `TEAM_JOB_ID`, `TEAM_MESSAGE_ID` y `TEAM_BRANCH` en el entorno. El plazo es de 60 s. Código 0 significa que la rama ya es antecesora de lo que el anfitrión sirve; la última línea es la referencia y DELIVER no corre. Cualquier otro resultado, incluido un plazo vencido, entrega como siempre.

En verde, la respuesta final es el `summary` de la sesión con «En producción desde HH:MM <zona>.» al final. El núcleo la publica sólo después de la confirmación del código 0.

## Marcadores `##team`

Son líneas completas. El núcleo las lee y no las cuenta como salida ni como referencia.

| Marcador | Orden y canal | Efecto |
|---|---|---|
| `##team phase verify` | DELIVER, stdout | El progreso pasa a `deliverVerify` (0 %). Es la fase con la que empieza toda entrega |
| `##team phase deploy` | DELIVER, stdout | El progreso pasa a `deliverDeploy` (50 %) |
| `##team wait before-machine` | DELIVER con código 75, stdout | La espera es legítima (el turno de otra entrega, una cuota). Es el valor por omisión |
| `##team wait in-machine` | DELIVER con código 75, stdout | La causa se repetirá en cada intento. El trabajo falla de inmediato como infraestructura (`deliver_env`) y se vuelve a lanzar con la próxima versión del trabajador |
| `##team quota machines=<N>` | CREATE con código 75, stderr | El núcleo registra cuántas máquinas admitió la cuota |
| `##team capture <json>` | DELIVER con código 0, stdout | Un «después» tomado de producción, con la forma `{ path, alt, masked, place, as }` y la imagen en `$TEAM_WORKDIR/captures` |
| `##team capture-failed <motivo>` | DELIVER con código 0, stdout | La respuesta final dice en una línea que no se tomó el «después» |

Un 75 repetido de DELIVER con la misma salida deja de ser una espera. El límite es `ceil(64 min / EXECUTE_CAPACITY_WAIT_MS)` respuestas seguidas, porque 64 minutos es lo más que duró un turno legítimo del anfitrión (medición del 2026-10-26). Pasado el límite, el trabajo falla como `deliver_env` con el motivo `stuck`.

## Entorno de la sesión

`env.sh` lleva estas variables. El runner local las pasa al proceso de `claude`.

| Variable | Valor |
|---|---|
| `TEAM_URL`, `TEAM_API_PREFIX` | Dirección de la API (`EXECUTE_TEAM_URL`) y su prefijo |
| `TEAM_AGENT_EMAIL`, `TEAM_AGENT_SECRET` | Credencial del miembro agente. Ver «Identidad delegada» |
| `TEAM_JOB_ID`, `TEAM_MESSAGE_ID`, `TEAM_BRANCH` | Trabajo, mensaje y rama `tp/<message_id>` |
| `TEAM_CAPTURES_DIR`, `TEAM_CAPTURES_MAX`, `TEAM_CAPTURES_MAX_BYTES`, `TEAM_CAPTURES_OPEN_ZONE`, `TEAM_CAPTURES_UNMASKED`, `TEAM_LANGUAGE` | Reglas de las capturas y lengua de la respuesta |
| `TEAM_ATTACHMENTS_DIR`, `TEAM_ATTACHMENTS_MAX`, `TEAM_ATTACHMENTS_MAX_BYTES` | Dónde la sesión deja documentos PDF y sus topes |
| `TEAM_THREAD_DIR` | Archivos del hilo, sólo en un trabajo que atiende una mención |
| `TRACEPARENT` | Continúa la traza del trabajo |
| Pares de `EXECUTE_SESSION_ENV`, `EXECUTE_DIRECT_SESSION_ENV` y `EXECUTE_OTEL_ENV` | Los que el anfitrión declaró |

`bin/team` está en el `PATH` de la sesión. Sus órdenes son `show`, `reply`, `progress`, `mark`, `timing` y `close`.

## `EXECUTE_HOST_INSTRUCTIONS`

Es la ruta de un archivo `.md` con las reglas del anfitrión: código, pruebas, ramas, qué toca la sesión y qué no. El núcleo lo lee en cada trabajo y lo agrega al prompt como el bloque `host_instructions`, con precedencia sobre las reglas por omisión. Si el archivo no existe o no se lee, el trabajo falla con `host_instructions_missing` y no se reintenta.

Una sesión del modelo liviano lee `EXECUTE_DIRECT_HOST_INSTRUCTIONS` en su lugar, si está declarada. Con `EXECUTE_DELIVER_COMMAND` declarada, el prompt agrega una sección «Delivery» después de este bloque. Tiene precedencia sobre él: la entrega la hace el sistema y la sesión no despliega.

## Tema

`THEME_CSS` es la ruta de una hoja `.css` en el disco del servidor. Un archivo ausente detiene el arranque. El servidor la entrega como `<BASE_PATH>theme.css`, después de la hoja del panel, y la lee en cada petición, así que editarla no exige reiniciar. Responde con `ETag` y `cache-control: no-cache`.

Los tipos `.woff2`, `.woff`, `.ttf`, `.png`, `.svg` y `.webp` que estén junto a la hoja salen como `<BASE_PATH>theme/<archivo>`, para usarlos desde la hoja con `url(theme/<archivo>)`. La hoja sólo redefine tokens; la estructura de las vistas no cambia. Las variables que acepta están en MASTER-SPEC §7.8, «Contrato del tema».

## Identidad delegada

Si el anfitrión ya tiene sesión, Team Platform acepta su identidad en lugar de pedir otra. El detalle de cada modo está en MASTER-SPEC §7.7.

| Variable | Omisión | Qué gobierna |
|---|---|---|
| `IDENTITY_PROVIDER` | `local` | Una fuente o una lista en orden: `local`, `delegated`, `signed-header`, `jwt`, `sso-redirect`, `trusted-header`. Gana la primera que identifica la petición |
| `DELEGATED_MODE` | `signed-header` | Modo que significa `delegated` |
| `DELEGATED_SECRETS` | vacía | Secretos de la firma. Dos durante una rotación. Obligatoria con `signed-header` |
| `JWT_JWKS_URL` o `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` | vacías | Obligatorias con `jwt`: una de las dos primeras y las dos últimas |
| `JWT_COOKIE_NAME` | vacía | Cookie del dominio del anfitrión donde viaja su JWT. Vacía: sólo cabecera |
| `SSO_LOGIN_URL`, `SSO_SECRET`, `PUBLIC_URL` | vacías | Obligatorias con `sso-redirect` |
| `IDENTITY_PROVISION` | `closed` | `host` da de alta al primer ingreso a un correo desconocido, con el nombre y el rol que declara el anfitrión |
| `COOKIE_DOMAIN`, `COOKIE_NAME` | vacía, `team_session` | Cookie de sesión compartida con el anfitrión |
| `HOST_LOGIN_URL` | `/session/login` | Adónde va una sesión ausente o vencida cuando el anfitrión gobierna la identidad (UD-308) |
| `LOGOUT_URL` | vacía | Salida propia del anfitrión |

El miembro agente no tiene contraseña. La sesión se identifica con las cabeceras `X-Team-User`, `X-Team-Ts` y `X-Team-Sig`. La firma es un HMAC-SHA256 ligado al método y la ruta, hecho con el secreto propio del agente. La API muestra ese secreto una sola vez, al crear al agente o reemplazarlo. `bin/team` firma con `TEAM_AGENT_EMAIL` y `TEAM_AGENT_SECRET`.

## Cómo sé si mi driver cumple

```sh
node scripts/host-conformance.mjs --driver <dir>
```

El comando sale con 0 sólo si todas las comprobaciones pasan, e imprime la `contract_version` que el driver cumple. Cualquier otro código significa que algo falló y la salida dice qué.

La prueba ejercita las cinco órdenes con un trabajo de prueba. Verifica el NDJSON de la sesión y que DESTROY corre tras un fallo y tras un plazo vencido. Verifica que el código 75 no gasta intento y que el 76 deja `delivery_held`. Verifica que DELIVER puede repetirse sobre la misma rama.

El driver de referencia es `drivers/docker-local`. Pasa esta prueba y sirve de plantilla; `drivers/README.md` explica cómo escribir otro. Un driver que declara `EXECUTE_CONTRACT_VERSION` lo hace con el número que imprime este comando.

## Diferencias con la documentación anterior

Se comparó este documento con MASTER-SPEC §7.5 (`docs/MASTER-SPEC.md`), `.env.example`, el plan canónico de 2026 y el contrato que el primer anfitrión escribió por su lado. Este último tiene una sola fila (C18, sobre la vida de las máquinas) y ninguna descripción del contrato: no hay nada que comparar. Donde difieren, este documento sigue el código.

| Documento y línea | Dice | El código hace |
|---|---|---|
| Plan canónico 2026, §1 | 46 variables `EXECUTE_*` en `src/config.js` | Son 45 nombres distintos (`src/config.js:352-421`). Con `EXECUTE_CONTRACT_VERSION` son 46 |
| MASTER-SPEC `:548-569` | La tabla de variables omite nueve | `EXECUTE_DELIVER_CONCURRENCY`, `EXECUTE_DIRECT_HOST_INSTRUCTIONS`, `EXECUTE_DIRECT_SESSION_ENV`, `EXECUTE_MACHINE_CLAUDE_BIN`, `EXECUTE_MAX_ATTEMPTS`, `EXECUTE_OTEL_ENV`, `EXECUTE_SESSION_ENV`, `EXECUTE_TEAM_URL` y `EXECUTE_WORK_ROOT` están en `src/config.js:351-421` |
| `.env.example` y MASTER-SPEC | No mencionan `TEAM_WORKER_VERSION` | `src/execute/resume.js:29` la lee para decidir cuándo se vuelve a lanzar un trabajo que falló por infraestructura |
| MASTER-SPEC `:539` | `{workdir}` contiene `run.sh`, `env.sh`, `prompt.md` y `bin/team` | También `system.md`, `thread/`, `captures/` y `attachments/` (`src/execute/runners.js:101-103`, `src/execute/handler.js:530-531`) |
| MASTER-SPEC `:579` | El código 75 de DELIVER espera y reintenta sin gastar intento | Con `##team wait in-machine` falla de inmediato, y la misma salida repetida `ceil(64 min / EXECUTE_CAPACITY_WAIT_MS)` veces también (`src/execute/deliver.js:340-359`) |
| MASTER-SPEC `:582` | Un plazo vencido de DELIVER es una falla que no vuelve a Claude | Además se repite una vez antes de pasar a una persona (`src/execute/deliver.js:329-337`) |
| MASTER-SPEC `:583` y `:586` | Sólo describe `##team phase` y seis variables de entorno | Las marcas `##team wait`, `##team quota`, `##team capture` y `##team capture-failed`, y las variables `TEAM_BEFORE_CAPTURES` y `TEAM_CAPTURES_VIDEO`, existen en el código (`src/execute/deliver.js:58,298-301`, `src/execute/runners.js:125`, `src/execute/captures.js:116-124`) |
| MASTER-SPEC, fila de `EXECUTE_DELIVER_CHECK_COMMAND` | No dice el plazo ni el entorno | 60 s y `TEAM_JOB_ID`, `TEAM_MESSAGE_ID`, `TEAM_BRANCH` (`src/execute/deliver.js:63,193`) |
| MASTER-SPEC, `EXECUTE_MACHINE_CREATE` | Sólo describe el 0 y el 75 | Cualquier otro código es falla de infraestructura con un segundo intento (`src/execute/handler.js:598`, `src/queue/index.js:22`) |
| `src/config.js:385` (comentario) | `EXECUTE_MACHINE_COLLECT` recibe `{machine}` y `{job_id}` | También recibe `{workdir}` (`src/execute/runners.js:178`) |
