# Gestión de proveedores y claves de API en octubre de 2026

Consultado el 2026-10-21. Las referencias entre corchetes remiten a la tabla de fuentes del final. Las fuentes web se abrieron ese día; las del proyecto anterior del autor (prefijo D) son archivos leídos ese día en `/home/kirlts/devalis`, sin modificar. «Sin verificar» marca lo que no tiene fuente primaria abierta. El buscador sólo devuelve resultados de Estados Unidos. Ninguna credencial ni valor de secreto figura en este informe.

Alimenta una decisión sobre la pantalla Configuración de team-platform (panel React, API Fastify, SQLite, tres ranuras de modelo: Texto, Visión, Transcripción; proveedores `anthropic`, `groq-speech` y `openai-compatible`). Hoy las claves viven sólo en variables de entorno y la pantalla no permite verlas, reemplazarlas, retirarlas ni diagnosticarlas. Se evalúa: estado por proveedor con últimos cuatro caracteres y funciones que lo usan, alta de proveedor compatible, reemplazo con prueba previa, retiro con bloqueo por dependencia, cambio de proveedor o modelo con prueba y reversión, diagnóstico clasificado y cifrado en reposo con AES-256-GCM.

## 1. Resumen

El proyecto anterior (Devalis) resolvió el mismo problema en la pestaña Modelos de su consola de operaciones. Prueba la llave con una petición de un token antes de guardarla, la guarda cifrada con AES-256-GCM, muestra los últimos cuatro caracteres, quién la puso y desde qué IP, y ofrece un desplegable de modelos que respondieron. Su diseño tiene tres carencias que este informe recomienda no repetir: no hay retiro sin volver al entorno, no hay bloqueo cuando una función depende de la llave, y la clave de cifrado sale de una variable de entorno sin generación en el primer arranque [D1][D2].

Los productos de referencia coinciden en tres puntos. La prueba ocurre al guardar (n8n, Vercel AI Gateway) o a pedido con una llamada mínima y modelo barato (Vercel, LiteLLM con 16 tokens y plazo de 60 s por defecto) [W12][W18][W19]. El valor de una llave no se vuelve a mostrar después de crearla (OpenRouter para llaves de gestión) [W9]. Las credenciales se cifran en la base con una clave aparte que, si se pierde o cambia sin procedimiento, vuelve ilegibles los datos (n8n, LiteLLM, Langfuse) [W13][W15][W17].

La clasificación de errores se apoya en códigos HTTP que los cuatro proveedores consultados declaran de forma casi idéntica: 401 y 403 para credencial, 402 para saldo, 429 para límite de tasa o cuota, 404 para recurso inexistente y 5xx o 504 para fallo del proveedor [W1][W3][W5][W7][W8]. Dos excepciones obligan a mirar el cuerpo además del código: OpenAI y Anthropic usan 429 tanto para límite de tasa como para cuota agotada, y Anthropic devuelve 400 cuando se alcanza un límite de gasto configurado por el usuario [W1][W7].

En cifrado, OWASP exige AES de 256 bits en modo autenticado, vector de inicialización único por operación y claves de datos separadas de las que protegen claves; NIST SP 800-38D limita a 2^32 las invocaciones por clave cuando el vector es aleatorio de 96 bits [W20][W22]. Para una base SQLite con decenas de claves, el límite no es alcanzable; el riesgo práctico es perder la clave maestra.

## 2. El proyecto anterior: Devalis

### 2.1 Dónde vive

Las claves de los proveedores de modelo se gestionan en la consola de operaciones, pestaña Sistema › Modelos (`plataforma/ops-console/src/pages/sistema/tabs/modelos.tsx`, 706 líneas). El servidor está en `plataforma/src/features/admin/llaves-routes.js` (641 líneas) y el cifrado en `plataforma/src/lib/llaves-cifradas.js` (65 líneas) [D1][D2][D3]. Fuera de la consola, `tools/accesos.py` (945 líneas) prueba en vivo el acceso a cada servicio externo y `plataforma/scripts/rotar-secreto.sh` rota secretos del entorno de producción [D4][D5].

### 2.2 Flujo en la pantalla

La tabla de la pestaña tiene dos filas fijas, «Principal» y «Alternativo (respaldo)». Cada una muestra el servicio con su dirección, una insignia con `···` más los últimos cuatro caracteres (o «sin llave», o «del entorno» si la llave viene del gestor de secretos), el modelo, el origen y la fecha de vigencia [D1]. El origen dice quién puso la llave: el nombre y correo de la persona con la IP de origen, o «una sesión de IA» con el nombre que la sesión declaró. La decisión es de 2026-09-24 y consta en el comentario del código [D1].

Un botón «Volver al entorno» aparece sólo cuando hay una llave puesta desde la consola y existe otra en el entorno a la que volver. El código lo justifica así: un botón que deja la plataforma sin modelo es una trampa [D1]. En el servidor, `DELETE /llaves-del-modelo/:proveedor` responde 409 si se intenta borrar la del principal sin llave de entorno [D2].

El reemplazo está en una sección plegada «Reemplazar una llave», con cuatro campos: espacio, proveedor (desplegable de tres servicios), llave nueva y modelo (desplegable con los modelos que respondieron, más un botón «Actualizar»). El botón «Comprobar y reemplazar» lista lo que falta cuando está inhabilitado [D1]. Un aviso en rojo aparece cuando un proveedor queda sin saldo o rechaza llamadas, y una tarjeta por proveedor muestra saldo declarado, última respuesta HTTP y resultado de una sonda con latencia [D6].

### 2.3 Flujo en el servidor

`POST /llaves-del-modelo` prueba antes de guardar. La prueba es una petición de un token de salida con el modelo configurado, con plazo de 30 s (`pregunta-minima.js`) [D2][D7]. Resultados:

| Respuesta del proveedor | Acción de Devalis |
|---|---|
| 2xx | Guarda cifrada y registra en auditoría quién la puso |
| 429 o 402 | La trata como llave válida, la guarda y devuelve un aviso (cuota agotada, sin saldo) |
| 401 o 403 | Responde 422 con el nombre del servicio, el código y la causa en palabras; si la dirección venía vacía, prueba antes las rutas hermanas del mismo anfitrión |
| 400 o 404 con modelo elegido | Responde que el nombre de modelo no existe en ese proveedor |
| Fallo de red o plazo | Responde 502 «no contestó a tiempo» o «no respondió desde el servidor», sin el texto del error del intérprete |

La decisión de aceptar 429 y 402 nace de dos incidentes con fecha: el 2026-09-05 la consola rechazó la llave que había que dejar puesta mientras volvía el cupo, y el 2026-09-21 rechazó una llave de una cuenta recién abierta sin saldo [D2]. La decisión de probar rutas hermanas nace del 2026-09-24, cuando la misma llave dio 403 en una ruta y 200 en otra del mismo anfitrión [D2].

El mensaje de rechazo cita la respuesta del proveedor sin su JSON y recorta hasta 2.000 caracteres, porque la causa exacta suele aparecer pasada la posición 200 [D2][D7]. Un cuerpo que empieza con `<` (página de un intermediario) no se cita.

### 2.4 Lista de modelos

`GET /llaves-del-modelo/modelos` devuelve lo guardado en una tabla de comprobaciones por huella de llave, sin llamar al proveedor. `POST` con `actualizar: true` pide el catálogo al servicio y prueba cada candidato con una petición de un token, también con una imagen de 64 por 64 píxeles para saber si el modelo acepta visión. Sólo se ejecuta en producción, para que una pila de pruebas con la llave real no barra el catálogo cada vez que alguien abre la pantalla [D2][D3]. Cada modelo descartado conserva su código y motivo. El valor guardado aparece siempre en el desplegable, con la nota «No responde ahora» si no figura entre los que responden [D3].

### 2.5 Cifrado

`llaves-cifradas.js` usa `aes-256-gcm` de `node:crypto`, vector de 12 bytes aleatorio por cifrado, etiqueta de autenticación y cuerpo en base64 separados por puntos. La clave de 32 bytes se deriva con `scrypt` de la variable `CIFRADO_DE_LLAVES` (mínimo 16 caracteres) con una sal fija. Sin la variable, guardar falla en vez de escribir en claro. Un descifrado fallido devuelve `null` sin distinguir clave equivocada de dato alterado, y el sistema cae a la llave del entorno [D8]. No usa datos asociados (AAD) ni identificador de versión de clave, así que no hay rotación de la clave maestra sin recifrar todo a mano.

### 2.6 Rotación fuera de la consola

Los secretos del entorno de producción se rotan con `rotar-secreto.sh <nombre> --leer`, que guarda la versión nueva en el gestor de la nube y la recarga. `recargar-secretos.sh` tiene la opción `--solo-comprobar`, que compara huellas sin cambiar nada, hace copia previa del archivo de entorno y repone el anterior si la salud falla después de reiniciar [D5]. Las claves públicas de los widgets tienen `rotar-clave`, con fecha `claveRotadaEn` y corte de las sesiones abiertas [D9]. `accesos.py` no declara que un acceso funciona: lo intenta y muestra qué respondió, y sale con código distinto de cero si algo no cuadra [D4].

### 2.7 Qué funciona

La prueba previa a guardar evita el caso más frecuente, una llave mala que reemplaza a una buena. El mensaje de rechazo nombra quién rechazó (el proveedor, no la consola), porque un 403 sin contexto se leyó como un permiso denegado por la propia pantalla, malentendido documentado el 2026-09-05 [D2]. La insignia con los últimos cuatro caracteres basta para reconocer qué llave está puesta. La trazabilidad de quién y desde dónde respondió a un pedido textual del dueño del proyecto [D1]. El valor actual del modelo se muestra aunque ya no responda.

### 2.8 Qué es confuso o falta

Los espacios «Principal» y «Alternativo» no son funciones. El principal no guarda modelo propio y usa tres modelos por función; la celda decía «el que pida cada cosa que Deva hace» y el dueño la declaró incomprensible el 2026-10-11, por lo que hoy muestra los nombres reales [D1]. Para una app con ranuras por función, la tabla debe partir de la función.

Guardar y probar comparten un botón con el rótulo «Comprobar y reemplazar»; no hay una prueba sin guardar ni una prueba de la llave ya guardada, salvo el barrido de modelos. No hay retiro: sólo «Volver al entorno», y nada impide que una función quede sin llave si el entorno tiene una distinta o ninguna para el espacio alternativo. No se comprueba qué funciones dependen de una llave antes de borrarla [D2].

Existen dos fuentes de verdad, base y entorno, con precedencia implícita. El mensaje al volver al entorno («Hay que volver a mandar la llave del gestor de secretos») no explica qué ocurrió [D1]. La lista de modelos exige pulsar «Actualizar» y sólo funciona en producción; en cualquier otro entorno la pantalla dice «Sin comprobar» sin forma de comprobar. Aceptar 429 y 402 como éxito con aviso es correcto, pero el aviso sólo llega como notificación efímera, y el estado «configurada pero sin cupo» no persiste en la tabla salvo por la tarjeta de saldo [D1][D6]. No hay reversión del cambio de modelo con prueba: el modelo se cambia y se guarda sin comprobar que el nuevo responde antes de que lo use una conversación.

## 3. Productos de referencia en 2026

### 3.1 OpenRouter

Las llaves de gestión crean, listan (hasta 100 por página), actualizan y eliminan llaves por API en `/api/v1/keys`; una llave de uso corriente no sirve para eso. El valor de una llave de gestión se muestra una sola vez («no podrá volver a verla»). Cada llave puede llevar un límite de crédito con reinicio diario, semanal o mensual. La expiración se fija al crear y no se cambia: para extender el acceso se crea otra llave y se borra la anterior; tras expirar, las peticiones reciben 401 «API key expired» [W9]. `GET /api/v1/key` devuelve el límite, el saldo restante, el uso diario, semanal y mensual, `is_free_tier` y el presupuesto efectivo [W10].

### 3.2 LiteLLM

Las llaves virtuales se generan con `/key/generate` y la llave maestra; requieren Postgres. La rotación manual `/key/{key}/regenerate` (Enterprise) admite un `grace_period` (ejemplo `48h`) durante el cual la llave anterior sigue vigente; sin él se revoca de inmediato. La rotación programada usa `auto_rotate` e `rotation_interval` (ejemplo `30d`) [W11]. `GET /health` requiere llave y envía una petición real a cada modelo configurado, con `health_check_max_tokens` de 16 y `health_check_timeout` de 60 s por defecto. Con `background_health_checks: true` se ejecuta cada 300 s y `/health` devuelve el último resultado en caché; `health_check_details: false` oculta direcciones y errores [W12]. Las credenciales de proveedor en la base se cifran con `LITELLM_SALT_KEY`, que debe fijarse antes de agregar modelos y no debe cambiarse; si no existe se usa la llave maestra, lo que acopla rotar la maestra con perder las credenciales. El registro de gasto y el de auditoría no se cifran [W13]. Este último punto procede de un resumen del buscador sobre la página de preguntas de seguridad, no de la página abierta.

### 3.3 Langfuse

Una conexión LLM tiene nombre, proveedor, credencial y, en ajustes avanzados, dirección base y nombres de modelo adicionales. Una conexión de proyecto con el mismo nombre que una de organización la reemplaza, con el mismo adaptador. En la nube exige `https://` y bloquea direcciones privadas y de loopback; la dirección se valida al guardar o probar y otra vez en cada petición saliente [W14]. La página no documenta el cifrado ni si hay prueba al guardar. Según su guía de autoalojamiento, las credenciales LLM se cifran con `ENCRYPTION_KEY` de 256 bits (64 caracteres hexadecimales) y las llaves de API del proyecto se almacenan con hash y sal; la fuente es un resumen del buscador sobre esa guía [W15].

### 3.4 n8n

Al guardar una credencial, n8n ejecuta una prueba para confirmar que funciona [W18]. Cifra las credenciales en la base con `N8N_ENCRYPTION_KEY`; si no se declara, genera una al primer arranque y la guarda en la carpeta `.n8n`. En modo de cola debe fijarse igual en todos los trabajadores. La variable admite sufijo `_FILE` para leerla de un archivo. Una guía de rotación existe y su activación es unidireccional, con copia de seguridad previa recomendada [W16][W17]. Las páginas consultadas no dicen qué ocurre si la clave se pierde ni si el valor se oculta tras guardar.

### 3.5 Vercel AI Gateway

El alta de una credencial propia (BYOK) termina en «Test Key», que valida y agrega. Una prueba posterior desde el menú ejecuta una consulta pequeña con un modelo barato del proveedor y deja un modal con el código de la petición y el JSON crudo de la respuesta. Un interruptor «Enabled» activa o desactiva la credencial sin borrarla. Si una petición con la credencial propia falla, el gateway reintenta con las suyas, comportamiento que facturan aparte [W19]. La página es de 2026-09-22.

### 3.6 Cifrado en reposo: OWASP y NIST

OWASP recomienda AES de 128 bits como mínimo y 256 preferentemente, en modo autenticado con GCM como primera opción; exige que los vectores no se repitan entre instancias que comparten clave y que los genere la biblioteca; pide mantener independientes las claves de datos y las claves que protegen claves; y recomienda almacenar la clave separada de los datos, con permisos restringidos y sin variables de entorno cuando no haya un gestor de claves [W20]. Para la rotación: rotar ante sospecha de compromiso, fin del periodo criptográfico o cercanía a los límites del modo; preferir descifrar y recifrar todo, o etiquetar cada dato con el identificador de su clave y conservar varias; conservar las retiradas para respaldos; y probar el procedimiento antes de necesitarlo [W20]. La guía de gestión de secretos pide no registrar nunca secretos, auditar quién los usa y los cambios administrativos, y rotar de inmediato tras una exposición. No da pautas sobre cómo mostrarlos en una interfaz [W21].

NIST SP 800-38D (publicada en noviembre de 2007, en revisión) limita a 2^32 las invocaciones de cifrado autenticado por clave cuando el vector se genera al azar con 96 bits, contando todas las instancias que la comparten. Un artículo de 2024 cuestiona ese margen [W22]. La cifra procede de resultados del buscador que citan el texto; la página de NIST abierta ese día sólo confirmó título y fecha.

## 4. Clasificación de errores por proveedor

| Causa | Anthropic | OpenAI | DeepSeek | Groq | OpenRouter |
|---|---|---|---|---|---|
| Clave inválida | 401 `authentication_error` | 401 | 401 | 401 | 401 |
| Sin permiso | 403 `permission_error` | 403 (región no admitida) | n/d | 403 | 403 |
| Sin saldo o cuota | 402 `billing_error`; 429 al alcanzar el tope mensual; 400 al alcanzar un límite de gasto propio | 429 con `error.type` `insufficient_quota` y `error.code` como `credit_balance_exhausted` | 402 | n/d | 402 |
| Límite de tasa | 429 `rate_limit_error` | 429 `rate_limit_error`, a veces `slow_down` | 429 | 429; 498 en nivel flex | 429 |
| Modelo o recurso inexistente | 404 `not_found_error` | 404 (`NotFoundError` de la biblioteca) | n/d (422 por parámetros inválidos) | 404 | 400 (parámetro inválido) |
| Fallo del proveedor | 500 `api_error`; 529 sobrecarga | 500; 503 `server_is_overloaded` | 500; 503 | 500; 502; 503 | 502; 503 |
| Tiempo agotado | 504 `timeout_error` | n/d | n/d | n/d | 408 |

Fuentes: [W1][W3][W5][W7][W8]. La celda «n/d» significa que la página oficial no lo lista. Para el 404 de modelo inexistente en Anthropic, la página dice «recurso no encontrado» sin ejemplo específico de modelo; la fila es una inferencia. Devalis observó el 2026-10-11 que un servicio compatible respondía 400 «Endpoint is unavailable» a un nombre de modelo que otro día daba 200, por lo que su código trata 400 y 404 con modelo elegido como «modelo inexistente» [D2].

El cuerpo de error tiene forma conocida: Anthropic devuelve `type: "error"`, un objeto `error` con `type` y `message`, y `request_id` [W1]; OpenAI usa `error.type`, `error.code` y `error.param` [W7]; Groq y OpenRouter, `error.message` y `error.type` o `error.code` [W5][W8]. `Retry-After` puede acompañar a 429 y 503, y a 402 sólo cuando `metadata.limit_source` es `openrouter_in_flight_budget` [W8]. Un 429 de tope mensual de Anthropic no trae `retry-after` y persiste hasta que se levanta el tope [W1]. Los fallos de red (DNS, conexión rechazada, certificado) y el plazo agotado del cliente no producen código HTTP y deben clasificarse por la excepción local. Anthropic valida en sus bibliotecas que una petición no streaming no pase de 10 minutos [W1].

## 5. Endpoints de lista de modelos

| Proveedor | Petición | Campos útiles | Estado |
|---|---|---|---|
| Anthropic | `GET https://api.anthropic.com/v1/models` con `x-api-key` y `anthropic-version`; paginación `after_id`, `before_id`, `limit` (1 a 1000, por defecto 20) | `id`, `display_name`, `created_at`, `lifecycle` (`active`, `deprecated`, `retired`), `retires_at`, `max_input_tokens`, `max_tokens`, `capabilities` (incluye `image_input`, `pdf_input`, `structured_outputs`, `thinking`) | Abierto [W2] |
| DeepSeek | `GET /models` bajo `https://api.deepseek.com` | `id`, `object`, `owned_by`, `name`, `context_window`, `max_output_tokens`, `input_modalities`, `effort` | Abierto [W4] |
| Groq | `GET https://api.groq.com/openai/v1/models`; uno solo en `/models/{model}` | `id`, `object`, `created`, `owned_by`, `active`, `context_window` | Abierto [W6] |
| OpenAI | `GET /v1/models` | `id`, `object`, `created`, `owned_by` | Sin verificar: la página oficial devolvió 403 |
| OpenRouter | `GET /api/v1/models` | n/d | Sin verificar: la página devolvió 404 |

Sólo Anthropic expone capacidades por modelo (imagen, PDF) en la lista; en los demás, saber si un modelo acepta imágenes exige probarlo o consultar documentación, que es lo que hace Devalis con su imagen de 64 por 64 píxeles [D3]. Groq marca `active` en cada entrada. La lista de un proveedor compatible puede incluir modelos que no sirven para la función (embeddings, voz, moderación), así que una ranura de Texto necesita un filtro o una prueba.

## 6. Implicaciones para el diseño

1. Mostrar la pantalla partida por función (Texto, Visión, Transcripción), no por «principal y alternativo». Cada fila lleva proveedor, modelo, estado y últimos cuatro caracteres de la llave. La tabla de Devalis por espacio produjo una celda ilegible que el dueño debió corregir a mano el 2026-10-11 [D1].

2. Definir cuatro estados de la llave: sin clave, configurada, fallando y sin comprobar. «Configurada» exige una prueba exitosa registrada con fecha; «fallando» guarda la causa clasificada de la última prueba o de la última llamada real. Un estado sin fecha de comprobación no es falseable [D6][W12].

3. Guardar una llave nueva sólo después de una llamada mínima exitosa, con la anterior intacta hasta entonces; si falla, la anterior sigue activa y se muestra la causa. Vercel y n8n prueban al guardar, y Devalis evita sustituir una llave buena por una mala por el mismo orden [D2][W18][W19].

4. Aceptar una llave con 402 o 429 por cuota como «válida sin cupo», con estado propio y aviso persistente en la tabla, no sólo una notificación. Devalis lo adoptó tras dos incidentes en los que la prueba rechazaba justo la llave que había que dejar puesta [D2]. Excluir el 429 de límite de tasa transitorio como motivo para rechazar.

5. Distinguir 429 por tasa de 429 por cuota leyendo `error.type` y `error.code` en OpenAI y la presencia de `retry-after` en Anthropic; sin esa lectura, el diagnóstico confunde «espere un minuto» con «agregue saldo» [W1][W7][W8].

6. Clasificar la causa en seis categorías con una tabla de reglas única, ordenada por prioridad: excepción local de tiempo (tiempo agotado), excepción local de conexión (sin red), 401 o 403 (clave inválida), 402 o 429 con cuota (sin cuota), 429 restante (límite de tasa), 404 o 400 con nombre de modelo (modelo inexistente), 5xx y 504 (fallo del proveedor, fuera de la lista pedida pero indispensable para no culpar a la clave) [W1][W3][W5][W7][W8].

7. Mostrar el mensaje de rechazo nombrando quién rechazó y con qué código: «Anthropic respondió 401: la clave no es válida o fue revocada», no un 403 suelto. En Devalis un 403 sin contexto se leyó como un permiso denegado por la propia pantalla [D2]. Citar el motivo del proveedor recortado y sin su JSON, y no citar cuerpos que empiecen con `<` [D2].

8. Usar un plazo explícito en cada prueba de diagnóstico (30 s es el valor medido y declarado de Devalis; LiteLLM usa 60 s por defecto con 16 tokens) y registrar la duración en milisegundos, que es parte del resultado [D7][W12]. Declarar el plazo como configuración con valor por omisión, no como constante implícita.

9. Para la lista de modelos, llamar a `GET /models` del proveedor y guardar el resultado con fecha y huella de la llave, de modo que abrir la pantalla lea lo guardado y sólo el botón «Actualizar» llame al proveedor. Devalis lo hace así para que abrir la pantalla no genere llamadas ni costo [D2][D3]. Filtrar por función: en Visión conviene `image_input` donde el proveedor lo declare (Anthropic) y una prueba con imagen donde no [W2][D3].

10. Dejar visible el modelo guardado aunque ya no figure en la lista, con la nota «no responde», para que el campo nunca muestre algo distinto de lo guardado [D3]. Anthropic publica `lifecycle` y `retires_at`, que permiten avisar de un retiro programado antes de que la función falle [W2].

11. Bloquear el retiro de una llave cuando una función la usa, y listar las funciones afectadas en el mensaje de bloqueo. Devalis sólo protege el caso del principal sin entorno de respaldo y no cruza con las funciones, lo que deja una función apuntando a un proveedor sin llave [D2]. Ofrecer deshabilitar (interruptor «Enabled» de Vercel) como alternativa reversible al borrado [W19].

12. Cambiar el proveedor o modelo de una función en dos pasos: probar el candidato con una llamada mínima sin tocar la configuración vigente, aplicar sólo si pasa, y conservar el valor anterior durante la sesión para una reversión de un clic. LiteLLM y Vercel separan la prueba del almacenamiento; Devalis no tiene reversión y fue el vacío más claro de su diseño [D2][W12][W19].

13. Cifrar con AES-256-GCM, vector aleatorio de 96 bits por operación generado por la biblioteca, etiqueta de 128 bits y AAD que incluya el identificador del proveedor y de la ranura, de modo que un valor cifrado no pueda moverse de una fila a otra sin que falle la autenticación. Prefijar el texto cifrado con un número de versión de clave para permitir rotación con recifrado gradual. Devalis carece de AAD y de versión [D8][W20][W22].

14. Generar la clave maestra de 32 bytes con un generador criptográfico seguro en el primer arranque, guardarla en un archivo con permisos 600 fuera de la base y aceptar `SECRETS_KEY` que prevalece sobre el archivo. n8n sigue este patrón (clave aleatoria al primer arranque, variable para fijarla, sufijo `_FILE`); Devalis exige que el operador declare una variable y rechaza guardar sin ella [D8][W16][W17]. Con SQLite en un solo proceso, el límite de 2^32 cifrados por clave no es alcanzable, pero la pérdida de la clave sí: la documentación debe indicar que respaldar la base sin respaldar la clave hace ilegibles las llaves [W13][W15][W17].

15. Derivar de la clave maestra con HKDF y una etiqueta por propósito si más adelante se cifra algo más, y no reutilizar la misma clave para datos distintos. OWASP pide claves separadas por función [W20]. Mostrar al operador, en un mensaje claro, el caso «no se pudo descifrar con la clave de esta instalación», sin distinguir clave equivocada de dato alterado, como hace Devalis, pero con la acción siguiente (volver a ingresar la llave) [D8].

16. Registrar en auditoría quién cambió, retiró o probó una llave, desde qué IP y con qué resultado, sin guardar nunca el valor, ni siquiera parcial más allá de los últimos cuatro caracteres. OWASP exige auditar actualizaciones y acciones administrativas y no registrar secretos [W21]. Devalis ya guarda actor, acción y recurso y distingue persona de sesión de IA [D1][D2].

## 7. Fuentes

| Id | Fuente | Consulta |
|---|---|---|
| D1 | `/home/kirlts/devalis/plataforma/ops-console/src/pages/sistema/tabs/modelos.tsx` | 2026-10-21 |
| D2 | `/home/kirlts/devalis/plataforma/src/features/admin/llaves-routes.js` | 2026-10-21 |
| D3 | `/home/kirlts/devalis/plataforma/ops-console/src/pages/sistema/tabs/modelos-que-responden.tsx` | 2026-10-21 |
| D4 | `/home/kirlts/devalis/tools/accesos.py` | 2026-10-21 |
| D5 | `/home/kirlts/devalis/docs/DESPLIEGUE.md` (sección de rotación de secretos) | 2026-10-21 |
| D6 | `/home/kirlts/devalis/plataforma/ops-console/src/components/simulador/TarjetaDeProveedor.tsx` | 2026-10-21 |
| D7 | `/home/kirlts/devalis/plataforma/src/features/llm/pregunta-minima.js` y `familias.js` | 2026-10-21 |
| D8 | `/home/kirlts/devalis/plataforma/src/lib/llaves-cifradas.js` | 2026-10-21 |
| D9 | `/home/kirlts/devalis/docs/WIDGETS-WEB.md` (rotar clave) | 2026-10-21 |
| W1 | Anthropic, Claude API errors: https://platform.claude.com/docs/en/api/errors | 2026-10-21 |
| W2 | Anthropic, List Models: https://platform.claude.com/docs/en/api/models-list | 2026-10-21 |
| W3 | DeepSeek, Error Codes: https://api-docs.deepseek.com/quick_start/error_codes | 2026-10-21 |
| W4 | DeepSeek, List Models: https://api-docs.deepseek.com/api/list-models | 2026-10-21 |
| W5 | Groq, Error Codes: https://console.groq.com/docs/errors | 2026-10-21 |
| W6 | Groq, API Reference (models): https://console.groq.com/docs/api-reference#models-list | 2026-10-21 |
| W7 | OpenAI, Error codes: https://developers.openai.com/api/docs/guides/error-codes | 2026-10-21 |
| W8 | OpenRouter, Errors: https://openrouter.ai/docs/api-reference/errors | 2026-10-21 |
| W9 | OpenRouter, Management API keys: https://openrouter.ai/docs/guides/overview/auth/management-api-keys | 2026-10-21 |
| W10 | OpenRouter, Limits y `GET /api/v1/key`: https://openrouter.ai/docs/api-reference/limits | 2026-10-21 |
| W11 | LiteLLM, Virtual Keys: https://docs.litellm.ai/docs/proxy/virtual_keys | 2026-10-21 |
| W12 | LiteLLM, Health Checks: https://docs.litellm.ai/docs/proxy/health | 2026-10-21 |
| W13 | LiteLLM, Security encryption FAQ (por resumen del buscador): https://docs.litellm.ai/docs/proxy/security_encryption_faq | 2026-10-21 |
| W14 | Langfuse, LLM Connections: https://langfuse.com/docs/administration/llm-connection | 2026-10-21 |
| W15 | Langfuse, Encryption (por resumen del buscador): https://langfuse.com/self-hosting/configuration/encryption | 2026-10-21 |
| W16 | n8n, Deployment environment variables: https://docs.n8n.io/hosting/configuration/environment-variables/deployment/ | 2026-10-21 |
| W17 | n8n, Encryption key: https://docs.n8n.io/hosting/configuration/configuration-examples/encryption-key/ | 2026-10-21 |
| W18 | n8n, Add and edit credentials: https://docs.n8n.io/credentials/add-edit-credentials/ | 2026-10-21 |
| W19 | Vercel, BYOK en AI Gateway (actualizada 2026-09-22): https://vercel.com/docs/ai-gateway/authentication-and-byok/byok | 2026-10-21 |
| W20 | OWASP, Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html | 2026-10-21 |
| W21 | OWASP, Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html | 2026-10-21 |
| W22 | NIST, SP 800-38D (2007): https://csrc.nist.gov/pubs/sp/800/38/d/final; límite de 2^32 por resultados del buscador, no por la página | 2026-10-21 |
