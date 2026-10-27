# Plan 2026 del Team Platform canónico

Fecha: 2026-10-26, 23:40 (Chile); consolidado a las 21:50 del 26. Lo pidió Martín: «Quiero que todo lo que hemos hecho en Team Platform tratemos
de integrarlo en la versión canónica de Team Platform, que es el repositorio Team Platform, porque siempre fue
conceptualizado como un sistema open source». Y fijó el límite del plan: «quiero que todo lo que tú recomendaste sea
lo que implementemos, excepto esta cuestión de la identidad que te acabo de corregir». Y a las 21:45 del 26 cerró
el punto de la identidad: «no perdamos tiempo en esto. Solo me importa que lo que vaya integrándose al canónico lo
haga siguiendo su estética actual sin estropearla». No hay rediseño: `panel/DISENO.md` es el referente, y toda
pantalla que entre se juzga contra él. Una implementación puede no usar el panel canónico y poner el suyo.

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
| Estética del panel | tokens en `panel/DISENO.md` y `panel/src/styles.css` (Orbitron, Source Sans 3, OKLCH, vidrio, cromo, gel, luces de estado). La auditoría de hoy midió dos derivas respecto de DISENO.md: Orbitron salió de los títulos el 21-10 (`cd001a46`) y las luces de estado pasaron a contador de contorno (`56a49550`, `99e34df1`); ninguno de los 59 commits posteriores de `styles.css` cita la estética como motivo | rama `wt-identidad` (`b32ad0fe`), `AUDITORIA.md` con 52 capturas |
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
| **Estética que deriva sin que nadie lo mida** | dos derivas medidas respecto de DISENO.md, en 59 commits que no la nombran | Toda pantalla que entra se juzga contra DISENO.md antes de fusionarse; las dos derivas se reponen como restauración |
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
| Pantallas fusionadas sin veredicto contra DISENO.md | sin medir | 0 | columna «juez» de `docs/CAPACIDADES-1.0.md` |
| Worktrees | 140 | sólo los de agentes vivos | `scripts/clean-worktrees.sh --list` |

## 4. Principios que no ceden

1. **El núcleo no conoce anfitriones.** Ningún archivo de `src/`, `panel/`, `scripts/` ni `drivers/` nombra un proyecto, un cliente ni una persona (regla 10). Lo que necesita saber del anfitrión entra por el contrato.
2. **El contrato tiene versión y prueba.** `contract_version` se publica en `/health` y en `docs/CONTRATO-DE-ANFITRION.md`. Un cambio incompatible sube la versión; un driver declara la que cumple; la conformidad lo verifica.
3. **Un driver son cinco órdenes de shell y nada más.** CREATE, RUN, COLLECT, DESTROY y DELIVER, con marcadores y códigos 0, 75 y 76. Si un anfitrión necesita algo más, se cambia el contrato. No se le abre una puerta lateral.
4. **Se generaliza antes de duplicar.** Una pieza que un segundo anfitrión necesitaría igual entra al canónico; nunca se copia.
5. **Ningún número gobierna sin declaración.** Plazos, topes y concurrencias llevan su medición o su perilla. Lo que no puede medirse espera por evento.
6. **Un error nunca es ausencia.** Permiso, red o credencial que fallan detienen con 75 y su marca; nunca deciden «no hay máquina», «no hay rama» ni «sin tope».
7. **Lo que se retira deja escrita su condición de regreso.** Un archivo del anfitrión se borra cuando su canario pasa con la pieza canónica. `DEPLOY_PUBLISHES_MAIN` se retira cuando `publish-main.sh` publicó una vez.
8. **Toda pantalla se juzga abierta,** con capturas programáticas y jueces que no la escribieron, contra `panel/DISENO.md`. La estética actual no se rediseña ni se «mejora»: lo que entra la sigue.

## 5. Arquitectura objetivo

| Capa | Qué posee | Dónde vive |
|---|---|---|
| **Núcleo** | API, cola, extractores, analizador, trabajo `execute`, trabajo `deliver`, retoma, reintento, Guardia de la idea, canario, capturador, guardias del arnés, panel canónico con su estética actual | este repositorio |
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
| A1 `docs/CONTRATO-DE-ANFITRION.md` | El contrato entero en un solo documento: variables, cinco órdenes, marcadores, entorno, códigos 0/75/76, `##team phase` y `##team wait`, entrega repetible, `contract_version`. Sale de MASTER-SPEC §7.5 y de lo que el primer anfitrión documentó por su lado | hecho (`702e0eaa`, UD-311) |
| A2 `drivers/docker-local` | Driver de referencia: CREATE levanta un contenedor desde `drivers/docker-local/Dockerfile`, RUN copia `{workdir}` y corre `bash run.sh`, COLLECT saca la transcripción, DESTROY borra siempre, DELIVER de ejemplo que empuja la rama a un remoto local | hecho (`b76ea305`): 19 pruebas contra Docker real; la imagen con Claude Code 2.1.311 se construye y `claude --version` responde dentro |
| A3 `scripts/host-conformance.mjs` | Prueba de conformidad: con un driver y un trabajo de prueba ejercita las cinco órdenes, verifica el NDJSON de la sesión, que DESTROY corre tras un fallo y tras un plazo vencido, que 75 no gasta intento, que 76 deja `delivery_held`, y que DELIVER es repetible. Sale 0 sólo si todo pasa; imprime la `contract_version` que cumple | hecho (`cbea03c2`): 13 casos; sale 0 en un clon limpio de `desarrollo` instalado con `INSTALACION.md`, 2026-10-26 21:17 |
| A4 `drivers/fly-machines` | Driver de máquinas bajo demanda sobre la API de Fly Machines: CREATE crea una máquina desde una imagen declarada con `auto_destroy`, RUN ejecuta por `exec`, COLLECT lee la transcripción, DESTROY la destruye; cada máquina nace con vida máxima declarada. Sin nombrar al anfitrión que lo usará | por hacer |
| A5 Driver de máquinas efímeras en nube del primer anfitrión | Sigue en su repositorio porque nombra su proyecto y su cuota; en el canónico se cita como ejemplo externo, sin nombre, en `drivers/README.md` | hecho en el anfitrión; cita por hacer |
| A6 `contract_version` en `/health` y en la salida del trabajador al arrancar | El trabajador rechaza arrancar con un driver que declare otra versión mayor | hecho (`cbea03c2`) |

### B. Piezas que vuelven del anfitrión al núcleo

| Pieza | Qué es | Estado |
|---|---|---|
| B1 `scripts/canary.mjs` | Un envío con destinatario agente, análisis, publicación, `execute`, respuesta «OK» en el hilo; todo por evento; sale 0 sólo con la respuesta; cierra y borra su mensaje. Corre tras instalar y tras cada despliegue del anfitrión | en `desarrollo` (`b76ea305`), 8 pruebas contra servidor y trabajador reales; identidad por cabecera firmada sin probar (fase 1) |
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
| D5 `scripts/clean-worktrees.sh` | Lista y retira worktrees sin agente vivo; corre al abrir sesión | hecho (`2f82a21f`): retiró 131 worktrees sin agente vivo, 1,9 GB |

### E. La estética del panel canónico se conserva

| Pieza | Qué es | Estado |
|---|---|---|
| E1 `panel/DISENO.md` es el referente | Una línea al inicio lo dice, con la decisión de Martín del 26-10 textual. Un cambio de tokens o materiales que no esté en DISENO.md no entra; si hace falta, primero se cambia DISENO.md con su medición | por hacer |
| E2 Juez contra DISENO.md en cada pantalla | Todo cambio de `panel/` que llegue a `desarrollo` lleva veredicto de un agente distinto, con capturas sin cabeza en escritorio y teléfono, claro y oscuro, que compara contra DISENO.md y contra la captura anterior de la misma vista | por hacer; las capturas de hoy en `wt-identidad` son la línea base |
| E3 Reponer las dos derivas medidas | Orbitron en los títulos según DISENO.md (o DISENO.md actualizado si el cambio del 21-10 fue a propósito: se lee `cd001a46` antes de tocar) y las luces de estado con brillo y palabra en vez del contador de contorno | por hacer |
| E4 La piel del anfitrión no cambia | `THEME_CSS` sigue; un anfitrión con panel propio no nota nada | hecho por diseño |

La auditoría y las tres direcciones de `wt-identidad` quedan como medición (`docs/investigaciones/identidad-2026-10-26/`); no se implementa ninguna.

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
| 0 Contrato | A1, A2, A3, A6 | `node scripts/host-conformance.mjs --driver drivers/docker-local` sale 0 en una instalación limpia. Cumplido el 2026-10-26 a las 21:17, en un clon limpio de `desarrollo` (`40d710fc`) |
| 1 Traer lo genérico | B1 a B7 | El primer anfitrión borra su copia de cada pieza y su canario pasa con la del canónico |
| 2 Segundo anfitrión | A4, F1, F2, D4 | `scripts/canary.mjs` sale 0 contra el segundo anfitrión, con `drivers/fly-machines`, instalado siguiendo `INSTALACION.md` sin un paso a mano fuera del documento |
| 3 Publicación propia | C1 a C5 | `main` avanza una vez por `publish-main.sh`; el gancho rechaza la marca vieja; el primer anfitrión fija versión por sha |
| 4 Capacidades 1.0 | D1, D2, D3, D5 | Cada fila de `CAPACIDADES-1.0.md` con prueba verde y veredicto |
| 5 Estética conservada | E1 a E4 | Las dos derivas repuestas con veredicto; el juez de E2 corre en la primera pantalla que la fase 1 o 4 fusione; `THEME_CSS` del primer anfitrión intacto |

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
| No hay rediseño: lo que entra sigue la estética actual sin estropearla; un anfitrión puede usar su propio panel | Martín, 2026-10-26, 21:45 |
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
| Ninguna pregunta queda abierta | las tres direcciones de identidad se descartaron el 26-10 |

## 11. Falsación del plan

| Objeción | Qué se midió o leyó | Qué cambia |
|---|---|---|
| «Un driver de máquinas bajo demanda antes de 1.0 es alcance extra» | Sin un segundo anfitrión la generalidad del contrato no se mide; la única evidencia hoy es un anfitrión que copió 54 archivos | Se mantiene, y se adelanta: la fase 2 arranca con la 1 |
| «El capturador mete un navegador en el núcleo» | El panel ya depende de un navegador para 115 pruebas; el capturador es opcional por capacidad del contrato | Entra como módulo opcional, sin dependencia nueva en `src/` |
| «Publicar `main` sin GitHub debilita la protección» | La protección de rama del plan gratuito devuelve 403; el flujo sólo mide, no impide | La verificación corre donde se publica; el flujo sigue como espejo |
| «Un juez de estética por pantalla frena las fusiones» | El panel ya exige capturas por cambio (regla 13, UD-268); el juez lee esas mismas capturas | Es un paso más sobre lo que ya se produce; sin él la estética derivó dos veces en 59 commits |
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
| Ramas `wt-driver-local` y `wt-identidad` | Driver de referencia, canario, auditoría de la estética con 52 capturas |
| Directorio de integración de Team Platform en la rama de despliegue del primer anfitrión | Las 54 piezas que vuelven |
| Fly, «Machines API», documentación vigente al 2026-10 | CREATE con `auto_destroy`, `exec`, destrucción |
