# Panel React contra una API REST en octubre de 2026

Consultado el 2026-10-20. El número entre corchetes remite a la tabla de fuentes del final. Los datos de versiones, fechas de publicación y descargas salen del registro de npm y de la API de GitHub. Las cifras de peso y de comportamiento de SSE son mediciones propias de ese día, con el método descrito en cada sección. «Sin verificar» marca lo que no tiene fuente primaria o cuya fuente no se pudo abrir. El buscador sólo devuelve resultados de Estados Unidos y muchas comparaciones de 2026 son blogs de proveedores; cuando una cifra sólo aparece ahí, se dice.

Alimenta una decisión de Martín: con qué se construye el panel de MASTER-SPEC §3, §6 y §7.8. Como punto de partida se tomaron las versiones ya probadas en producción por el autor en un proyecto anterior: React ^19.1.0, Vite ^6.3.5, `@refinedev/core` ^5.0.8, `@refinedev/rest` ^2.1.0 y React Router ^7.0.2.

## 1. Resumen

Refine 5 es MIT y su repositorio tiene actividad, pero el último paquete publicado de `@refinedev/core` es 5.0.12, del 2026-04-02. El changelog de `main` incluye las versiones 5.1.0 y 5.2.0, que nunca llegaron a npm porque el paso de publicación del flujo de lanzamiento falló en ambas. React Router lanzó la versión 8 el 2026-06-17, y el adaptador de Refine declara `react-router ^7.0.2`. Además Refine envía por omisión un aviso de telemetría a un tercero desde el navegador de cada miembro. Medido con una compilación mínima, Refine suma 74 KB comprimidos sobre React; la alternativa de TanStack suma 48 KB. El peso no decide nada. El riesgo de mantenimiento y la telemetría sí piden una decisión explícita.

El resto de la pila está vigente: React 19.3.1, Vite 8.3.4, Tailwind 4.3.3. shadcn/ui usa Base UI por omisión desde julio de 2026. Para el progreso en vivo, el plugin oficial `@fastify/sse` 0.6.1 repone eventos por `Last-Event-ID`. Una prueba con Node 24 mostró que los eventos llegan sin retraso, también a través del proxy de Vite 8 y con `@fastify/compress`. `fetch` sigue sin dar progreso de subida portable, y ese progreso se obtiene con `XMLHttpRequest`.

## 2. Refine 5 y sus alternativas

### 2.1 Estado del proyecto

| Señal | Dato | Fuente |
|---|---|---|
| Licencia y tamaño | MIT, 35.913 estrellas, no archivado | API de GitHub [5] |
| Última versión en npm | `@refinedev/core` 5.0.12, 2026-04-02; doce parches desde 5.0.0 (2025-09-03) | registro [2] |
| Versiones sólo en `main` | 5.1.0 (`updateIdentity`, 2026-06-05) y 5.2.0 (tipos de `MetaQuery` y `useDataProvider`, 2026-09-10) | CHANGELOG [7] |
| Por qué no se publicaron | El flujo «Release» falló el 2026-06-05 y el 2026-09-10 en el paso de publicar a npm; lint, tipos y pruebas pasaron. Causa sin verificar: el log no se pudo descargar | ejecución 34479611984 [6] |
| Último commit en `main` | 2026-09-10 | API de GitHub [5] |
| Pull requests e issues abiertos | 28 y 21; varios PR del 2026-10-12 al 2026-10-20 sin fusionar | API de GitHub [5], [8] |
| Integración con shadcn | Issue #7620 abierto desde 2026-09-27: usa una versión vieja | [8] |
| Seguridad | Issue #7556 (2026-08-25): ejecución de código en `@refinedev/inferencer`, paquete de desarrollo | [8] |
| Empresa | Habría separado el producto en enero de 2026. Sólo agregadores, sin fuente primaria | sin verificar |
| Licencia o adquisición | Ningún cambio encontrado en 2026 | búsqueda |

Las dos lecturas posibles no se zanjan con las fuentes. El proyecto está mantenido porque `main` recibió commits hasta septiembre, hay contribuciones externas y las pruebas pasan. O está detenido para quien instala, porque desde abril no hay un paquete nuevo y el flujo de publicación falla desde hace cinco meses. La evidencia directa respalda la segunda en lo que se puede instalar. Congelar en 5.0.12 es viable: 5.1 y 5.2 agregan funciones opcionales. Pero una corrección de seguridad futura no llegaría por `npm update` mientras el flujo siga roto.

El anuncio de la versión 5 es del 2025-09-18 [3] y npm publica `5.0.0` el 2025-09-03. Las dos fechas son oficiales y no coinciden; se usa la de npm.

### 2.2 Qué aporta contra una API REST

La guía de migración fija React 18 o 19, TanStack Query 5 y `@refinedev/react-router` 2.x [4]. Retiró `legacyAuthProvider`, `legacyRouterProvider`, `useNavigation` y `useMenu`. `sort` pasó a `sorters` y `metaData` a `meta` [4].

Para el contrato de §7.1 lo útil es `@refinedev/rest` 2.1.1. `createDataProvider(apiUrl, options)` acepta por operación `getEndpoint`, `buildQueryParams`, `buildBodyParams` y `mapResponse`, y en las listas también `getTotalCount` (leído en los tipos instalados). Una sola función traduce los `filters` de Refine a `GET /messages?for=&area=&status=&q=&replies=`. `useList`, `useTable` y `useForm` aportan paginación, orden, filtros y estado de formulario. Con `syncWithLocation` los filtros viajan en la URL; el parche 5.0.10 corrigió la lectura de filtros anidados desde la URL [1]. Las mutaciones invalidan las consultas relacionadas, lo que refresca «Últimos mensajes» tras publicar.

El núcleo no trae interfaz. Las interfaces vienen de paquetes por biblioteca o de un registro para shadcn, con el issue abierto citado. Con la interfaz propia de la maqueta, Refine sería sólo capa de datos y de rutas de recursos.

Dos hallazgos en el paquete instalado afectan las restricciones. El primero: `<Refine>` monta por omisión un componente de telemetría que pide una imagen a `https://telemetry.refine.dev/telemetry?payload=<base64>`. El contenido es la versión, el número de recursos, el `projectId` si existe y banderas de qué proveedores se usan (lectura de `dist/index.mjs`, versión 5.0.12). Se apaga con `options={{ disableTelemetry: true }}`. No lleva mensajes ni nombres, pero es una conexión de cada navegador hacia un tercero, y §4.1 dice que nada sale del contenedor salvo hacia los proveedores de modelo. Una política `Content-Security-Policy` con `img-src 'self' blob: data:` la bloquearía aunque alguien olvide la opción. El segundo: `@refinedev/core` depende de lodash, papaparse, qs y pluralize, y declara `sideEffects: false`; el empaquetador descarta lo no importado, como muestra la medición.

### 2.3 Costo en tamaño y en complejidad

Método: una aplicación mínima por variante, compilada para producción con Vite 8.3.4, Node 24.20 y React 19.3.1, en un solo trozo, con `gzip -9`. Cada variante usa sus hooks principales para que no se descarten. Es un piso: el código propio se suma.

| Variante | Sin comprimir | Comprimido | Sobre React solo |
|---|---|---|---|
| React y ReactDOM | 218,8 KB | 67,4 KB | 0 |
| TanStack Query 5.104 y React Router 7.18 | 293,5 KB | 90,8 KB | +23,4 KB |
| TanStack Query, Router 1.170 y Table 8 | 378,4 KB | 115,3 KB | +47,9 KB |
| Refine core 5.0.12, `rest` 2.1.1, adaptador de rutas y Query | 455,8 KB | 141,6 KB | +74,2 KB |
| react-admin 5.15.5 con MUI 9.5 y `ListGuesser` | 1.060,0 KB | 326,1 KB | +258,7 KB |
| CSS de Tailwind 4.3.3, muestra de 25 utilidades | 13,8 KB | 3,6 KB | aparte |

El blog de Refine publica 315,9 KB comprimidos para react-admin [10]; es texto de un competidor, y la medición propia lo confirma. Refine pesa 26,3 KB comprimidos más que la combinación de TanStack. Esa diferencia cuesta milisegundos en una oficina o una tailnet.

La complejidad pesa más. Refine suma un vocabulario propio: recursos, proveedores de datos, de autenticación, de rutas, de acceso, de notificaciones y «live», más `meta` como canal de parámetros. Para cinco vistas casi nada de eso se usa. El control de acceso son dos roles fijos en código (UD-007) y las notificaciones son una campana. Lo que Refine ahorra es traducir filtros a parámetros e invalidar consultas, que con TanStack Query son unas treinta líneas.

### 2.4 Alternativas vivas

| Opción | Estado el 2026-10-20 | Cubre | Deja por hacer |
|---|---|---|---|
| TanStack Query 5 | 5.104.5 (2026-10-19), 40,1 millones de descargas semanales [2] | Caché, mutaciones, invalidación | Traducir filtros |
| TanStack Router 1 | 1.170.45 (2026-10-16), 12,3 millones semanales [2] | Parámetros de búsqueda validados con esquema | Capa de recursos |
| TanStack Table | v9 estable 9.3.1 (2026-10-12) tras beta de junio [12]; la 8.21.3 sigue en uso, por ejemplo en Plane [24] | Lógica de tabla | Marcado y estilo |
| React Router | 8.5.0; la 8.0.0 salió el 2026-06-17 y exige Node 22.22 y React 19.2.7; la serie 7 sigue con versiones (7.18.4) [14] | Rutas y `useSearchParams`; modo SPA con `ssr: false` [13] | Filtros tipados a mano |
| react-admin 5 | 5.15.5 (2026-10-19), MIT, 87.415 descargas semanales; febrero de 2026 agregó un adaptador de TanStack Router [11] | CRUD completo con MUI | Estética Material; 326 KB; no calza con la maqueta |
| Refine 5 | 5.0.12; 158.897 descargas semanales [2] | Ver 2.2 | Ver 2.1 |

Entre enrutadores, la evidencia son blogs de 2026 que coinciden en que TanStack Router tipa y valida los parámetros de búsqueda y React Router 7 es el más difundido. No hay fuente primaria que mida la diferencia. El único argumento concreto para este panel es que los filtros de Mensajes viven en la URL y tiparlos evita validación escrita a mano. Hay precedentes de React Router en SPA servidas por un servidor propio: Plane lo compila con `ssr: false` [24] y Docmost lo usa en modo biblioteca [25]. La elección entre ambos es de preferencia.

Conclusión: Refine no está abandonado, pero tres hechos medidos (nada publicado desde abril, bloqueo en React Router 7 y telemetría por omisión) se suman a un beneficio pequeño en cinco vistas. Se recomienda TanStack Query más un enrutador y una función propia de traducción de filtros. Si Martín conserva Refine por continuidad, las condiciones son: `@refinedev/core` fijo en 5.0.12, `react-router` en la serie 7, `disableTelemetry` activo, y ni paquetes de interfaz ni inferencer.

## 3. React 19, Vite y Tailwind 4

| Pieza | Versión actual | Hecho fechado y requisitos | Fuente |
|---|---|---|---|
| React | 19.3.1 (2026-10-20) | 19.2 (2025-10-01): `Activity`, `useEffectEvent`. Compiler 1.0 (2025-10-07). 19.3 (2026-09-09): `<ViewTransition>` y referencias a fragmentos estables. Sin cambios que rompen en la nota. Los avisos de diciembre de 2025 afectan a componentes de servidor, que un cliente estático no usa | [17] |
| Vite | 8.3.4 (2026-10-08); 8.0 el 2026-03-12 | Rolldown y Oxc reemplazan a Rollup y esbuild. Node 20.19 o 22.12. Objetivo por omisión: Chrome y Edge 111, Firefox 114, Safari 16.4. `rollupOptions` pasa a `rolldownOptions` con conversión automática. `@vitejs/plugin-react` 6 ya no usa Babel | [15], [16] |
| Vite 7 | 2025-06-24 | Dejó Node 18; objetivo Chrome 107, Firefox 104, Safari 16.0 | [16] |
| Tailwind CSS | 4.3.3 (2026-10-19); 4.3 el 2026-05-08 | Base: Chrome 111, Safari 16.4, Firefox 128; quien necesite navegadores anteriores se queda en 3.4 | [18], [19] |
| `@tailwindcss/vite` | 4.3.3 | Compatible con Vite 5 a 8 | registro |

Para un proyecto nuevo, Vite 8 es la elección por omisión. Su piso de navegadores coincide con el de Tailwind 4 y no hay plugins de Rollup heredados que migrar. `@vitejs/plugin-react` 6 con Vite 8 compiló sin avisos en las pruebas de 2.3.

### Tailwind 4 frente a CSS nativo

El 2026-09-09 Tailwind Labs anunció que se une a Shopify. Afirma que Tailwind y sus demás proyectos abiertos seguirán bajo MIT, con el mismo equipo y apoyo de Shopify, y que cierra las altas de clientes nuevos de Tailwind Plus [18]. En enero de 2026 la empresa había despedido al 75 % de sus ingenieros, según una fuente secundaria que cita al fundador [20]. La licencia y el equipo quedan mejor respaldados en octubre que en enero.

`@scope` es Baseline desde Firefox 146 (diciembre de 2025), tras Chrome 118 y Safari 17.4 [21]. En State of CSS 2025, el anidamiento es segunda función favorita (182 respuestas) y las capas séptima (66) [22]. Los blogs de 2026 coinciden en que CSS nativo basta en proyectos chicos y que Tailwind impone estructura, pero ninguno trae una medición reproducible.

Contradicción declarada: los porcentajes de uso de Tailwind circulan con tres versiones incompatibles (37 % en 2025, 62 % de uso y 81 % de satisfacción en 2024, y 62 % combinado en 2025). La página oficial abierta no trae el ranking, así que no se usa ninguna. Tampoco hay argumento de tamaño: el CSS de la muestra pesa 3,6 KB comprimidos.

La restricción que pesa es otra. Los componentes de shadcn/ui se copian al proyecto y se escriben con clases de Tailwind, de modo que elegirlos implica Tailwind 4. Con Mantine el estilo viene de su hoja (35,4 KB comprimidos medidos) y Tailwind sobraría. Los tokens de la estética de programa estándar van como variables en `@theme`, con capas explícitas. `@scope` no hace falta en una sola aplicación.

## 4. Componentes para un programa denso

| Familia | Versión (2026-10-20) | Hecho fechado | Fuente |
|---|---|---|---|
| shadcn/ui | CLI 4.22.1 | Base UI es la biblioteca por omisión desde julio de 2026. Radix no se retira y cada componente nuevo sale para ambas. `npx shadcn init -b radix` elige Radix | [23] |
| Radix UI | `radix-ui` 1.8.1 | Paquetes unificados en febrero de 2026 | [23] |
| Base UI | `@base-ui/react` 1.9.0 | shadcn cita la 1.6.0 y más de 6 millones de descargas semanales al cambiar; Plane usa la 1.6.0 | [23], [24] |
| Ark UI | 5.39.3 | Máquinas de estado de Zag.js; Park UI se integró a Chakra el 2025-11-27 (sin fuente primaria para Zag) | registro |
| Mantine | 9.7.3 | La 9.0 exige React 19.2; Docmost usa la 9.3.2 | [47], [25] |

Costo medido con el método de 2.3, sobre siete piezas típicas (diálogo, selección, menú, ventana emergente, información emergente, pestañas, casilla):

| Familia | JS sin comprimir | JS comprimido | Sobre React solo |
|---|---|---|---|
| Radix | 343,3 KB | 105,8 KB | +38,5 KB |
| Ark | 424,0 KB | 124,4 KB | +57,0 KB |
| Base UI | 420,1 KB | 132,2 KB | +64,9 KB |
| Mantine, con tabla, insignia, campo y proveedor | 461,0 KB | 139,0 KB | +71,6 KB, más 35,4 KB de CSS |

Radix pesa menos que Base UI en esta muestra, lo contrario de lo esperable para la biblioteca nueva. La medición no separa la causa y usa una sola combinación de piezas. Con unas diez piezas, 26 KB comprimidos no cambian nada práctico, y la decisión se toma por rumbo: shadcn y Plane (61.188 estrellas, AGPL) usan Base UI. Un informe de terceros dice que migrar de Radix a Base UI cambia `asChild` por la propiedad `render` y altera pestañas y menús; no se verificó contra una fuente primaria.

La maqueta pide filas densas, chips editables para destinatarios, insignias de área y estado, edición en el lugar, barra de progreso y selector de tema. Ninguna biblioteca trae una tabla de gestión con edición en el lugar. Mensajes son filas de mensaje, no una cuadrícula de datos, así que una lista de `MessageCard` basta y TanStack Table sobra. La virtualización sólo entra con cientos de filas, que hoy no existen; Plane la usa por su volumen [24]. Un chip editable se arma con ventana emergente, lista y casillas, que las cuatro familias cubren.

Recomendación: shadcn/ui con Radix si se prioriza el peso, o con Base UI si se prioriza el rumbo; Tailwind 4 y `lucide-react` para íconos. El código queda en el repositorio y no cuenta como dependencia.

## 5. SSE en React

### 5.1 Lo que fija el estándar

El navegador reconecta solo y reenvía el último `id` en la cabecera `Last-Event-ID`; sin campos `id` del servidor no hay nada que reenviar. El campo `retry` fija la espera, y el estándar sólo dice que el valor inicial depende de la implementación [31]. Una respuesta con estado distinto de 200 o con otro tipo de contenido que `text/event-stream` falla la conexión sin reintento. El 204 es la forma explícita de decirle al cliente que deje de reconectar [31]. Sobre HTTP/1.1 hay unas seis conexiones por navegador y dominio, un límite que Chrome y Firefox marcaron «Won't fix»; sobre HTTP/2 el límite negociado es de 100 flujos [30]. `EventSource` acepta sólo URL y `withCredentials`: no pone cabeceras ni hace POST [30].

Para §7.10 se deduce lo siguiente. El `id` del evento es `job_events.seq`. Un trabajo terminado se cierra con un evento `done` y un `close()` del cliente; sin eso, la reconexión automática reabriría un flujo ya terminado. Una reconexión sobre un trabajo finalizado puede responderse con 204. La autenticación viaja por cookie, algo que panel y API comparten al servirse del mismo origen; que la cookie acompañe a `EventSource` en el mismo origen es comportamiento estándar, pero no se probó en un navegador (sin verificar). Si hiciera falta una cabecera o un POST, el recurso es `fetch` con lectura de flujo; `@microsoft/fetch-event-source` 2.0.1 lo implementa, pero su última versión es de abril de 2021 y no conviene como dependencia nueva.

### 5.2 Servidor con `@fastify/sse`

`@fastify/sse` 0.6.1 es del repositorio oficial de Fastify, MIT, con último empujón el 2026-10-08. Declara repetición por `Last-Event-ID`, latido de 30 s por omisión, rutas `{ sse: 'only' | 'dual' | 'manual' }` y envío desde generadores asíncronos [29]. Es una versión 0.x, creada en agosto de 2025 y con 28 estrellas: pide versión exacta y una prueba que la falsifique. La alternativa son unas treinta líneas sobre `reply.raw`.

Prueba propia con Node 24.20, Fastify 5.12.7, `@fastify/sse` 0.6.1, `@fastify/compress` 9.2.2 y Vite 8.3.4. Un servidor emite cinco eventos de progreso con `id` 1 a 5, uno cada 400 ms, y un `done`; `reply.sse.replay` devuelve lo posterior a `Last-Event-ID`. Un cliente `fetch` con `Accept-Encoding: gzip` anota la hora de cada fragmento.

| Escenario | Llegada de eventos 1 a 5 y `done` (ms) | Repetición desde `Last-Event-ID: 3` |
|---|---|---|
| Directo a Fastify | 63, 455, 856, 1257, 1658, 2060 | eventos 4 y 5 y `done` en 35 ms |
| Con `@fastify/compress` global | 46, 442, 842, 1243, 1643, 2044; sin `Content-Encoding` | no medido |
| A través del proxy de desarrollo de Vite 8 | 52, 447, 848, 1249, 1650, 2051 | desde el evento 4 en 46 ms |

El espaciado de 400 ms se conserva en los tres casos: no hay acumulación. `@fastify/compress` no comprimió `text/event-stream` ni añadió retraso, así que el riesgo que las guías atribuyen al middleware de Express no se reprodujo. La prueba no cubre un proxy inverso con búfer (nginx pide `X-Accel-Buffering: no`, según guías de terceros) ni `tailscale serve`, cuya documentación consultada no menciona streaming ni HTTP/2 (sin verificar). Ambos casos entran a la batería como prueba de extremo a extremo con `curl -N`.

### 5.3 Cliente y ciclo de datos

Las guías de 2026 coinciden: dejar la reconexión al navegador, abrir en un efecto y cerrar al desmontar, mantener estable la URL, guardar el último `id` en una referencia y cerrar el flujo en pestañas ocultas si el trabajo es largo. Para el panel basta un hook `useJobProgress(jobId)` sobre `new EventSource('/api/jobs/' + id + '/events')`. En cada mensaje `progress` actualiza `{ percent, phrase }`; en `done` cierra la conexión e invalida `['inputs', id]` para traer la propuesta. Porcentaje y frase son estado efímero de pantalla; llevarlos a la caché de consultas mezcla datos del servidor con una conexión.

TanStack Query tiene `streamedQuery`. Sus mantenedores lo marcaron experimental en 2025 para poder cambiarlo sin versión mayor, y uno señaló que SSE no es la solución pensada para resultados infinitos [50]. La página de referencia respondió 404 y no hay fuente de 2026 sobre su estado (sin verificar). Para flujos largos de toda la aplicación, las guías proponen una conexión que escribe en la caché con `setQueryData` o `invalidateQueries`. Aquí el flujo es finito y por trabajo, y el hook propio es más simple.

Con Refine, el equivalente es un `liveProvider` con `subscribe`, `unsubscribe` y `publish` opcional, y `liveMode: 'auto'`, que invalida consultas de recursos relacionados al llegar un evento [54]. Sirve para que «Últimos mensajes» se actualice cuando otro miembro publica, con un flujo por sesión. No sirve para el progreso de un trabajo, que no es un recurso. La documentación no trae un ejemplo con SSE. Con TanStack Query el mismo efecto es un hook que invalida `['messages']` ante un evento de ese canal.

## 6. Entrada multimodal

### 6.1 Capturas, arrastre y pegado

El evento `paste` expone `clipboardData`, un `DataTransfer` Baseline desde marzo de 2017. Los archivos salen de `clipboardData.files` o de `items` con `kind === 'file'`, y se previsualizan con `URL.createObjectURL`. La página de MDN consultada sólo documenta `getData`, de modo que el uso de `files` e `items` es el patrón de `DataTransfer` sin cita directa. Arrastrar usa el mismo objeto en `drop`. Slack acepta hasta 10 archivos arrastrados a la vez [38]. GitHub acepta arrastrar y pegar sobre el comentario y sube el archivo en el acto, con un enlace en el texto [37].

### 6.2 Cámara y micrófono

La cámara del teléfono se obtiene con `<input type="file" accept="image/*" capture="environment">`. MDN lo marca de disponibilidad limitada: en escritorio da un selector de archivos y en móviles ofrece la cámara; `user` elige la frontal [32]. No necesita contexto seguro, porque abre la cámara el sistema y no la página. Con `accept="audio/*"` funciona igual para audio donde el sistema lo ofrezca.

Grabar dentro del panel con `MediaRecorder` exige `getUserMedia`, que sólo funciona en HTTPS, `localhost` o `file://`; en un contexto inseguro `navigator.mediaDevices` es `undefined` [34]. Un panel servido por `http://ip-local:3000` no puede grabar. `tailscale serve` o el proxy del anfitrión con TLS (§3, fila «Red») es entonces requisito del botón de micrófono. El permiso se pide la primera vez y el navegador muestra un indicador mientras graba [34].

`MediaRecorder.isTypeSupported` es Baseline desde abril de 2021, y MDN recomienda recorrer candidatos y usar el primero que devuelva verdadero [33]. Las guías de 2026 usan `audio/webm;codecs=opus`, `audio/webm` y `audio/mp4`, y leen `recorder.mimeType` para nombrar el archivo. Dos fuentes secundarias dicen que Safari grababa sólo MP4 con AAC hasta la 18.3 y que la 18.4 sumó WebM con Opus. No coinciden en cuándo empezó MP4 (14.1 una, 14.4 otra), y un informe de 2026 dice que iPhone no reproduce el WebM de Chrome. Groq acepta flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav y webm [39], de modo que ambos contenedores llegan al transcriptor sin conversión. La reproducción en iOS se prueba en un teléfono real (sin verificar).

### 6.3 Subida con progreso y reintento

`fetch` no ofrece progreso de subida. Las solicitudes con cuerpo en flujo existen desde Chromium 105, sólo sobre HTTP/2 o HTTP/3 y con `duplex: 'half'`; Safari no admite `duplex` [35]. Sobre Firefox las fuentes no concuerdan. El evento `progress` de `XMLHttpRequest.upload` es Baseline desde 2015 [36] y es la vía portable: `loaded` sobre `total`, cuidando que `lengthComputable` puede ser falso. Cada adjunto sube con su propio `XMLHttpRequest` a `POST /inputs`, y el reintento reenvía el archivo completo. Es seguro porque §1.3 hace idempotente el input por hash. Una subida reanudable (`tus-js-client` 4.3.1 con `@tus/server` 2.4.6, MIT, 1,3 millones de descargas semanales, o `@uppy/xhr-upload` 6.0.1) sólo se justifica si los videos son tan grandes que perder una subida duela. No es el caso inicial de un equipo de 3 a 10 personas con volumen local.

`@fastify/multipart` fija por omisión `fileSize` igual al `bodyLimit` de Fastify, 1 MiB, y 1000 partes; no aplica `bodyLimit` como tope de la solicitud entera [41]. Sin declarar `limits.fileSize`, `files` y `parts`, una captura de 2 MB falla. Esos valores entran a §4.9.

### 6.4 Límites de apps comparables y de proveedores

| Aplicación o proveedor | Límite | Fuente |
|---|---|---|
| GitHub, issues | Imágenes y GIF 10 MB; video 10 MB gratis y 100 MB en planes pagos; otros archivos 25 MB | [37] |
| Slack | 1 GB por archivo; 10 archivos arrastrados a la vez | [38] |
| Groq, `whisper-large-v3-turbo` | 25 MB gratis, 100 MB en nivel de desarrollo; 0,04 USD por hora, mínimo 10 s por solicitud | [39] |
| API de Anthropic, imágenes | 10 MB por imagen en base64 (unos 7,5 MB del archivo original), 32 MB por solicitud, 100 imágenes por solicitud con contexto de 200k, 8000 x 8000 px | [40] |
| Telegram y WhatsApp, documentos | 2 GB, fuente secundaria | sin verificar |
| Discord, gratis | 10, 20 o 25 MB según la fuente | contradicción, sin verificar |
| Linear | Cifra no hallada; se adjunta con clip, atajo o arrastre | sin verificar |

Los topes que importan al motor son los de los proveedores. De ahí salen valores iniciales que §4.9 deberá cerrar con el banco de pruebas: imágenes hasta 7 MB antes de redimensionar, audio hasta 25 MB por archivo mientras se use Groq gratuito, documentos 25 MB como GitHub, y video según lo que mida `ffmpeg` en el banco. Redimensionar las capturas en el cliente baja la subida y el costo de visión. `browser-image-compression` no se actualiza desde 2023, así que se hace con `canvas` o en el servidor.

## 7. Referentes de bandeja de entrada

Height cerró el 2025-09-24, seis meses después de anunciarlo [46]; no sirve como referente vivo. Se revisaron los otros cinco en su documentación oficial, salvo Superhuman, cuyo centro de ayuda respondió 403 y se leyó por reseñas de 2026.

| Producto | Filtros | Estado y asignación | Edición en el lugar | Fuente |
|---|---|---|---|---|
| Linear | Tecla F; el filtro es una fórmula (propiedad, operador, valor) y sus partes se editan con un clic; AND y OR; los filtros van en la URL y se comparten copiándola | Estados por flujo de cada equipo; Inbox con pestañas Priority y Other, `J` y `K`, posponer | Título y descripción con un clic; la documentación no afirma edición de estado o responsable desde la fila | [42] |
| Plane | Chips sobre la lista; varios filtros se combinan solos | Estado, prioridad y responsable como propiedades mostrables; el estado se cambia en la vista de detalle y se guarda solo | La disposición Tabla edita celdas con un clic | [43] |
| Front | Icono de filtro sobre la lista; etiqueta, responsable y estado; varias opciones de una categoría son OR y entre categorías AND; persisten por bandeja | Etiqueta para el tema, estado para el flujo, asignación para el responsable | No documentada en la página consultada | [44] |
| Superhuman | Bandeja dividida por dirección, dominio, etiqueta o asunto; paleta con Cmd+K | Sin bandeja compartida ni asignación nativa, según reseñas | No aplica | [45] |
| HEY | Sin filtros: se decide una vez por remitente en el Screener | Montones Set Aside y Reply Later; hilos compartidos con comentarios privados en HEY for Domains | No aplica | [45] |

Hay cuatro patrones comunes. El filtro se muestra como fragmentos legibles sobre la lista y se quita uno por uno; los valores de una propiedad suman y las propiedades se cruzan. El estado es una propiedad con su valor visible en la fila, separada de las etiquetas y de la asignación, que en Front son tres ejes. El estado de la vista vive en la URL en Linear y por bandeja en Front. La edición de propiedades ocurre en un detalle o en una disposición de tabla, y la fila de lista queda de lectura; sólo Plane edita en la celda de su tabla.

Para team-platform, editar destinatarios y adjuntos de la propuesta es el caso de detalle editable. La fila de Mensajes puede quedar de lectura, con responder y cerrar. Los filtros de §6 (para mí, para X, área, estado, respuestas) encajan como chips con la búsqueda al lado, serializados en la URL para compartir una vista. Las fuentes hablan de propiedades y atajos, no de medidas: alto de fila, cuerpo de letra y espaciado son tokens de diseño que Martín fija con una captura delante.

## 8. Servir un panel Vite desde Fastify

Dos patrones aparecen en proyectos abiertos. El primero es `@fastify/static` con una ruta comodín. MonitoRSS (MIT) registra `fastifyStatic` con `root` en `client/dist` y define `setNotFoundHandler`: si la URL empieza por `/api` devuelve 404 en JSON, y si no, `reply.sendFile('index.html')` [26]. Docmost (AGPL, NestJS sobre Fastify, cliente con Vite 8.0.16, React 19.2.7, Mantine 9.3.2 y React Router 7.18) usa `wildcard: false`, marca `/assets/` con `max-age=31536000, immutable` y sirve `index.html` con `no-cache, no-store, must-revalidate`. Responde 404 a un `/assets/` inexistente, para que un archivo con hash de otra compilación no se confunda con una página, e inyecta un `window.CONFIG` en el HTML [25]. El README de `@fastify/static` 10.1.6 recomienda el mismo reparto: activos con hash inmutables e `index.html` con `maxAge: 0` [27].

El segundo es `@fastify/vite` 10.0.0, con peers `vite >=6` y `fastify >=5`. Espera un paquete ya compilado en producción y su opción `spa: true` desactiva el paquete de SSR [28]. Para un cliente estático puro aporta más estructura de la necesaria; `@fastify/static` cubre lo que §7.8 pide.

En desarrollo, Docmost configura el proxy de Vite para `/api` hacia el servidor, con `changeOrigin: false` [25]. La prueba de 5.2 mostró que el proxy de Vite 8 retransmite SSE sin acumular. En producción, panel y API comparten origen, de modo que la cookie de sesión y `EventSource` no necesitan CORS. Plane entrega un paquete estático sin servidor de renderizado y lo sirve con su propio Caddy, no con Fastify [24].

## 9. Contradicciones declaradas

La fecha de Refine 5: el blog anuncia la versión el 2025-09-18 y npm publica `5.0.0` el 2025-09-03. Se usa la de npm porque es la del artefacto.

El estado de Refine: hay commits recientes y pruebas verdes, pero ningún paquete desde abril. Pesa más el registro, porque es lo que se instala.

El peso de Base UI: se esperaría la más liviana y mide +64,9 KB contra +38,5 KB de Radix. Pesa la medición, con la salvedad de que usa una sola combinación de piezas.

Uso y satisfacción de Tailwind: tres cifras incompatibles; ninguna se usa. Soporte de MP4 y WebM en Safari: el corte inicial de MP4 va de 14.1 a 14.4 según la fuente, y ambas coinciden en WebM desde 18.4; por eso se detecta en ejecución. Límite gratuito de Discord: de 10 a 25 MB, sin efecto en la recomendación. La lista de referentes pedida incluía a Height, que ya no opera.

## 10. Sin verificar

La causa de la falla de publicación de Refine. El estado de `streamedQuery` en 2026. Si `tailscale serve` transmite SSE sin acumular y con qué protocolo habla al servidor local. El envío de la cookie por `EventSource` en un navegador real. La reproducción en iPhone de audio grabado en Chrome. Los topes de Linear, Telegram y WhatsApp en documentación oficial. La situación corporativa de Refine Dev Teknoloji en 2026. La fecha exacta de Base UI 1.0. La edición de estado desde la fila en Linear. Medidas de densidad de cualquier referente.

## 11. Recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Reemplazar Refine por TanStack Query 5, un enrutador y una función propia de filtros a parámetros. Si se conserva: `@refinedev/core` 5.0.12 fijo, `react-router` en 7, `disableTelemetry`, sin paquetes de interfaz ni inferencer | Nada publicado desde 2026-04-02; 5.1 y 5.2 sin publicar tras dos fallas del flujo; adaptador con `react-router ^7.0.2` frente a la 8.5.0; telemetría por omisión; 26 KB comprimidos de diferencia | [2], [6], [7], lectura del paquete y medición, 2026-10-20 |
| Si se conserva Refine, usar sólo `core` y `@refinedev/rest` con `createDataProvider` | `buildQueryParams`, `mapResponse` y `getTotalCount` calzan con `GET /messages?...`; issue de shadcn abierto | tipos de `rest` 2.1.1, [8], 2026-10-20 |
| Prohibir en la batería toda conexión del navegador a otro dominio, con CSP `img-src 'self' blob: data:` y `connect-src 'self'` | La telemetría de Refine es una imagen a un tercero; §4.1 | lectura del paquete, 2026-10-20 |
| Fijar React 19.3, Vite 8, `@vitejs/plugin-react` 6, Tailwind 4.3; base Chrome 111, Safari 16.4, Firefox 128 | Versiones vigentes; Vite 8 y Tailwind 4 comparten el piso de navegadores | [15], [16], [17], [19], 2026-10-20 |
| Tailwind 4 con tokens en `@theme` y `@layer`; sin `@scope` | MIT con equipo y respaldo de Shopify desde 2026-09-09; CSS de muestra 3,6 KB; los componentes elegidos usan Tailwind | [18], [19], medición, 2026-10-20 |
| shadcn/ui con Radix (peso) o Base UI (rumbo), código en el repositorio | Base UI por omisión desde 2026-07 y en Plane; Radix no se retira; +38,5 KB frente a +64,9 KB | [23], [24], medición, 2026-10-20 |
| Mensajes como lista de `MessageCard`, sin TanStack Table ni virtualización hasta que haya cientos de filas | No es una cuadrícula de datos; Plane las usa por su volumen | [24], 2026-10-20 |
| Filtros de Mensajes en la URL, como chips de propiedad, operador y valor | Patrón común de Linear, Plane y Front | [42], [43], [44], 2026-10-20 |
| SSE con `@fastify/sse` 0.6.1 exacta o a mano sobre `reply.raw`; `id` igual a `job_events.seq`; evento `done` y `close()` en el cliente; 204 si el trabajo ya terminó | Repetición medida en 35 ms; sin acumulación con compresión ni con el proxy de Vite 8; el estándar fija 204 como fin de reconexión | [29], [31], medición, 2026-10-20 |
| Hook `useJobProgress` sobre `EventSource`, progreso como estado efímero e invalidación de `['inputs', id]` al `done`; sin `streamedQuery` | `streamedQuery` sin confirmación de 2026, pensado para respuestas que terminan | [50], 2026-10-20 |
| Un canal SSE por sesión para «Últimos mensajes»; el progreso fuera de ese canal | Seis conexiones por dominio en HTTP/1.1; 100 flujos en HTTP/2 | [30], [54], 2026-10-20 |
| Exigir HTTPS donde se grabe audio; la cámara del teléfono por `<input capture>` | `getUserMedia` sólo en contextos seguros; `capture` abre la cámara del sistema | [32], [34], 2026-10-20 |
| `MediaRecorder` con candidatos `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4` y lectura de `recorder.mimeType` | `isTypeSupported` es Baseline; Safari anterior a 18.4 sólo MP4; Groq acepta ambos | [33], [39], 2026-10-20 |
| Subida con `XMLHttpRequest` y `upload.progress`; reintento reenviando el archivo; tus sólo si los videos lo piden | `fetch` sin progreso portable; flujo sólo con HTTP/2 en Chromium y sin `duplex` en Safari | [35], [36], 2026-10-20 |
| Declarar `limits.fileSize`, `files` y `parts`; valores iniciales: imagen 7 MB, audio 25 MB, documento 25 MB, video según el banco | Omisión de 1 MiB; 10 MB en base64 de Anthropic; 25 MB de Groq gratis y de GitHub | [37], [39], [40], [41], 2026-10-20 |
| `@fastify/static`: activos con hash inmutables, `index.html` sin caché, 404 para `/assets/` ausente y 404 JSON bajo `/api`; en desarrollo, proxy de Vite a `/api` | MonitoRSS, Docmost y README de `@fastify/static` | [25], [26], [27], 2026-10-20 |
| No usar Height como referente; usar Linear, Plane y Front | Height cerró el 2025-09-24 | [46], 2026-10-20 |

## Fuentes

Consultadas el 2026-10-20. Las salidas de comandos se repiten con `npm view <paquete> version time.modified`, `gh api` y una compilación con Vite 8.3.4 y `gzip -9`.

| N.º | Fuente | URL |
|---|---|---|
| 1 | Releases de Refine | https://github.com/refinedev/refine/releases |
| 2 | Registro de npm de los paquetes citados | https://www.npmjs.com |
| 3 | Anuncio de Refine v5 | https://refine.dev/blog/refine-v5-announcement/ |
| 4 | Migración de Refine 4.x a 5.x | https://refine.dev/core/docs/migration-guide/4x-to-5x/ |
| 5 | Repositorio de Refine | https://github.com/refinedev/refine |
| 6 | Ejecución del flujo Release, 2026-09-10 | https://github.com/refinedev/refine/actions/runs/34479611984 |
| 7 | CHANGELOG de `@refinedev/core` en `main` | https://github.com/refinedev/refine/blob/main/packages/core/CHANGELOG.md |
| 8 | Issues de Refine | https://github.com/refinedev/refine/issues |
| 10 | Refine frente a react-admin | https://refine.dev/blog/react-admin-vs-refine/ |
| 11 | React-admin, febrero de 2026 | https://marmelab.com/blog/2026/02/26/react-admin-february-2026-update.html |
| 12 | TanStack Table v9 beta | https://www.infoq.com/news/2026/07/tanstack-table-v9-beta/ |
| 13 | React Router, modo SPA | https://reactrouter.com/how-to/spa |
| 14 | `react-router` 8.5.0 en npm | https://www.npmjs.com/package/react-router |
| 15 | Vite 8.0 | https://vite.dev/blog/announcing-vite8 |
| 16 | Migración de Vite | https://vite.dev/guide/migration |
| 17 | Blog de React y nota de 19.3 | https://react.dev/blog/2026/09/09/react-19-3 |
| 18 | Tailwind Labs se une a Shopify | https://tailwindcss.com/blog/tailwind-is-joining-shopify |
| 19 | Compatibilidad de Tailwind 4 | https://tailwindcss.com/docs/compatibility |
| 20 | Despidos de Tailwind Labs, enero de 2026 (secundaria) | https://www.devclass.com/2026/01/08/tailwind-labs-lays-off-75-percent-of-its-engineers-thanks-to-brutal-impact-of-ai/ |
| 21 | Plataforma web, diciembre de 2025 | https://web.dev/blog/web-platform-12-2025 |
| 22 | State of CSS 2025, uso | https://2025.stateofcss.com/en-US/usage/ |
| 23 | shadcn/ui, Base UI por omisión | https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default |
| 24 | Plane, repositorio | https://github.com/makeplane/plane |
| 25 | Docmost, repositorio | https://github.com/docmost/docmost |
| 26 | MonitoRSS, `services/backend-api/src/app.ts` | https://github.com/synzen/MonitoRSS |
| 27 | README de `@fastify/static` | https://github.com/fastify/fastify-static |
| 28 | `@fastify/vite` | https://github.com/fastify/fastify-vite |
| 29 | README de `@fastify/sse` | https://github.com/fastify/sse |
| 30 | MDN, eventos enviados por el servidor | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events |
| 31 | Estándar HTML, eventos enviados por el servidor | https://html.spec.whatwg.org/multipage/server-sent-events.html |
| 32 | MDN, atributo `capture` | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture |
| 33 | MDN, `MediaRecorder.isTypeSupported` | https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static |
| 34 | MDN, `getUserMedia` | https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia |
| 35 | Chrome, solicitudes `fetch` en flujo | https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests |
| 36 | MDN, `XMLHttpRequestUpload` progress | https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequestUpload/progress_event |
| 37 | GitHub, adjuntar archivos | https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files |
| 38 | Slack, agregar archivos | https://slack.com/help/articles/201330736-Add-files-to-Slack |
| 39 | Groq, voz a texto | https://console.groq.com/docs/speech-to-text |
| 40 | Anthropic, visión | https://platform.claude.com/docs/en/build-with-claude/vision |
| 41 | README de `@fastify/multipart` | https://github.com/fastify/fastify-multipart |
| 42 | Linear, filtros, bandeja y opciones de vista | https://linear.app/docs/filters |
| 43 | Plane, filtros y opciones de vista | https://docs.plane.so/core-concepts/issues/display-options |
| 44 | Front, filtros de la lista | https://help.front.com/en/articles/2163 |
| 45 | HEY, funciones; Superhuman, bandeja dividida | https://www.hey.com/features/ y https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox |
| 46 | Cierre de Height | https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/ |
| 47 | Mantine, de 8.x a 9.x | https://mantine.dev/guides/8x-to-9x |
| 50 | TanStack Query, `streamedQuery` | https://github.com/TanStack/query/discussions/9065 |
| 54 | Refine, proveedor live | https://refine.dev/core/docs/realtime/live-provider/ |
