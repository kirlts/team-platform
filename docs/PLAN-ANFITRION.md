# Team Platform en el sitio anfitrión

Escrito el 2026-10-22 a partir de la nota «[el cliente] Team Platform» de Martín (Saber, 2026-10-22) y de lo conversado esa madrugada. Reemplaza la Mesa de `team.example.org` por una instancia de Team Platform dentro de la consola de superadministrador. Los dos miembros y Martín entran con las credenciales de superadministrador. Claude es un miembro del equipo y un harness ejecuta lo que la clasificación le asigna. Las decisiones del dueño están en [UD-254](USER-DECISIONS.md). Lo que falta decidir está en la última sección.

## Lo que queda al terminar

| Quién | Qué hace | Dónde |
|---|---|---|
| Responsable del cliente | Escribe, graba o adjunta lo que hoy manda por WhatsApp. Ve su envío descompuesto en mensajes por área, con progreso, y las respuestas de cada uno | `team.example.org`, con su usuario de superadministrador |
| Segundo miembro | Igual que el responsable del cliente, con las credenciales de superadministrador que ya conoce | `team.example.org` |
| Martín | Escribe mensajes, lee las respuestas de Claude, marca respondido o cerrado, y empuja a producción bajo UD-150 | `team.example.org` y su sesión de Claude Code |
| Claude | Miembro con perfil propio. Recibe los mensajes que el analizador le asigna leyendo ese perfil, los ejecuta en un harness desatendido y responde en el formato que la plantilla declara | Un trabajador de Team Platform fuera del notebook |

## Punto de partida medido el 2026-10-22

| Qué | Estado |
|---|---|
| `team.example.org` | Sirve la Mesa: HTML generado desde `tools/mesa/data/items.json` (4 ítems), publicado a un bucket, login con el mismo usuario de superadministrador y cookie `anfitrion_mesa_sesion` (JWT RS256 de una hora, sin SSO entre hosts). Caddy lo reescribe a `/mesa` (`borde/Caddyfile:713`) |
| Consola de superadministrador | React 19 con Refine 5, servida en `app.example.org/consola/`; `@anfitrion/design-system` con 105 componentes, entre ellos `Composer`, `FilaDeHilo`, `ColumnasDeBandeja`, `DataTable`, `Toast`, `Avisos` |
| Identidad del anfitrión | `platform_users` con un solo rol, `super_admin`. los dos miembros y Martín entran con esas credenciales (Martín, 22-10: «[el médico] ya tiene acceso superadmin porque conoce las credenciales») |
| Feedback real | 416 archivos en cinco carpetas Sprint fuera de git: videos y audios de WhatsApp, capturas y .docx como «Errores funcionales 6 COMPLETO.docx». Siete pedidos sin atender en `PEDIDOS-DE-LA-CLINICA-SIN-ATENDER.md`, mantenidos a mano |
| Motor de Team Platform | API de 72 rutas con OpenAPI vivo y SSE; identidad delegada en cuatro modos; harness de clasificación con `claude -p`; cola con trabajos `extract` y `analyze` y trabajador separable (`WORKER_MODE=external`) |
| Huecos del motor para un anfitrión | Ningún modo delegado da de alta miembros ni fija el rol (UD-007); con `jwt` o `signed-header` el SSE queda sin sesión; el panel fija `/api` y `/` y una sola cookie `__Host-session`; el prompt dice «equipo de software» y las frases de progreso están en el código; no hay cliente del contrato fuera de `queries.ts` (821 líneas) |
| Ejecución desatendida de Claude Code | Con `ANTHROPIC_API_KEY` cobra a la API, con el token OAuth a la suscripción, y gana la API si hay ambas. `--permission-mode`, `--disallowedTools` (vale en todos los modos), `--max-turns`, `--max-budget-usd`, `--json-schema` con `structured_output`, `stream-json` en tiempo real, `--resume` desde otro proceso, hooks de `.claude/settings.json` del repo |
| Dónde nacen máquinas en el anfitrión | UD-152: corredor efímero en Google Cloud desde una imagen horneada con Docker, Node y el agente de GitHub (`imagen-del-runner.yml`); la enciende GitHub Actions. UD-210: el camino local es el normal de entrega y la puerta en la nube es el respaldo. UD-176: techo diario fuera de producción, 0,75 USD |
| Presupuesto de API | 200 USD de Anthropic para el anfitrión; UD-140 reservó 100 para Team Platform, unos 55 gastados |

## El flujo, del envío del responsable del cliente a producción

| Paso | Quién lo hace | Con qué |
|---|---|---|
| 1. El responsable del cliente o Martín envían texto, audio, video, capturas, documentos o enlaces | La persona | Inicio de Team Platform dentro de la consola, en `team.example.org` |
| 2. Extracción y clasificación en mensajes por área y plantilla, con destinatarios | El motor | Igual que hoy. Los destinatarios salen del perfil de cada miembro (`prompts-es.js:162`, UD-023) |
| 3. Un mensaje asignado a Claude encola un trabajo `execute` | El motor | Trabajo nuevo en la misma cola; eventos de progreso iguales a los del análisis |
| 4. El trabajador externo crea una máquina desde la imagen horneada, corre `claude -p` con el repositorio del anfitrión, y la apaga | Trabajador de Team Platform con `claude` y la llave de API | `--json-schema` compilado del bloque de salida de la plantilla; `--max-budget-usd`, `--max-turns`, `disallowedTools` y los hooks del repositorio del anfitrión como candados; `stream-json` como progreso del trabajo |
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
| A5 Trabajo `execute` y miembro agente | Tipo de trabajo `execute` en la cola, con progreso y traza; un miembro de tipo agente con credencial propia (firma `signed-header` o JWT emitido por Team Platform) que responde y cierra por la API; `WORKER_MODE=external` con un trabajador que corre `claude -p` (Sonnet 5.5, razonamiento medio, `--max-budget-usd 10`, `bypassPermissions`, hasta tres subagentes con la instrucción de paralelizar) y crea y apaga la máquina. El harness recibe la credencial y una orden `team reply` para responder: una al empezar y otra al terminar, en un par de párrafos dirigidos a quien envió, con su perfil y la descripción del proyecto (UD-255) | Prueba de API con un `claude` falso que deja las dos respuestas; traza con costo real |
| A7 «Enviar como» | Desplegable en la barra de envío para enviar en nombre de otro miembro, con el miembro de la sesión por omisión; `POST /inputs` acepta el autor elegido y la auditoría guarda quién tenía la sesión (UD-255) | Flujo de navegador: un miembro envía como otro y el mensaje queda del otro, con la auditoría correcta |
| A6 Cliente del contrato | Paquete `@team-platform/client` extraído de `queries.ts`: claves de caché, invalidaciones, versión al editar, deshacer, multipart, códigos de error; tipos generados del OpenAPI | El panel actual pasa a usarlo sin cambio de comportamiento: batería de navegador en verde |

Ruta crítica: A5 depende de A4. El resto corre en paralelo. Estimado: 1 h de reloj hasta `main` con la batería completa.

### Fase B. El sitio anfitrión, en el repositorio del anfitrión

| Encargo | Qué entrega |
|---|---|
| B1 Instancia | Servicio `team-platform` en el compose del anfitrión (patrón de `compose.override.example.yml`), con su volumen, `PROJECT_NAME=<nombre del anfitrión>`, encuadre del anfitrión y la llave de API en el secreto de la máquina. Caddy sirve `team.example.org` apuntando a él en lugar de `/mesa` |
| B2 Identidad | Login propio en `team.example.org` que comparte la cookie de sesión con la consola: una cookie con `Domain=.example.org` que la consola también lee (hoy guarda el JWT en `sessionStorage`). Team Platform valida el JWT RS256 con la llave pública en el modo de A1 y da de alta al miembro; Martín editor, el resto miembros (UD-255) |
| B3 Interfaz | Las vistas de Team Platform (Inicio, Mensajes, ficha, Áreas, Equipo, Configuración) con `@anfitrion/design-system` y el cliente de A6, servidas en `team.example.org` con la estética del panel de la clínica, no la de la consola (UD-255) |
| B4 Áreas y plantillas del anfitrión | Las de la decisión pendiente, con bloque de salida cada una |
| B5 Miembros | Los dos miembros, Martín y Claude con sus perfiles; Claude con la credencial de A5. El segundo miembro recibe su propia cuenta de superadministrador: Team Platform identifica al miembro por el `sub` del JWT |
| B6 Retiro de la Mesa | `tools/mesa/` deja de publicarse; la regla 19 de `CLAUDE.md` y la memoria `memoria-de-la-mesa` se reescriben; la sección «Claude» según la decisión pendiente |

Depende de A1, A4, A5 y A6. Estimado: 1,5 h de reloj, con el despliegue del anfitrión medido en su propio flujo.

### Fase C. El harness en el anfitrión

| Encargo | Qué entrega |
|---|---|
| C1 Máquina | El trabajador externo de Team Platform crea una instancia desde la imagen horneada (`imagen-del-runner.yml`) con `gcloud`, sin GitHub Actions, y la retira al terminar; gasto sujeto a UD-176 |
| C2 Candados | Los del repositorio del anfitrión (hooks, candados de invariantes, `check-secretos`), `--max-budget-usd 10`, sin lista blanca de herramientas; `claude` corre con un usuario sin privilegios porque `bypassPermissions` no arranca como root fuera de un sandbox. En producción toca lo mismo que una sesión interactiva de Martín (UD-255) |
| C3 Verificación proporcional | El harness corre lo que el clasificador de `desplegar.yml:240` decide para su cambio: pruebas de pantalla, batería corta o gemelo |
| C4 Entrega | El harness deja una rama `tp/<id-del-mensaje>` y la salida; Martín entrega por el camino local (UD-210). Nada empuja a `main` sin él |
| C5 Historial | El anfitrión declara `EXECUTE_MACHINE_COLLECT` (copia de la transcripción a un almacén con su regla de retención) y pone en las instrucciones de sus sesiones las dos líneas de «Dónde mirar los tiempos» de `docs/INSTALACION.md` (UD-262) |

Depende de B. Estimado: 1 h de reloj, más una corrida real con un mensaje de prueba del responsable del cliente, medida desde el envío hasta la rama entregada.

## Lo que falta decidir

UD-255 decidió sesión, roles, datos reales, harness, las dos respuestas de Claude y «Enviar como». Quedan dos, para la mañana del 2026-10-22, hora de Chile:

| Decisión | Por qué no se infiere | Propuesta |
|---|---|---|
| Áreas y plantillas del anfitrión | La Mesa usa Agenda, Infraestructura y Deva con tipos Pedido y Hallazgo; Team Platform trae Idea, Error, Nueva funcionalidad, Retroalimentación y Pregunta | Las cinco de Team Platform, con un campo «módulo» (Agenda, Deva, Pagos, Consola, Infraestructura) en cada plantilla |
| Miembros y perfiles | Los perfiles deciden qué recibe cada uno, incluido Claude; los escribe cada persona | Martín escribe el de Claude; los dos miembros el suyo en su primer ingreso |
