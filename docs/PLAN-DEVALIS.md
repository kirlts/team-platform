# Team Platform en Devalis

Escrito el 2026-10-22 a partir de la nota «Devalis Team Platform» de Martín (Saber, 2026-10-22) y de lo conversado esa madrugada. Reemplaza la Mesa de `team.devalis.cl` por una instancia de Team Platform dentro de la consola de superadministrador. Pablo, Alejandro y Martín entran con las credenciales de superadministrador. Claude es un miembro del equipo y un harness ejecuta lo que la clasificación le asigna. Las decisiones del dueño están en [UD-254](USER-DECISIONS.md). Lo que falta decidir está en la última sección.

## Lo que queda al terminar

| Quién | Qué hace | Dónde |
|---|---|---|
| Pablo | Escribe, graba o adjunta lo que hoy manda por WhatsApp. Ve su envío descompuesto en mensajes por área, con progreso, y las respuestas de cada uno | `team.devalis.cl`, con su usuario de superadministrador |
| Alejandro | Igual que Pablo, con las credenciales de superadministrador que ya conoce | `team.devalis.cl` |
| Martín | Escribe mensajes, lee las respuestas de Claude, marca respondido o cerrado, y empuja a producción bajo UD-150 | `team.devalis.cl` y su sesión de Claude Code |
| Claude | Miembro con perfil propio. Recibe los mensajes que el analizador le asigna leyendo ese perfil, los ejecuta en un harness desatendido y responde en el formato que la plantilla declara | Un trabajador de Team Platform fuera del notebook |

## Punto de partida medido el 2026-10-22

| Qué | Estado |
|---|---|
| `team.devalis.cl` | Sirve la Mesa: HTML generado desde `tools/mesa/data/items.json` (4 ítems), publicado a un bucket, login con el mismo usuario de superadministrador y cookie `devalis_mesa_sesion` (JWT RS256 de una hora, sin SSO entre hosts). Caddy lo reescribe a `/mesa` (`borde/Caddyfile:713`) |
| Consola de superadministrador | React 19 con Refine 5, servida en `app.devalis.cl/consola/`; `@devalis/design-system` con 105 componentes, entre ellos `Composer`, `FilaDeHilo`, `ColumnasDeBandeja`, `DataTable`, `Toast`, `Avisos` |
| Identidad de Devalis | `platform_users` con un solo rol, `super_admin`. Pablo, Martín y Alejandro entran con esas credenciales (Martín, 22-10: «el doctor ya tiene acceso superadmin porque conoce las credenciales») |
| Feedback real | 416 archivos en cinco carpetas Sprint fuera de git: videos y audios de WhatsApp, capturas y .docx como «Errores funcionales 6 COMPLETO.docx». Siete pedidos sin atender en `PEDIDOS-DE-LA-CLINICA-SIN-ATENDER.md`, mantenidos a mano |
| Motor de Team Platform | API de 72 rutas con OpenAPI vivo y SSE; identidad delegada en cuatro modos; harness de clasificación con `claude -p`; cola con trabajos `extract` y `analyze` y trabajador separable (`WORKER_MODE=external`) |
| Huecos del motor para un anfitrión | Ningún modo delegado da de alta miembros ni fija el rol (UD-007); con `jwt` o `signed-header` el SSE queda sin sesión; el panel fija `/api` y `/` y una sola cookie `__Host-session`; el prompt dice «equipo de software» y las frases de progreso están en el código; no hay cliente del contrato fuera de `queries.ts` (821 líneas) |
| Ejecución desatendida de Claude Code | Con `ANTHROPIC_API_KEY` cobra a la API, con el token OAuth a la suscripción, y gana la API si hay ambas. `--permission-mode`, `--disallowedTools` (vale en todos los modos), `--max-turns`, `--max-budget-usd`, `--json-schema` con `structured_output`, `stream-json` en tiempo real, `--resume` desde otro proceso, hooks de `.claude/settings.json` del repo |
| Dónde nacen máquinas en Devalis | UD-152: corredor efímero en Google Cloud desde una imagen horneada con Docker, Node y el agente de GitHub (`imagen-del-runner.yml`); la enciende GitHub Actions. UD-210: el camino local es el normal de entrega y la puerta en la nube es el respaldo. UD-176: techo diario fuera de producción, 0,75 USD |
| Presupuesto de API | 200 USD de Anthropic para Devalis; UD-140 reservó 100 para Team Platform, unos 55 gastados |

## El flujo, del envío de Pablo a producción

| Paso | Quién lo hace | Con qué |
|---|---|---|
| 1. Pablo o Martín envían texto, audio, video, capturas, documentos o enlaces | La persona | Inicio de Team Platform dentro de la consola, en `team.devalis.cl` |
| 2. Extracción y clasificación en mensajes por área y plantilla, con destinatarios | El motor | Igual que hoy. Los destinatarios salen del perfil de cada miembro (`prompts-es.js:162`, UD-023) |
| 3. Un mensaje asignado a Claude encola un trabajo `execute` | El motor | Trabajo nuevo en la misma cola; eventos de progreso iguales a los del análisis |
| 4. El trabajador externo crea una máquina desde la imagen horneada, corre `claude -p` con el repositorio de Devalis, y la apaga | Trabajador de Team Platform con `claude` y la llave de API | `--json-schema` compilado del bloque de salida de la plantilla; `--max-budget-usd`, `--max-turns`, `disallowedTools` y los hooks del repositorio de Devalis como candados; `stream-json` como progreso del trabajo |
| 5. El harness prueba, toca producción sólo por el simulador (UD-169), deja una rama con el cambio y devuelve la salida declarada | Claude Code desatendido | Las mismas herramientas que una sesión interactiva |
| 6. La salida entra como respuesta de Claude al mensaje; el trabajo marca el mensaje como respondido | El trabajador, con la credencial del miembro Claude | `POST /messages/:id/replies` |
| 7. Martín lee, entra a la sesión si quiere (`--resume <session_id>`), y empuja por el camino local | Martín | UD-210 y UD-150 |

## Fases

Las duraciones salen de lo medido hoy. Un agente de una pieza de producto tarda 6 a 25 min. Una fusión con choques, 1 a 5 min. Una subida al VPS, 1 a 6 min. La batería completa de navegador, 5 min.

### Fase A. El motor como framework, en este repositorio

Seis encargos independientes, a la vez, cada uno en su rama.

| Encargo | Qué entrega | Cómo se prueba |
|---|---|---|
| A1 Identidad del anfitrión | Un modo delegado donde el anfitrión da de alta al miembro y fija su rol (reversión de UD-007 por su condición escrita). Tras validar el JWT o la firma, el servidor emite su propia cookie de sesión, para que el SSE funcione. `GET /me` dice de dónde vino la identidad | Prueba de API con un JWT RS256 firmado por una llave de prueba y un flujo de navegador con SSE vivo |
| A2 Panel montable | `API_PREFIX` y `basename` leídos del entorno; nombre de cookie por instancia; retorno del SSO configurable; CSP con `connect-src` del anfitrión | Dos instancias en un mismo nombre de host sin pisarse la sesión |
| A3 Encuadre por instalación | El encuadre del prompt («equipo de software») y las frases de progreso pasan a ajustes editables por el Editor; el catálogo de proveedores admite uno nuevo sin tocar código | Prueba de que el prompt lleva el encuadre guardado |
| A4 Salida declarada en la plantilla | Un bloque de salida en el frontmatter de cada plantilla, compilado con el mismo `compileFieldsSchema`, exigido como `--json-schema` al harness; sin `structured_output` el trabajo falla | Prueba con una plantilla que declara salida y un harness falso que la omite |
| A5 Trabajo `execute` y miembro agente | Tipo de trabajo `execute` en la cola, con progreso y traza; un miembro de tipo agente con credencial propia (firma `signed-header` o JWT emitido por Team Platform) que responde y cierra por la API; `WORKER_MODE=external` con un trabajador que corre `claude -p` y crea y apaga la máquina | Prueba de API con un `claude` falso; traza con costo real |
| A6 Cliente del contrato | Paquete `@team-platform/client` extraído de `queries.ts`: claves de caché, invalidaciones, versión al editar, deshacer, multipart, códigos de error; tipos generados del OpenAPI | El panel actual pasa a usarlo sin cambio de comportamiento: batería de navegador en verde |

Ruta crítica: A5 depende de A4. El resto corre en paralelo. Estimado: 1 h de reloj hasta `main` con la batería completa.

### Fase B. Devalis como anfitrión, en el repositorio de Devalis

| Encargo | Qué entrega |
|---|---|
| B1 Instancia | Servicio `team-platform` en el compose de Devalis (patrón de `compose.override.example.yml`), con su volumen, `PROJECT_NAME=Devalis`, encuadre de Devalis y la llave de API en el secreto de la máquina. Caddy sirve `team.devalis.cl` apuntando a él en lugar de `/mesa` |
| B2 Identidad | La consola firma el JWT RS256 de superadministrador; Team Platform lo valida con la llave pública en el modo de A1 y da de alta al miembro con el rol decidido |
| B3 Interfaz | Las vistas de Team Platform (Inicio, Mensajes, ficha, Áreas, Equipo, Configuración) dentro de la aplicación de la consola, con `@devalis/design-system` y el cliente de A6, servidas en `team.devalis.cl` |
| B4 Áreas y plantillas de Devalis | Las de la decisión pendiente, con bloque de salida cada una |
| B5 Miembros | Pablo, Alejandro, Martín y Claude con sus perfiles; Claude con la credencial de A5. Team Platform identifica al miembro por el `sub` del JWT: cada persona necesita su propia fila en `platform_users`, aunque compartan rol |
| B6 Retiro de la Mesa | `tools/mesa/` deja de publicarse; la regla 19 de `CLAUDE.md` y la memoria `team-devalis-es-donde-martin-lee` se reescriben; la sección «Claude» según la decisión pendiente |

Depende de A1, A4, A5 y A6. Estimado: 1,5 h de reloj, con el despliegue de Devalis medido en su propio flujo.

### Fase C. El harness en Devalis

| Encargo | Qué entrega |
|---|---|
| C1 Máquina | El trabajador externo de Team Platform crea una instancia desde la imagen horneada (`imagen-del-runner.yml`) con `gcloud`, sin GitHub Actions, y la retira al terminar; gasto sujeto a UD-176 |
| C2 Candados | `disallowedTools` con lo que el harness nunca hace (empujar a `main`, tocar producción fuera del simulador, borrar), hooks del repositorio de Devalis, `--max-budget-usd` y `--max-turns` por mensaje, sandbox de red con los dominios permitidos |
| C3 Verificación proporcional | El harness corre lo que el clasificador de `desplegar.yml:240` decide para su cambio: pruebas de pantalla, batería corta o gemelo |
| C4 Entrega | El harness deja una rama `tp/<id-del-mensaje>` y la salida; Martín entrega por el camino local (UD-210). Nada empuja a `main` sin él |

Depende de B. Estimado: 1 h de reloj, más una corrida real con un mensaje de prueba de Pablo, medida desde el envío hasta la rama entregada.

## Lo que falta decidir

Cada fila trae una propuesta para contestar con una palabra.

| Decisión | Por qué no se infiere | Propuesta |
|---|---|---|
| Áreas y plantillas de Devalis | La Mesa usa Agenda, Infraestructura y Deva con tipos Pedido y Hallazgo; Team Platform trae Idea, Error, Nueva funcionalidad, Retroalimentación y Pregunta. La nota habla de «errores directos, cambios bien descritos, ideas que pueden investigarse» | Las cinco de Team Platform, con un campo «módulo» (Agenda, Deva, Pagos, Consola, Infraestructura) en cada plantilla |
| Sesión en `team.devalis.cl` | Hoy la Mesa pide login aparte en ese host, porque la cookie de la consola no cruza hosts | Login aparte, como la Mesa; sesión compartida cuando exista SSO en Devalis |
| Rol de cada uno en Team Platform | Team Platform tiene `member` y `editor`; nadie dijo quién edita áreas y plantillas | Martín editor; Pablo y Claude miembros |
| Una fila de `platform_users` por persona | Si Pablo y Alejandro entran con la misma cuenta, Team Platform los ve como un solo miembro: un perfil, un «para mí» y una autoría compartidos | Una fila por persona, con la misma contraseña si así lo prefieren; es un alta en la tabla, sin cambiar el rol |
| Contenido de pacientes dentro de Team Platform | Los videos de Pablo nombran pacientes reales. La regla de la Mesa prohíbe que lleguen a `team.devalis.cl`; Team Platform guardaría ese contenido en su base, detrás del login de superadministrador | Se acepta dentro del mismo perímetro que protege a las clínicas; `redactar.py` se aplica sólo a lo que salga del perímetro (ramas, commits, respuestas que viajen a GitHub) |
| Sección «Claude» de la Mesa | Regla 19 y la memoria dicen que Martín lee ahí las respuestas, copiadas del registro de la conversación | Desaparece: la respuesta de Claude a cada mensaje la reemplaza. Las transcripciones completas siguen en el depósito privado |
| Modelo y tope por mensaje del harness | 27k a 150k tokens medidos por invocación; el costo depende del modelo y del tope | Sonnet 5.5 con `--max-budget-usd 2` y `--max-turns 60` por mensaje; Opus sólo si el perfil de Claude lo pide para un mensaje |
| Qué puede tocar el harness en producción | UD-169 fija el simulador como única puerta para conversaciones; nada dice de leer logs, Grafana o la base | Lectura de logs y métricas sí; escritura sólo por el simulador |
| Orden de las fases | A entera antes de B, o B con lo mínimo de A | A entera primero: cada hueco de A ya costó una vuelta en la mesa de OKOS |
