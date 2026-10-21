# Identidad ligera y delegada para una aplicación Node de equipo pequeño

Fecha de consulta: 2026-10-20. Método: búsqueda web, lectura de documentación primaria, lectura del registro de npm y de la API de GitHub, y tres mediciones locales (Node v24.20.0, 16 hilos). Lo marcado «sin verificar» no tiene fuente primaria dentro de los últimos 12 meses. Las referencias [F#] remiten a la tabla de fuentes. Alimenta el módulo `src/identity/` (MASTER-SPEC §7.7) y las decisiones UD-002 y UD-007.

## Resultado

1. Node 24.7 o posterior trae `crypto.argon2` en el módulo estable. Un hash PHC producido con él lo verifica `@node-rs/argon2`, y al revés (medido). El valor de partida es Argon2id con 19 MiB, 2 pasadas y 1 hilo, el mínimo de OWASP, que tarda 19 ms en esta máquina.
2. Las sesiones van en la tabla `sessions` con ficha opaca de 32 bytes guardada con hash. La cookie lleva `__Host-`, `HttpOnly`, `Secure` y `SameSite=Lax`. La defensa de CSRF usa `Sec-Fetch-Site` y `Origin`. Ningún complemento de Fastify da más que ese módulo propio sobre `@fastify/cookie` (estimado en un centenar de líneas).
3. Ninguna librería de autenticación conviene. Lucia está deprecada desde marzo de 2025 y su repositorio no está archivado. Auth.js pasó a Better Auth con parches de seguridad. Better Auth impone sus tablas de usuario y sesión, que chocan con `members` y con el rol fijado en código (UD-007), y suma al menos diez avisos de seguridad publicados entre junio y septiembre de 2026.
4. La delegación necesita tres modos bajo un mismo contrato: cabecera firmada con HMAC y marca de tiempo (patrón de Stripe), JWT verificado con `jose` contra JWKS o secreto compartido, y redirección firmada con nonce (patrón DiscourseConnect). La cabecera sin firma solo se sostiene si el puerto es inalcanzable salvo por el proxy, y los avisos de oauth2-proxy de 2026 muestran que esa frontera se rompe.
5. Tailscale Serve entrega `Tailscale-User-Login` y descarta las cabeceras que traiga el cliente. El plan gratuito admite 6 usuarios y MASTER-SPEC §1 habla de 3 a 10. `tsnet` es solo de Go. Tailscale queda como red y como cuarto modo opcional de cabecera confiable.

## 1. Contraseñas

### 1.1 Algoritmo y parámetros

OWASP ordena Argon2id, scrypt, bcrypt y PBKDF2 [F1]. La hoja no lleva fecha de página. Cita NIST SP 800-63B-4 y RFC 9106, de modo que su texto es posterior a la versión final de NIST. Las filas de Argon2id que declara equivalentes en defensa son estas:

| Memoria | Pasadas | Hilos | Nota |
|---|---|---|---|
| 47104 KiB (46 MiB) | 1 | 1 | no vale para Argon2i |
| 19456 KiB (19 MiB) | 2 | 1 | el mínimo citado en el encabezado de la sección |
| 12288 KiB (12 MiB) | 3 | 1 | |
| 9216 KiB (9 MiB) | 4 | 1 | |
| 7168 KiB (7 MiB) | 5 | 1 | |

Para scrypt, el mismo documento fija N=2^17, r=8, p=1 como mínimo (128 MiB). Lista equivalentes con N menor y p mayor: 2^16 con p=2, 2^15 con p=3, 2^14 con p=5 y 2^13 con p=10. Para bcrypt exige factor 10 o más, solo en sistemas heredados, y un tope de 72 bytes de contraseña. PBKDF2 queda reservado a quien necesite FIPS-140, con 600.000 iteraciones de HMAC-SHA256.

RFC 9106 da dos opciones recomendadas: la primera con 2 GiB, una pasada y 4 hilos. La segunda, «si hay mucha menos memoria», con 64 MiB, 3 pasadas y 4 hilos, sal de 128 bits y etiqueta de 256 bits [F2]. Su guía de ajuste es fijar los hilos en 4, dar a cada llamada la mayor memoria que pueda costear y elegir el mayor número de pasadas que quepa en el presupuesto de tiempo.

Las dos fuentes no se contradicen. OWASP fija un piso con poca memoria para servidores que atienden muchos inicios de sesión. El RFC describe el punto de partida con más memoria. Un equipo de 3 a 10 personas inicia sesión pocas veces por día, de modo que el costo por intento puede subir. El límite real es la memoria del contenedor, porque cada intento simultáneo reserva `m` KiB.

La literatura secundaria repite cifras distintas (64 MiB, 3 pasadas y 4 hilos, o 47 MiB con una pasada) sin citar la versión de OWASP. Son filas del RFC o de la tabla anterior. Ninguna contradice el piso.

### 1.2 Qué hace Node 24 por sí solo

La documentación de Node 24 registra `crypto.argon2()` y `crypto.argon2Sync()` como añadidos en v24.7.0 [F3]. Las notas de esa versión, del 2025-08-27, lo confirman con la línea «crypto: add argon2() and argon2Sync() methods» [F4]. El módulo `node:crypto` figura como estable y la entrada de `argon2` no lleva etiqueta experimental. Los algoritmos son `argon2d`, `argon2i` y `argon2id`. Los parámetros son `message`, `nonce` (al menos 8 bytes, 16 recomendados), `parallelism`, `tagLength`, `memory` en KiB, `passes`, y dos opcionales: `secret` (pimienta) y `associatedData`. Una búsqueda secundaria afirmó que esa función no existe. Las dos fuentes primarias anteriores la desmienten.

La función devuelve el valor derivado y nada más. El formato PHC (`$argon2id$v=19$m=…,t=…,p=…$sal$etiqueta`) lo escribe y lo lee el código propio. Se midió la interoperabilidad con un guion de unas 20 líneas: un hash armado con `node:crypto` lo acepta `verify` de `@node-rs/argon2` (y rechaza una contraseña distinta), y un hash producido por `@node-rs/argon2` lo acepta la verificación propia con `timingSafeEqual`. El formato es el mismo, así que las dos rutas son intercambiables sin migrar datos.

El scrypt de Node trae por omisión `cost` 16384 (2^14), `parallelization` 1 y `maxmem` 32 MiB [F3]. Con N=2^17 y r=8 se necesitan 128 MiB, de modo que el valor por omisión de `maxmem` lo rechaza: hay que subirlo a mano. Es una trampa que bcrypt y Argon2 no tienen.

### 1.3 Mediciones locales

Node v24.20.0, 16 hilos, mediana de 15 corridas (21 en las filas con calentamiento). Un VPS de 1 vCPU será más lento; sin medir.

| Algoritmo y parámetros | Mediana | Origen del parámetro |
|---|---|---|
| Argon2id 47104 KiB, 1 pasada, 1 hilo | 32 a 44 ms | fila OWASP |
| Argon2id 19456 KiB, 2 pasadas, 1 hilo | 18 a 19 ms | mínimo OWASP |
| Argon2id 12288 KiB, 3 pasadas, 1 hilo | 14 ms | fila OWASP |
| Argon2id 9216 KiB, 4 pasadas, 1 hilo | 13 ms | fila OWASP |
| Argon2id 65536 KiB, 3 pasadas, 4 hilos | 110 ms | RFC 9106, segunda opción |
| Argon2id 65536 KiB, 3 pasadas, 1 hilo | 143 ms | variante sin paralelismo |
| scrypt N=2^17, r=8, p=1 | 260 ms | mínimo OWASP |
| scrypt N=2^15, r=8, p=3 | 181 ms | fila OWASP |
| scrypt N=2^14, r=16, p=1, 64 bytes | 47 ms | valor de Better Auth |

El scrypt de Better Auth usa N=16384, r=16, p=1, 64 bytes de salida y `maxmem` de 128·N·r·2 (leído en el paquete `@better-auth/utils` 0.5.0). Eso equivale a 32 MiB y a un producto N·r·p de 262.144. Las filas de scrypt de OWASP tienen productos de 655.360 a 1.048.576. Es un cálculo propio sobre dos fuentes: el valor por omisión de Better Auth hace entre 2,5 y 4 veces menos trabajo que cualquier fila de OWASP. Su propia documentación ejemplifica Argon2id con 64 MiB, 3 pasadas y 4 hilos, lo que sugiere que su valor por omisión es un compromiso de portabilidad y no una recomendación [F21].

### 1.4 Librerías vivas y costo de compilación nativa

| Opción | Versión y fecha | Descargas semanales | Instalación | Multiarquitectura |
|---|---|---|---|---|
| `node:crypto` | Node ≥ 24.7 | integrada | ninguna | la de Node |
| `@node-rs/argon2` | 2.2.2, 2026-10-06 | 1.226.838 | sin guion de instalación; 13 paquetes opcionales por plataforma | incluye linux x64 y arm64, glibc y musl, y arm 32 bits |
| `argon2` (node-argon2) | 0.45.1, 2026-07-21 | 1.544.175 | `node-gyp-build` en `install`; 10 binarios dentro del tarball | linux x64, arm64 y arm, glibc y musl; en macOS solo arm64 |

Las dos son MIT. `@node-rs/argon2` pesa 44,8 KB sin desempaquetar su binario (784 KB con el de linux x64 instalado). `argon2` pesa 959 KB porque incluye los binarios [F5, F6]. Sus valores por omisión difieren: `@node-rs/argon2` usa 19456 KiB, 2 pasadas y 1 hilo, igual que el mínimo de OWASP. `argon2` usa 65536 KiB, 3 pasadas y 4 hilos [F6].

Dos riesgos concretos de Docker multiarquitectura. El primero, de `@node-rs/argon2`: sus binarios llegan como dependencias opcionales por plataforma, y npm tiene un error abierto en que un `package-lock.json` generado en otra plataforma omite las opcionales de Linux, de modo que `npm ci` en el contenedor falla con «cannot find module» [F7]. El informe usa rollup como ejemplo. El mecanismo vale para cualquier paquete con ese esquema. Se mitiga generando el candado dentro del propio Dockerfile o probando cada arquitectura en CI. El segundo, de `argon2`: si la plataforma no tiene binario, compila con `node-gyp` y exige Python y un compilador, que una imagen mínima no trae. La misma descripción del README admite Node 22 o posterior como único probado y fija Alpine x64 desde 0.28.1 y arm64 desde 0.28.2 [F5].

Una página de benchmarks en Hugging Face afirma que `argon2` falla al compilar en el 54,2 % de los entornos y menciona paquetes que no se pudieron confirmar. Sus propias cifras se contradicen entre versiones (77,8 % en otra). No se usa como evidencia.

Veredicto de esta sección: `node:crypto` elimina el riesgo de compilación y de lockfile. El costo es escribir y probar unas 30 líneas de codificación PHC. `@node-rs/argon2` es la alternativa si el proyecto fija un Node anterior a 24.7, y entra como dependencia de desarrollo para la prueba de interoperabilidad.

### 1.5 Política de contraseñas

NIST SP 800-63B-4 fija estos requisitos (secciones 3.1.1.2 y 3.2.2) [F8]. Mínimo de 15 caracteres si la contraseña es el único factor y de 8 dentro de un esquema multifactor. Máximo permitido de al menos 64. Ninguna regla de composición. Lista de bloqueo de valores conocidos o comprometidos, comparada contra la contraseña completa. Tope de 100 fallos consecutivos por autenticador antes de deshabilitarlo. La hoja de autenticación de OWASP repite 15 y 64 y pide no truncar en silencio [F9]. Pide también mensajes de error idénticos para usuario inexistente, contraseña errónea y cuenta bloqueada, y el mismo tiempo de respuesta en todos los casos, lo que obliga a calcular un hash de relleno cuando el correo no existe. Sin segundo factor, el mínimo aplicable es 15.

Better Auth normaliza con NFKC antes de hashear y fija mínimo 8 y máximo 128 por omisión [F21]. La consulta de contraseñas filtradas por la API pública de Pwned Passwords enviaría un prefijo de hash a un tercero y contradice MASTER-SPEC §4.1. La lista de bloqueo tiene que viajar dentro de la imagen. El origen y el tamaño de esa lista quedan sin verificar: NIST pide que no sea excesivamente grande y no nombra una lista.

## 2. Sesiones

### 2.1 Cookie con sesión en base contra JWT

OWASP exige invalidar la sesión en el servidor al cerrar sesión: borrar la cookie del cliente no basta [F10]. Eso descarta una sesión sin estado para este proyecto. Las otras fuentes apuntan igual:

| Fuente | Lo que dice sobre sesiones sin estado |
|---|---|
| `@fastify/secure-session` | La cookie está cifrada con libsodium; el servidor no guarda nada. Una cookie filtrada suplanta al usuario hasta que expire; el README no documenta revocación en el servidor [F14] |
| Better Auth | Con la caché de cookie activa, una sesión revocada puede seguir válida en otros dispositivos hasta que venza `maxAge`; hay que consultar la base para forzarlo [F21] |
| Lucia (guía de sesiones sin estado) | Un JWT de vida corta, de 5 minutos a lo sumo, junto a una ficha de sesión respaldada en base [F19] |

El esquema §7.2 ya define la tabla `sessions (id, member_id, expires_at)`, de modo que la sesión en base no añade una pieza. Al cierre de sesión, el cambio de contraseña y el cambio de rol (UD-007), la fila se borra o se rota.

### 2.2 Forma de la ficha, rotación y expiración

El patrón mínimo vivo es el archivo `auth_session.ts` que el autor de Lucia dejó como reemplazo del paquete [F20]. Genera un identificador aleatorio de 16 bytes y un secreto aleatorio de 32 bytes. La ficha es `id.base64(secreto)`. La base guarda solo el SHA-256 del secreto. La comparación es en tiempo constante. La sesión vence a los 10 días de la última verificación y se renueva si pasó al menos una hora. La cookie es `HttpOnly`, `SameSite=Lax`, `Secure` bajo HTTPS. Pesa unas 200 líneas, no tiene dependencias y su licencia es Zero-Clause BSD, compatible con MIT. Usa `Uint8Array.toBase64()`, que exige Node 25, por lo que en Node 24 se sustituye por `Buffer`.

OWASP pide al menos 64 bits de entropía en el identificador [F10]. Pide regenerar la sesión tras cualquier cambio de privilegio, el inicio de sesión incluido, para evitar la fijación. Recomienda el prefijo `__Host-` en la cookie, que obliga a `Secure`, sin `Domain` y con `Path=/`. Para los plazos, OWASP da 15 a 30 minutos de inactividad en aplicaciones de bajo riesgo y 2 a 5 minutos en las de alto valor. Como duración absoluta cita 4 a 8 horas para una aplicación de oficina de jornada completa. Las librerías de autenticación usan plazos mucho más largos: Better Auth usa 7 días por omisión [F21], el archivo de Lucia 10 días [F20] y la guía de MySQL de Lucia 30 días [F19].

La contradicción tiene explicación: OWASP describe un mínimo defensivo. Las librerías optan por la comodidad de quien vuelve cada día. Para el valor por omisión se adoptan los de OWASP, porque el costo de equivocarse en esa dirección es un inicio de sesión extra, y se documenta el preset relajado. Es la única elección de la sección que cambia la experiencia diaria, y queda para Martín.

### 2.3 CSRF

OWASP es explícito: `SameSite` no sustituye una defensa de CSRF en la mayoría de los despliegues [F11]. `Lax` sigue enviando la cookie en navegaciones GET de nivel superior. El sitio incluye los subdominios hermanos, de modo que la toma de un subdominio hereda la cookie. Tampoco detiene el CSRF iniciado por el JavaScript propio. Para una API JSON con cookie propone, en orden: exigir una cabecera personalizada y rechazar tipos de contenido simples, añadir una ficha, aplicar una política con `Sec-Fetch-Site` con `Origin` como respaldo, y dejar `SameSite` como defensa en profundidad. La cabecera `Sec-Fetch-Site` es de disponibilidad amplia desde marzo de 2023 y JavaScript no puede fijarla [F12].

El plugin `@fastify/csrf-protection` 8.0.2 es compatible con Fastify 5 desde su rama 7. Guarda un secreto en cookie o sesión y valida una ficha por solicitud. Su README no menciona `SameSite` y deja la defensa a cargo del desarrollador [F15]. Con una API que solo acepta `application/json` y `multipart/form-data` más una cabecera propia, un gancho `onRequest` de unas 15 líneas que rechace métodos no seguros cuando `Sec-Fetch-Site` sea `cross-site` (y que caiga a comparar `Origin` cuando falte) cubre lo que OWASP lista. No añade una dependencia ni una segunda ficha que sincronizar con Refine.

El inicio de sesión también necesita defensa: OWASP describe el CSRF de login, en que un atacante inicia en la víctima la sesión del atacante. La misma política de `Sec-Fetch-Site` sobre `POST /auth/login` lo cubre.

### 2.4 Límite de intentos

| Capa | Valor y fuente |
|---|---|
| Por IP | `@fastify/rate-limit` 11.2.1 admite configuración por ruta con `config.rateLimit`; la clave por omisión es `request.ip` normalizado, con almacén LRU en memoria y almacenes externos opcionales [F16]. Better Auth limita `/sign-in/email` a 3 solicitudes en 10 segundos [F21] |
| Por cuenta | OWASP: contar los fallos por cuenta y no por IP; espera exponencial que empieza en 1 segundo y se duplica; avisa del riesgo de bloqueo como denegación de servicio y propone dejar restablecer la contraseña [F9] |
| Tope duro | NIST: no más de 100 fallos consecutivos por autenticador [F8] |

Tras un proxy, la IP que ve Fastify es la del proxy salvo que se configure `trustProxy`. Si se deja sin configurar, todos los miembros comparten un contador y uno que se equivoque bloquea a los demás. Fastify declara el valor por omisión `false`, rechaza el conteo de saltos porque «no puede validar el par inmediato y deja que clientes directos falsifiquen `X-Forwarded-*`», y pide una lista de IP o CIDR [F18]. La lista es la única forma aceptable aquí.

### 2.5 Complementos de Fastify 5

| Paquete | Versión y fecha | Descargas semanales | Qué da | Encaje |
|---|---|---|---|---|
| `@fastify/cookie` | 11.1.3, 2026-10-08 | n/d | lectura y escritura de cookies, firmadas opcionalmente | base de todo; dependencias `cookie` y `fastify-plugin` |
| `@fastify/session` | 11.1.5, 2026-10-18 | 149.286 | sesión con almacén intercambiable (`set`, `get`, `destroy`), `regenerate()`, `rolling` por omisión verdadero, secreto de 32 caracteres, rotación de secretos | exige escribir el almacén SQLite; guarda el id de sesión sin hash; `saveUninitialized` es verdadero por omisión y debe pasar a falso [F13] |
| `@fastify/secure-session` | 8.4.1, 2026-10-09 | 69.365 | cookie cifrada sin estado, rotación de llaves, expiración por omisión de un día | depende de `sodium-native`; sin revocación en servidor; descartada por §2.1 [F14] |
| `@fastify/csrf-protection` | 8.0.2, 2026-10-09 | n/d | ficha de CSRF | cubierta por el gancho de §2.3 |
| `@fastify/rate-limit` | 11.2.1, 2026-10-08 | n/d | límite por ruta | se usa para la capa por IP |

Todos son MIT. `@fastify/session` declara que continúa el paquete `fastify-session` sin mantenimiento [F13].

### 2.6 Lucia, Better Auth y Auth.js en 2026

| Proyecto | Estado verificado | Encaje |
|---|---|---|
| Lucia | El README dice «Lucia fue deprecada en marzo de 2025»; el sitio se actualizó en julio de 2026 y remite al archivo de una sola pieza y al libro Auth Book. La API de GitHub (2026-10-20) da `archived: false` y último empujón el 2026-08-08 [F19] | El paquete npm (276.061 descargas semanales) no se debe adoptar; el archivo de sesión es la referencia de §2.2 |
| Auth.js | Un aviso del sitio dice que el proyecto «es ahora parte de Better Auth»; el anuncio del 2025-09-22 promete parches de seguridad y correcciones urgentes, y recomienda Better Auth para proyectos nuevos [F22] | No se adopta; su sitio no declara fin de vida |
| Better Auth | 1.7.12 publicada el 2026-10-20; MIT; 7.801.856 descargas semanales; 30.394 estrellas; 889 incidencias abiertas; 2,08 MB sin desempaquetar y dependencias como `zod`, `kysely`, `jose` y siete paquetes propios [F21] | Ver abajo |

Better Auth monta como una ruta comodín (`/api/auth/*`) en Fastify, reconstruye la solicitud como `Request` de Fetch, copia de vuelta estado, cabeceras y cuerpo, y obtiene la sesión con `auth.api.getSession` y `fromNodeHeaders`. La guía exige registrar `@fastify/cors` antes y declarar `trustedOrigins` [F21]. Para SQLite la guía de instalación muestra `better-sqlite3`, que la página de adaptadores llama «recomendado». Sobre `node:sqlite` la misma página dice «candidato a versión estable» desde Node 24.15.0, mientras una búsqueda secundaria lo había descrito como experimental [F21]. Usar el controlador recomendado reintroduce la compilación nativa que MASTER-SPEC §3 evita al elegir `node:sqlite`.

La lista de avisos del repositorio, fuente primaria, muestra diez en su primera página, publicados entre junio y septiembre de 2026, y la lista tiene cuatro páginas. Dos son críticos: el estado de OAuth usado como enlace mágico para entrar como otro usuario (2026-09-30) y la toma de usuarios por fichas SCIM (2026-06-26). La mayoría afecta a complementos que este proyecto no usaría (SSO, SCIM, Stripe, OAuth Proxy). Otro, de gravedad alta, deja válida la contraseña del atacante después de un inicio con enlace mágico u OTP. Sitios secundarios fechan la crítica el 2026-10-14, y el repositorio el 2026-09-30. Se toma el repositorio.

Razones para no adoptarlo aquí: define sus propias tablas de usuario, sesión, cuenta y verificación, que duplican `members`, `credentials` y `sessions`. El rol sale de su complemento de organización y UD-007 lo fija en código. Un modo delegado exigiría escribir un complemento propio. Y el ritmo de publicación (una versión el mismo día de esta consulta) pide revisar avisos con frecuencia. La condición de revisión: que el producto sume OAuth de terceros, doble factor o claves de acceso, donde reescribir esas piezas cuesta más que adoptar la librería.

## 3. Delegar la identidad al sitio anfitrión

Cada patrón responde a la misma pregunta: cómo sabe la aplicación embebida quién es la persona sin implementar OAuth completo. La tabla los compara; el texto que sigue da los riesgos de cada uno.

| Patrón | Qué confía la aplicación | Ejemplos vivos | Riesgo dominante |
|---|---|---|---|
| A. Cabecera inyectada por el proxy, sin firma | Que la solicitud solo pudo pasar por el proxy | Tailscale Serve, oauth2-proxy, Authelia, Gitea, Grafana | Alcance directo al puerto; proxy que no borra las cabeceras del cliente |
| B. Cabecera con firma HMAC y marca de tiempo | Un secreto compartido | patrón de firma de Stripe | Fuga del secreto; deriva del reloj |
| C. JWT emitido por el anfitrión | Una llave pública (JWKS) o un secreto | Cloudflare Access, Pomerium | Validación incompleta de `iss`, `aud`, `exp` y algoritmo |
| D. Redirección con carga firmada y nonce | Un secreto compartido y el nonce | DiscourseConnect, Metabase | Correo no verificado en el anfitrión |
| E. Consulta al anfitrión con la cookie reenviada (forward auth) | La respuesta de un punto del anfitrión | Caddy `forward_auth`, nginx `auth_request` | La app debe estar detrás de ese proxy; cabeceras copiadas sin borrado previo |
| F. Cookie compartida por dominio | El formato de la cookie del anfitrión | sin ejemplo abierto hallado | Subdominios hermanos; acople al anfitrión |
| G. iframe y `postMessage` | El origen del mensaje | sin ejemplo abierto hallado | Cookies de terceros; verificación de origen |

### 3.1 Cabecera inyectada por el proxy

Tailscale Serve agrega `Tailscale-User-Login`, `Tailscale-User-Name` y `Tailscale-User-Profile-Pic` al tráfico de la red privada, y borra las mismas cabeceras si el cliente las trae. No las completa para el tráfico de Funnel ni para dispositivos etiquetados, y sí para quien acepta un dispositivo compartido. La documentación pide que el servicio escuche solo en `localhost`, porque de otro modo quien llegue directo puede fijar los valores [F23]. oauth2-proxy envía `X-Forwarded-User` y compañeras por omisión (`pass_user_headers` verdadero), borra las cabeceras de autenticación que él mismo fijaría (`skip_auth_strip_headers` verdadero) y confía por omisión en cualquier IP para las `X-Forwarded-*` (`trusted_proxy_ips` en `0.0.0.0/0`), con una advertencia de arranque [F24]. Authelia pide que el proxy elimine y reemplace las cabeceras reenviadas que lleguen del cliente. Una IP falsificable puede secuestrar reglas de acceso (página actualizada el 2026-09-25) [F25]. Grafana trae `auth.proxy` con lista blanca de IP y alta automática de usuarios por omisión [F28]. Gitea desactiva la autenticación por proxy inverso por omisión, lee `X-WEBAUTH-USER`, confía por omisión solo en `127.0.0.0/8,::1/128` y deja el alta automática como opción explícita [F29].

Los fallos de 2026 muestran dónde se rompe la frontera. El aviso GHSA-pxq7-h93f-9jrg (CVE-2026-41059, gravedad alta, CVSS 8,2, publicado el 2026-04-14) permite a un atacante sin credenciales sumar `#` o `%23` a la ruta. Así oauth2-proxy aplica una regla de exención y el backend sirve un recurso protegido [F24].. Fuentes secundarias (Red Hat, Lutra) describen además CVE-2026-40575, crítica con CVSS 9,1, donde un `X-Forwarded-Uri` enviado por el cliente hace que el proxy compruebe la autenticación contra otra ruta. Las dos se corrigen en 7.15.2 [F24]. No se leyó el registro de NVD de la segunda. Queda como dato secundario.

Regla que sale de aquí: un `trustProxy` con lista exacta, el puerto de la aplicación publicado solo en loopback o en un socket Unix, y el proxy que sobrescribe las cabeceras de identidad en cada solicitud. Alta automática de miembros: ninguna. A diferencia de Grafana, UD-007 exige que un editor registre al miembro, de modo que una identidad delegada sin fila en `members` recibe 403.

### 3.2 Cabecera con HMAC y marca de tiempo

La cabecera sin firma convierte la seguridad en una propiedad de la red. Firmarla la convierte en una propiedad de un secreto. El patrón vivo de firma es el de los webhooks de Stripe: el firmante calcula HMAC-SHA256 sobre la marca de tiempo, un punto y la carga. El receptor extrae la marca y las firmas, recalcula, compara en tiempo constante, y rechaza si la marca queda fuera de la tolerancia, que las bibliotecas fijan en 5 minutos. Una tolerancia de cero desactiva la comprobación de antigüedad. Al rotar el secreto, ambos permanecen activos hasta 24 horas y se emite una firma por secreto [F33].

Aplicado aquí (diseño propio, no una fuente): el proxy del anfitrión agrega `X-Team-User` (correo), `X-Team-Ts` y `X-Team-Sig`, con la firma sobre `ts + "." + correo`. El módulo `delegated` recalcula con `timingSafeEqual`, acepta dos secretos durante la rotación y rechaza fuera de 300 segundos. Lo que el esquema deja sin cubrir: dentro de la ventana, la repetición de una solicitud capturada. Incluir en el mensaje firmado el método y la ruta la acota. Con este patrón, el alcance directo al puerto ya no basta para suplantar a alguien.

### 3.3 JWT emitido por el anfitrión

Cloudflare Access envía la ficha en `Cf-Access-Jwt-Assertion` y recomienda validar esa cabecera y no la cookie `CF_Authorization`. Se verifica con RS256 contra el JWKS publicado, eligiendo la llave por `kid`, comprobando `iss` contra el dominio del equipo y `aud` contra la etiqueta de la aplicación. La llave rota cada 6 semanas y la anterior sigue válida 7 días (página del 2026-05-06) [F27]. Pomerium firma una ficha propia en `X-Pomerium-Jwt-Assertion` y nunca reenvía la original del proveedor de identidad. Publica las llaves en `/.well-known/pomerium/jwks.json`. Su SDK de JavaScript confía en el primer uso si no se fijan `issuer` y `audience`, y la documentación recomienda fijarlos en producción [F26].

`jose` 6.2.13 (MIT, sin dependencias, publicada el 2026-10-20) cubre `jwtVerify` con lista de algoritmos, emisor y audiencia, y `createRemoteJWKSet`. El resto de la guía de validación (algoritmos permitidos, fijar el algoritmo y no leerlo de la ficha) viene de RFC 8725, de 2020, anterior a la ventana de 12 meses. Sin verificar en esta consulta. Dos ajustes: con JWKS, la aplicación vuelve a pedir las llaves cuando llega un `kid` desconocido. Con secreto compartido (HS256), la configuración nombra el algoritmo y la aplicación lo exige.

### 3.4 Redirección firmada con nonce

DiscourseConnect delega el inicio de sesión a un sitio externo. Discourse redirige con `sso` (carga en Base64 con nonce y `return_sso_url`) y `sig` (HMAC-SHA256 hexadecimal con el secreto compartido). El sitio autentica, arma una nueva carga con el nonce y los datos de la persona, la firma y vuelve a `return_sso_url`. El nonce vale una vez, vence a los 30 minutos y queda atado al navegador de la sesión, lo que protege del CSRF. El aviso central de la página: Discourse confía en el correo que recibe, y si el sitio no lo verifica, queda expuesto a la toma de cuentas. Existe un caso discutido de una cuenta administradora que aún no había entrado por SSO (última edición 2026-05-27) [F30]. Metabase reparte la misma idea con un JWT firmado en `/auth/sso`, mantiene la contraseña habilitada para que el administrador no quede fuera si el SSO falla, y pide POST cuando la ficha en la URL podría quedar en registros [F31].

Para UD-002 este patrón es el que mejor responde a «sin importar cómo se maneje ese acceso»: el anfitrión solo debe producir una redirección firmada tras su propio inicio de sesión. Después la aplicación emite su propia cookie de sesión (§2.2), y la ruta SSE de progreso, que usa `EventSource` y no puede enviar cabeceras propias (sin verificar en esta consulta), funciona sin trucos. El mapeo debe usar un identificador externo estable junto al correo y exigir correo verificado por el anfitrión.

### 3.5 Consulta al anfitrión

`forward_auth` de Caddy envía un GET al servicio de autenticación con la URI reescrita y las cabeceras `X-Forwarded-*`. Si la respuesta es 2xx copia las cabeceras de `copy_headers` a la solicitud original, y si no devuelve la respuesta del servicio al cliente. La página no dice si borra antes las cabeceras de igual nombre que mande el cliente [F32]. Sin verificar. `auth_request` de nginx tiene la misma forma: 2xx permite, 401 y 403 niegan, `auth_request_set` guarda variables de la respuesta, y el módulo no viene compilado por omisión [F32]. Sirve para un anfitrión que ya expone un punto «quién soy» según su cookie, y obliga a que la aplicación viva tras ese proxy.

### 3.6 Cookie compartida, iframe y navegadores de 2026

Compartir la cookie del anfitrión exige `Domain=` en un dominio padre. Eso excluye el prefijo `__Host-` y amplía la superficie a todos los subdominios hermanos, vector de CSRF por toma de subdominio según OWASP [F11]. Además acopla la aplicación al formato de una cookie ajena. Solo se justifica como entrada del patrón E.

En un iframe de otro sitio, la cookie de sesión es de terceros. Estado verificado:

| Hecho | Fuente y fecha |
|---|---|
| Chrome «mantendrá su enfoque actual de ofrecer a los usuarios la elección sobre cookies de terceros» y retira Related Website Sets, Topics, Attribution Reporting y otras APIs; mantiene CHIPS y FedCM | Privacy Sandbox, 2025-10-17 (cuatro días fuera de la ventana de 12 meses) [F35] |
| CHIPS (cookies `Partitioned`) es «Baseline 2025» y funciona en los navegadores actuales desde diciembre de 2025; exige `Secure`; se recomienda `__Host-`; la clave de partición es el sitio de nivel superior, de modo que la cookie no se lee en otro anfitrión | MDN, 2026-06-15 [F34] |
| La API de acceso al almacenamiento exige un gesto del usuario, contexto seguro, y un iframe con `sandbox` necesita `allow-storage-access-by-user-activation`; las concesiones caducan a los 30 días sin interacción en Chrome, Firefox y Safari | MDN, 2026-09-04 [F34] |
| `postMessage`: verificar `event.origin` y `source`, verificar también la sintaxis del mensaje, y usar siempre un `targetOrigin` exacto, nunca `*` | MDN, 2026-09-04 [F34] |

Para el estado de las cookies de terceros en Chrome hay fuentes secundarias de 2026 (Plausible, Usercentrics y otras) que coinciden en que siguen activas con control del usuario. La única fuente primaria hallada es la del 2025-10-17. Safari y Firefox bloquean o parten las cookies de terceros desde hace años. La página de CHIPS dice que Firefox particiona el almacenamiento de terceros por omisión y no trata Safari. Sin verificar contra primaria reciente para Safari.

Consecuencia: la integración con el panel dentro de un iframe necesita una cookie `SameSite=None; Secure; Partitioned` con prefijo `__Host-`, o una ficha en memoria enviada en la cabecera `Authorization`, que evita las cookies pero deja la ficha al alcance de cualquier XSS (inferencia propia). Montar la aplicación bajo el mismo origen que el anfitrión mediante proxy inverso evita todo el problema y es el modo que se debe preferir.

Refine 5 (`@refinedev/core` 5.0.12, 2026-04-02; `@refinedev/simple-rest` 6.0.1, 2025-10-23) espera un `authProvider` con `login`, `check`, `logout`, `onError` y opcionalmente `getIdentity`. La guía de v5 muestra una ficha en `localStorage` enviada en `Authorization` [F37]. Para una cookie de sesión, el proveedor de datos debe enviar `credentials: "include"` en los pedidos entre orígenes. No se leyó la documentación que lo confirme para el proveedor REST, sin verificar. En un mismo origen (el modo recomendado) la cookie viaja sin configuración.

## 4. Productos abiertos que se instalan dentro de otro sitio

| Producto | Qué ofrece para identidad (documentación consultada) | Delegación al anfitrión |
|---|---|---|
| Gitea | Autenticación por proxy inverso, apagada por omisión; cabecera `X-WEBAUTH-USER`; alta automática opcional; proxies confiables `127.0.0.0/8,::1/128` [F29] | Sí, patrón A, sin firma |
| Grafana | `auth.proxy` con lista blanca de IP y cabeceras de rol, correo y grupos; alta automática por omisión; `sync_ttl` [F28] | Sí, patrón A |
| Discourse | DiscourseConnect: HMAC-SHA256, nonce, `return_sso_url` [F30] | Sí, patrón D |
| Metabase | JWT en `/auth/sso`; disponible en los planes Pro y Enterprise [F31] | Sí, de pago |
| Plane | Contraseña (activa si no hay SMTP) y código mágico por correo; OAuth, OIDC, SAML y LDAP en Autenticación, sin que la página indique la edición; proxy y embebido: no tratados [F36] | No documentada |
| Fider | Enlace por correo sin contraseña; OAuth de Google, GitHub y Facebook por variables; Microsoft, Keycloak y Authentik desde el panel; sesiones firmadas con `JWT_SECRET`; sin mención de SSO ni embebido [F36] | No documentada |
| Formbricks | OIDC «parte de la edición Enterprise»; el método por omisión de la edición libre no consta en la página leída [F36] | De pago |
| Umami | Cuenta inicial `admin` con contraseña `umami`, que debe cambiarse; sin mención de SSO ni proxy [F36] | No documentada |
| Plausible (edición comunitaria) | El primer usuario se crea al visitar la instancia; el README no trata otras opciones [F36] | No verificada |

Tres hallazgos. Los productos con SSO nativo en su edición libre son los que aceptan una cabecera de proxy (Gitea, Grafana) o una redirección firmada propia (Discourse). Los demás lo reservan a planes de pago (Metabase, Formbricks) o no lo documentan. Ninguno de los que se instalan dentro de otro sitio firma la cabecera: dependen de la frontera de red, el patrón que fallaron los avisos de oauth2-proxy. Y el único con cuenta inicial conocida (Umami) obliga a cambiarla. Team-platform no debe sembrar ninguna contraseña, y el primer editor sale de una variable de entorno o de una orden de línea de comandos.

La mención de que PLANKA movió su OIDC a un plan de pago en la versión 2.2.0 viene de un resultado secundario y queda sin verificar.

## 5. Tailscale como red e identidad

| Aspecto | Dato | Fuente y fecha |
|---|---|---|
| Identidad por cabecera | `Tailscale-User-Login`, `-Name`, `-Profile-Pic`; Serve borra las que traiga el cliente | Documentación de Serve, validada el 2026-01-20 [F23] |
| Alcance | Solo tráfico de la red privada; Funnel no las lleva; dispositivos etiquetados no las llevan; usuarios con dispositivo compartido sí | ídem |
| Enlace del servicio | Servir a `http://127.0.0.1:3000`; el servicio debe escuchar solo en localhost | ídem |
| Capacidades de aplicación | `Tailscale-App-Capabilities` con `--accept-app-caps`, desde la versión 1.92 | ídem |
| Verificación independiente | Consulta `whois` por el socket local de `tailscaled` con la dirección remota; el cliente de Go expone `WhoIs(ctx, remoteAddr)` | repositorio de Tailscale; guía de agentgateway (secundaria) [F23] |
| `tsnet` | Biblioteca de Go que incorpora Tailscale como dispositivo propio; ejemplos solo en Go; sin otro lenguaje documentado | validada el 2026-07-24 [F23] |
| HTTPS | Exige activar certificados en la red; los nombres de máquina y de la red quedan en el registro público de transparencia de certificados; renovación de 90 días a cargo del usuario con `tailscale cert` | validada el 2025-12-10 [F23] |
| Plan gratuito | 6 usuarios, dispositivos ilimitados de usuario, 50 recursos etiquetados | página de precios, 2026-10-20; guía secundaria del 2026-08-17 coincide y fecha el cambio el 2026-04-08 [F23] |

Limitaciones que importan. El plan gratuito de 6 usuarios queda por debajo del tope de 10 miembros de MASTER-SPEC §1. A partir de 7 hace falta un plan de pago, cuyo precio no se consultó. `tsnet` no sirve a un proceso Node: la opción sería un contenedor auxiliar en Go o `tailscale serve` en el anfitrión. Dentro de Docker, el puerto debe publicarse como `127.0.0.1:PUERTO:PUERTO`. Serve del anfitrión entrega a ese loopback (inferencia propia, sin fuente). La documentación advierte que escuchar en localhost limita la falsificación a otros servicios del mismo equipo. Otro proceso local aún podría fijar las cabeceras. Dos candados adicionales: la consulta `whois` con la dirección de origen, o el patrón B con una firma que el proceso local no puede producir.

Encaje con UD-002: la decisión descartó Tailscale como identidad con contraseña de respaldo y como único método. Un modo `trusted-header` opcional, apagado por omisión y con el proveedor local aún disponible, no contradice esa decisión, porque no reemplaza a ninguno de los dos proveedores del contrato.

## 6. Roles fijos y autorización en Fastify

El orden de ganchos de Fastify es `onRequest`, `preParsing`, lectura del cuerpo, `preValidation`, `preHandler`. En `onRequest` `request.body` es `undefined`. Un gancho de ruta se ejecuta siempre al final de su categoría. Si un gancho asíncrono llama `reply.send()`, debe hacerlo antes de devolver o la solicitud continúa [F17].

Dos consecuencias para el proyecto. Autenticar y comprobar el rol en `onRequest` rechaza una carga multiparte de 40 MB de una persona sin sesión antes de leerla. Y el patrón mínimo es una función que recibe un rol y devuelve un gancho, registrada una sola vez:

| Pieza | Forma | Fuente o estado |
|---|---|---|
| Autenticación | gancho `onRequest` en un contexto encapsulado que llama `identify(request)` y deja `request.member` | Fastify Hooks [F17] |
| Rol | `fastify.requireRole('editor')` devuelve un gancho; la ruta lo declara en `onRequest` | patrón de `fastify-guard` (`role('admin','editor')`) y de la guía de Auth0, ambos con 403 si falta el rol; búsqueda secundaria |
| Composición | `@fastify/auth` 5.1.2 compone verificadores con `and` y `or` | útil con más de dos roles; con `member` y `editor` sobra |
| Denegar por omisión | un gancho `onRoute` que falle al arrancar si una ruta no declara su política | diseño propio; el gancho `onRoute` existe en Fastify, sin verificar en esta consulta |
| Regla de dominio | «solo un miembro distinto del emisor responde» (§4.8) vive en la capa de dominio, no en un gancho | MASTER-SPEC §4.8 |

El enumerado `['member','editor']` queda en el código, con `CHECK` en la tabla `members`. La batería puede recorrer la tabla de rutas de §7.1 y comprobar que cada una declara su política y que `PATCH /members/:id`, `POST /areas` y `GET /settings/providers` devuelven 403 a un miembro.

## 7. Contradicciones declaradas

| Tema | Fuente A | Fuente B | Resolución |
|---|---|---|---|
| Existencia de `crypto.argon2` | Una búsqueda secundaria dice que no existe | Documentación de Node 24 y notas de v24.7.0 la registran | Existe desde 2025-08-27; se usa la primaria |
| Parámetros de Argon2id | OWASP: 19 MiB, 2, 1 | RFC 9106 y la ayuda de Better Auth: 64 MiB, 3, 4 | Piso contra punto de partida; el piso es el valor por omisión, el RFC es el preset fuerte |
| Duración de sesión | OWASP: 15 a 30 minutos de inactividad, 4 a 8 horas absolutas | Better Auth, 7 días; Lucia, 10 y 30 días | Propósitos distintos; se adopta OWASP y se documenta el preset relajado |
| Estado de Lucia | Búsquedas secundarias la llaman archivada | README: deprecada; API de GitHub: `archived: false`, empujón del 2026-08-08 | Deprecada, no archivada |
| `node:sqlite` en Better Auth | Resumen secundario: experimental | Página del adaptador: candidato a versión estable desde Node 24.15.0 | Se toma la página |
| Fecha de la crítica de Better Auth | Sitios secundarios: 2026-10-14 | Repositorio: 2026-09-30 | Se toma el repositorio |
| Cookies de terceros en Chrome | Fuentes secundarias: siguen activas; algunas dicen que se retiró todo Privacy Sandbox | Primaria del 2025-10-17: se retiran varias APIs, se mantienen CHIPS y FedCM y el enfoque de elección | La primaria no dice «sin desaprobación» textualmente; se cita solo lo que dice |
| Descargas de `argon2` en Alpine | Páginas de benchmarks: 54,2 % o 77,8 % de fallos | README: Alpine x64 y arm64 con binarios precompilados | Las páginas se contradicen entre sí y no se usan |

## 8. Sin verificar

Lo que sigue no tiene fuente primaria dentro de los últimos 12 meses o no se leyó.

| Dato | Estado |
|---|---|
| Precio de los planes de Tailscale por encima de 6 usuarios; si el plan gratuito incluye Serve | No consultado; la página de precios no menciona Serve |
| Origen y tamaño de la lista de contraseñas bloqueadas | Sin fuente |
| Si Caddy `forward_auth` borra las cabeceras del cliente antes de copiar las de la respuesta | La página no lo dice |
| Registro de NVD de CVE-2026-40575; RFC 8725 (2020) | Solo fuentes secundarias; no leídos |
| `EventSource` no puede fijar cabeceras propias | Conocimiento previo, sin lectura |
| El proveedor REST de Refine acepta `credentials: "include"` | No leído |
| Estado de las cookies de terceros en Safari | Sin primaria reciente |
| Bucle de eventos y grupo de hilos con la variante asíncrona de `crypto.argon2` bajo varios inicios simultáneos | Sin medir |
| Tiempo de hash en un VPS de 1 vCPU | Sin medir; las mediciones son de un equipo de 16 hilos |
| Existencia y comportamiento del gancho `onRoute` | Conocimiento previo, sin lectura |
| PLANKA movió su OIDC a un plan de pago en la versión 2.2.0 | Resultado secundario |

## 9. Fuentes

Todas consultadas el 2026-10-20. La fecha entre paréntesis es la del documento cuando la página la declara.

| Id | Fuente | URL |
|---|---|---|
| F1 | OWASP, Password Storage Cheat Sheet (sin fecha de página) | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| F2 | RFC 9106, Argon2 (2021) | https://www.rfc-editor.org/rfc/rfc9106.html |
| F3 | Node.js 24, documentación de `crypto` (JSON y HTML) | https://nodejs.org/docs/latest-v24.x/api/crypto.html |
| F4 | Node.js v24.7.0, notas de versión (2025-08-27) | https://nodejs.org/blog/release/v24.7.0 |
| F5 | node-argon2 README, registro npm 0.45.1 (2026-07-21) y API de GitHub | https://github.com/ranisalt/node-argon2 |
| F6 | `@node-rs/argon2`, README y registro npm 2.2.2 (2026-10-06) | https://github.com/napi-rs/node-rs/tree/main/packages/argon2 |
| F7 | npm CLI, incidencia 8320 sobre dependencias opcionales por plataforma | https://github.com/npm/cli/issues/8320 |
| F8 | NIST SP 800-63B-4, autenticadores (3.1.1 y 3.2.2) | https://pages.nist.gov/800-63-4/sp800-63b/authenticators/ |
| F9 | OWASP, Authentication Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html |
| F10 | OWASP, Session Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html |
| F11 | OWASP, CSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html |
| F12 | MDN, Sec-Fetch-Site (2026-09-28) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site |
| F13 | `@fastify/session` README, npm 11.1.5 (2026-10-18) | https://github.com/fastify/session |
| F14 | `@fastify/secure-session` README, npm 8.4.1 (2026-10-09) | https://github.com/fastify/fastify-secure-session |
| F15 | `@fastify/csrf-protection` README, npm 8.0.2 (2026-10-09) | https://github.com/fastify/csrf-protection |
| F16 | `@fastify/rate-limit` README, npm 11.2.1 (2026-10-08) | https://github.com/fastify/fastify-rate-limit |
| F17 | Fastify, Hooks | https://fastify.dev/docs/latest/Reference/Hooks/ |
| F18 | Fastify, Server (`trustProxy`) | https://fastify.dev/docs/latest/Reference/Server/ |
| F19 | Lucia: sitio (actualizado en julio de 2026), README, guías de sesión y API de GitHub | https://lucia-auth.com/ y https://github.com/lucia-auth/lucia |
| F20 | Lucia, `code/auth_session.ts` | https://raw.githubusercontent.com/lucia-auth/lucia/main/code/auth_session.ts |
| F21 | Better Auth: documentación (Fastify, sesiones, correo y contraseña, límite de tasa, SQLite, instalación), paquete `@better-auth/utils` 0.5.0, npm 1.7.12 (2026-10-20) y avisos de seguridad | https://www.better-auth.com/docs/integrations/fastify y https://github.com/better-auth/better-auth/security/advisories |
| F22 | Better Auth, anuncio «Auth.js joins Better Auth» (2025-09-22) y aviso en authjs.dev | https://www.better-auth.com/blog/authjs-joins-better-auth |
| F23 | Tailscale: Serve (validada 2026-01-20), `tsnet` (2026-07-24), HTTPS (2025-12-10), precios; guía secundaria de SSD Nodes (2026-08-17); cliente local de Go | https://tailscale.com/docs/features/tailscale-serve |
| F24 | oauth2-proxy: configuración, GHSA-pxq7-h93f-9jrg (2026-04-14), CVE-2026-40575 (Red Hat y stack.watch) | https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview |
| F25 | Authelia, cabeceras reenviadas (2026-09-25) | https://www.authelia.com/integration/proxies/forwarded-headers/ |
| F26 | Pomerium, identidad del usuario | https://www.pomerium.com/docs/capabilities/getting-users-identity |
| F27 | Cloudflare Access, validación de JWT (2026-05-06) | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ |
| F28 | Grafana, auth proxy | https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/auth-proxy/ |
| F29 | Gitea, autenticación | https://docs.gitea.com/administration/authentication |
| F30 | DiscourseConnect (editado el 2026-05-27) | https://meta.discourse.org/t/setup-discourseconnect-official-single-sign-on-for-discourse-sso/13045 |
| F31 | Metabase, JWT | https://www.metabase.com/docs/latest/people-and-groups/authenticating-with-jwt |
| F32 | Caddy `forward_auth` y nginx `ngx_http_auth_request_module` | https://caddyserver.com/docs/caddyfile/directives/forward_auth y https://nginx.org/en/docs/http/ngx_http_auth_request_module.html |
| F33 | Stripe, webhooks y verificación manual de firmas | https://docs.stripe.com/webhooks |
| F34 | MDN: CHIPS (2026-06-15), Storage Access API (2026-09-04), `postMessage` (2026-09-04) | https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies |
| F35 | Privacy Sandbox, actualización de planes (2025-10-17) | https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies |
| F36 | Plane, Fider, Formbricks, Umami y Plausible: documentación de autenticación e instalación | https://developers.plane.so/self-hosting/govern/authentication, https://docs.fider.io/hosting-instance, https://formbricks.com/docs/self-hosting/configuration/auth-sso/open-id-connect, https://docs.umami.is/docs/install, https://github.com/plausible/community-edition |
| F37 | Refine, interfaz del proveedor de autenticación; npm `@refinedev/core` 5.0.12 | https://refine.dev/docs/guides-concepts/authentication/auth-provider-interface |
| F38 | Descargas semanales, API de npm (2026-10-12 a 2026-10-18) y registro de versiones | https://api.npmjs.org/downloads/point/last-week/ |
| F39 | Mediciones propias: tiempos de hash, interoperabilidad `node:crypto` y `@node-rs/argon2`, contenido del tarball de `argon2` | guiones en el directorio temporal de la sesión |

## 10. Recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Hashear con `crypto.argon2` (Argon2id), formato PHC propio, y exigir Node ≥ 24.7 | Función estable desde 24.7.0; hash interoperable con `@node-rs/argon2` en ambos sentidos; sin compilación nativa | Node 24 docs; notas v24.7.0 (2025-08-27); medición propia 2026-10-20 |
| Mantener `@node-rs/argon2` solo como dependencia de desarrollo para la prueba de interoperabilidad, y como alternativa si se fija un Node anterior | 13 binarios por plataforma incluido linux arm64 musl; riesgo del candado entre plataformas | registro npm 2.2.2 (2026-10-06); npm/cli#8320 |
| Parámetros por omisión 19456 KiB, 2 pasadas, 1 hilo; preset fuerte 65536 KiB, 3 pasadas, 4 hilos; volver a hashear al iniciar sesión si los parámetros cambian | OWASP lista el piso; RFC 9106 la segunda opción; 19 ms contra 110 ms medidos | OWASP; RFC 9106 (2021); medición 2026-10-20 |
| No usar bcrypt ni el scrypt de Node con valores por omisión | bcrypt: solo heredado y 72 bytes; scrypt de Node: N=2^14 y `maxmem` de 32 MiB, bajo el mínimo de OWASP | OWASP; Node 24 docs |
| Contraseña de 15 a 128 caracteres, sin reglas de composición, con lista de bloqueo local y NFKC | NIST 15, 64 y bloqueo; OWASP 15; Better Auth 128 y NFKC; la API de contraseñas filtradas contradice §4.1 | NIST SP 800-63B-4; OWASP Authentication; Better Auth docs, 2026 |
| Sesión en tabla `sessions` con ficha opaca de 32 bytes guardada con SHA-256, cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, regeneración en inicio de sesión y cambio de rol | OWASP exige invalidar en servidor y regenerar; sin estado no se puede revocar | OWASP Session Management; Lucia `auth_session.ts` (2026); `@fastify/secure-session` README |
| Escribir el módulo de sesión sobre `@fastify/cookie`; no adoptar `@fastify/session`, `@fastify/secure-session` ni Better Auth | El esquema ya tiene `sessions`; Better Auth impone esquema y rol propios y tiene al menos 10 avisos en 2026 | npm (2026-10-08); GitHub advisories de Better Auth (2026-09-30) |
| No adoptar Lucia ni Auth.js | Lucia deprecada en marzo de 2025 y no archivada; Auth.js bajo Better Auth con parches de seguridad | README de Lucia; anuncio del 2025-09-22 |
| CSRF con gancho `onRequest`: `Sec-Fetch-Site` y `Origin`, cabecera propia en métodos no seguros, también en el inicio de sesión | OWASP lista ese orden; `SameSite` solo es defensa en profundidad | OWASP CSRF; MDN Sec-Fetch-Site (2026-09-28) |
| Límite por IP con `@fastify/rate-limit` y por cuenta con espera exponencial desde 1 segundo; `trustProxy` con lista de IP, nunca `true` ni saltos | Cuentas, no IP (OWASP); IP del proxy bloquearía a todos | OWASP Authentication; Fastify Server; README rate-limit |
| Delegación en cuatro modos bajo `identify(request)`: `signed-header` (HMAC con marca de tiempo), `jwt` (`jose`, JWKS o secreto), `sso-redirect` (nonce y firma) y `trusted-header` opcional; ninguno da de alta miembros | Patrones vivos con riesgos documentados; UD-007 exige alta manual | Stripe; Cloudflare Access (2026-05-06); DiscourseConnect (2026-05-27); Gitea; Grafana |
| Preferir montar la aplicación bajo el mismo origen que el anfitrión mediante proxy inverso; en iframe, cookie `Partitioned` con `__Host-` | Cookies de terceros bloqueadas o particionadas; CHIPS disponible desde diciembre de 2025 | MDN CHIPS (2026-06-15); MDN Storage Access (2026-09-04) |
| Tailscale solo como red y modo opcional de cabecera; publicar el puerto solo en loopback | Serve borra cabeceras del cliente; falta de alcance directo es la condición; plan gratuito de 6 usuarios | Tailscale Serve (2026-01-20); precios (2026-10-20) |
| Roles `member` y `editor` en un enumerado con `CHECK`; `requireRole` como gancho de ruta en `onRequest`; denegar por omisión; prueba de política por ruta | Orden de ganchos de Fastify; `@fastify/auth` sobra con dos roles | Fastify Hooks; `@fastify/auth` 5.1.2 (2026-10-09) |

## 11. Perillas

Cada una es una variable de entorno o una fila de configuración con su valor por omisión; la fuente justifica el número y no el nombre. Las marcadas «decisión» no tienen un número normativo.

| Perilla | Valor por omisión | Justificación |
|---|---|---|
| `ARGON2_MEMORY_KIB` | 19456 | Mínimo de Argon2id de OWASP (Password Storage, sin fecha de página) |
| `ARGON2_PASSES` | 2 | Misma fila de OWASP |
| `ARGON2_PARALLELISM` | 1 | Misma fila; con 1 vCPU no hay aceleración por hilos |
| `ARGON2_PRESET` fuerte | 65536 KiB, 3 pasadas, 4 hilos | Segunda opción recomendada de RFC 9106 (2021); 110 ms medidos |
| `ARGON2_SALT_BYTES` y `ARGON2_TAG_BYTES` | 16 y 32 | RFC 9106: sal de 128 bits y etiqueta de 256 bits |
| `ARGON2_PEPPER` | vacío | Opcional; OWASP lo admite como defensa en profundidad con el secreto fuera de la base; Node lo acepta en `secret` |
| `PASSWORD_MIN_LENGTH` | 15 | NIST SP 800-63B-4 sección 3.1.1.2 sin segundo factor; OWASP Authentication |
| `PASSWORD_MAX_LENGTH` | 128 | NIST exige permitir al menos 64; 128 es el máximo de Better Auth |
| `SESSION_TOKEN_BYTES` | 32 | OWASP pide al menos 64 bits de entropía; el archivo de sesión de Lucia usa 32 bytes de secreto |
| `SESSION_IDLE_MINUTES` | 30 | Extremo superior de OWASP para aplicaciones de bajo riesgo (decisión de Martín si se relaja) |
| `SESSION_ABSOLUTE_HOURS` | 8 | Ejemplo de OWASP para aplicación de oficina; preset relajado: 7 días deslizantes y 30 absolutos (Better Auth 7 días; guía de Lucia 30) |
| `LOGIN_IP_LIMIT` | 3 solicitudes por 10 segundos | Regla de `/sign-in/email` de Better Auth (límite de tasa, 2026) |
| `LOGIN_BACKOFF_BASE_SECONDS` | 1, se duplica por fallo consecutivo | Ejemplo de espera exponencial de OWASP Authentication |
| `LOGIN_HARD_CAP` | 100 fallos consecutivos | Tope máximo de NIST SP 800-63B-4, sección 3.2.2; después, restablecimiento por un editor |
| `TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` | Valor por omisión de Gitea para `REVERSE_PROXY_TRUSTED_PROXIES`; Fastify exige lista exacta |
| `DELEGATED_TS_TOLERANCE_SECONDS` | 300 | Tolerancia de 5 minutos de las bibliotecas de Stripe; nunca 0 |
| `DELEGATED_SECRET_OVERLAP_HOURS` | 24 | Superposición de secretos al rotar, según Stripe |
| `SSO_NONCE_MINUTES` | 30, uso único | Vencimiento del nonce de DiscourseConnect |
| `JWT_JWKS_REFETCH` | al recibir un `kid` desconocido | Cloudflare rota llaves cada 6 semanas y mantiene la anterior 7 días |
| `DELEGATED_AUTOPROVISION` | apagado, sin opción de encenderlo | UD-007; Grafana lo enciende por omisión y es el contraejemplo |
| `COOKIE_MODE` | `__Host-` con `SameSite=Lax`; `iframe` pasa a `SameSite=None; Secure; Partitioned` | OWASP Session Management; MDN CHIPS (2026-06-15) |
