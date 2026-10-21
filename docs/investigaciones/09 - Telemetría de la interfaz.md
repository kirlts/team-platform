# Telemetría de la interfaz en octubre de 2026

Consultado el 2026-10-21. El número entre corchetes remite a la tabla de fuentes del final; todas se abrieron ese día. Los pesos en KB y el prototipo de la sección 2.4 son mediciones propias del mismo día, con el método descrito allí. «Sin verificar» marca lo que no tiene fuente primaria abierta. El buscador sólo devuelve resultados de Estados Unidos. Una fuente de más de doce meses lleva su fecha a la vista.

Alimenta una decisión sobre cómo medir el uso del panel (React 19, API Fastify propia, SQLite, equipos de 2 a 15 personas, sin terceros, OpenTelemetry en el servidor con exportador propio a SQLite) sin capturar texto de personas, contenido ni nombres de archivo.

## 1. Resumen

El SDK de navegador de OpenTelemetry sigue siendo experimental. La página oficial de instalación lo declara «experimental y en gran parte sin especificar» [1], `@opentelemetry/sdk-trace-web` figura como obsoleto en npm desde la 2.7.1 (2026-04-29) [2] y la versión 3.0.0 de OpenTelemetry JS (2026-10-20) lo eliminó a favor de `@opentelemetry/sdk-trace` [3][4]. Las convenciones semánticas de navegador y de sesión están todas en estado «development» [6][7][8], y el repositorio de navegador dice que las propuestas para clic, navegación y tiempos de recursos se cerraron por inactividad [10]. Un módulo propio mínimo que mida con las API del navegador y envíe JSON validado cuesta 0,7 KB comprimidos en un prototipo medido; el SDK de trazas con exportador OTLP cuesta 16,3 KB y `web-vitals` 3,3 KB.

Las métricas vigentes tienen umbrales oficiales estables: LCP 2,5 s, INP 200 ms, CLS 0,1, al percentil 75 [11][12][13][14]. CLS, tareas largas y long-animation-frame sólo existen en Chromium; INP funciona también en Firefox y Safari [19][21]. Para fricción (rage clicks, dead clicks) no hay un umbral común: PostHog, LaunchDarkly y Conviva publican tres combinaciones distintas y Fullstory no publica la suya [22][24][25][27].

Para enviar al cerrar la página, `navigator.sendBeacon` no admite cabeceras propias y manda credenciales [32]. Un endpoint protegido por cabecera CSRF personalizada exige `fetch` con `keepalive`, cuyo tope es 64 KiB acumulados entre todas las solicitudes en vuelo [31][33]. El exportador OTLP de OpenTelemetry JS pasó a ese mecanismo y declaró obsoleto el de beacon [37].

En privacidad, el Comité Europeo de Protección de Datos (CEPD) considera que un script que manda al servidor información producida localmente cae bajo el artículo 5(3) de ePrivacy [39]. Los cinco productos de código abierto comparados nacen con la medición encendida una vez que el operador instala el código; ninguno exige consentimiento de la persona por omisión [40][41][42][43][44][45][46][47]. La autoridad francesa (CNIL) tiene una exención para medición de audiencia con condiciones concretas [40]; la conclusión de la sección 5 se apoya en ella.

## 2. Instrumentar la interfaz con OpenTelemetry

### 2.1 Estado de los paquetes

| Paquete | Versión y fecha en npm | Estado |
|---|---|---|
| `@opentelemetry/sdk-trace-web` | 2.12.0, 2026-10-06 | Obsoleto desde 2.7.1: «Use @opentelemetry/sdk-trace package» [2] |
| `@opentelemetry/sdk-trace` | 3.0.0, 2026-10-20 | Sustituye a sdk-trace-base, sdk-trace-node y sdk-trace-web [3][4] |
| `@opentelemetry/sdk-logs` | 3.0.0, 2026-10-20 | Marcado estable en esa versión [4] |
| `@opentelemetry/exporter-trace-otlp-http` | 0.300.0, 2026-10-20 | Experimental (0.x) [3] |
| `@opentelemetry/browser-instrumentation` | 0.8.2, 2026-10-10 | Experimental, rutas `./experimental/*`; puede romper en versiones menores [5][9] |
| `@opentelemetry/browser-sdk` | 0.5.0, 2026-10-10 | Experimental [5][9] |
| `@opentelemetry/instrumentation-user-interaction`, `-long-task`, `-document-load` | 0.68.0, 0.68.0 y 0.69.0, 2026-10-20 | Experimentales [3][9] |
| `@opentelemetry/instrumentation-fetch` | 0.300.0, 2026-10-20 | El repositorio de navegador lo lista como obsoleto [3][9]; el equipo de navegador pasa a instrumentaciones basadas en eventos (registros de log) [9][10] |

La versión 3.0.0 exige Node 22.15 o superior, elimina los subpaths `./platform/browser` y cambia el campo `browser` de `package.json` por `#platform`; webpack necesita 5.54 o más [4]. Un proyecto que hoy importe `sdk-trace-web` debe migrar antes de actualizar.

### 2.2 Convenciones semánticas

Todos los atributos `browser.*` del registro son «development» (11 atributos, entre ellos `browser.web_vital.*`) [7]. `session.id`, `session.previous_id` y los eventos `session.start` y `session.end` también [6]. La página general de eventos de semconv está en «Development» y no menciona eventos de navegador [8]. El documento del repositorio de navegador es más preciso: sólo `browser.web_vital` (development) y `exception` (estable) existen en semconv; las propuestas para `browser.navigation`, `browser.navigation_timing`, `browser.resource_timing` y `browser.user_action.click` se cerraron por inactividad, y los atributos que emiten las instrumentaciones sirven de definición provisional [10]. No existe un `user_action` estable.

La instrumentación experimental de clic registra coordenadas de página, nombre de etiqueta, selector CSS y los atributos `data-otel-*` del elemento, sin su texto (leído en el código de `@opentelemetry/browser-instrumentation` 0.8.2). Un selector CSS puede incluir `id` y clases, así que el panel tendría que revisar que no filtren contenido.

### 2.3 Peso y privacidad frente a un módulo propio

Método: esbuild 0.28.2, minificado, ESM, `gzip -9`, Node 24.20, 2026-10-21. Cada variante importa sólo lo que usa.

| Variante | Minificado | Comprimido |
|---|---|---|
| `@opentelemetry/sdk-trace` 3.0.0 con `TracerProvider`, `BatchSpanProcessor` y `OTLPTraceExporter` | 51,0 KB | 16,3 KB |
| `web-vitals` 6.2.3 con `onCLS`, `onINP` y `onLCP` | 8,3 KB | 3,3 KB |
| Módulo propio de prototipo (observadores de layout-shift, event, long-animation-frame y longtask, conteo de clics, errores, envío con `fetch` y `keepalive`) | 1,2 KB | 0,7 KB |

El README de `web-vitals` declara «~3K, brotli» [21], coherente con la medición. El prototipo no está validado ni probado en navegadores: sólo acota el orden de magnitud.

Un SDK de navegador resuelve contexto de traza y propagación hacia el servidor, que el panel puede obtener con una cabecera `traceparent` propia. A cambio, sus instrumentaciones son experimentales y cambian entre versiones menores [9], y su exportador espera un colector OTLP, no un endpoint con validación de esquema. Un módulo propio permite fijar qué campos existen (lista cerrada de nombres de evento, duraciones, contadores, cubos de tamaño de ventana) y rechazar en el servidor cualquier campo no declarado, y así el servidor descarta texto aunque el navegador lo envíe. Con un SDK, ese filtro depende de la configuración de cada instrumentación.

## 3. Métricas de experiencia en 2026

### 3.1 Umbrales oficiales

| Métrica | Bueno | Malo | Percentil | Fuente y fecha de la página |
|---|---|---|---|---|
| LCP | 2,5 s o menos | más de 4,0 s | 75, móvil y escritorio por separado | [14], 2025-09-04 |
| INP | 200 ms o menos | más de 500 ms | 75 | [12], 2025-09-02 |
| CLS | 0,1 o menos | más de 0,25 | 75 | [13], 2023-04-12 |

La página general de Core Web Vitals es del 2024-10-31 y fija el percentil 75 [11]. La página de CLS tiene más de doce meses; sus umbrales coinciden con los de las otras dos páginas más recientes, que usan el mismo percentil, y no hay una fuente posterior que los cambie. Se declara la edad de la fuente.

CLS se calcula en ventanas de sesión: los desplazamientos separados menos de 1 s forman una ráfaga con un máximo de 5 s, y el valor es la ráfaga mayor. Los desplazamientos con `hadRecentInput` (entrada discreta en los 500 ms previos) se excluyen [13][15].

### 3.2 API web de cada una y compatibilidad

| Medida | API | Chrome | Firefox | Safari | Estado en MDN |
|---|---|---|---|---|---|
| CLS | `PerformanceObserver` con tipo `layout-shift` | 77 | no | no | experimental, disponibilidad limitada [15][19] |
| Tareas largas (≥50 ms) | tipo `longtask` | 58 | no | no | experimental [17][19] |
| Long animation frame (≥50 ms) | tipo `long-animation-frame` | 123 | no | no | experimental [16][19] |
| INP y latencia de eventos | tipo `event` con `interactionId` | 96 | 144 | 26.2 | no experimental [18][19] |
| LCP | tipo `largest-contentful-paint` | ver [21] | ver [21] | ver [21] | `web-vitals` lo soporta en los tres [21] |

La columna de compatibilidad sale de `@mdn/browser-compat-data` 8.1.6 (publicada el 2026-10-15) [19]; las páginas de MDN que se abrieron no traían la tabla en el texto extraído. El README de `web-vitals` coincide: CLS sólo en Chromium, INP y LCP en Chromium, Firefox y Safari [21]. Event Timing reporta por omisión eventos de 104 ms o más, acepta un mínimo de 16 ms y redondea a 8 ms [18]. Una medición que no existe en un navegador debe guardarse como «no soportado» y no como cero.

La página de Total Blocking Time (2025-10-15) define tarea larga como más de 50 ms y dice que TBT es métrica de laboratorio; recomienda medir INP en campo [20]. Esa página muestra dos fechas contradictorias (cabecera 2025-10-15, pie 2024-11-04); la definición de 50 ms coincide con MDN [16][17].

## 4. Esfuerzo de tarea y fricción

Ninguna de las herramientas consultadas define «clics hasta completar una tarea» o «desplazamientos hasta completar»; es una medida propia que se construye contando eventos entre el inicio y el fin de una tarea nombrada. Las definiciones publicadas cubren fricción:

| Señal | PostHog | LaunchDarkly | Conviva | Microsoft Clarity | Fullstory |
|---|---|---|---|---|---|
| Rage click | 3 clics, cada uno a 30 px y 1 s del anterior; configurable [22][23] | 5 clics, radio de 8 px, ventana de 2 s; configurable [24] | 3 o más clics en el mismo elemento en 2 s sin respuesta [25] | clics repetidos en un área en sucesión rápida, sin cifras [26] | definición reservada, sin cifras publicadas [27] |
| Dead click | clic sin cambio en la página; sin cifra de espera en la página de autocaptura [22] | sin cifra en el artículo [24] | no consultado | clic sin respuesta visual ni navegación «en un tiempo razonable», sin cifra [26] | «unos segundos» según el centro de ayuda, sin cifra [27] |
| Clic con error | no consultado | no consultado | no consultado | error de JavaScript tras un clic [26] | clic con error de servidor [27] |

PostHog excluye por omisión de sus rage clicks los controles de navegación (anterior, siguiente), los botones de cantidad y los clics repetidos en campos de texto [22]. Fullstory reconoce que los botones Siguiente y Anterior disparan su heurística aunque el uso sea normal [27].

Contradicción: PostHog dice 3 clics en 30 px y 1 s [22][23]; LaunchDarkly dice 5 clics en 8 px y 2 s [24]; Conviva dice 3 clics en 2 s [25]. Las fuentes no explican la diferencia; cada producto fija su propio equilibrio entre falsos positivos y cobertura. Para el panel se recomienda adoptar la combinación de PostHog porque es la única cuyos tres parámetros están publicados con nombre y valor por omisión en configuración, y citarla así en el código.

Abandono de formularios: Contentsquare define su análisis de formularios como visitantes que interactuaron con un formulario sin completarlo, con tasas por campo (en blanco, abandono, rellenado) [28]. Esa página devolvió 403 al abrirla; la descripción viene del resultado de búsqueda y queda sin verificar contra el texto. No se encontró definición publicada de Hotjar ni de Heap. Amplitude define abandono de embudo como uno menos la conversión entre pasos consecutivos [29]. Para el panel, abandono equivale a una tarea iniciada que no llega a su evento de fin antes de que la sesión termine; es una definición de embudo, no de campo.

La tasa de error por pantalla no tiene umbral publicado en las fuentes consultadas; Clarity sólo etiqueta las sesiones con errores de JavaScript y clics con error [26].

## 5. Envío fiable al cerrar la página

| Mecanismo | Cabeceras propias | Credenciales | Tope | Compatibilidad |
|---|---|---|---|---|
| `navigator.sendBeacon` | no; sólo `Content-Type` derivado de los datos | modo `include`: envía cookies [32] | 64 KiB en cola [30] | Chrome 39, Firefox 31, Safari 11.1; disponible desde 2018 [19][30] |
| `fetch` con `keepalive: true` | sí; permite otros métodos y propiedades [31] | las de `fetch` (misma origen por omisión) | 64 KiB acumulados entre las solicitudes en vuelo; si la suma supera el tope, error de red [33] | Chrome 66, Firefox 133, Safari 13; línea base 2024 [19][31] |
| `fetchLater()` | sí | n/d | cuota propia, no confirmada en la página [38] | sólo Chrome 135 [19][38] |

La especificación de Beacon describe una solicitud con `Content-Type` sólo si los datos lo traen; si no es seguro para CORS se hace comprobación previa [32]. Su última versión publicada es de 2022-08-03, anterior a los doce meses, y MDN (2026-10-11) sigue describiendo la misma interfaz [30]; no hay una fuente posterior que la contradiga. Un endpoint que exige una cabecera CSRF personalizada no puede recibir un `sendBeacon`, porque la API no permite fijarla. `fetch` con `keepalive` sí, y en el mismo origen no dispara comprobación previa de CORS.

Evento de disparo: MDN (2026-10-11) recomienda `visibilitychange` con estado `hidden` y desaconseja `unload`, `beforeunload` y también `pagehide` [30]. Chrome (actualizada 2026-10-16) llama a `visibilitychange` «el último momento fiable» para guardar datos y propone `pagehide` sólo para detectar descarga; advierte que quien dependa de eventos de terminación pierde datos [34]. Contradicción menor: Chrome admite `pagehide` como detector de descarga y MDN lo desaconseja. OpenTelemetry JS 3.0.0 resolvió quitar el oyente de `pagehide` porque estaba registrado en `document` y nunca se ejecutaba, y dejó sólo `visibilitychange` [4]. Para el panel basta `visibilitychange`.

Qué hacen las bibliotecas:

| Biblioteca | Mecanismo |
|---|---|
| `web-vitals` (README) | `sendBeacon` y vaciado de la cola en `visibilitychange` con estado `hidden` [35] |
| posthog-js | transporte por omisión `fetch`, luego XHR, luego `sendBeacon`; `keepalive` sólo si cabe: reserva hasta el 80 % de los 64 KiB; si un beacon se rechaza y el lote pasa de 16 KB, lo parte por la mitad [36] |
| OpenTelemetry JS (`otlp-exporter-base` 0.300.0) | `fetch` con `keepalive` mientras la suma pendiente sea menor de 61.440 bytes y haya menos de 9 solicitudes con `keepalive`; si no, `fetch` sin `keepalive`; el delegado de beacon quedó obsoleto [37] |

Contradicción entre bibliotecas: `web-vitals` sigue mostrando `sendBeacon` [35] y OpenTelemetry lo declaró obsoleto a favor de `fetch` con `keepalive` [37]. Para un endpoint con cabecera CSRF, la segunda es la única viable. El tope de OpenTelemetry (61.440 B y 9 solicitudes) sale de un comentario de su código que cita un issue del estándar Fetch [37]; la regla de 64 KiB acumulados está en el estándar [33].

## 6. Privacidad

### 6.1 Marco legal

El CEPD (directrices 2/2023, versión 2.0 adoptada el 2024-10-07, anterior a los doce meses; es la versión vigente) sostiene que el artículo 5(3) de ePrivacy no se limita a cookies. Un script que ordena al navegador mandar peticiones asíncronas con información del dispositivo es acceso en ese sentido (párrafo 33), y la información producida localmente que se envía a un servidor también lo es (párrafo 53) [39]. Por tanto una telemetría de interfaz propia, aun sin cookie ni identificador, está dentro del alcance del artículo 5(3): necesita consentimiento o una excepción. Las excepciones del artículo son transmisión de la comunicación y servicio solicitado explícitamente por la persona; las directrices consultadas tratan el alcance, no clasifican la analítica como necesaria [39].

La CNIL publicó el 2025-07-04 una ficha sobre soluciones de medición de audiencia exentas de consentimiento. Su página devolvió 503 al abrirla; los criterios se leen en la autoevaluación de Matomo, que los cita (abril de 2026), y quedan sin verificar contra el texto de la CNIL [40]. Según esa autoevaluación, la exención se limita a medición de rendimiento, detección de problemas de navegación, optimización de rendimiento o ergonomía, estimación de capacidad y análisis de contenido visto; admite tres tipos de evento (presencia en una página, uso de una función como un clic, y estadísticas de tiempo de carga, desplazamiento o tiempo en la página); exige minimizar cabeceras como tamaño de pantalla, y su modo de cumplimiento desactiva el informe de resolución de pantalla; fija vida del rastreador de 13 meses como máximo y retención de 25 meses como máximo (759 días en su modo) [40].

Contradicción de alcance: el CEPD aplica el artículo 5(3) a todo lo que el script envíe [39] y la CNIL ofrece una exención francesa con condiciones [40]. La CNIL es una interpretación nacional; en otro Estado puede no regir. El informe no resuelve cuál jurisdicción aplica al panel ni cubre el contexto laboral (las personas que usan el panel son equipo de trabajo). Esto es una lectura técnica de fuentes, no asesoría jurídica.

### 6.2 Valor por omisión de productos comparables

| Producto | Estado por omisión | Fuente |
|---|---|---|
| Plausible | Sin cookies ni almacenamiento local; sin identificadores persistentes; identificador diario con sal que se borra cada 24 h; dice que no requiere banner ni consentimiento. Mide en cuanto se instala el código | [41], página de septiembre de 2026 |
| Matomo | Cookies propias por omisión: `_pk_id` (visitante, 13 meses) y `_pk_ses` (30 minutos). Es exento sólo si el operador activa el modo de cumplimiento CNIL | [40][42] |
| PostHog (JS) | `persistence` en `localStorage+cookie`, `opt_out_capturing_by_default` falso, `respect_dnt` falso, `person_profiles` en `identified_only`, `mask_all_text` falso. La guía RGPD pide al operador pedir consentimiento al registrarse y reconoce el autoalojamiento como responsable del tratamiento | [23][43][44] |
| Umami | Con la configuración por omisión inicia seguimiento de páginas, clics y rendimiento; `data-do-not-track` es opcional y está obsoleto, y la propia página dice que no es una solución de consentimiento | [45] |
| Sentry (navegador) | Envía la IP por omisión; el replay oculta todo texto, medios e inputs por omisión | [46][47] |
| GlitchTip (autoalojado) | La página de instalación no trata telemetría de uso ni consentimiento; sólo fija retención de 90 días por omisión | [48] |

Ninguno nace apagado ni pide consentimiento a la persona final por omisión; el operador decide al instalar. PostHog incluye interruptores de exclusión (`opt_out_capturing_by_default`, `opt_out_capturing()`), apagados por omisión [44]. En todos, quien instala es el responsable del tratamiento. Plausible y la exención CNIL de Matomo son los dos diseños que evitan identificadores persistentes [40][41].

### 6.3 Conclusión práctica

Para un producto autoalojado donde quien lo instala es el responsable, la práctica de los comparables es nacer encendido y dar al operador el interruptor. Con la lectura del CEPD, esa práctica sólo se sostiene si el diseño cumple las condiciones de la exención: sin cookie ni almacenamiento local, sin identificador que persista entre sesiones, sin texto ni contenido, con tamaño de ventana en cubos gruesos y retención acotada [39][40]. Si el panel añade cualquier identificador persistente o cualquier dato de contenido, debe nacer apagado y encenderse con una decisión expresa. Esta conclusión es una recomendación de diseño; la validez de la exención en la jurisdicción de cada instalación queda a quien despliega.

## 7. Límites para un endpoint de ingestión

| Referente | Límite | Fuente |
|---|---|---|
| Fastify (servidor de la API) | `bodyLimit` por omisión 1.048.576 bytes (1 MiB) | [52] |
| Estándar Fetch | 64 KiB acumulados de cuerpo en solicitudes `keepalive` en vuelo | [33] |
| `sendBeacon` | 64 KiB de datos en cola | [30] |
| Colector de OpenTelemetry | `max_request_body_size` por omisión 20 MiB | [49] |
| PostHog, `/batch` | cuerpo menor de 20 MB por omisión; sin límite de eventos por lote; `distinct_id` de 200 caracteres | [51] |
| Sentry | 200 MiB por sobre descomprimido; 1 MiB por evento, span, log o métrica | [53] |
| Plausible, API de eventos | 30 pares clave-valor en `props`; URL de hasta 2.000 caracteres; sin tope de cuerpo publicado | [54] |
| OpenTelemetry, procesador por lotes | cola 2.048; lote 512; espera 5.000 ms; tiempo de exportación 30.000 ms | [50] |
| posthog-js (cliente) | vaciado cada 3.000 ms; 10 eventos por segundo con ráfaga de 10 veces (100); la cubeta de fichas se rellena por segundo | [36] |

Ninguna de las fuentes fija un tope de eventos por lote para un uso como este; PostHog dice que no lo hay y deja la limitación al tamaño de cuerpo [51]. Los topes por bytes de los referentes (1 MiB, 20 MiB, 200 MiB) son de servidores generales. El límite que gobierna el envío al cerrar la página es el de 64 KiB del estándar [33]: un cuerpo mayor no puede salir con `keepalive`. Un tope de cuerpo de 64 KiB en el endpoint es por tanto el valor derivado de la fuente, y el número de eventos por lote se deriva de ese tope y del tamaño medido de un evento, no de una cifra elegida. La frecuencia de vaciado tiene dos referentes publicados, 5.000 ms en OpenTelemetry [50] y 3.000 ms en PostHog [36].

## 8. Qué se recomienda para este panel

1. Escribir un módulo propio mínimo en lugar de adoptar un SDK de navegador: el estado oficial es experimental, `sdk-trace-web` quedó eliminado en 3.0.0 y las convenciones están en «development» [1][2][4][6][7]. El prototipo pesa 0,7 KB comprimidos frente a 16,3 KB del SDK de trazas con exportador (medición propia, sección 2.3).
2. Enviar eventos como JSON con lista cerrada de campos, validada en el servidor con rechazo de campos desconocidos: el servidor descarta texto y nombres de archivo aunque el navegador los envíe, algo que las instrumentaciones configurables no aseguran (el clic de OpenTelemetry emite selector CSS y atributos del elemento) [10].
3. Medir LCP, INP y CLS con los umbrales oficiales al percentil 75 y guardar «no soportado» donde la API no exista: CLS, tareas largas y long-animation-frame sólo existen en Chromium [11][12][13][14][19][21].
4. Calcular INP y CLS con `PerformanceObserver` propio, o con `web-vitals` (3,3 KB comprimidos) si se quiere la misma atribución que Chrome [15][18][21].
5. Contar tareas largas con el umbral de 50 ms y descartar la atribución de scripts, que puede contener nombres de archivo [16][17].
6. Definir rage click con los parámetros publicados de PostHog (3 clics, 30 px, 1.000 ms), excluir controles de navegación y de cantidad como esa herramienta, y citarla en el código [22][23].
7. Tratar duración de tarea, clics y desplazamientos hasta completar y abandono como medidas propias de embudo (inicio y fin de una tarea nombrada): ninguna herramienta consultada las define con cifras [24][25][26][27].
8. Enviar al cerrar con `fetch` y `keepalive: true` con la cabecera CSRF, disparado por `visibilitychange` con estado `hidden`; no usar `sendBeacon` (sin cabeceras propias) ni `pagehide` [30][31][32][34][37].
9. Mantener cada lote bajo 64 KiB acumulados y, como OpenTelemetry, caer a `fetch` sin `keepalive` cuando la suma pendiente lo supere; fijar el tope de cuerpo del endpoint con ese valor, por debajo del `bodyLimit` de Fastify [33][37][52].
10. No usar cookies, almacenamiento local ni identificador de visitante: la sesión vive en memoria y se pierde al cerrar la pestaña, que es el diseño que cumple las condiciones de la exención de la CNIL [39][40].
11. Registrar el tamaño de ventana en cubos gruesos y no el valor exacto; el modo exento de Matomo desactiva la resolución de pantalla [40].
12. Nacer encendido con interruptor del administrador y retención acotada, como los comparables; nacer apagado si se añade un identificador persistente o contenido [39][40][41][43][44].

## 9. Cifras para citar en el código

| Cifra | Valor | Fuente | Fecha de la fuente |
|---|---|---|---|
| LCP bueno y malo | 2,5 s y 4,0 s | [14] | 2025-09-04 |
| INP bueno y malo | 200 ms y 500 ms | [12] | 2025-09-02 |
| CLS bueno y malo | 0,1 y 0,25 | [13] | 2023-04-12 |
| Percentil de evaluación | 75 | [11] | 2024-10-31 |
| Ventana de sesión de CLS | hueco de 1 s, máximo 5 s | [13] | 2023-04-12 |
| Exclusión de CLS por entrada reciente | 500 ms | [13][15] | 2023-04-12 |
| Tarea larga y long-animation-frame | 50 ms | [16][17][20] | 2026-10-05 y 2025-10-15 |
| Umbral por omisión de Event Timing | 104 ms (mínimo 16 ms, redondeo a 8 ms) | [18] | consultada 2026-10-21 |
| Rage click, PostHog | 3 clics, 30 px, 1.000 ms | [22][23] | consultada 2026-10-21 |
| Rage click, LaunchDarkly | 5 clics, 8 px, 2 s | [24] | 2025-11-13 |
| Rage click, Conviva | 3 clics, 2 s | [25] | 2026-09-02 |
| Cuerpo acumulado con `keepalive` | 64 KiB | [33] | 2026-10-19 |
| Cuerpo en cola de `sendBeacon` | 64 KiB | [30] | 2026-10-11 |
| Tope práctico de OpenTelemetry con `keepalive` | 61.440 bytes y 9 solicitudes | [37] | 2026-10-20 |
| Reserva de PostHog del cupo `keepalive` | 80 % | [36] | consultada 2026-10-21 |
| `bodyLimit` por omisión de Fastify | 1.048.576 bytes | [52] | consultada 2026-10-21 |
| `max_request_body_size` del colector | 20 MiB | [49] | consultada 2026-10-21 |
| Cola, lote, espera y tiempo de exportación de OpenTelemetry | 2.048, 512, 5.000 ms y 30.000 ms | [50] | consultada 2026-10-21 |
| Vaciado del cliente de PostHog | 3.000 ms | [36] | consultada 2026-10-21 |
| Eventos por segundo del cliente de PostHog | 10, con ráfaga de 100 | [36] | consultada 2026-10-21 |
| Vida máxima del rastreador (modo exento CNIL, según Matomo) | 13 meses | [40] | abril de 2026 |
| Retención máxima (modo exento CNIL, según Matomo) | 25 meses (759 días en su modo) | [40] | abril de 2026 |
| Peso de `sdk-trace` 3.0.0 con exportador OTLP | 16,3 KB comprimidos | medición propia | 2026-10-21 |
| Peso de `web-vitals` 6.2.3 (CLS, INP, LCP) | 3,3 KB comprimidos | medición propia; [21] | 2026-10-21 |
| Peso del prototipo propio | 0,7 KB comprimidos | medición propia | 2026-10-21 |

## 10. Fuentes

Todas con fecha de acceso 2026-10-21. Las fechas entre paréntesis son las de la página.

| N.º | Fuente | URL |
|---|---|---|
| 1 | OpenTelemetry, instrumentación de navegador en JS | https://opentelemetry.io/docs/languages/js/getting-started/browser/ |
| 2 | Registro de npm, `@opentelemetry/sdk-trace-web` (mensaje de obsolescencia, versiones y fechas) | https://registry.npmjs.org/@opentelemetry/sdk-trace-web |
| 3 | Registro de npm, `sdk-trace`, `sdk-logs`, `exporter-trace-otlp-http`, `instrumentation-*` y `web-vitals` | https://registry.npmjs.org/@opentelemetry/sdk-trace |
| 4 | opentelemetry-js, CHANGELOG, versión 3.0.0 | https://github.com/open-telemetry/opentelemetry-js/blob/main/CHANGELOG.md |
| 5 | Registro de npm, `@opentelemetry/browser-instrumentation` y `browser-sdk` | https://registry.npmjs.org/@opentelemetry/browser-instrumentation |
| 6 | Convenciones semánticas, sesión | https://opentelemetry.io/docs/specs/semconv/general/session/ |
| 7 | Convenciones semánticas, registro de atributos `browser` | https://opentelemetry.io/docs/specs/semconv/registry/attributes/browser/ |
| 8 | Convenciones semánticas, eventos (estado «Development») | https://opentelemetry.io/docs/specs/semconv/general/events/ |
| 9 | opentelemetry-browser, README (paquetes y estados) | https://github.com/open-telemetry/opentelemetry-browser/blob/main/README.md |
| 10 | opentelemetry-browser, modelo de eventos de navegador y README de la instrumentación | https://github.com/open-telemetry/opentelemetry-browser/blob/main/docs/browser-observability-model.md |
| 11 | web.dev, Web Vitals (2024-10-31) | https://web.dev/articles/vitals |
| 12 | web.dev, INP (2025-09-02) | https://web.dev/articles/inp |
| 13 | web.dev, CLS (2023-04-12) | https://web.dev/articles/cls |
| 14 | web.dev, LCP (2025-09-04) | https://web.dev/articles/lcp |
| 15 | MDN, `LayoutShift` | https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift |
| 16 | MDN, `PerformanceLongAnimationFrameTiming` (2026-10-05) | https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming |
| 17 | MDN, `PerformanceLongTaskTiming` | https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming |
| 18 | MDN, `PerformanceEventTiming` | https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming |
| 19 | `@mdn/browser-compat-data` 8.1.6 (publicada 2026-10-15) | https://www.npmjs.com/package/@mdn/browser-compat-data |
| 20 | web.dev, Total Blocking Time (2025-10-15) | https://web.dev/articles/tbt |
| 21 | GoogleChrome/web-vitals, README (soporte, envío, tamaño) | https://github.com/GoogleChrome/web-vitals |
| 22 | PostHog, autocaptura (rage click, dead click) | https://posthog.com/docs/product-analytics/autocapture |
| 23 | PostHog, configuración de JS web | https://posthog.com/docs/libraries/js/config.md |
| 24 | LaunchDarkly, detectar frustración (2025-11-13) | https://launchdarkly.com/docs/tutorials/detecting-user-frustration-session-replay.md |
| 25 | Conviva, métrica de rage click (2026-09-02) | https://docs.conviva.ai/vsi-app/metric-dictionary/rage-click/ |
| 26 | Microsoft Learn, métricas semánticas de Clarity (2025-12-05) | https://learn.microsoft.com/en-us/clarity/insights/semantic-metrics |
| 27 | Fullstory, desarrollador (rage click) y resultado de búsqueda del centro de ayuda | https://developer.fullstory.com/browser/rage-clicks/ y https://help.fullstory.com/hc/en-us/articles/360020624154-Rage-Clicks-Error-Clicks-Dead-Clicks-and-Thrashed-Cursor-Frustration-Signals |
| 28 | Contentsquare, análisis de formularios (403 al abrir; sólo resultado de búsqueda) | https://support.contentsquare.com/hc/en-us/articles/37271850273041-Evaluate-your-site-s-form-performance-using-Form-Analysis |
| 29 | Amplitude, glosario de abandono de embudo (resultado de búsqueda) | https://amplitude.com/glossary/terms/drop-off-rate |
| 30 | MDN, `Navigator.sendBeacon()` (2026-10-11) | https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon |
| 31 | MDN, `Request.keepalive` (2025-03-13) | https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive |
| 32 | W3C, Beacon, borrador de candidata a recomendación (2022-08-03) | https://www.w3.org/TR/beacon/ |
| 33 | WHATWG, Fetch Standard (2026-10-19) | https://fetch.spec.whatwg.org/ |
| 34 | Chrome, API de ciclo de vida de la página (actualizada 2026-10-16) | https://developer.chrome.com/blog/page-lifecycle-api |
| 35 | `web-vitals`, sección de envío a un endpoint | https://github.com/GoogleChrome/web-vitals#send-the-results-to-an-analytics-endpoint |
| 36 | posthog-js, `request.ts`, `request-queue.ts` y `rate-limiter.ts` | https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/request.ts |
| 37 | `@opentelemetry/otlp-exporter-base` 0.300.0, `fetch-transport` (código del paquete, 2026-10-20) | https://registry.npmjs.org/@opentelemetry/otlp-exporter-base |
| 38 | MDN, `fetchLater()` (2026-10-12) | https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater |
| 39 | CEPD, directrices 2/2023, versión 2.0 (2024-10-07) | https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf |
| 40 | Matomo, guía de configuración para la exención de la CNIL (abril de 2026); la ficha de la CNIL devolvió 503 | https://matomo.org/wp-content/uploads/2026/04/Configure-Matomo-Analytics-for-CNIL-exemption-User-Guide.pdf |
| 41 | Plausible, política de datos (septiembre de 2026) | https://plausible.io/data-policy |
| 42 | Matomo, cookies y consentimiento (FAQ) | https://matomo.org/faq/general/faq_146/ |
| 43 | PostHog, cumplimiento RGPD | https://posthog.com/docs/privacy/gdpr-compliance |
| 44 | PostHog, privacidad de analítica de producto | https://posthog.com/docs/product-analytics/privacy |
| 45 | Umami, configuración del rastreador | https://docs.umami.is/docs/tracker-configuration |
| 46 | Sentry, datos recogidos por el SDK de JavaScript | https://docs.sentry.io/platforms/javascript/data-management/data-collected/ |
| 47 | Sentry, privacidad de Session Replay | https://docs.sentry.io/platforms/javascript/session-replay/privacy/ |
| 48 | GlitchTip, instalación (variables por omisión) | https://glitchtip.com/documentation/install |
| 49 | Colector de OpenTelemetry, `confighttp/server.go` | https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector/main/config/confighttp/server.go |
| 50 | OpenTelemetry, especificación del SDK de trazas (procesador por lotes) | https://opentelemetry.io/docs/specs/otel/trace/sdk/ |
| 51 | PostHog, API de captura | https://posthog.com/docs/api/capture |
| 52 | Fastify, opciones del servidor | https://fastify.dev/docs/latest/Reference/Server/ |
| 53 | Sentry, sobres (envelopes) | https://develop.sentry.dev/sdk/foundations/transport/envelopes/ |
| 54 | Plausible, API de eventos | https://plausible.io/docs/events-api |

Sin verificar: el texto primario de la ficha de la CNIL (503 al abrir), la definición de abandono de formularios de Contentsquare (403) y cualquier cifra de dead click, que ninguna herramienta consultada publica.
