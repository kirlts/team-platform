# Cola de trabajos y progreso sobre SQLite

Fecha de consulta: 2026-10-20. Alimenta MASTER-SPEC §2, §3, §4, §7.2, §7.3 y §7.10. `[F#]` remite a la tabla de fuentes (sección 10, con URL y fecha de consulta). `[M#]` remite a una medición propia del mismo día (sección 1). «Sin verificar» marca lo que no tiene fuente primaria.

## Resultado

`node:sqlite` es «release candidate» desde Node 24.15.0, y Node 24.20 incluye SQLite 3.53.4. La elección de §3 se sostiene. Una cola propia con dos procesos escritores no produjo reclamos duplicados (13.768 reclamos, 13.768 trabajos distintos). Exige dos condiciones que el spec no declara: `busy_timeout` distinto de cero y `BEGIN IMMEDIATE` en toda transacción que lee y luego escribe. La forma `UPDATE … LIMIT 1` de §7.3 es un error de sintaxis y se reemplaza por una subconsulta. SSE con `@fastify/sse` 0.6.1 repone sin duplicados si se suscribe antes de reponer, pero `fastify.close()` se cuelga con un flujo abierto. Los esquemas de respuesta de Fastify convierten tipos y descartan propiedades, así que la salida del modelo se valida con una instancia propia de Ajv.

## 1. Método y entorno de medición

Se corrieron las cuatro búsquedas del procedimiento por tema: estado actual, comparativa, crítica y migración. Cuando el buscador devolvió solo resúmenes de terceros, se leyó la fuente primaria. Fueron la documentación de Node.js y SQLite, el registro de npm, la API de GitHub y el código de pg-boss.

Las mediciones corrieron en un equipo de 16 núcleos con Linux 7.2.6, btrfs sobre NVMe y Node 24.20.0. Versiones: SQLite 3.53.4 (incluida en Node), `better-sqlite3` 13.0.3, `libsql` 0.5.29 y Ajv 8.20.0. Del lado de Fastify: Fastify 5.12.7, `@fastify/sse` 0.6.1, `@fastify/multipart` 10.1.4 y `@fastify/static` 10.1.6. Los guiones viven fuera del repositorio. Las cifras de un equipo no sustituyen el banco de §7.11. Valen como orden de magnitud y como prueba de que un comportamiento ocurre.

| Marca | Medición |
|---|---|
| M1 | Tres controladores SQLite, tres corridas con 100.000 filas por operación |
| M2 | Cuatro procesos sobre un archivo: dos reclaman, uno lee, uno lee y escribe; 5 s, 20.000 trabajos |
| M3 | Respaldo en caliente de una base de 41 MB con un escritor activo |
| M4 | SSE con reposición, esquemas de respuesta, Ajv, estáticos y subida multipart de 500 MB |
| M5 | Cierre de Fastify con un flujo SSE abierto |
| M6 | `PRAGMA data_version` como aviso entre procesos |
| M7 | Ejecutor de migraciones con dos procesos que arrancan a la vez |
| M8 | `synchronous` FULL contra NORMAL |

## 2. `node:sqlite`

### 2.1 Estado de estabilidad

Las documentaciones de Node 26.12 y de Node 24.22 marcan el módulo como «Stability: 1.2 - Release candidate» [F1, F2]. La rama 24 lo recibió en v24.15.0 y la 25 en v25.7.0. Salió de la bandera `--experimental-sqlite` en v22.13.0 y v23.4.0, aún como experimental. En Node 24.20.0, `require('node:sqlite')` no imprimió advertencia [M1]. Exporta `DatabaseSync`, `StatementSync`, `Session`, `constants` y `backup`. La documentación de Node 26 declara obsoletos esos alias a favor de `Database` y `Statement`.

Node 24 pasa a mantenimiento el 2026-10-20 y termina su soporte el 2028-04-30. Node 26 será LTS desde el 2026-10-28 [F3]. La página «previous releases» muestra «Oct 14, 2026» para v24, en una columna rotulada «Last updated». Se descarta a favor de `schedule.json`, de donde sale la tabla.

Las opciones que el proyecto usa existen en Node 24:

| Dato | Valor | Fuente |
|---|---|---|
| Nivel de estabilidad | 1.2, release candidate | F1, F2 |
| `timeout` (busy timeout) | opción desde v24.0.0; omisión 0 ms | F1, M1 |
| `defensive` | opción desde v24.12.0; activa por omisión desde v24.14.0 | F1, F2 |
| `sqlite.backup()` | desde v23.8.0 | F1 |
| `foreign_keys` por omisión | activado | F1, M1 |
| `synchronous` por omisión | 2 (FULL) | M1 |
| SQLite incluido en Node 24.20.0 | 3.53.4 | M1 |
| Última versión de SQLite | 3.54.1, 2026-10-16 | F11 |

`Session` (`createSession`, `applyChangeset`, v23.3.0) registra cambios de una tabla como un changeset aplicable en otra base. El módulo se compiló con `ENABLE_SESSION` [M1]. La cola y el respaldo no lo necesitan.

SQLite publicó un error de reinicio de WAL en las versiones 3.7.0 a 3.51.2. Dos conexiones que escriben o hacen checkpoint a la vez pueden corromper la base. Quedó corregido en 3.51.3 (2026-03-13) y en los parches 3.44.6 y 3.50.7 [F4]. La probabilidad es muy baja, pero el proyecto tiene ese perfil: un proceso API y un proceso worker que escriben. El paquete debe exigir Node `>=24.15` y comprobar `sqlite_version() >= 3.51.3` al arrancar.

### 2.2 Rendimiento contra `better-sqlite3` y `libsql`

Dos fuentes de 2026 miden. El issue 1522 de `better-sqlite3` (2026-09-15, Node 26.8.2) mide una fila: 115.544 contra 112.696 operaciones por segundo, a favor de `better-sqlite3`. En lecturas de 100 filas da 36.904 contra 23.015. Las inserciones empatan [F13]. El issue 60719 de Node mide una caída de 57 % en lecturas de un módulo SQLite nativo entre Node 20 y Node 24.11.1. Lo atribuye a la conversión de cadenas hacia C++ tras actualizar V8 [F12]. Ese issue no trata de `node:sqlite` y sigue abierto. Un participante midió esa conversión unas 4 veces más rápida en Node 26.5.0 que en 24.18.0.

M1 repite la comparación con una tabla de trabajos, `synchronous=NORMAL` y Node 24.20.0. Mediana de tres corridas, en milisegundos (menos es mejor):

| Operación | `node:sqlite` | `better-sqlite3` | `libsql` |
|---|---|---|---|
| 100.000 inserciones en una transacción | 150 | 150 | 294 |
| 5.000 inserciones con commit individual | 508 | 449 | 522 |
| 100.000 lecturas por clave primaria | 206 | 165 | 358 |
| 2.000 lecturas de 100 filas | 146 | 62 | 225 |
| 20.000 reclamos `UPDATE … RETURNING` | 459 | 388 | 389 |
| 5.000 cierres con commit individual | 832 | 812 | 879 |

La brecha aparece donde el módulo materializa muchas filas: 2,4 veces en lecturas de 100 filas. Coincide en dirección con el issue 1522. En inserción y reclamo desaparece. Un reclamo cuesta unos 23 µs (43.600 por segundo), muy por encima de lo que necesita un equipo de 10 personas. `libsql` rinde la mitad en escritura en lote y lectura.

Contradicción declarada: un artículo de la comunidad afirma que ambos rinden igual porque enlazan el mismo motor, y no publica cifras. Los dos issues y M1 muestran brecha en lecturas voluminosas. La cola lee una fila por consulta, así que la brecha no pesa. La ventaja de `node:sqlite` es no compilar un módulo nativo por arquitectura. `libsql` se descarta: su README dice que está «activamente mantenida» pero que las funciones nuevas se desarrollan en Turso [F37].

### 2.3 WAL, `busy_timeout` y concurrencia entre procesos

WAL admite un escritor a la vez. Los lectores no bloquean al escritor ni son bloqueados por él. Todos los procesos deben estar en el mismo anfitrión, porque el índice WAL es un archivo mapeado en memoria junto a la base. No funciona sobre sistemas de archivos de red [F4]. El checkpoint corre al llegar a 1.000 páginas (unos 4 MB). Un lector que nunca termina impide reiniciar el WAL y el archivo crece sin tope. El volumen `/data` debe ser disco local.

El `busy_timeout` por omisión de `node:sqlite` es 0 [F1, M1], y SQLite no instala manejador de ocupado salvo que se pida [F8]. `better-sqlite3` usa 5.000 ms [F42] y el ejemplo de `walq` también [F16]. Tener manejador no implica que se invoque: si SQLite detecta riesgo de bloqueo mutuo, devuelve `SQLITE_BUSY` de inmediato [F8]. El caso típico es una transacción diferida que lee y luego escribe, cuando otra conexión ya escribió. El ascenso falla con `SQLITE_BUSY` [F6]. `BEGIN IMMEDIATE` toma el bloqueo de escritura al empezar, donde el manejador sí espera [F6].

M2 lo reproduce con cuatro procesos. Dos workers reclaman con una sola sentencia, uno lee, y un proceso API abre una transacción, lee y escribe.

| Configuración | Workers: reclamos / `SQLITE_BUSY` | Proceso API: operaciones / `SQLITE_BUSY` | Reclamos duplicados |
|---|---|---|---|
| `busy_timeout` 0, `BEGIN` diferido | 13.780 / 19.040 | 26.866 / 769.006 | 0 |
| `busy_timeout` 5.000, `BEGIN` diferido | 7.291 / 0 | 1.045.144 / 202.359 | 0 |
| `busy_timeout` 5.000, `BEGIN IMMEDIATE` | 13.768 / 0 | 21.752 / 0 | 0 |

Con 0 fallan todos los escritores. Con 5.000 los workers no fallan, porque su sentencia única no asciende. La transacción diferida sigue fallando en el 16 % de sus intentos. Con `BEGIN IMMEDIATE` y 5.000 no hubo errores. `PRAGMA integrity_check` devolvió `ok` en las tres corridas.

`DatabaseSync` es síncrono y bloquea el bucle de eventos mientras espera el candado. La espera máxima observada fue 930 ms con tres escritores saturando la base, una carga de estrés. Con transacciones cortas, la espera es de milisegundos. Ninguna llamada a un proveedor de modelo ocurre dentro de una transacción.

`synchronous` en WAL: NORMAL no corrompe, pero una transacción confirmada puede perderse si cae el sistema. FULL es durable [F7]. M8 midió 131 confirmaciones por segundo con FULL y 28.529 con NORMAL. Las librerías discrepan: `liteque` usa NORMAL [F19] y `walq` usa FULL [F16]. Un equipo de 10 personas escribe decenas de filas por input. `POST /inputs` responde con un id, y esa fila no puede desaparecer con una caída del anfitrión. Se recomienda FULL.

### 2.4 Respaldo en caliente

`sqlite.backup(origen, ruta, {rate, progress})` devuelve una promesa y copia 100 páginas por paso [F1]. SQLite advierte que una escritura de otra conexión durante la copia la reinicia, y que con escrituras frecuentes puede no terminar nunca. Nombra `VACUUM INTO` como alternativa que copia una base en uso [F9]. El destino debe estar vacío o no existir. Una caída durante la ejecución puede dejar un archivo incompleto [F10].

M3, con 41 MB y un proceso escribiendo sin pausa:

| Método | Tiempo | Observación |
|---|---|---|
| `backup()`, `rate` 100 | 3.832 ms | 4.663 llamadas de progreso para unas 106 pasadas: se reinició decenas de veces |
| `VACUUM INTO` | 123 a 129 ms | Instantánea consistente en una sentencia |
| Escritor solo | 581 filas en 4 s | Línea base |
| Escritor durante `backup()` | 525 filas en 4 s | Sin degradación apreciable |

Ambas copias pasaron `integrity_check` con 200.525 filas. Se recomienda `VACUUM INTO` a un archivo temporal seguido de `rename`, para el respaldo nocturno y antes de cada migración. Litestream replica WAL de forma continua hacia archivo o S3 como proceso aparte y se declara beta en su README [F36]. Queda fuera de la imagen y se documenta como opción externa. Copiar el archivo con `cp` mientras la API escribe puede dejar una copia inconsistente.

## 3. Cola de trabajos sobre SQLite

### 3.1 Reclamo atómico

§7.3 describe el reclamo como `UPDATE … LIMIT 1`. En `node:sqlite`, agregar `ORDER BY … LIMIT` da `near "order": syntax error`. SQLite solo lo admite si se compiló con `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` [F5, M1]. Tampoco existe `SKIP LOCKED`. La forma medida en M1 y M2 usa una subconsulta:

```sql
UPDATE jobs
   SET status = 'running', worker_id = :worker,
       lease_until = :now + :lease_ms, attempts = attempts + 1
 WHERE id = (SELECT id FROM jobs
              WHERE status = 'queued' AND run_at <= :now
              ORDER BY priority DESC, run_at, id
              LIMIT 1)
RETURNING id, kind, payload_json, attempts;
```

`RETURNING` existe desde SQLite 3.35.0. El orden de sus filas es indefinido, sin importancia con una sola fila [F5]. M2 ejercitó la sentencia con dos workers sin un solo duplicado. El índice `(status, priority DESC, run_at, id)` evita recorrer la tabla. Por qué SQLite toma el bloqueo de escritura antes de evaluar la subconsulta no está verificado en su documentación; el resultado sí está medido.

Dos reglas completan el patrón y las usan las implementaciones vivas. Primera, el cierre verifica el intento: `WHERE id=:id AND status='running' AND attempts=:n`. Un worker cuyo arriendo venció no puede cerrar el intento de otro. pg-boss lo llama «attempt fence» y lo compara con `retry_count` [F15]. `liteque` renueva un `allocationId` en cada reclamo [F19]. `walq` aborta la señal del trabajo al perder el arriendo [F16]. Segunda, toda transacción de varias sentencias empieza con `BEGIN IMMEDIATE`, como el reclamo de `liteque` [F19].

### 3.2 Qué hace pg-boss 12 y qué se traduce

pg-boss está en 12.38.0, con licencia MIT, 4.073 estrellas y último empuje el 2026-10-20. Pide Node 22.12 o superior y PostgreSQL 13 o superior [F14, F15]. Su `fetch` es un `UPDATE … RETURNING` sobre una selección con `FOR UPDATE OF j SKIP LOCKED` [F15].

| Opción de pg-boss | Omisión | Se traduce a |
|---|---|---|
| `retryLimit` | 2 (tres intentos) | `max_attempts` |
| `retryDelay` / `retryBackoff` | 0 s / `false`; con retroceso y sin retraso parte de 1 s | `run_at = now + retraso` con retroceso exponencial |
| `retryDelayMax` | sin tope | tope explícito |
| `expireInSeconds` | 900 s (rango 1 a 86.400) | tiempo máximo de ejecución por tipo |
| `heartbeatSeconds` | desactivado; mínimo 10 s | renovar `lease_until` cada 10 s |
| `deleteAfterSeconds` | 7 días tras completar | retención de `job_events` y trabajos terminados |
| `priority`, `startAfter` | mayor primero; 0 | `priority DESC`, `run_at` |
| `singletonKey` | sin valor | `inputs.content_hash UNIQUE` (§1.3) |
| `localConcurrency` | 1 | perilla de concurrencia |
| `pollingIntervalSeconds` | 2 s; 30 s con LISTEN/NOTIFY | sondeo de `data_version` (5.3) |

Los estados de pg-boss son `created`, `retry`, `active`, `completed`, `cancelled` y `failed`. Un trabajo que falla pasa a `retry` si `retry_count < retry_limit`, y a `failed` si no [F15]. La tabla `jobs` del spec tiene `queued`, `running`, `done` y `failed`. Faltan `cancelled` (para `POST /inputs/:id/cancel`) y las columnas `max_attempts`, `worker_id` y `last_error`.

No se traducen cinco piezas. `SKIP LOCKED` sobra porque SQLite serializa escritores. `LISTEN/NOTIFY` no existe en SQLite. Las particiones y el mantenimiento por lotes sobran con decenas de filas. La cola de mensajes muertos se reemplaza por `status='failed'` con el error visible y un botón de reintento. Las políticas de cola, el cron y las dependencias entre trabajos quedan fuera de alcance.

### 3.3 Librerías vivas en 2026

Datos leídos del registro de npm y de la API de GitHub [F14 a F20]:

| Librería | Estrellas | Última versión (fecha) | Licencia | Controlador | Observación |
|---|---|---|---|---|---|
| `workmatic` | 8 | 1.2.0 (2026-09-07) | MIT en npm; GitHub no declara | `better-sqlite3` | Arriendo, retroceso, prioridad; creada 2026-01-20 |
| `plainjob` | 99 | 0.0.14 (2024-10-13) | MIT | `better-sqlite3` o `bun:sqlite` | 24 meses sin versión; sus cinco últimos commits son actualizaciones de dependencias |
| `walq` | 2 | 1.2.2 (2026-10-05) | Apache-2.0 | `node:sqlite` o `better-sqlite3` | Creada 2026-09-20; arriendo de 30 s renovado cada 10 s; jitter; deduplicación |
| `liteque` | 80 | 0.10.0 (2026-10-10) | MIT | `better-sqlite3` con Drizzle y Zod | Reclamo con `BEGIN IMMEDIATE`; la usa Karakeep |
| `@donothing/jobq` | sin dato | 1.2.0 (2024-05-06) | ISC | `sqlite3` | Inactiva |

§3 dice «8 estrellas o 3 años sin versión». Hoy `plainjob` lleva 2 años, y `liteque` y `walq` publicaron en octubre de 2026. La conclusión se mantiene por otras razones. De las librerías activas con licencia MIT (`workmatic` y `liteque`), ninguna usa `node:sqlite`. La única que lo usa, `walq`, tiene 2 estrellas, un mes de vida y licencia Apache-2.0, que UD-004 permite. Reclamo, arriendo y reintentos caben en un módulo de unas 100 líneas cuyo comportamiento ya se midió en M2. `walq` es la mejor referencia de diseño.

### 3.4 Reintentos, retroceso y recuperación

Un trabajo `analyze` llama a un proveedor con el SDK de Anthropic. El SDK reintenta 2 veces por omisión, con retroceso exponencial, los errores de conexión, 408, 409, 429 y 5xx. Respeta `retry-after` [F38, F39]. Si la cola también reintenta, los intentos se multiplican. La guía de AWS recomienda reintentar en un solo punto de la pila, con jitter y solo operaciones idempotentes. Ilustra el riesgo con cinco capas de tres reintentos, que multiplican la carga 243 veces [F41]. Esa guía es de 2019 y excede los 12 meses del procedimiento. Se usa como principio; las cifras actuales vienen de [F38] y [F39].

Los trabajos deben ser idempotentes. `extract` sobrescribe `attachments.extracted_text` y `analyze` escribe una fila `proposals` por `input_id`. Un 429 por tope de gasto de la cuenta no trae `retry-after` y falla hasta que la cuenta se reactive [F39]. Ese trabajo pasa a `failed` con el motivo visible. El límite de Groq para `whisper-large-v3-turbo` es de 20 peticiones por minuto, 2.000 por día y 7.200 segundos de audio por hora [F40]. El límite horario no se resuelve con reintentos de segundos.

Retroceso: el retraso del intento *n* es `min(tope, base × 2^(n-1))` con jitter. `walq` resta al retraso una fracción aleatoria de hasta `jitter`, entre 0 y 1 [F16].

Recuperación: `walq` recupera arriendos vencidos en el siguiente reclamo y cuenta cada reclamo como intento, aunque el manejador no haya empezado [F16]. `liteque` incluye en la consulta de reclamo los `running` con `expireAt` vencido [F19]. §4, punto 3, pide retomar los trabajos con arriendo vencido. Basta agregar `OR (status='running' AND lease_until < :now)` a la subconsulta y un barrido al arrancar que marque `failed` los que agotaron intentos. Un apagado ordenado devuelve los trabajos en curso a `queued` y reembolsa el intento, como `refundRetry` en `liteque` [F19].

## 4. Worker en el mismo proceso o en uno aparte

Karakeep, una aplicación web con workers y cola SQLite en una sola imagen, corre dos procesos de Node bajo s6-overlay: `svc-web` (`node server.js`) y `svc-workers` (`node dist/index.js`). Ambos dependen de `init-db-migration`, un servicio de una sola ejecución que migra la base antes de que arranque cualquiera [F21]. pg-boss y `walq` corren los workers dentro del proceso de la aplicación y ofrecen cierre explícito (`stop()`, `worker.close()`). `walq` puede mover SQLite a un hilo dedicado con `worker: true`, verificado solo en Node [F15, F16].

Hay dos patrones vivos y el mismo código de cola sirve a ambos. La exclusión la pone SQLite, no el proceso (M2: cuatro procesos, cero duplicados). §7.3 adopta lo correcto: `inline` por omisión y `node src/worker.js` opcional. Falta declarar el arranque.

En M7, dos procesos que migran a la vez aplicaron cada migración una sola vez. Cada uno hace `BEGIN IMMEDIATE`, lee `user_version` dentro de la transacción y salta lo aplicado. Pero `PRAGMA journal_mode=WAL` ejecutado por ambos al crear la base falló con «database is locked» en 2 de 20 arranques, con `busy_timeout` de 5.000. Leer el modo actual y fijarlo solo si no es WAL, con un reintento corto, dejó 0 fallos en 20. La forma sin reintento es la de Karakeep: un paso de inicialización que corre una vez antes de la API y del worker.

Apagado. Docker envía SIGTERM y mata con SIGKILL a los 10 s por omisión [F32]. Un Node como PID 1 no trae manejadores de señal por omisión: hay que declarar `process.on('SIGTERM')` y usar el formato exec en `CMD`. Blogs de 2026 recomiendan además `init: true` (tini), fuente secundaria [F45]. Fastify 5 tiene `forceCloseConnections: "idle"` por omisión, que cierra solo conexiones inactivas, y `return503OnClosing: true` [F24].

Un flujo SSE no está inactivo. M5 abrió un flujo y llamó a `app.close()`. Con la configuración por omisión no terminó en 8 s, y Docker habría matado el proceso a los 10 s. Con `forceCloseConnections: true`, o cerrando los flujos en el gancho `preClose`, terminó en 0 a 1 ms. Secuencia recomendada:

1. Recibir SIGTERM y dejar de reclamar.
2. Cerrar los flujos SSE.
3. Abortar los trabajos en curso con `AbortSignal` y enviar SIGTERM a `ffmpeg`.
4. Devolverlos a `queued` con reembolso del intento.
5. Llamar a `app.close()` y cerrar la base.

No hay espera por trabajos largos. Lo que no alcance a devolverse lo recupera el vencimiento del arriendo.

## 5. Progreso en vivo

### 5.1 SSE con Fastify 5

| Opción | Versión (fecha) | Licencia | Estrellas | Reposición |
|---|---|---|---|---|
| `@fastify/sse` | 0.6.1 (2026-10-08) | MIT | 28 | `reply.sse.replay(cb)` y `lastEventId`; siete versiones 0.x desde 2025-08-26; par `fastify ^5` |
| `fastify-sse-v2` | 4.2.2 (2026-01-27) | MIT | sin dato | No documentada en lo leído; par `fastify >=4`, compatibilidad con 5 sin verificar |
| `reply.raw` directo | no aplica | no aplica | no aplica | Propia, unas 30 líneas |

Fuente de la tabla: [F14, F22]. `@fastify/sse` responde 406 a `Accept: application/json` en rutas `sse: 'only'`. Envía por sí solo `content-type: text/event-stream`, `cache-control: no-cache` y `x-accel-buffering: no` [M4]. Su latido por omisión es de 30 s [F22].

El ejemplo de reposición del README usa un arreglo en memoria. El diseño de §7.10, reponer desde `job_events`, es correcto pero tiene una carrera. Un evento emitido entre la lectura de la base y el alta del suscriptor se pierde. M4 probó el orden que la evita: suscribirse y acumular, reponer `seq > Last-Event-ID` desde la base y vaciar lo acumulado descartando `seq <= último enviado`. Una reconexión con `Last-Event-ID: 2`, con dos eventos emitidos durante la conexión, entregó los eventos 3, 4 y 5. No hubo repetidos ni huecos.

El navegador reenvía `Last-Event-ID` solo si el último `id` recibido no está vacío. Su tiempo de reconexión por omisión es «de unos pocos segundos» y el servidor lo cambia con `retry:` [F27]. `EventSource` no admite cabeceras propias [F27, F28]. La sesión por cookie `HttpOnly` de §7.7 funciona sin cambios.

Límites. En HTTP/1.1 el navegador permite 6 conexiones por dominio, compartidas entre pestañas. Chrome y Firefox lo marcaron «Won't fix». En HTTP/2 el máximo negociado por omisión es 100 flujos [F28]. Un flujo por trabajo, como en §7.1, agota las 6 con tres inputs en dos pestañas. Se recomienda un flujo por miembro (`GET /events`) con un `job_events.id` autoincremental global como `Last-Event-ID`. `GET /jobs/:id/events` queda para clientes externos. Este diseño no se midió.

Proxies. nginx trae `proxy_buffering on` y `proxy_read_timeout 60s`, respeta `X-Accel-Buffering: no` y usa HTTP/1.1 hacia el origen desde la 1.29.7 [F29]. El estándar HTML sugiere un comentario cada 15 s para que proxies antiguos no corten la conexión [F27]. Se adopta 15 s. Cloudflare devuelve 524 tras 125 s sin respuesta del origen, y solo Enterprise lo amplía. Su página no trata el streaming [F30]. La documentación de `tailscale serve` tampoco describe streaming ni tiempos de espera [F31].

### 5.2 Contra WebSocket y sondeo largo

`@fastify/websocket` 11.3.4 (MIT, 467 estrellas, 2026-10-18) se mantiene [F43]. El flujo del proyecto es de un solo sentido, y la cancelación es un `POST`. WebSocket obliga a escribir a mano la reconexión y la reposición, que SSE resuelve con `id` y `Last-Event-ID`. Las comparativas generales coinciden en que el sondeo largo es el recurso para redes que cortan flujos; son blogs sin fecha verificable. Cloudflare recomienda sondeo de estado para procesos largos tras su proxy [F30]. Se mantiene SSE, con sondeo corto de `GET /inputs/:id` como degradación documentada.

### 5.3 Aviso entre procesos

Con el worker en otro proceso, la API no se entera de los `job_events` nuevos. SQLite no tiene equivalente de `LISTEN/NOTIFY`. `PRAGMA data_version` cambia cuando otra conexión, incluso de otro proceso, confirma una escritura. No cambia por las confirmaciones propias [F7]. M6 midió 1,15 µs por consulta. La latencia de detección es igual al intervalo de sondeo: mediana 11,1 ms con 10 ms y 50,3 ms con 50 ms. Con worker `inline` basta un `EventEmitter`.

## 6. Migraciones SQL sin ORM

| Herramienta | Estado | Licencia | Encaje |
|---|---|---|---|
| Ejecutor propio con `user_version` | 25 líneas, medido en M7 | MIT del proyecto | Sin dependencias |
| dbmate | 2.37.0 (2026-10-18), 7.470 estrellas | MIT | Binario Go, imagen o paquete npm. Archivos `NNN_nombre.sql` con `-- migrate:up` y `-- migrate:down`. Guarda solo la versión. Exige bloque `down` [F14, F33] |
| Atlas | 8.788 estrellas | Apache-2.0 | SQLite soportado; flujos declarativo y versionado. Costo de las funciones de Atlas Cloud sin verificar [F34] |
| drizzle-kit | repositorio con 36.102 estrellas | Apache-2.0 | `generate` emite SQL y `migrate` lo aplica. Su página no lista controladores SQLite ni `node:sqlite` [F35] |

`user_version` es un entero en el encabezado de la base que SQLite no usa [F7]. M7 comprobó tres propiedades. Un `ROLLBACK` lo revierte (quedó en 5 tras intentar 99). Una migración con error deja versión y esquema intactos. Dos procesos simultáneos aplican cada archivo una sola vez si leen la versión dentro de `BEGIN IMMEDIATE`. Existe `@gordonb/sqlite-migrate` sobre `node:sqlite`, solo hacia adelante, sin fecha verificada [F44].

Convención de las herramientas vivas: prefijo numérico, versión igual al prefijo, transacción por migración y rechazo si el orden se altera (`--strict` en dbmate [F33]). Se recomienda el ejecutor propio, solo hacia adelante, con un `VACUUM INTO` previo como vía de vuelta. Debe negarse a arrancar si `user_version` supera el último archivo. dbmate es la alternativa si el equipo prefiere una herramienta externa, a cambio de un binario más en la imagen.

## 7. Esquemas, archivos y panel en Fastify 5

### 7.1 Esquemas y salida del modelo

Fastify 5.12.7 usa Ajv 8 con `coerceTypes: 'array'`, `useDefaults: true`, `removeAdditional: true` y `allErrors: false`. Valida solo cuerpos `application/json`, salvo que el esquema declare `content` [F23]. Los esquemas de respuesta pasan por `fast-json-stringify`. La documentación los presenta como serialización rápida y protección contra filtraciones, y no dice que validen [F23].

M4: una ruta con esquema `{n: integer}` devolvió `{"n":12}` para `{n:"12", extra:"secreto"}`. Convierte y descarta. Respondió 500 con `"n" is required!` cuando faltaba el campo. Los esquemas de respuesta sirven al contrato de la API, no para aceptar o rechazar lo que devuelve un modelo. La salida del analizador se valida con una instancia propia de Ajv con `strict: true`, compilada una vez por plantilla y renovada según `templates.updated_at`. M4 devolvió errores por campo para `{"area_id":"x","messages":[]}` y `{ok:true}` para un caso válido. Esos errores son el contexto del único reintento de §7.5.

### 7.2 Archivos grandes con `@fastify/multipart`

La versión 10.1.4 fija `parts` en 1.000 y `fileSize` igual al `bodyLimit` de Fastify, 1 MiB por omisión. El analizador no pasa por `bodyLimit`, así que el total queda sin acotar salvo que se fijen `fieldSize`, `fields`, `files`, `parts` y `fileSize` [F24, F25]. Con `throwFileSizeLimit` activo por omisión, superar `fileSize` lanza `RequestFileTooLargeError`. Hay que consumir `part.file`, por ejemplo con `pipeline` hacia `createWriteStream`, o la promesa no se resuelve.

M4 subió 500 MB con `req.parts()`, `pipeline` a disco y un `sha256` calculado durante la escritura, con `fileSize` en 3 GiB. Tardó 1,3 s y el servidor quedó entre 134 y 165 MB de memoria. El adjunto se escribe a un temporal en `/data` y se renombra a su hash. La API de mensajes acepta 32 MB por petición y la de archivos 500 MB [F39]. Un adjunto mayor que 32 MB no viaja inline y pasa por el extractor a texto, como ya decide §5.

### 7.3 Panel de Vite con `@fastify/static`

La versión 10.1.6 sirve con ruta comodín por omisión. En M4 respondió `cache-control: public, max-age=0` con ETag débil. El README muestra `maxAge: '30d'` e `immutable: true` para activos con hash [F26]. Un panel de Vite necesita dos reglas: `/assets/*` con caché larga e inmutable, e `index.html` con `max-age=0`. Las rutas de la SPA se resuelven con `setNotFoundHandler` que entrega `index.html` solo a `GET` fuera de `/api`. En M4, `/mensajes/12` devolvió el HTML y `/api/nada` devolvió 404 JSON. `preCompressed` agrega `Vary: Accept-Encoding`. Sus rutas permitidas se evalúan contra la ruta pedida, no contra la variante comprimida [F26].

## 8. Contradicciones declaradas

| Tema | Fuente A | Fuente B | Motivo | Decisión |
|---|---|---|---|---|
| Rendimiento de `node:sqlite` | Artículo de la comunidad: igual que `better-sqlite3`, sin cifras | Issue 1522 y M1: 1,6 a 2,4 veces más lento en lecturas de 100 filas | Mismo motor, distinta materialización de filas | Se usa `node:sqlite`; el reclamo mueve una fila |
| `synchronous` | `liteque`: NORMAL | `walq`: FULL | NORMAL pierde durabilidad ante caída del sistema [F7] | FULL; M8 mide 131 confirmaciones por segundo |
| Fin de vida de Node 24 | nodejs.org: «Oct 14, 2026» bajo «Last updated» | `schedule.json`: mantenimiento 2026-10-20, fin 2028-04-30 | La tabla rotula otra cosa | Rige `schedule.json` |
| Librerías de cola | §3: «8 estrellas o 3 años sin versión» | Hoy: dos publicaron en octubre de 2026; `plainjob` lleva 24 meses | La nota del spec es anterior | Cola propia, por las razones de 3.3 |
| Regresión de Node 24 | Issue 60719: 57 % más lento | M1 en 24.20.0: paridad entre `node:sqlite` y `better-sqlite3` en reclamo | El issue mide un módulo nativo y la conversión de cadenas | Si `node:sqlite` la hereda, sin verificar |
| Reposición SSE | README de `@fastify/sse`: arreglo en memoria | §7.10: desde `job_events` | Ejemplo contra diseño | Rige §7.10, suscribiendo primero |

## 9. Sin verificar

El cierre de flujos SSE por Cloudflare y por `tailscale serve`. La compatibilidad de `fastify-sse-v2` con Fastify 5. Si `node:sqlite` hereda la regresión de conversión de cadenas de Node 24. El comportamiento de WAL con dos contenedores sobre un volumen compartido en Docker Desktop (SQLite exige el mismo anfitrión [F4]). La licencia efectiva de `workmatic` (npm dice MIT, GitHub no declara ninguna). El costo de Atlas Cloud. El uso de tini frente a manejadores propios (solo blogs). El límite de tamaño de audio de Groq (su página de límites no lo trata).

## 10. Fuentes

Todas consultadas el 2026-10-20.

| Id | Fuente | URL |
|---|---|---|
| F1 | Node.js 26.12, `node:sqlite` | https://nodejs.org/api/sqlite.html |
| F2 | Node.js 24.22, `node:sqlite` | https://nodejs.org/docs/latest-v24.x/api/sqlite.html |
| F3 | Calendario de versiones de Node | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json y https://nodejs.org/en/about/previous-releases |
| F4 | SQLite, WAL (actualizada 2026-08-25) | https://www.sqlite.org/wal.html |
| F5 | SQLite, RETURNING | https://www.sqlite.org/lang_returning.html |
| F6 | SQLite, transacciones | https://www.sqlite.org/lang_transaction.html |
| F7 | SQLite, pragmas | https://www.sqlite.org/pragma.html |
| F8 | SQLite, manejador de ocupado | https://www.sqlite.org/c3ref/busy_handler.html |
| F9 | SQLite, API de respaldo | https://www.sqlite.org/backup.html |
| F10 | SQLite, VACUUM INTO | https://www.sqlite.org/lang_vacuum.html |
| F11 | SQLite, versiones | https://www.sqlite.org/releaselog/current.html |
| F12 | Issue 60719 de Node.js (2025-11-14, comentarios hasta 2026-07) | https://github.com/nodejs/node/issues/60719 |
| F13 | Issue 1522 de better-sqlite3 (2026-09-15) | https://github.com/WiseLibs/better-sqlite3/issues/1522 |
| F14 | Registro de npm y API de GitHub (versiones, fechas, estrellas, licencias) | https://registry.npmjs.org/ y https://api.github.com/repos/ |
| F15 | pg-boss 12.38.0: sitio, API, repositorio y `src/plans.ts` | https://pgboss.io/ , https://pgboss.io/api/queues , https://pgboss.io/api/workers , https://pgboss.io/api/jobs , https://github.com/timgit/pg-boss |
| F16 | walq | https://github.com/unsady/walq |
| F17 | workmatic | https://github.com/litepacks/workmatic |
| F18 | plainjob | https://github.com/justplainstuff/plainjob |
| F19 | liteque | https://github.com/karakeep-app/liteque |
| F20 | `@donothing/jobq` | https://registry.npmjs.org/@donothing/jobq |
| F21 | Karakeep, Dockerfile y servicios s6 | https://github.com/karakeep-app/karakeep/tree/main/docker |
| F22 | `@fastify/sse` y `fastify-sse-v2` | https://github.com/fastify/sse y https://registry.npmjs.org/fastify-sse-v2 |
| F23 | Fastify, validación y serialización | https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ |
| F24 | Fastify, servidor | https://fastify.dev/docs/latest/Reference/Server/ |
| F25 | `@fastify/multipart` 10.1.4 | https://registry.npmjs.org/@fastify/multipart |
| F26 | `@fastify/static` 10.1.6 | https://registry.npmjs.org/@fastify/static |
| F27 | WHATWG, eventos enviados por el servidor | https://html.spec.whatwg.org/multipage/server-sent-events.html |
| F28 | MDN, SSE (modificada 2026-09-03) | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events |
| F29 | nginx, módulo proxy | https://nginx.org/en/docs/http/ngx_http_proxy_module.html |
| F30 | Cloudflare, error 524 | https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/ |
| F31 | Tailscale Serve | https://tailscale.com/kb/1242/tailscale-serve |
| F32 | Docker, `container stop` | https://docs.docker.com/reference/cli/docker/container/stop/ |
| F33 | dbmate | https://github.com/amacneil/dbmate |
| F34 | Atlas | https://github.com/ariga/atlas |
| F35 | drizzle-kit | https://orm.drizzle.team/docs/kit-overview |
| F36 | Litestream | https://github.com/benbjohnson/litestream |
| F37 | libSQL | https://github.com/tursodatabase/libsql |
| F38 | SDK de Anthropic para TypeScript | https://platform.claude.com/docs/en/api/sdks/typescript |
| F39 | Errores de la API de Anthropic | https://platform.claude.com/docs/en/api/errors |
| F40 | Límites de Groq | https://console.groq.com/docs/rate-limits |
| F41 | AWS Builders' Library, reintentos y jitter (2019, fuera de los 12 meses) | https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter |
| F42 | better-sqlite3, API | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md |
| F43 | `@fastify/websocket` | https://github.com/fastify/fastify-websocket |
| F44 | `@gordonb/sqlite-migrate` | https://jsr.io/@gordonb/sqlite-migrate |
| F45 | Señales y tini en Docker, blogs de 2026 (secundaria) | https://oneuptime.com/blog/post/2026-01-16-docker-graceful-shutdown-signals/markdown |

## 11. Recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Mantener `node:sqlite`; exigir Node `>=24.15` y SQLite `>=3.51.3` al arrancar | Release candidate desde 24.15.0; 3.53.4 incluido; error de WAL corregido en 3.51.3 | F1, F2, F4, M1; 2026-10-20 |
| Reemplazar `UPDATE … LIMIT 1` de §7.3 por `UPDATE … WHERE id=(SELECT … LIMIT 1) RETURNING` | `ORDER BY` y `LIMIT` en `UPDATE` dan error de sintaxis; orden de `RETURNING` indefinido | F5, M1; 2026-10-20 |
| `busy_timeout` de 5.000 ms y `BEGIN IMMEDIATE` en toda transacción que lee y escribe | 0 errores con ambos; 16 % de fallos solo con el tiempo de espera | F6, F8, M2; 2026-10-20 |
| Barrera de intento al cerrar y latido que renueva el arriendo | pg-boss, `liteque` y `walq` la implementan | F15, F16, F19; 2026-10-20 |
| Agregar `cancelled`, `max_attempts`, `worker_id`, `last_error` a `jobs` y el índice `(status, priority DESC, run_at, id)` | Estados de pg-boss; reclamo de 23 µs con índice | F15, M1; 2026-10-20 |
| Cola propia en un módulo; `walq` y `liteque` solo como referencia | Ninguna librería MIT activa usa `node:sqlite`; `walq` tiene 2 estrellas y un mes | F14 a F19; 2026-10-20 |
| `synchronous=FULL` | 131 confirmaciones por segundo bastan; NORMAL puede perder confirmaciones | F7, M8; 2026-10-20 |
| Respaldo con `VACUUM INTO` y `rename`, no `backup()` ni `cp` | 123 ms contra 3.832 ms con escritor activo; copias íntegras | F9, F10, M3; 2026-10-20 |
| Paso de inicialización único antes de API y worker; fijar WAL solo si no lo está | 2 de 20 arranques simultáneos fallan al fijar WAL; patrón de Karakeep | F21, M7; 2026-10-20 |
| `forceCloseConnections: true` o cerrar flujos en `preClose` | `app.close()` no termina con un flujo SSE abierto | F24, M5; 2026-10-20 |
| `@fastify/sse` 0.6.1 con versión exacta; suscribir antes de reponer; latido de 15 s | Cero repetidos y cero huecos al reconectar; sugerencia del estándar | F22, F27, M4; 2026-10-20 |
| Un flujo SSE por miembro y no uno por trabajo | 6 conexiones por dominio en HTTP/1.1, compartidas entre pestañas | F28; 2026-09-03 |
| `PRAGMA data_version` como aviso con worker aparte | 1,15 µs por consulta; latencia igual al intervalo | F7, M6; 2026-10-20 |
| Validar la salida del modelo con Ajv propio, no con esquemas de respuesta | Fastify convierte tipos y descarta propiedades | F23, M4; 2026-10-20 |
| Fijar los cinco límites de `@fastify/multipart` y escribir a disco con `pipeline` | `fileSize` por omisión es 1 MiB; 500 MB en 1,3 s | F25, M4; 2026-10-20 |
| `maxAge` largo e `immutable` en `/assets`; `max-age=0` en `index.html` | Omisión `max-age=0` | F26, M4; 2026-10-20 |
| Ejecutor de migraciones propio con `user_version`, solo hacia adelante | Transaccional; una aplicación por archivo con dos procesos | F7, M7; 2026-10-20 |

## 12. Perillas

- `lease_ms`: 30.000, con latido cada 10.000 (`heartbeat_ms`). `walq` usa 30 s y 10 s [F16]; el mínimo de latido de pg-boss es 10 s [F15]. Un worker caído se recupera en 30 s como máximo.
- `max_runtime_ms` por tipo de trabajo: 900.000 por omisión. Es el `expireInSeconds` de pg-boss (900 s) [F15]. El banco §7.11 lo ajusta por tipo.
- `max_attempts`: 3, primer intento más 2 reintentos. Es el `retryLimit` de pg-boss [F15] y coincide con el `maxRetries` del SDK de Anthropic [F38]. El peor caso son 9 llamadas al proveedor. AWS recomienda un solo punto de reintento [F41]. Si el banco muestra 429 en cadena, se baja `maxRetries` del SDK a 0 y el retroceso queda en la cola. Un 429 sin `retry-after` falla sin reintentar [F39].
- `retry_base_ms`: 1.000, con retroceso exponencial y jitter. pg-boss parte de 1 s [F15]; el jitter es el de `walq` [F16].
- `retry_max_ms`: 60.000. Derivado del límite por minuto de Groq, 20 peticiones [F40]. No hay otra fuente.
- `concurrency`: 1 trabajo a la vez, el valor por omisión de pg-boss, `walq` y `liteque` [F15, F16, F19]. Era la única perilla cuyo valor era convención. El 2026-10-21 se midió y quedó en 3 (`docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md`).
- `busy_timeout_ms`: 5.000, el valor de `better-sqlite3` y del ejemplo de `walq` [F42, F16]. M2 midió 0 errores contra 19.040 con 0.
- `synchronous`: `FULL` [M1, M8]. `NORMAL` solo si el banco sostiene más de 100 confirmaciones por segundo.
- `wal_autocheckpoint`: 1.000 páginas, la omisión de SQLite [F4].
- `sse_heartbeat_ms`: 15.000 [F27].
- `job_events_retention_days`: 7, igual que `deleteAfterSeconds` de pg-boss [F15]. Aplica a `job_events` y a trabajos terminados.
- `data_version_poll_ms`: 100 con worker aparte; no existe con worker `inline`. La latencia mediana medida es el propio intervalo y el costo es 1,15 µs por consulta [M6]. El valor es elegido, no derivado: lo fija el banco §7.11 contra el tiempo percibido del progreso.
- `upload_max_bytes`: sin valor propio medido. El techo por adjunto lo da la API de archivos, 500 MB [F39], y debe fijarse en `@fastify/multipart` junto con `files`, `fields`, `fieldSize` y `parts`.
- Apagado: sin espera de trabajos; se abortan y vuelven a la cola con reembolso del intento. `stop_grace_period` queda en la omisión de Docker, 10 s [F32].
