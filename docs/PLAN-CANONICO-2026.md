# Plan 2026 del Team Platform canónico

Fecha: 2026-10-26, 23:40 (Chile). Lo pidió Martín: «Quiero que todo lo que hemos hecho en Team Platform tratemos
de integrarlo en la versión canónica de Team Platform, que es el repositorio Team Platform, porque siempre fue
conceptualizado como un sistema open source». Y fijó el límite del plan: «quiero que todo lo que tú recomendaste sea
lo que implementemos, excepto esta cuestión de la identidad que te acabo de corregir»: la identidad visual nueva es
la del panel canónico; una implementación puede no usar ese panel y poner el suyo, y eso está bien.

La tesis que ordena el plan: **el canónico es el producto; un anfitrión lo instala, le conecta un driver y, si
quiere, le pone su piel. Todo lo que no nombra a un anfitrión vive en el canónico, con su prueba; lo que sí lo
nombra vive en el anfitrión, detrás de un contrato con versión y con una prueba de conformidad.** Hoy el núcleo ya
es genérico, pero las piezas que hacen funcionar a Claude desatendido viven en el repositorio del primer anfitrión,
y el `main` del canónico sólo avanza cuando ese anfitrión despliega. Un segundo anfitrión no puede instalarlo sin
copiar a mano. El plan devuelve esas piezas a su lugar, área por área, y lo demuestra con un segundo anfitrión real.

Sin estimaciones de tiempo: cada fase tiene un criterio de salida que se mide con un comando. Sin ventanas de
reloj («una semana sin fallas»): cada criterio es un evento o un conteo.

## 1. Lo medido el 2026-10-26

| Medida | Valor | Cómo se midió |
|---|---|---|
| Menciones a otros proyectos o personas en `src/` | 0 | `grep -rniE` sobre `src/`; la regla 10 lo exige (`public-names.test.js`) |
| Pruebas en el canónico | 177 en `src/`, 115 en `panel/src`, 9 en `scripts/` | `git ls-tree -r origin/desarrollo` contando `*.test.*` |
| Distancia entre `desarrollo` y `main` | 76 commits (`9380f7cb` contra `f41dd388`) | `git rev-list --count` |
| Variables del contrato de ejecución | 46 `EXECUTE_*` en `src/config.js` | `grep -oE 'EXECUTE_[A-Z_]+'` |
| Drivers de máquina en el canónico | 0 en `desarrollo`; 1 de referencia (`drivers/docker-local`) en la rama `wt-driver-local`, con prueba contra Docker real | árbol del repositorio y `git log` de la rama |
| Pruebas de conformidad de un anfitrión | 0 | no existe un guion que ejercite CREATE, RUN, COLLECT, DESTROY y la entrega contra un driver |
| Piezas genéricas del arnés que viven en el primer anfitrión | 54 archivos: máquina 15, vista y capturas 12, entrega 6, ganchos 4, arnés 2, ensayo 2, imagen y tema 8, utilerías 2 | `git ls-tree` de la rama de despliegue del anfitrión, directorio de integración de Team Platform |
| Canario de Claude desatendido | existe, en el anfitrión; en el canónico, `scripts/canary.mjs` en `wt-driver-local` | mismos árboles |
| Anfitriones instalados | 1 | el único que sirve una instancia |
| Instalación en un servidor limpio con dominio propio | sin probar | `docs/TODO.md`, EPIC-007 |
| Cómo avanza `main` | sólo con `DEPLOY_PUBLISHES_MAIN=<sha>`, marca que exporta el guion de despliegue del anfitrión; espejo en un flujo de GitHub Actions sobre `ubuntu-latest` | `.githooks/pre-push`, `.github/workflows/main-solo-desde-desarrollo.yml` |
| Filas abiertas en `docs/HALLAZGOS.md` | 0 contra `main` al 21-10 | cabecera del documento |
| Puntos sin marcar en `docs/TODO.md` | 14; 9 esperan hardware, dominio, llave o a Martín | `grep -c '^- \[ \]'` |
| Identidad visual | tokens Y2K en `panel/DISENO.md` y `panel/src/styles.css` (Orbitron, Source Sans 3, OKLCH, vidrio, cromo, gel, luces de estado); el encargo de Martín de hoy no está escrito como fuente | lectura; auditoría con capturas en la rama `wt-identidad` |
| Worktrees vivos en el repositorio canónico | 140 | `ls .claude/worktrees` |
| Vocabulario de la interfaz | Kairós en documentos; rótulos del panel en castellano estándar | `docs/KAIROS.md`, `panel/src` |

## 2. Qué difiere del diseño, por clase

| Clase | Casos de hoy | Qué lo corrige |
|---|---|---|
| **Pieza genérica que vive en un anfitrión** | el canario; el capturador de pantallas con máscara y guardia; las guardias de órdenes y de herramientas del arnés; la exigencia de cierre de sesión; el barrido de máquinas huérfanas; el mapa del repositorio; las instrucciones genéricas del arnés mezcladas con las del anfitrión | Cada una entra al canónico con su prueba; el anfitrión borra su copia cuando el canario pasa con la del canónico |
| **Contrato sin driver ni conformidad** | 46 variables documentadas en MASTER-SPEC §7.5, ningún driver en el árbol, ninguna prueba que diga «este anfitrión cumple» | `docs/CONTRATO-DE-ANFITRION.md` con versión, `drivers/docker-local` de referencia y `scripts/host-conformance.mjs` |
| **Publicación de `main` atada a un anfitrión** | `DEPLOY_PUBLISHES_MAIN` la emite el despliegue del primer anfitrión; sin él, el canónico no publica | Puerta propia del canónico: el sello lo emite `scripts/publish-main.sh` tras la batería y la conformidad; el anfitrión fija su versión por sha o digest, no por `main` |
| **Instalación no reproducible** | EPIC-007 sin servidor limpio; `compose.override.example.yml` sin instalación que lo pruebe | La instalación se prueba en el segundo anfitrión y queda como guion repetible |
| **Capacidades maduradas bajo presión, sin lista** | reintentar, retomar por versión, Guardia de la idea, entrega aparte, revisión por persona, medios en la respuesta: cada una con prueba, ninguna en una lista que diga qué es 1.0 | `docs/CAPACIDADES-1.0.md`: una fila por capacidad, su prueba desde el envío hasta la respuesta y su veredicto de juez |
| **Identidad sin fuente escrita** | DISENO.md cita referencias de 2026-10 pero no el encargo de hoy | El encargo entra textual a DISENO.md; una dirección elegida; jueces contra el encargo |
| **Higiene** | 140 worktrees; ramas de pasadas del anfitrión en el canónico | Guion de limpieza con condición declarada; las ramas de pasada se borran al fusionarse |

Las siete son la misma deriva: una verdad del producto que vive fuera del repositorio del producto.

## 3. Objetivo y cómo se mide

| Indicador | Hoy | Objetivo | Dónde se lee |
|---|---|---|---|
| Anfitriones que instalan el canónico sin copiar archivos a mano | 0 de 1 | 2 de 2 (el primero, migrado; el segundo, nuevo) | `scripts/host-conformance.mjs` en verde en cada uno |
| Archivos del arnés genérico fuera del canónico | 54 | 0 que no nombren al anfitrión | inventario del directorio de integración del anfitrión |
| Drivers conformes | 0 | 3: local de referencia, máquinas efímeras del primer anfitrión, máquinas bajo demanda del segundo | `host-conformance.mjs --driver <ruta>` |
| Cómo avanza `main` | marca del anfitrión | sello de la puerta del canónico | `.githooks/pre-push`, `scripts/publish-main.sh` |
| Capacidades 1.0 con prueba e2e y juez | sin lista | todas las de la lista | `docs/CAPACIDADES-1.0.md` |
| Identidad | tokens sin encargo escrito | dirección elegida por Martín, implementada, con nota de jueces contra el encargo | `panel/DISENO.md`, `docs/investigaciones/identidad-2026-10-26/` |
| Worktrees | 140 | sólo los de agentes vivos | `scripts/clean-worktrees.sh --list` |

## 4. Principios que no ceden

1. **El núcleo no conoce anfitriones.** Ningún archivo de `src/`, `panel/`, `scripts/` ni `drivers/` nombra un proyecto, un cliente ni una persona (regla 10). Lo que necesita saber del anfitrión entra por el contrato.
2. **El contrato tiene versión y prueba.** `contract_version` se publica en `/health` y en `docs/CONTRATO-DE-ANFITRION.md`. Un cambio incompatible sube la versión; un driver declara la que cumple; la conformidad lo verifica.
3. **Un driver son cinco órdenes de shell y nada más.** CREATE, RUN, COLLECT, DESTROY y DELIVER, con marcadores y códigos 0, 75 y 76. Si un anfitrión necesita algo más, se cambia el contrato. No se le abre una puerta lateral.
4. **Se generaliza antes de duplicar.** Una pieza que un segundo anfitrión necesitaría igual entra al canónico; nunca se copia.
5. **Ningún número gobierna sin declaración.** Plazos, topes y concurrencias llevan su medición o su perilla. Lo que no puede medirse espera por evento.
6. **Un error nunca es ausencia.** Permiso, red o credencial que fallan detienen con 75 y su marca; nunca deciden «no hay máquina», «no hay rama» ni «sin tope».
7. **Lo que se retira deja escrita su condición de regreso.** Un archivo del anfitrión se borra cuando su canario pasa con la pieza canónica. `DEPLOY_PUBLISHES_MAIN` se retira cuando `publish-main.sh` publicó una vez.
8. **Toda pantalla se juzga abierta,** con capturas programáticas y jueces que no la escribieron, contra el encargo escrito.

## 5. Arquitectura objetivo

| Capa | Qué posee | Dónde vive |
|---|---|---|
| **Núcleo** | API, cola, extractores, analizador, trabajo `execute`, trabajo `deliver`, retoma, reintento, Guardia de la idea, canario, capturador, guardias del arnés, panel canónico con su identidad | este repositorio |
| **Contrato de anfitrión** | variables `EXECUTE_*`; las cinco órdenes con marcadores, entorno y códigos; `EXECUTE_HOST_INSTRUCTIONS`; `THEME_CSS`; identidad delegada; `contract_version` | `docs/CONTRATO-DE-ANFITRION.md`, `src/config.js`, `/health` |
| **Drivers** | la implementación de las cinco órdenes para un lugar donde correr: contenedor local, máquina efímera en una nube, máquina bajo demanda en una plataforma de aplicaciones | `drivers/<nombre>/` en el canónico cuando no nombran a nadie; en el anfitrión cuando sí |
| **Anfitrión** | su repositorio, sus credenciales, su camino a producción, su piel opcional, sus instrucciones al agente | el repositorio del anfitrión |

El flujo que el contrato sostiene, igual en los dos anfitriones: una persona envía; el analizador reparte en
mensajes por área y plantilla; un mensaje asignado al agente encola `execute`; el trabajador llama CREATE, RUN,
COLLECT y DESTROY del driver; la sesión devuelve la salida que la plantilla declara, con los medios que la propia
sesión decidió adjuntar. El núcleo comprueba que cada medio declarado existe antes de entregar (prueba: `src/execute/deliver.test.js`, fase 1). `deliver` llama la
orden de entrega del anfitrión y la respuesta queda en el hilo con «En producción desde HH:MM».

Quién decide qué, para no volver a confundirlo: la sesión de Claude decide, leyendo la plantilla, si una respuesta
lleva foto, video o captura y cómo dirigirla. El núcleo comprueba que lo declarado está presente al entregar y no
cierra una respuesta con un medio declarado ausente (la misma prueba). El anfitrión decide dónde corre la sesión y cómo llega su rama a
producción. El núcleo no decide ninguna de las tres cosas.

## 6. Piezas por área

Estado al 2026-10-26: **hecho** (en `desarrollo`), **en rama** (con su sha), **por hacer**.

### A. Contrato y drivers

| Pieza | Qué es | Estado |
|---|---|---|
| A1 `docs/CONTRATO-DE-ANFITRION.md` | El contrato entero en un solo documento: variables, cinco órdenes, marcadores, entorno, códigos 0/75/76, `##team phase` y `##team wait`, entrega repetible, `contract_version`. Sale de MASTER-SPEC §7.5 y de lo que el primer anfitrión documentó por su lado | por hacer |
| A2 `drivers/docker-local` | Driver de referencia: CREATE levanta un contenedor desde `drivers/docker-local/Dockerfile`, RUN copia `{workdir}` y corre `bash run.sh`, COLLECT saca la transcripción, DESTROY borra siempre, DELIVER de ejemplo que empuja la rama a un remoto local | en rama `wt-driver-local` (`c4ea9192`, `e01edb75`) |
| A3 `scripts/host-conformance.mjs` | Prueba de conformidad: con un driver y un trabajo de prueba ejercita las cinco órdenes, verifica el NDJSON de la sesión, que DESTROY corre tras un fallo y tras un plazo vencido, que 75 no gasta intento, que 76 deja `delivery_held`, y que DELIVER es repetible. Sale 0 sólo si todo pasa; imprime la `contract_version` que cumple | por hacer |
| A4 `drivers/fly-machines` | Driver de máquinas bajo demanda sobre la API de Fly Machines: CREATE crea una máquina desde una imagen declarada con `auto_destroy`, RUN ejecuta por `exec`, COLLECT lee la transcripción, DESTROY la destruye; cada máquina nace con vida máxima declarada. Sin nombrar al anfitrión que lo usará | por hacer |
| A5 Driver de máquinas efímeras en nube del primer anfitrión | Sigue en su repositorio porque nombra su proyecto y su cuota; en el canónico se cita como ejemplo externo, sin nombre, en `drivers/README.md` | hecho en el anfitrión; cita por hacer |
| A6 `contract_version` en `/health` y en la salida del trabajador al arrancar | El trabajador rechaza arrancar con un driver que declare otra versión mayor | por hacer |

### B. Piezas que vuelven del anfitrión al núcleo

| Pieza | Qué es | Estado |
|---|---|---|
| B1 `scripts/canary.mjs` | Un envío con destinatario agente, análisis, publicación, `execute`, respuesta «OK» en el hilo; todo por evento; sale 0 sólo con la respuesta; cierra y borra su mensaje. Corre tras instalar y tras cada despliegue del anfitrión | en rama `wt-driver-local` (`scripts/canary.mjs`, `canary.test.mjs`) |
| B2 `src/execute/captures/` | Capturador de pantallas del arnés: navegador sin cabeza, máscara de datos, zona abierta (`EXECUTE_CAPTURES_OPEN_ZONE`), declaración de qué muestra cada captura (UD-268). Hoy vive en el anfitrión como `vista/` | por hacer |
| B3 `src/execute/hooks/` | Guardias de órdenes y de herramientas que el anfitrión configura por lista, y la exigencia de cierre: una sesión termina con salida válida o el trabajo falla con motivo | por hacer; la exigencia de cierre existe en parte (Guardia de la idea, retoma) |
| B4 Barrido de máquinas huérfanas | Al arrancar, el trabajador llama DESTROY de toda `execute_runs` con máquina creada y sin destruir; nada queda sin atender (UD de 2026-10-25) | por hacer |
| B5 Instrucciones del arnés | Separar en dos: lo que toda sesión de Team Platform necesita (cómo responde, qué declara, cómo adjunta) va al núcleo; lo del anfitrión sigue en `EXECUTE_HOST_INSTRUCTIONS` | por hacer |
| B6 Mapa del repositorio | Guion que resume al agente la estructura del repositorio del anfitrión al abrir sesión; genérico | por hacer |
| B7 Vista de estado del agente | Lo que el anfitrión dibuja hoy aparte (trabajo, máquina, tramo, costo) entra al panel canónico como parte de la ficha del mensaje | por hacer; el panel ya muestra progreso y reintento |

### C. Publicación propia de `main`

| Pieza | Qué es | Estado |
|---|---|---|
| C1 `scripts/publish-main.sh` | La única puerta: toma el sha de `desarrollo`, corre la batería dirigida sobre ese sha, corre la conformidad con `docker-local`, y emite el sello `RELEASE_PUBLISHES_MAIN=<sha>` para el gancho | por hacer |
| C2 Gancho `pre-push` | Acepta el sello de C1 en vez de `DEPLOY_PUBLISHES_MAIN`; lo demás igual: `desarrollo` o ancestro, avance rápido, nunca borrar | por hacer |
| C3 Flujo de GitHub Actions | Queda como espejo opcional de la misma regla; no es requisito: la verificación corre en la máquina que publica. Nada del canónico depende de tener presupuesto en GitHub | por hacer |
| C4 Versión y etiqueta | Cada publicación de `main` lleva etiqueta `vX.Y.Z` y una línea en `CHANGELOG.md`; el anfitrión fija la que instala por sha o digest | por hacer |
| C5 El anfitrión deja de mover `main` | Su despliegue ya no exporta la marca; fija versión del canónico como fija la de cualquier dependencia | por hacer en el anfitrión, tras C1 |

### D. Núcleo 1.0

| Pieza | Qué es | Estado |
|---|---|---|
| D1 `docs/CAPACIDADES-1.0.md` | Una fila por capacidad: mensajes, respuestas e hilos, menciones, miembros y perfiles, roles de equipo, áreas y plantillas con bloque `output`, estados y cierre, adjuntos con extracción y medios visibles, envío que se reparte en varios mensajes, revisión por persona, reintentar y retomar, entrega aparte y en espera, Guardia de la idea, avisos al anfitrión, telemetría. Cada fila: ruta de la prueba e2e, veredicto del juez, sha | por hacer |
| D2 Pruebas e2e por capacidad | Con `scripts/walkthrough.mjs` y `scripts/test-dirigido`, contra una instancia con `docker-local` | parcial: existen para análisis, execute y entrega |
| D3 Jueces de interfaz por vista | Método de `docs/investigaciones/10`; cada vista con su encargo, capturas en escritorio y teléfono, claro y oscuro; los mismos jueces al cerrar, sin decirles qué cambió | por hacer |
| D4 Cierre del TODO | Lo que exige dominio o servidor limpio se cierra en el segundo anfitrión; lo que exige un aparato o una llave queda como límite externo con dueño y comando | por hacer |
| D5 `scripts/clean-worktrees.sh` | Lista y retira worktrees sin agente vivo; corre al abrir sesión | por hacer |

### E. Identidad visual del panel canónico

| Pieza | Qué es | Estado |
|---|---|---|
| E1 El encargo, textual, en `panel/DISENO.md` | «Mezcla entre un foro de los años 2000 con un programa para operadores de call center… look optimista, futurista y reflectivo… como de una compañía telefónica» (Martín, 2026-10-26). Es la fuente contra la que se juzga | por hacer |
| E2 Auditoría y propuesta | Capturas de las vistas actuales, auditoría contra el encargo, tres direcciones con maqueta HTML | en rama `wt-identidad` (`b32ad0fe`): 52 capturas, auditoría, tres direcciones con bocetos y contraste medido |
| E3 Dirección elegida | La única decisión que cruza a Martín en este plan: una de las tres, con recomendación y lo que pierde cada otra | por hacer |
| E4 Tokens y componentes | La dirección elegida entra a `panel/src/styles.css` y a los componentes; contraste medido como hoy en DISENO.md; `prefers-reduced-motion` | por hacer |
| E5 Jueces contra el encargo | Los mismos de D3, con el encargo de E1 como referente | por hacer |
| E6 La piel del anfitrión no cambia | `THEME_CSS` sigue; un anfitrión con panel propio no nota E4 | hecho por diseño; se prueba con el primer anfitrión |

### F. Documentación

| Pieza | Qué es | Estado |
|---|---|---|
| F1 `docs/INSTALACION.md` probada | Instalación limpia con `docker-local`, de cero a canario verde, como guion repetible | por hacer |
| F2 `README.md` en tres niveles | Instalar; conectar un driver; poner piel. Cada nivel con su comando y su prueba | por hacer |
| F3 MASTER-SPEC y USER-DECISIONS | Cada pieza que entra cambia §7.5 y registra su decisión en el mismo commit | continuo |
| F4 Regla 10 | Ningún documento nuevo nombra anfitriones; la prueba `public-names.test.js` lo mide | hecho; se mantiene |

## 7. Orden de ejecución

| Fase | Piezas | Criterio de salida, medido con un comando |
|---|---|---|
| 0 Contrato | A1, A2, A3, A6 | `node scripts/host-conformance.mjs --driver drivers/docker-local` sale 0 en una instalación limpia |
| 1 Traer lo genérico | B1 a B7 | El primer anfitrión borra su copia de cada pieza y su canario pasa con la del canónico |
| 2 Segundo anfitrión | A4, F1, F2, D4 | `scripts/canary.mjs` sale 0 contra el segundo anfitrión, con `drivers/fly-machines`, instalado siguiendo `INSTALACION.md` sin un paso a mano fuera del documento |
| 3 Publicación propia | C1 a C5 | `main` avanza una vez por `publish-main.sh`; el gancho rechaza la marca vieja; el primer anfitrión fija versión por sha |
| 4 Capacidades 1.0 | D1, D2, D3, D5 | Cada fila de `CAPACIDADES-1.0.md` con prueba verde y veredicto |
| 5 Identidad | E1 a E6 | Dirección elegida implementada; jueces con nota contra el encargo; `THEME_CSS` del primer anfitrión intacto |

Dependencias reales: 1, 2 y 5 arrancan apenas termina 0 y corren en paralelo, con agentes distintos. 3 depende de
1 (la conformidad que corre la puerta usa el canario canónico). 4 corre en paralelo con todo desde el inicio para
las capacidades que ya existen, y cierra al final para las que 1 y 2 agregan.

## 8. Reglas de operación mientras dure el plan

1. **El contrato sólo cambia de forma aditiva mientras el primer anfitrión estabiliza su camino a producción.** Vale una variable nueva con omisión, una orden opcional o un campo más en `/health`. Un cambio incompatible espera la cadena consolidada del anfitrión. Entonces sube `contract_version`.
2. **Nada se fusiona a `desarrollo` del canónico sin su prueba.** El `node --test` dirigido y las pruebas del panel que toca pasan en el worktree del agente.
3. **Un agente por pieza, en su worktree, con escritura incremental.** Lo que toca pantalla lo juzga otro agente con capturas programáticas.
4. **Las pruebas que necesitan un driver real corren con `docker-local`.** Ninguna prueba del canónico necesita una nube.
5. **Toda cifra nueva lleva fuente** en el código, como las perillas de `src/analyze/config.js`.
6. **Capturas sin cabeza, nunca en la pantalla de una persona.**
7. **Cada fase cierra con MASTER-SPEC, USER-DECISIONS y este plan actualizados en el mismo commit.**

## 9. Lo que se retira, y con qué condición de regreso

| Se retira | Cuándo | Qué lo traería de vuelta |
|---|---|---|
| `DEPLOY_PUBLISHES_MAIN` como marca aceptada por el gancho | tras la primera publicación con `publish-main.sh` | Que la puerta no pueda correr la batería en la máquina que publica |
| El flujo de GitHub Actions como requisito | con C3 | Ninguna: queda como espejo |
| Las 54 piezas duplicadas en el primer anfitrión | una por una, cuando su canario pasa con la canónica | Que una pieza necesite algo que el contrato no da; entonces se cambia el contrato |
| Los worktrees sin agente vivo | con D5 | Ninguna: un worktree se recrea con un comando |
| Las ramas de pasadas del anfitrión en el canónico | al fusionarse | Ninguna |

## 10. Decisiones ya tomadas, con su fuente

| Decisión | Fuente |
|---|---|
| El canónico es open source bajo MIT; toda dependencia nueva compatible | UD-004 |
| La identidad nueva es del panel canónico; un anfitrión puede usar su propio panel | Martín, 2026-10-26 |
| Todo lo recomendado se implementa, salvo esa corrección | Martín, 2026-10-26: «quiero que todo lo que tú recomendaste sea lo que implementemos» |
| Ningún archivo versionado nombra otros proyectos, clientes ni personas | Regla 10, 2026-10-20 |
| Nada depende de tener presupuesto en GitHub | Martín, 2026-10-26 |
| Sin plazos de reloj como criterio | Martín, 2026-10-26: «No aceptaré plazos arbitrarios así» |
| La sesión decide los medios desde la plantilla; el núcleo comprueba que lo declarado está al entregar | Martín, 2026-10-26 |
| Las pruebas por defecto son dirigidas | UD-265 |
| Una captura declara qué muestra y si ocultó datos | UD-268 |
| Lo que necesita a una persona llega a su bandeja; lo decidido no se le devuelve | UD-269 |
| Sin tope de máquinas ni sesiones simultáneas; el tope es el gasto del día | UD-304 |
| Lo caído se relanza al arrancar; nunca lo relanza una persona | decisión del 2026-10-25 |
| Nivel ligero a un modelo chico hasta su límite medido, con escalada | decisión del 2026-10-25 |
| La única pregunta abierta: qué dirección de identidad | se lleva con recomendación cuando E2 termine |

## 11. Falsación del plan

| Objeción | Qué se midió o leyó | Qué cambia |
|---|---|---|
| «Un driver de máquinas bajo demanda antes de 1.0 es alcance extra» | Sin un segundo anfitrión la generalidad del contrato no se mide; la única evidencia hoy es un anfitrión que copió 54 archivos | Se mantiene, y se adelanta: la fase 2 arranca con la 1 |
| «El capturador mete un navegador en el núcleo» | El panel ya depende de un navegador para 115 pruebas; el capturador es opcional por capacidad del contrato | Entra como módulo opcional, sin dependencia nueva en `src/` |
| «Publicar `main` sin GitHub debilita la protección» | La protección de rama del plan gratuito devuelve 403; el flujo sólo mide, no impide | La verificación corre donde se publica; el flujo sigue como espejo |
| «La identidad antes que la madurez funcional distrae» | Son agentes distintos; la identidad no toca `src/` | Corre en paralelo; no bloquea ninguna fase |
| «Chocar con la estabilización del primer anfitrión» | Esa sesión consolida su cadena y sube una imagen por versión del canónico | Regla 8.1: contrato aditivo hasta su publicación; `contract_version` para lo demás |
| «Traer piezas rompe al anfitrión que hoy funciona» | Su canario mide el camino real | Cada pieza se retira del anfitrión sólo con el canario verde con la canónica |
| «Las capacidades 1.0 ya están probadas» | 177 pruebas de unidad e integración, pero sin lista que diga qué promete 1.0 ni veredicto de juez por vista | La lista es el contrato con quien instale; sin ella no hay 1.0 |

## 12. Fuentes

| Fuente | Qué aportó |
|---|---|
| `docs/MASTER-SPEC.md` §6 y §7.5 | Vistas y componentes del panel; contrato de ejecución y entrega |
| `docs/USER-DECISIONS.md` UD-004, UD-254 a UD-310 | Las decisiones citadas arriba |
| `docs/RULES.md`, `src/public-names.test.js` | Regla 10 |
| `.githooks/pre-push`, `scripts/main-solo-desde-desarrollo.sh`, `.github/workflows/main-solo-desde-desarrollo.yml` | Cómo avanza `main` hoy |
| `panel/DISENO.md`, `panel/src/styles.css` | Tokens y referencias de la identidad actual |
| `docs/TODO.md`, `docs/HALLAZGOS.md`, `docs/TECHNICAL-DEBT.md` | Lo abierto |
| `docs/investigaciones/10` | Método de jueces de interfaz |
| Ramas `wt-driver-local` y `wt-identidad` | Driver de referencia, canario, capturas de la identidad |
| Directorio de integración de Team Platform en la rama de despliegue del primer anfitrión | Las 54 piezas que vuelven |
| Fly, «Machines API», documentación vigente al 2026-10 | CREATE con `auto_destroy`, `exec`, destrucción |
