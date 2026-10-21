# USER-DECISIONS: Human Agency Record

> This document IS NOT A CHANGELOG. It is the register of user sovereignty.
> It captures the strategic "why" and the explicit intentions that the user communicates.

| Symbol | Meaning |
|---|---|
| 💡 | Strategic user decision |
| 🔗 | Traceable cross-reference to `.HUM` checks |

---

<!--
INPUT FORMAT (Adapted ADR, 5 mandatory fields):

## [UD-NNN] Decision Title

**Date:** YYYY-MM-DD
**Context:** [Situation that motivated the decision]
**Decision:** [What the user decided and why]
**Discarded alternatives:**
- [Alternative 1 and why it was discarded]
**Consequences:**
- [Project impact, accepted tradeoffs]
**Reversion conditions:** [Under what circumstances this decision would be reverted]

RULES:
- The AI drafts based on chat literality.
- The user confirms with "ok" or similar BEFORE saving.
- Every high reversibility-cost decision is logged here.
-->

## [UD-001] Un proveedor por modalidad, configurable

**Fecha:** 2026-10-20
**Contexto:** El análisis necesita texto, visión (imágenes, PDF, fotogramas de video) y transcripción (audio y pista de audio del video).
**Decisión:** Una ranura de proveedor por modalidad, configurable por el operador. Martín corrige el dato de partida: DeepSeek sí tiene visión (DeepSeek V4.1 Vision). La transcripción va por la API de Groq (gratuita, Whisper large-v3-turbo, como ya la usa el autor en otra herramienta propia). El video se convierte a fotogramas «de forma eficiente y repetible».
**Alternativas descartadas:**
- Un solo proveedor para todo: ata el proyecto a una empresa.
- Sólo texto en la primera versión: no cumple la promesa central (captura de chat, docx de 40 puntos).
**Consecuencias:**
- Tres ranuras en configuración: texto, visión, transcripción. Sus valores por omisión salen de la investigación de precios y límites encargada el mismo día.
- El muestreo de fotogramas es determinista: el mismo video da los mismos fotogramas.
**Condiciones de reversión:** Que una modalidad quede sin proveedor abierto o gratuito viable.

## [UD-002] La identidad es un módulo intercambiable; por omisión, correo y contraseña

**Fecha:** 2026-10-20
**Contexto:** team-platform tiene que poder integrarse de forma nativa en un sitio que ya tiene su propia autenticación.
**Decisión:** Martín, textual: «Esto debe ser configurable, la razón es que team-platform debe poder integrarse nativamente en un sitio con su propia autenticación, por ej. reutilizando las credenciales de admin o superadmin de esos sitios sin importar cómo se maneje ese acceso. Por defecto, correo y contraseña de manera SEGURA pero ligera».
**Alternativas descartadas:**
- Tailscale como identidad con contraseña de respaldo: deja afuera al sitio anfitrión.
- Sólo Tailscale: nadie fuera de la tailnet entra.
**Consecuencias:**
- Un contrato de proveedor de identidad con dos implementaciones iniciales: local (correo y contraseña) y delegada (el sitio anfitrión dice quién es y qué rol tiene).
- Tailscale queda como red, no como identidad.
**Condiciones de reversión:** Ninguna prevista.

## [UD-003] El emisor revisa y confirma; el procesamiento vive en una cola de trabajos

**Fecha:** 2026-10-20
**Contexto:** La maqueta dibuja «Enviar» en el bloque de análisis. Había que decidir si la descomposición se publica sola o la revisa el emisor, y cómo se desacopla del navegador.
**Decisión:** El emisor revisa y confirma. Y, textual: «DEBE haber una cola de trabajos [como en un proyecto anterior del autor] que desacople completamente el procesamiento en curso del navegador».
**Alternativas descartadas:**
- Publicar sola: una mala categorización llega al equipo sin filtro.
- Configurable por miembro: dos comportamientos que probar.
**Consecuencias:**
- Un input crea un trabajo en cola; el navegador puede cerrarse y el trabajo sigue; el progreso se consulta por evento, no por sondeo.
- La vista previa editable (área, destinatarios, texto, adjuntos por mensaje) es una pantalla propia, no un estado transitorio del navegador.
**Condiciones de reversión:** Ninguna prevista.

## [UD-004] Licencia: la más permisiva

**Fecha:** 2026-10-20
**Contexto:** El proyecto es de código abierto y tiene que poder integrarse en sitios ajenos, también cerrados (UD-002).
**Decisión:** Martín, textual: «la más permisiva». Se adopta MIT, la permisiva de uso más extendido y la que menos fricción pone a quien integra.
**Alternativas descartadas:**
- AGPL-3.0: obliga a publicar cambios a quien sirve por red; espanta la integración en sitios cerrados.
- Apache-2.0: igual de permisiva con cláusula de patentes y texto más largo.
- 0BSD o Unlicense: todavía más permisivas, pero menos reconocidas por los departamentos legales que evalúan dependencias.
**Consecuencias:**
- Archivo `LICENSE` MIT en la raíz; toda dependencia tiene que ser compatible con MIT.
**Condiciones de reversión:** Que Martín pida una de las tres últimas por nombre.

## [UD-005] Idioma: código en inglés, comentarios y documentación en español

**Fecha:** 2026-10-20
**Contexto:** Proyecto abierto escrito por alguien que piensa en español.
**Decisión:** «Como [en un proyecto anterior del autor]: código en inglés, comentarios y docs en español». Identificadores, esquema, rutas y nombres de archivo de código en inglés; comentarios, eje documental y textos de trabajo en español.
**Alternativas descartadas:**
- Todo en inglés: Martín leería y decidiría sobre su segundo idioma.
- Código en inglés, `docs/` en español y README en inglés: no la eligió; el README también va en español.
**Consecuencias:**
- Un esquema mezclado no existe: no se traducen identificadores ni se escriben comentarios nuevos en inglés.
**Condiciones de reversión:** Que el proyecto reciba contribuidores que no lean español y Martín decida abrir el README.
**Vigencia:** UD-015 (2026-10-20) reemplaza esta decisión en los comentarios: ahora van en inglés junto con el código. Siguen vigentes aquí la documentación y el README en español.

## [UD-006] Una sola vista Mensajes, con filtro Respuestas

**Fecha:** 2026-10-20
**Contexto:** La maqueta dibuja Mensajes y Respuestas como dos entradas de la barra lateral; `idea.md` las junta en una vista Mensajes con filtros.
**Decisión:** Una vista Mensajes. Las respuestas son un filtro más, junto a «para mí», «para X», estado y área.
**Alternativas descartadas:**
- Dos vistas como la maqueta: los mismos filtros dos veces.
**Consecuencias:**
- La barra lateral pierde la entrada Respuestas. La maqueta queda superada en ese punto.
**Condiciones de reversión:** Que el filtro Respuestas resulte invisible en uso real.

## [UD-007] Dos roles, Miembro y Editor, fijados en código

**Fecha:** 2026-10-20
**Contexto:** `idea.md` nombra el rol Editor para áreas y plantillas; faltaba quién administra equipo y conexiones y de dónde sale el rol cuando la identidad la da un sitio anfitrión.
**Decisión:** «Miembro y editor, por ahora definidos manualmente en el código, no derivado de otra parte». Editor administra áreas, plantillas, equipo y conexiones; Miembro usa. El rol no se mapea desde el proveedor de identidad.
**Alternativas descartadas:**
- Mapeo de roles desde el proveedor de identidad: más tarde, si hace falta.
- Tres roles con Administrador aparte: un rol más que explicar en un equipo de 3 a 10.
**Consecuencias:**
- Los roles son un enumerado del código; cambiar el rol de alguien es una edición de datos, no de configuración del proveedor.
**Condiciones de reversión:** Que una integración anfitriona necesite derivar el rol de su propio sistema.

## [UD-008] Bucle propio con un contrato de analizador que también admite un harness

**Fecha:** 2026-10-20
**Contexto:** Con la investigación de `docs/investigaciones/01 - Motor de análisis y adjuntos.md` delante (un harness paga 27k a 150k tokens y 0,6 a 4 s por invocación; con DeepSeek pierde el PDF; ningún producto de bandeja de entrada encontrado embebe uno), había que elegir qué ejecuta el análisis.
**Decisión:** Martín, textual (dictado): «implementaremos el bucle propio siguiendo las mejores y más eficientes prácticas documentadas a octubre de 2026 considerando que también debemos poder implementar un harness. La razón de esto es porque la idea es poder instalar esta página en proyectos donde por ejemplo ya se esté pagando una suscripción a Claude Code y se pueda utilizar directamente la misma cuenta que ya se está pagando … utilizando el harness de Claude Code en modo bare». Y el vector que ordena todo: «la cualidad máxima a maximizar es la velocidad de respuesta y la correcta descomposición de un input».
**Alternativas descartadas:**
- Harness como único motor: paga el arranque en cada input y no puede fijar el presupuesto de tokens por paso.
- Bucle propio sin contrato de harness: deja afuera a quien ya paga una suscripción.
**Consecuencias:**
- Un contrato `Analyzer` con dos implementaciones: `api` (bucle propio, por omisión) y `harness` (`claude -p` por input, trabajo en cola). Las dos reciben el mismo paquete de entrada (texto, adjuntos ya extraídos, áreas, plantillas, equipo) y devuelven el mismo resultado validado contra esquema.
- Hecho verificado en la documentación oficial (code.claude.com/docs/en/headless, 2026-10-20): `--bare` «no usa el login de suscripción; nunca lee credenciales OAuth ni el llavero» y exige `ANTHROPIC_API_KEY`. Reutilizar la suscripción obliga a correr `claude -p` sin `--bare`, desde un directorio de trabajo vacío y propio del adaptador, que es lo más cerca de bare que permite la suscripción. El adaptador queda escrito así y se mide su sobrecarga real con `--output-format json` (`usage`, `total_cost_usd`).
- Audio: Groq por ahora; cuando se cambie, la sesión propone su mejor opción medida, no necesariamente Whisper. Video: lo que salga más fácil.
**Condiciones de reversión:** Que Anthropic habilite la suscripción en modo bare (el adaptador pasa a `--bare`), o que la medición del adaptador lo haga inviable (se deja como experimental).

## [UD-009] Extracción de documentos: lo más rápido, con MarkItDown como referencia

**Fecha:** 2026-10-20
**Contexto:** PDF y DOCX tienen que pasar a texto antes del modelo (DeepSeek no lee PDF; un PDF nativo cuesta 1.500 a 3.000 tokens por página).
**Decisión:** Martín, textual: «Lo que salga más rápido, quizás MarkItDown es muy bueno, pero también no olvides que nosotros mismos podemos programar nuestra propia herramienta utilizando WASM o ocupando uno que ya exista. En fin, hay que hacerlo más rápido, no más posible».
**Alternativas descartadas:**
- Sidecar Docling: tablas y OCR excelentes, un contenedor más y 41 s por 14 páginas.
- Escalonado MarkItDown + Docling: dos caminos que probar.
**Consecuencias:**
- La extracción corre dentro del mismo contenedor y se mide por documento: la herramienta que gane en tiempo con calidad suficiente para que el modelo descomponga bien es la que queda. Candidatas en orden: un port a Node de MarkItDown (`markitdown-node`), MarkItDown en Python invocado como proceso, y una pieza propia en WASM si ninguna alcanza.
**Condiciones de reversión:** Que un tipo de documento (escaneado, tablas anidadas) salga roto en uso real; entonces entra Docling sólo para ese tipo.

## [UD-010] Arquitectura: una API resiliente que lo sirve todo

**Fecha:** 2026-10-20
**Contexto:** `idea.md` pide Docker con React+Refine, SQLite y un harness. Un proyecto anterior del autor usa Postgres, cola de trabajos (pg-boss) y varios servicios.
**Decisión:** Martín, textual: «tenemos que tomar más inspiración del stack de [un proyecto anterior del autor]. Piensa que [ese proyecto] utiliza Postgres con cola de trabajo y orquestador y un montón de cosas. Quizás no necesitamos todo eso, pero algo necesitamos. Además quiero que este programa funcione parecido a como funciona [ese proyecto] en cuanto a que el frontend solamente hace llamadas por API y que hay algo sirviendo la API y que la API es resiliente, y eso facilita mucho las cosas cuando necesitas que sistemas externos interactúen con esto».
**Alternativas descartadas:**
- Frontend con acceso directo a la base o renderizado en servidor: cierra la puerta a sistemas externos.
- Copiar la pila entera de ese proyecto (Postgres, pooler, Caddy, Loki, Grafana): contradice «mínimos componentes».
**Consecuencias:**
- Una API HTTP (Fastify) es la única puerta: el panel, las Conexiones futuras y cualquier sistema externo hablan con ella con el mismo contrato.
- Cola de trabajos propia sobre SQLite con arriendo y reintentos, en el mismo proceso o en un worker aparte del mismo contenedor; el patrón es el de pg-boss, la base es `node:sqlite`.
- Resiliencia medida: un trabajo sobrevive al cierre del navegador y al reinicio del proceso; la API responde mientras hay trabajos corriendo.
**Condiciones de reversión:** Que un equipo supere lo que SQLite en un solo nodo aguanta; entonces el adaptador de base cambia a Postgres sin tocar la API.

## [UD-011] El panel se construye con TanStack Query y React Router, sin Refine

**Fecha:** 2026-10-20
**Contexto:** `idea.md` pedía React + Refine. El informe 07 (`docs/investigaciones/07 - Panel React contra una API REST.md`) encontró que `@refinedev/core` no publica un paquete desde el 2026-04-02 (las versiones 5.1 y 5.2 figuran en el changelog y nunca llegaron a npm por fallas del flujo de publicación), que su adaptador exige React Router 7 cuando ya existe la 8, y que manda telemetría a un tercero desde el navegador salvo que se apague.
**Decisión:** Martín eligió reemplazarlo por TanStack Query 5, React Router 8 y una función propia de filtros a parámetros de la API.
**Alternativas descartadas:**
- Conservar Refine fijado en 5.0.12, con `react-router` 7, `disableTelemetry` y sólo `core` más `@refinedev/rest`: el día que haga falta un arreglo no hay versión publicada que lo traiga.
**Consecuencias:**
- 26 KB comprimidos menos en el panel (medición del informe 07) y ninguna conexión del navegador a otro dominio (§4.1).
- Las listas, filtros y formularios contra la API se escriben en el proyecto; los filtros viven en la URL.
**Condiciones de reversión:** Que Refine vuelva a publicar y a seguir a React Router, y que el módulo propio de filtros crezca más de lo que Refine costaría.

## [UD-012] GitHub Issues es un conector futuro, no el almacén

**Fecha:** 2026-10-20
**Contexto:** Martín preguntó si el sistema podía construirse sobre GitHub Issues en vez de a medida. El mapeo es directo (issue, comentarios, etiquetas, formularios, assignees, abierto y cerrado), y lo que de todos modos hay que construir es la barra de entrada, la extracción, la descomposición y la vista previa de confirmación. Lo que se pierde: cuenta de GitHub obligatoria para cada miembro, sin adjuntos de audio ni carga de adjuntos por API, sin estado «respondido», y la instalación dentro de un sitio ajeno o sola en un VPS deja de ser cierta.
**Decisión:** Martín, textual: «github issues debería ser un conector a construir a futuro». Se sigue con el almacén propio; GitHub Issues entra como una Conexión (un adaptador que crea issues y lee comentarios) cuando la descomposición esté probada.
**Alternativas descartadas:**
- GitHub Issues como único almacén: lo anterior.
**Consecuencias:**
- La vista Conexiones lista GitHub Issues entre los conectores previstos, apagado.
**Condiciones de reversión:** Que el equipo que use team-platform viva entero en GitHub y nadie mande audio; entonces el conector se construye antes que el resto de Conexiones.

## [UD-013] Estética Y2K futurista

**Fecha:** 2026-10-20
**Contexto:** El panel se estaba construyendo con la estética de un programa de gestión estándar y sin referente visual propio.
**Decisión:** Martín, textual: «la estética tiene que ser MUCHO mejor, inspirada en y2k futurista», y a continuación: «nada muy loco, pero con más identidad, espaciado, y jerarquía visual con el uso de alineaciones, tamaños, formas, distribución, etc.». El Y2K futurista es la cita (vidrio, cromo, iridiscencia, formas redondeadas, azul eléctrico, plata, lima y lila, tipografía de la época con licencia libre); lo que manda es la jerarquía visual y una identidad propia, sin efectos por todos lados. Lo funcional no cambia: rótulos cortos, densidad de bandeja de escritorio, estado como insignia, edición en el lugar. Los valores que delatan diseño generado por IA (paleta índigo y degradado púrpura a azul, superficies zinc, centrado simétrico universal, radios y sombras por omisión) quedan prohibidos.
**Alternativas descartadas:**
- Estética neutra de panel administrativo: era la omisión y no la quiso.
**Consecuencias:**
- `panel/DISENO.md` con referencias fechadas y los tokens derivados; modo claro y oscuro.
- Ninguna fuente ni recurso cargado desde otro dominio (§4.1): las tipografías van empaquetadas.
**Condiciones de reversión:** Que Martín nombre otro referente.

## [UD-014] Todo lo que pasa por un modelo se mide con OpenTelemetry y se guarda

**Fecha:** 2026-10-20
**Contexto:** Las llamadas al modelo quedaban en `llm_calls` (proveedor, modelo, tokens, costo). Martín pide trazabilidad completa para mejorar el sistema.
**Decisión:** Martín, textual: «estrictamente es necesario que todo lo que pase por un modelo de inteligencia artificial en general se mida con OpenTelemetry y almacenemos los resultados de cada llamada de API y de cada uso de herramienta y cada cosa que podamos guardar porque todo eso nos da trazabilidad para poder ir mejorando este sistema».
**Alternativas descartadas:**
- Seguir con `llm_calls` a mano: no tiene árbol de spans ni el contenido de cada llamada, y no lo lee ninguna herramienta estándar.
- Un colector externo obligatorio: rompe «un contenedor y un volumen» (§4.5).
**Consecuencias:**
- Un span por trabajo, por paso (extraer cada adjunto, clasificar, descomponer cada grupo, rescatar, validar, publicar), por llamada a proveedor y por invocación del harness, con las convenciones semánticas de GenAI de OpenTelemetry (`gen_ai.*`) y el contenido completo de entrada y salida de cada llamada guardado en el volumen.
- Los spans se guardan en SQLite por un exportador propio (sin componente externo) y, si se configura `OTEL_EXPORTER_OTLP_ENDPOINT`, también salen por OTLP a un colector. `llm_calls` pasa a ser una vista sobre los spans de llamada.
- El banco (§7.11) lee los spans para sus tiempos por paso en vez de medir aparte.
**Condiciones de reversión:** Ninguna prevista.

## [UD-015] Código y comentarios en inglés; interfaz y textos al cliente en español

**Fecha:** 2026-10-20
**Contexto:** UD-005 fijaba comentarios en español. El repositorio es público y abierto.
**Decisión:** Martín, textual: «cambié de opinión; quiero que el código y los comentarios de código (mas no la interfaz ni lo que se muestra al cliente) esté en inglés». Reemplaza a UD-005 en ese punto: identificadores, comentarios, nombres y descripciones de pruebas, mensajes de registro y prompts del analizador van en inglés (el prompt pide responder en el idioma del input). Siguen en español: los textos de la interfaz, los mensajes de error que una persona ve, las plantillas iniciales de `templates/` (las edita el Editor), el eje documental, los informes y los commits.
**Alternativas descartadas:**
- Todo en inglés, documentación incluida: no la pidió.
**Consecuencias:**
- Una pasada de traducción sobre todo el código existente; HP-008 pasa a exigir comentarios en inglés y textos de interfaz en español.
**Condiciones de reversión:** Ninguna prevista.

## [UD-016] Íconos de medio en cada mensaje y respuesta; nada desalineado, flotando ni truncado

**Fecha:** 2026-10-20
**Contexto:** Martín revisó las primeras capturas del panel contra su maqueta.
**Decisión:** Martín, textual: «en los mensajes y en las respuestas hay íconos amigables que te dan a entender qué tipos de medios están asociados a un mensaje o a una respuesta. Además no me gusta que en la interfaz haya elementos que se vean desalineados o flotando innecesariamente, o peor aún, texto truncado o con puntos suspensivos que la gran mayoría de las veces quizás se puede mejorar de otra forma». Tres clases de defecto, y se arregla la clase: (1) cada tarjeta de mensaje y cada respuesta muestra, como en la maqueta, un ícono por tipo de medio adjunto (foto, video, audio, documento, enlace) además de la miniatura principal; (2) todo elemento se alinea a la grilla y nada queda flotando sin relación con lo que lo rodea; (3) ningún texto se trunca con puntos suspensivos: se envuelve, se reparte en otra línea o se cambia la disposición.
**Alternativas descartadas:**
- Truncar con título emergente al pasar el puntero: Martín lo rechaza como regla general.
**Consecuencias:**
- Prohibición en la batería del panel: ninguna clase `truncate`, `line-clamp` ni `text-overflow: ellipsis` en `panel/src` salvo con una justificación escrita en la misma línea.
- El juez de pantalla revisa estas tres clases en cada vista.
**Condiciones de reversión:** Ninguna prevista.

## [UD-017] Edición en el lugar con deshacer y rehacer; cada vista cabe en una pantalla

**Fecha:** 2026-10-20
**Contexto:** La vista previa del input y la propuesta del análisis son editables. Faltaba fijar cómo se edita y cuánto puede ocupar una vista.
**Decisión:** Martín, textual: «editar un texto es simplemente hacer clic sobre el texto en el campo de texto, cambiarlo, y luego un clic afuera guarda el texto, con un botón deshacer y un botón rehacer funcionales. Sin versionado» y «me importa que todo el diseño de la interfaz quepa en una sola página … tener que hacer scroll me parece una mala decisión de diseño … revisa cómo lo hace Devalis en esos sentidos». Toda pieza de texto editable (vista previa del input, título, cuerpo y campos de cada mensaje propuesto, destinatarios, área, y luego título y cuerpo de un mensaje publicado y de una plantilla) se edita en el lugar: clic entra a edición, clic afuera o Enter (Escape cancela) guarda, sin botón «Editar» ni «Guardar». Deshacer y rehacer son dos botones visibles y los atajos Ctrl+Z y Ctrl+Shift+Z, con una pila por pantalla que vive en memoria y se pierde al recargar: no hay historial de versiones en la base. Cada vista cabe en una pantalla a 1440×900 y a 1280×720: lo que se necesita ahora está a la vista, lo demás se pliega con su cuenta y llega cuando hace falta, y las listas paginan dentro del marco con un tamaño de página medido según el alto disponible.
**Alternativas descartadas:**
- Botones «Editar» y «Guardar» por campo: es la descripción de una acción en lugar de la acción.
- Historial de versiones persistente: Martín lo descartó.
- Desplazamiento del documento: Martín lo rechaza como regla general.
**Consecuencias:**
- Una pieza del panel `EditableText` y un almacén `useUndoStack` compartidos por todas las vistas; cada guardado es una operación que se puede deshacer (también la asignación de un miembro y el cambio de área).
- Rutas `PATCH /messages/:id` (título, cuerpo, campos, destinatarios, área) y `PATCH /inputs/:id/proposal` (la propuesta antes de publicar, para que una edición no se pierda al cerrar la pestaña).
- Prohibición del panel medida en el navegador, como en un proyecto anterior del autor: ninguna vista desplaza el documento a 1440×900 ni a 1280×720, con lo sembrado y con cada lista multiplicada por ocho, y ningún carril con desplazamiento propio fuera de una lista blanca declarada.
**Condiciones de reversión:** Ninguna prevista.

## [UD-018] Un solo ajuste de idioma por cuenta: español o inglés, para prompts, salida e interfaz

**Fecha:** 2026-10-20
**Contexto:** Con UD-015 el código pasa a inglés. Hacía falta fijar en qué idioma se redactan los mensajes, en qué idioma se le habla al modelo y en qué idioma se ve la interfaz.
**Decisión:** Martín, textual: «si vamos a tener prompt en inglés necesitamos poder fijar de alguna forma el lenguaje de output y que por defecto sea el que está configurado por cuenta», «por defecto el lenguaje configurado debe ser español latino neutro», y al ver la propuesta de un selector junto a Enviar: «no me parece correcto el chip junto a enviar … basta con tenerlo en ajustes por ahora. Cambiar entre español e inglés en los ajustes, porque esos son los únicos dos idiomas que quiero por ahora, debe cambiar tanto el lenguaje de las prompts como el lenguaje del output como toda la interfaz de usuario al idioma seleccionado, y solamente debe haber un botón». Cada cuenta tiene un solo ajuste, `language`, con dos valores: `es-419` (español latino neutro, la omisión) y `en`. Ese único control en Configuración cambia a la vez: el idioma de los prompts que recibe el modelo (los prompts existen en los dos idiomas), el idioma en que se redactan los mensajes de los envíos de esa cuenta, y toda la interfaz del panel. No hay selector por envío.
**Alternativas descartadas:**
- Responder en el idioma del input: un audio en inglés de un cliente produciría mensajes en inglés para un equipo que trabaja en español.
- Un selector de idioma junto a Enviar: Martín lo rechazó.
- Más idiomas: por ahora sólo español e inglés.
**Consecuencias:**
- Columna `language` en `members` (`es-419` o `en`, `CHECK`), editable en `PATCH /members/me`; el envío toma el idioma de su autor; `bundle.language` hacia el analizador, que elige el juego de prompts de ese idioma.
- El panel tiene dos catálogos de textos (`es-419`, `en`) y ningún texto visible fuera de ellos; los mensajes de error de la API llegan con un código y el panel los traduce.
- Una prueba con el proveedor real de que un input en un idioma sale redactado en el idioma de la cuenta, en los dos sentidos.
**Condiciones de reversión:** Que Martín pida un tercer idioma o un cambio por envío.

## [UD-019] Lo que redacta el analizador no lleva las marcas de la escritura generada por IA

**Fecha:** 2026-10-20
**Contexto:** Los mensajes que produce el analizador los lee el equipo y, a veces, el cliente.
**Decisión:** Martín, textual: «es de suma importancia evitar los vicios de Signs of AI writing en el output de team-platform». La guía de Wikipedia «Signs of AI writing» se convierte en un contrato de redacción corto dentro del prompt de descomposición (hechos llanos, título con verbo y objeto, sin trascendencia inflada, sin adjetivos promocionales, sin atribuciones vagas, sin «no es X, sino Y», sin grupos de tres de relleno, sin vocabulario típico de IA en inglés ni en español, sin raya larga, sin negritas, sin emoji, sin cierre que resume, sin charla colaborativa).
**Alternativas descartadas:**
- Un filtro que reescriba o corte la prosa del modelo después de generarla: oculta el defecto en vez de corregir la causa, que está en el contexto del modelo.
**Consecuencias:**
- El banco cuenta las marcas por mensaje en cada caso (`bench/ai-tells.js`, con la sección de la guía citada por patrón), y el objetivo es cero en todos los casos.
**Condiciones de reversión:** Ninguna prevista.

## [UD-020] Licencias en dos capas: MIT en el código y las dependencias, LGPL admitida en los binarios de la imagen

**Fecha:** 2026-10-20
**Contexto:** La imagen Docker lleva `ffmpeg` (Alpine lo compila con partes GPL) y `libvips` (LGPL-3.0, el binario que trae `sharp`). UD-004 pedía que toda dependencia fuera compatible con MIT y dejaba estas dos sin decisión (DT-002). Martín: «respecto a lo de la imagen Docker que lleva algo que no es de la licencia que yo quiero, resuélvelo elegantemente».
**Decisión:** Dos capas con una regla cada una. Lo que se enlaza con el código del proyecto (el repositorio y toda dependencia de npm) es permisivo y compatible con MIT. Lo que la imagen ejecuta como programa aparte o carga como biblioteca compartida sin modificarla puede ser LGPL, que admite ese uso sin contagiar la licencia del proyecto, y nunca GPL. `ffmpeg` se compila dentro del propio `Dockerfile` en configuración LGPL (sin `--enable-gpl`, sin x264 ni x265) y sólo con los códecs que el producto usa, lo que además baja la imagen; `libvips` queda como viene en `sharp`. Cada binario de esa capa figura en un archivo `NOTICE` dentro de la imagen con versión, licencia y dirección del código fuente, que es lo que la LGPL exige.
**Alternativas descartadas:**
- Cambiar `sharp` y `ffmpeg` por alternativas MIT: no existe un equivalente MIT de `ffmpeg` con esa cobertura de formatos, y `sharp` es la biblioteca de imágenes de Node con mejor medición (informes 05 y 06).
- Dejar el `ffmpeg` de Alpine: trae componentes GPL que sí contagiarían la imagen distribuida.
**Consecuencias:**
- MASTER-SPEC §4.10 reescrita; DT-002 cerrada; una prueba de la batería lee `package.json` y el `NOTICE` y falla ante una licencia fuera de regla.
- Sobre DT-001 (idempotencia por emisor): no es una deuda. Martín ya había dicho que la idempotencia se estaba tomando demasiado literal; la detección de duplicados por emisor es un detalle de implementación, y §1.3 describe lo que hace el código. Se cierra sin UD.
**Condiciones de reversión:** Que un redistribuidor exija una imagen sin LGPL; entonces `ffmpeg` y `libvips` pasan a ser opcionales en tiempo de instalación.

## [UD-021] Todo insumo que una persona entrega se interpreta; si a primera vista no se entiende, se analiza más a fondo

**Fecha:** 2026-10-20
**Contexto:** Una captura de pantalla enviada sola, sin texto, producía cero mensajes (H-20): el analizador la trataba como «sin pedido».
**Decisión:** Martín, textual: «una captura de pantalla enviada sola sin texto debe producir mensajes aunque lo que sea esté viéndose desde la imagen. La inteligencia artificial que recibe todo esto debe entender que su deber es tratar de entender lo que le están pasando, entendiendo que una persona le entregó una serie de insumos; por lo tanto, cuando a primera vista no es fácil determinar las cosas, puede analizar más profundo». Es un principio del analizador, no una regla para capturas: una persona no manda algo por nada. Si un insumo no da un mensaje a la primera lectura, el analizador hace una segunda pasada más profunda (para una imagen, una descripción de visión más detallada con lo que se ve, lo que parece fallar o lo que se está mostrando; para un texto, una lectura por secciones) antes de concluir que no hay nada, y «cero mensajes» es un resultado que sólo se acepta después de esa segunda pasada. Lo que sale de una imagen sin texto lleva `source: "frame"`, para que quien envió lo vea y lo pueda descartar.
**Alternativas descartadas:**
- Cero mensajes como resultado normal de una captura sola: descartado por Martín.
**Consecuencias:**
- Segunda pasada en `src/analyze/` cuando la primera da cero mensajes, con su span y su prueba; las referencias c01, d01 y u03 del banco privado esperan un mensaje.
**Condiciones de reversión:** Ninguna prevista.

## [UD-022] Los párrafos largos van justificados y sin guionizado

**Fecha:** 2026-10-21
**Contexto:** Cuerpos de mensaje, respuestas, vista previa del input y cuerpos de plantilla pueden tener varias líneas.
**Decisión:** Martín, textual: «cuando hayan párrafos largos en la interfaz, el texto debería quedar justificado y sin guionizado». Todo bloque de texto corrido de más de dos líneas se compone con `text-align: justify` y `hyphens: none`; con `text-wrap: pretty` donde el navegador lo soporte, para que la justificación no deje ríos. Títulos, rótulos, chips, celdas y textos de una o dos líneas siguen alineados a la izquierda.
**Alternativas descartadas:**
- Justificado con guionizado automático: Martín lo descartó.
**Consecuencias:**
- Una clase única del kit (`prose-block`) que aplican todos los bloques largos; una prueba estática del panel falla si un bloque de párrafo usa otra alineación o activa `hyphens`.
**Condiciones de reversión:** Ninguna prevista.

## [UD-023] Cada miembro tiene un perfil en prosa; reemplaza a «responsabilidades» y «dominios»

**Fecha:** 2026-10-21
**Contexto:** `idea.md` hablaba de «descripción breve de sus responsabilidades y dominios» y el código lo volvió dos campos: `responsibilities` y `domains`. Martín, textual: «en un equipo pequeño startup muy enfocado en desarrollar con IA, las responsabilidades se difuminan mucho. En mi idea original yo hablé de las responsabilidades, pero me refería a que podríamos proveer una descripción de un par de párrafos de cada miembro del equipo y que esa descripción sirva como un contexto mucho más rico para el LLM que finalmente vaya a asignar mensajes».
**Decisión:** Un solo campo de texto libre por miembro, `profile`, con el rótulo «Perfil»: un par de párrafos en primera persona, escritos por la propia persona, que dicen qué hace, qué sabe, qué decide, qué no toca y cómo prefiere recibir las cosas. Reemplaza a `responsibilities` y `domains`, que se eliminan. El perfil entero viaja al modelo como contexto de cada análisis (invariante: mucho contexto cuesta poco), y el modelo asigna leyendo esos párrafos; el sistema sólo valida que el miembro exista. Se eligió «perfil» y no «descripción» porque una descripción habla de alguien y un perfil sirve para decidir a quién le toca algo, que es su único uso. El nombre y el perfil son lo único que el modelo sabe de cada miembro.
**Alternativas descartadas:**
- Mantener responsabilidades y dominios como listas: en un equipo chico se difuminan y el modelo asigna mejor con prosa.
- «Descripción»: no dice para qué sirve el texto.
**Consecuencias:**
- Migración: `members.profile TEXT`, con `responsibilities` y `domains` fundidos en el perfil existente y luego eliminados; `PATCH /members/me` acepta `profile`; `GET /members` y `/me` lo devuelven; el bundle del analizador lleva `members: [{ id, name, profile }]`.
- Equipo muestra el perfil en el lugar, editable sólo por su dueño, justificado (UD-022).
**Condiciones de reversión:** Que el modelo asigne peor con prosa que con listas, medido en el banco (exactitud de destinatarios).

## [UD-024] El Editor mantiene una descripción del proyecto en markdown que el analizador recibe como contexto

**Fecha:** 2026-10-21
**Contexto:** El analizador conocía las áreas, las plantillas y el equipo, pero nada del proyecto sobre el que el equipo trabaja.
**Decisión:** Martín, textual: «el usuario con el rol administrador debe poder cambiar la descripción del proyecto en ajustes y esa descripción debe ser un texto libre o un archivo markdown que se le entregará a la inteligencia artificial en la parte donde analiza un mensaje original y lo pasa por una plantilla. Si este contexto es lo suficientemente rico va a permitir que la IA describa muy bien el mensaje, le provea contexto si es necesario o explique mejor cuál es el valor para el producto. Si una plantilla de un área pide enriquecer el mensaje con información relacionada al proyecto, tener esa descripción es muy valioso: puede contener el índice de las carpetas del repositorio, información del stack, decisiones de diseño como lo haría el master spec». En Configuración, el Editor (el rol administrador de UD-007) edita la descripción del proyecto en el lugar como markdown, o sube un archivo `.md` que la reemplaza. El texto entero viaja al modelo en la llamada de descomposición (la que aplica la plantilla), dentro del prompt de sistema cacheado, para que una plantilla pueda pedir enriquecer un mensaje con contexto del proyecto; también va a la clasificación, porque saber qué es el producto ayuda a distinguir un error de una idea.
**Alternativas descartadas:**
- Descripción corta de una línea: no sirve para enriquecer.
- Leer el repositorio del proyecto en vivo: es una Conexión futura; hoy la descripción es lo que el Editor pega.
**Consecuencias:**
- Tabla `settings` (clave y valor) con `project_description` (markdown); `GET /settings/project` para todos y `PATCH /settings/project` para el Editor; `bundle.project = { name, description }`; tope de tamaño como perilla con su cita (el escalón de precio de 100.000 tokens de entrada del modelo por omisión).
- Las plantillas iniciales mencionan que pueden apoyarse en el contexto del proyecto cuando exista.
**Condiciones de reversión:** Ninguna prevista.

## [UD-025] Envíos seguidos: cada uno se analiza al tiempo, llegan uno tras otro en una bandeja compacta y la pantalla no crece

**Fecha:** 2026-10-21
**Contexto:** El uso diario normal es mandar algo, acordarse de otra cosa, mandarla, y otra más. La cola corría un trabajo a la vez y la vista de Inicio apilaba un bloque de análisis por envío.
**Decisión:** Martín, textual: «asegúrate de que esté bien cubierto el caso de que alguien mande un mensaje e inmediatamente después piensa en otra cosa que quería mandar y lo mande, y luego mande otra cosa. Los mensajes procesados deben ir llegando uno tras otro sin que la interfaz se vuelva inmanejable ni que el usuario esté forzado a hacer scroll por toda la página … pensar en estos casos borde enfocados en la usabilidad a diario». Cuatro reglas: (1) la barra de envío se vacía al enviar y queda lista para el siguiente en el acto, sin esperar el análisis; (2) los envíos se analizan a la vez, no en fila, hasta el tope de concurrencia (perilla medida contra el límite de tasa del proveedor), y la cola atiende por orden de llegada dentro de cada persona; (3) en Inicio, los envíos en curso y los listos para revisar viven en una sola bandeja de alto fijo, una fila por envío con su estado, su progreso y la cuenta de mensajes propuestos, y la propuesta se revisa de a una en el mismo marco (la siguiente se abre sola al publicar o descartar la actual), de modo que diez envíos seguidos no agregan alto a la página; (4) el análisis de un envío recibe como contexto los envíos recientes de la misma persona que todavía no publicó, para que un punto que continúa o repite uno anterior se diga así y no salga duplicado.
**Alternativas descartadas:**
- Un bloque de análisis por envío apilado en la página: crece sin tope y obliga a desplazarse.
- Juntar automáticamente envíos seguidos en uno: decidir que dos envíos son el mismo es interpretar texto con una regla; lo decide el modelo con el contexto de los recientes, y la persona en la revisión.
**Consecuencias:**
- `QUEUE_CONCURRENCY` deja de ser 1: se mide en el banco con cinco envíos simultáneos contra el límite de tasa de Anthropic y Groq y se fija con su cita.
- `bundle.recent_inputs` con los envíos sin publicar de la misma persona (texto ya extraído y títulos propuestos), con un tope de cantidad y de antigüedad declarados.
- Bandeja de envíos en Inicio con prueba de alto: diez envíos seguidos no cambian `scrollHeight` del documento.
**Condiciones de reversión:** Ninguna prevista.

## [UD-026] Lo que genera la IA se distingue a simple vista; nada se muestra dos veces; el móvil aprovecha el espacio

**Fecha:** 2026-10-21
**Contexto:** Martín revisó una captura móvil de Inicio con una propuesta abierta.
**Decisión:** Martín, textual: «la parte de análisis no está muy visualmente separada de la parte del mensaje … a simple vista cuesta entender que una parte de la pantalla corresponde a algo que generó una inteligencia artificial. Una forma de combatir esto es dándole un fondo de color distinto a la parte de análisis, pero también puedes ver cómo lo hacen otras interfaces de usuario 2026», y «en Envíos aparece el mismo texto que después se muestra en el mensaje, es ridículo, hay que fusionar ese componente … en móvil tenemos que aprovechar mucho mejor el espacio». Tres reglas de clase: (1) todo contenido generado por el modelo vive en una superficie propia y reconocible (fondo distinto del kit, marca de origen e ícono consistentes, siguiendo el patrón investigado de las interfaces de 2026) en todas las pantallas donde aparece, no sólo en Análisis; (2) ningún dato se muestra dos veces en la misma vista: la fila del envío seleccionado se convierte en la cabecera de su revisión, el texto original no se repite, y los conteos y estados aparecen una sola vez; (3) en móvil, lo que no se necesita para decidir nace plegado (el texto original se abre a pedido cuando la propuesta está lista), y los controles secundarios son íconos con nombre accesible.
**Alternativas descartadas:**
- Separar por una línea o un título: la captura muestra que no alcanza.
**Consecuencias:**
- Prueba del panel que falla si un mismo texto de más de 20 caracteres aparece dos veces en una vista; captura móvil revisada a 390×844 de Inicio con propuesta abierta.
- El banco cuenta como marca de baja calidad un cuerpo de mensaje que repite su título.
**Condiciones de reversión:** Ninguna prevista.

## [UD-027] Presupuesto de API de Anthropic para el desarrollo y las mediciones

**Fecha:** 2026-10-21
**Decisión:** Martín, textual: «podemos gastar hasta 25 usd en api de anthropic». Es un tope total para lo que falta de desarrollo, mediciones y pruebas con el proveedor real, repartido entre los agentes (cada encargo declara su parte) y llevado en `bench/results/` por los guiones de gasto. Una corrida que lo supere se detiene y lo dice.
**Consecuencias:** Las comparaciones de modelos (Haiku 5.5, Sonnet 5.5, DeepSeek), las repeticiones del banco y las pruebas de punta a punta en el VPS cuentan contra este tope.

## [UD-028] Lo que afecta a cada miembro se cuenta en el servidor, con un criterio mínimo, y los pendientes por área llevan a Mensajes filtrado

**Fecha:** 2026-10-21
**Contexto:** Martín vio Inicio en su teléfono y en el PC y dijo, textual: «si me llegó un mensaje a mí, la interfaz no me avisa como debería. Además la pestaña Mensajes debería tener una notificación que indique cuántos mensajes abiertos me afectan específicamente, y el área Error en general debería mostrar pendientes; si uno hace clic en esos pendientes debe llevar a la vista de Mensajes filtrando por los pendientes de esa área». La API no guarda quién leyó qué: no existe «respuesta sin leer» como dato.
**Decisión:** Un mensaje no cerrado afecta a un miembro cuando está asignado a él, o cuando él lo emitió y ya tiene respuestas. El criterio usa sólo datos que la API ya tiene (asignados, emisor, estado). `GET /api/messages/summary` devuelve, para quien tiene la sesión, el conteo por prioridad (`mine`: `red`, `yellow`, `blue`, `total`) y, por área, los mensajes abiertos (`open`) y cuántos de ellos están asignados a él (`mine_open`). Cada mensaje cae en una sola prioridad: asignado y abierto es rojo; asignado y respondido es amarillo; emitido por él, sin estar asignado y respondido es azul. Un pendiente por área es un conteo clicable que lleva a `/messages` con los filtros `area` y `status=open`.
**Alternativas descartadas:**
- Estado de lectura por miembro (tabla de «visto hasta»): contestaría «sin leer» de verdad, pero agrega esquema, escritura en cada apertura y una decisión de cuándo un mensaje cuenta como leído. Se evalúa si el uso demuestra que el criterio mínimo no alcanza (H-93).
- Contar en el panel recorriendo `GET /messages`: la lista pagina con tope de 100 y el conteo quedaría incompleto con más mensajes.
- Contar también lo emitido por el miembro sin respuestas: no es una respuesta que espera ni una acción que le toque.
**Consecuencias:**
- La insignia baja cuando el mensaje se responde o se cierra, no cuando se lee.
- Prueba de la API: cada mensaje cae en una sola prioridad, uno cerrado no cuenta, los abiertos se cuentan por área y la ruta exige sesión.
**Condiciones de reversión:** Si el criterio sin estado de lectura deja avisos que la persona ya vio y siguen contando, se agrega el estado de lectura por miembro (H-93).

## [UD-029] El aviso lleva el color de la prioridad más alta presente (rojo, amarillo, azul)

**Fecha:** 2026-10-21
**Contexto:** Martín pidió, por el coordinador, que el ícono de notificación sea mucho más prominente, que su fondo se tiña del color de la notificación de mayor prioridad, «porque hay notificaciones azules, amarillas y rojas», y que el significado de cada color se defina con los datos que ya existen.
**Decisión:** Tres prioridades, en este orden: rojo, amarillo, azul. Rojo: afecta al miembro directamente y requiere su acción (asignado a él y todavía abierto). Amarillo: pendiente (asignado a él y respondido sin cerrar; los abiertos de un área que no son suyos). Azul: informativo o nuevo (respuestas a un mensaje que él emitió; novedades del flujo de eventos mientras nada más lo afecte). El fondo de toda insignia (pestaña Mensajes, campana, aviso de Inicio, pendientes por área) es el color de la prioridad más alta presente en lo que cuenta. El color nunca es el único indicador: cada prioridad lleva su forma (triángulo, reloj, punto con marca), su palabra («Por atender», «Pendiente», «Novedad») y el número. Los fondos y bordes cumplen contraste en claro y oscuro (`npm run contraste`: 4,5 el texto sobre su fondo y 3 el borde sobre vidrio y cromo). La definición de cada color la propuso la sesión con los datos existentes; Martín la confirma o la cambia.
**Alternativas descartadas:**
- Rojo para el área «Error»: un `if` sobre el nombre de un área editable por el Editor; la prioridad sale del estado y de los asignados, no de un título.
- Color como único indicador: falla para quien no distingue colores.
**Consecuencias:**
- `panel/src/lib/priority.ts` es el único lugar donde se decide la prioridad más alta; `NotifyBadge` y la campana la leen de ahí.
- Pruebas: la prioridad más alta gana en las ocho combinaciones; en el navegador, el fondo pintado de cada insignia coincide con el de su prioridad en las ocho combinaciones y en los dos temas.
**Condiciones de reversión:** Si Martín cambia el significado de un color, se cambia `priority.ts` y `messageSummary` en el mismo commit.

## [UD-030] Inicio muestra lo último y lo nuevo para mí, y pliega los envíos tras un solo control

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «Los últimos mensajes y últimas respuestas deberían tener un lugar mucho más prominente en la interfaz. Ahora quedaron como un hipervínculo abajo … El detalle del mensaje que se escribió debería ser desplegable o manejarse de otra forma, porque la cola de envíos es importante y el análisis también, pero hoy ocupan tanto espacio que opacan lo de los últimos mensajes y últimas respuestas. Además el texto para leer, que es la descripción del análisis y es súper importante, no es tan visible: es lo que más debería destacar del análisis».
**Decisión:** (1) Inicio muestra, en este orden, la barra de envío, el aviso «Para mí» (insignia grande, un chip por prioridad con su conteo y los pendientes por área, cada uno clicable hacia Mensajes ya filtrado), y los bloques «Últimos mensajes» y «Últimas respuestas» como lo principal de la página, siempre a la vista, cada uno en su superficie. Las filas que afectan al miembro llevan un borde del color de su prioridad y la marca con su palabra. (2) La cola de envíos, el original y el análisis quedan tras un solo control («Envíos») con el estado en su cara (cuántos para revisar, en análisis, fallidos). Abrirlo muestra la revisión en un diálogo centrado sobre la página, que no cambia de alto; no es un panel lateral. El original nace plegado. (3) El texto de cada mensaje propuesto, que es lo que se lee, se dibuja a 17 px con interlineado 1,65, color de texto pleno y justificado (`prose-block`), más grande que el título y que los campos de la plantilla. (4) El control de envíos conserva su alto con uno o diez envíos, y J, K y Enter siguen funcionando dentro de la revisión.
**Alternativas descartadas:**
- Acordeón en la misma página: con la revisión abierta los dos bloques quedaban en una fila de alto, con el paginador encima de la fila (H-96).
- Plegar sólo el original: la cola y el análisis siguen opacando lo último.
**Consecuencias:**
- Las pruebas de ajuste (`test:fit`) y de flujos (`test:flows`) abren el diálogo de envíos antes de revisar una propuesta; la medida de alto de diez envíos se toma sobre la página, que no cambia.
- Una captura a 1440×900 y a 390×844, en claro y oscuro, de Inicio sin envíos, con el envío plegado y con el diálogo abierto.
**Condiciones de reversión:** Si revisar en un diálogo resulta incómodo frente a ver los últimos mensajes mientras se revisa, se vuelve a una disposición en la página con alto repartido.
## [UD-031] Las descripciones de área son largas y detalladas, y juntas son mutuamente excluyentes y colectivamente exhaustivas

**Fecha:** 2026-10-21
**Contexto:** El modelo clasificaba con una frontera entre áreas escondida en el prompt (H-91) que no coincidía con la de las referencias, y las descripciones cortas de `templates/areas.json` dejaban los casos borde sin regla de desempate.
**Decisión:** Martín, textual: «La gracia es que este programa sea algo que uno puede demorarse un día entero en configurar, pensando muy bien las cosas y llegando a descripciones muy detalladas y buenas, de modo que sean orgánicamente exhaustivas y colectivamente inclusivas. Está bien que las descripciones sean largas y verbosas, porque eso aporta exactitud al contexto. Está bien enfocarse en que cubran los casos borde y hacer un diseño robusto. Ten en mente mutuamente excluyente y colectivamente exhaustivo.» Cada descripción tiene de dos a cuatro párrafos: qué es y qué la distingue, casos típicos, casos borde con la regla de desempate hacia las áreas vecinas, y qué no es. El prompt conserva solo la mecánica (unidades, grupos, esquema) y ninguna definición de producto.
**Alternativas descartadas:**
- Descripciones de una o dos oraciones con un ejemplo: dejan sin regla los casos que las dos lecturas de las referencias resuelven distinto.
- Definiciones en el prompt: el Editor no las ve ni las edita.
**Consecuencias:**
- Una prueba exige de dos a cuatro párrafos, los títulos «Casos típicos» y «Casos borde» y que cada área sea el destino de un desempate en alguna vecina.
- La vista de Áreas del panel debe mostrar textos de este largo plegados con vista previa (`test:fit`).
- Las descripciones se miden contra las dos lecturas de las referencias con `bench/area-vs-references.mjs`.
**Condiciones de reversión:** Que el costo de tokens del catálogo (cacheado) o la edición en el panel lo vuelvan inmanejable.

## [UD-032] Un insumo sin pedido produce un mensaje que resume lo compartido; nunca una propuesta vacía

**Fecha:** 2026-10-21
**Contexto:** En la prueba en el VPS, un enlace compartido sin pedido («Mira este artículo, me parece relevante para nosotros») dejó 68 unidades descartadas y una propuesta con cero mensajes que no se podía publicar (`422 messages_empty`) (H-133). Con un video, además, la frase que solo señala el adjunto salió como un mensaje genérico aparte (H-135).
**Decisión:** Se aplica UD-021 («una persona no manda algo por nada») a los insumos sin pedido: si tras la segunda lectura no hay un pedido explícito, el punto es lo compartido y se agrupa en el área que el catálogo describe para lo que se comparte sin pedido ni falla (hoy Idea), con un mensaje que lo resume para que el equipo lo vea y decida. La frase que solo señala un adjunto («mira este video») no es un punto: va con el punto que el adjunto muestra.
**Alternativas descartadas:**
- Un estado «sin pedido» en el panel con la publicación apagada: deja a la persona con un insumo que el sistema no entendió, que es lo que UD-021 prohíbe.
- Una regla sobre las palabras del texto para reconocer un enlace sin pedido: interpretaría texto con una regla.
**Consecuencias:**
- Dos pruebas con el proveedor real (enlace sin pedido y video con una frase que lo señala) y dos regresiones de prompt (REG-010 y REG-011).
**Condiciones de reversión:** Que Martín prefiera un estado explícito «sin pedido» en el panel.

## [UD-033] Las descripciones de área se corrigen contra la exactitud medida en el pipeline, y el catálogo lista Nueva funcionalidad primero

**Fecha:** 2026-10-21
**Contexto:** Las descripciones largas de UD-031 bajaron la exactitud de área de 82,6 % a 75,8 % (unión de lectores). Martín: «El dueño necesita poder confiar en la clasificación por área: esa es la métrica que más importa.» La causa medida son dos frases que atraían unidades a Pregunta y a Retroalimentación (`docs/investigaciones/mediciones/2026-10-21-descripciones-de-area-largas.md`).
**Decisión:** Las descripciones siguen siendo de dos a cuatro párrafos con casos típicos y casos borde, y se reescriben así: «debe», «tiene que», «hay que» y «en vez de» marcan un pedido (Nueva funcionalidad o Error), nunca una valoración; Retroalimentación es la impresión sin pedido; Pregunta es lo que se le pregunta a alguien, y la gestión solo cuando el punto es averiguarla; poder editar, borrar o ver el historial es una capacidad. El orden del catálogo es Nueva funcionalidad, Error, Retroalimentación, Idea, Pregunta, por el campo opcional `position` de `templates/areas.json`; los ids no cambian. La exactitud sube a 86,4 % y 85,5 % (pipeline, clasificación).
**Alternativas descartadas:**
- Una regla de prioridad explícita hacia Nueva funcionalidad en tres áreas: bajó la exactitud a 77,8 %.
- Volver a las descripciones cortas: pierden los casos borde que UD-031 exige.
**Consecuencias:**
- La prueba de REG-004 acepta «cómo debe comportarse algo que todavía no existe». La prueba de publicación usa el área Idea de forma explícita, porque la primera del catálogo ahora es Nueva funcionalidad.
- El panel lista las áreas en ese orden (el Editor puede cambiarlo).
- `bench/areas-classify.mjs` mide la clasificación sola, a unos 0,05 USD por corrida.
**Condiciones de reversión:** Una corrida completa del pipeline con proyecto bajo el 82,6 % de las cortas, o que Martín prefiera el orden anterior.


## [UD-035] Una parte que el análisis dejó sin mensaje se convierte en mensaje, de a una, desde su lista

**Fecha:** 2026-10-21
**Contexto:** El juez de la ronda 3 (J3-B-09) no pudo convertir en mensaje un párrafo que el análisis dejó sin acción y que era un error real: la lista «Partes sin mensaje» sólo se leía y la única salida era analizar todo de nuevo. Martín pidió atender el 100 % de los hallazgos de la ronda y dejó decidir lo que el informe dejaba abierto.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. Cada parte de la lista lleva «Crear mensaje». El mensaje nuevo lleva el texto de esa parte como cuerpo, sus primeras ocho palabras como título provisional (se edita en el lugar, UD-017), el área del primer mensaje de la propuesta (o la primera del catálogo si no queda ninguno), la plantilla de esa área, sin destinatarios, y se abre al crearse. La parte sale de la lista y es una operación del historial: Deshacer la devuelve. El botón «Partes sin mensaje» pasa al pie de la propuesta, junto a Descartar envío, y no ocupa una fila propia.
**Alternativas descartadas:**
- Un solo botón que convierta todas las partes juntas: junta puntos distintos en un mensaje.
- Elegir el área o los destinatarios leyendo el texto de la parte: es un `if` sobre texto humano, que la regla 4 de `docs/RULES.md` prohíbe. La persona los elige en el mensaje ya creado.
- Abrir un editor aparte para la parte: UD-017 pide editar en el lugar.
**Consecuencias:**
- Prueba `flows` «a part without a message becomes a message, one part at a time, and Deshacer takes it back» (`panel/src/flows-ronda3b.browser.test.mjs`).
- Un título provisional de ocho palabras no es una interpretación del texto: es su comienzo, y la persona lo cambia antes de publicar (el título es obligatorio).
**Condiciones de reversión:** Que Martín prefiera que las partes sin mensaje sean sólo lectura, o que la medición de uso muestre que el título provisional se publica sin editar.
## [UD-034] El justificado de los párrafos depende del ancho del contenedor

**Fecha:** 2026-10-21
**Contexto:** El juez A de la ronda 3 midió en teléfono huecos de unos 20 px entre palabras en las respuestas, en el proyecto y en las instrucciones (J3-A-21). UD-022 pide justificar todo bloque de más de dos líneas. Martín delegó la decisión: «decide por ti mismo, reversible y barato».
**Decisión:** Las palabras de UD-022 siguen siendo la regla: «cuando hayan párrafos largos en la interfaz, el texto debería quedar justificado y sin guionizado». Un bloque `prose-block` se justifica sólo mientras su ancho mide 29,2 rem (438 px con la raíz de 15 px) o más, y debajo se alinea a la izquierda. El valor sale de `docs/investigaciones/mediciones/2026-10-21-justificado-por-ancho.md`: a 1440 px, donde Martín vio el texto justificado, el hueco mayor entre palabras fue de 14,2 px, y 438 px es el ancho más angosto desde el cual ningún ancho mayor, en un barrido de 2 px, pasa de ese hueco. A 290 o 330 px los huecos llegan a 20 o 28 px.
**Alternativas descartadas:**
- Alinear a la izquierda todo texto corrido: contradice UD-022 en los anchos donde el justificado no abre huecos.
- Un umbral más bajo: entre 402 y 436 px un renglón abre hasta 21,4 px y a 350 px 16,0 px, sobre el hueco de referencia.
- Guionizar: Martín lo descartó en UD-022.
**Consecuencias:**
- `panel/src/lib/prose-width.ts` (`JUSTIFY_MIN_REM = 29.2`) marca con `data-wide` cada `.prose-block` que mide eso o más; la hoja de estilos justifica sólo `.prose-block[data-wide]` y alinea a la izquierda el resto.
- Las dos columnas de la ficha pasan de 5 y 7 partes de 12 a 0,9 y 1 partes: a 1440 px el cuerpo del mensaje (394 px antes) y el texto de las respuestas miden más de 438 px y siguen justificados.
- Prueba del navegador: a 390 px ningún bloque se justifica y a 1440 px los anchos desde 438 px sí, con el hueco medido en los párrafos reales.
**Condiciones de reversión:** Si Martín prefiere justificar a cualquier ancho, se quita la condición `data-wide` de la hoja de estilos y `watchProse`; si cambia la tipografía o el tamaño de la raíz, se repite la medición.

## [UD-036] Un solo relleno de color en la interfaz: la campana

**Fecha:** 2026-10-21
**Contexto:** UD-029 pidió que el aviso lleve el color de la prioridad más alta y que cada prioridad tenga forma, palabra y número. Martín pidió que el ícono de notificación fuera más prominente y que su fondo se tiñera del color de mayor prioridad. La ronda 3 del juez A contó en Inicio más de 18 elementos rojos con el mismo peso (J3-A-04, severidad 5): campana, pestaña Mensajes, chips, áreas, marcas y borde de cada fila. La ronda 2 los había bajado a un tono suave y no alcanzó.
**Decisión:** El fondo de color de la prioridad es de la campana, y sólo de la campana. Toda otra cuenta o marca de prioridad (pestaña Mensajes, chips de Inicio, pendientes por área, avisos de la lista de la campana, marca de una fila) va en peso callado: fondo neutro, borde neutro, texto en tinta, y la prioridad sólo en el color de su forma (triángulo, reloj, punto) junto a su palabra y su número. En una fila de mensaje la prioridad se dice una sola vez, en la columna de estado, y el borde izquierdo de 3 px es lo único de la fila que lleva color. UD-029 conserva el significado de los tres colores y que el color nunca es el único indicador. Es una decisión de la sesión por encargo de Martín de atender el 100 % de los hallazgos de la ronda; la palabra «fondo de toda insignia» de UD-029 es del coordinador y no una cita de Martín.
**Alternativas descartadas:**
- Mantener el tono suave de la ronda 2: el juez lo siguió contando como rojo.
- Quitar el número de la pestaña Mensajes o el de la campana: UD-028 pide ambos.
**Consecuencias:**
- `[data-weight='quiet']` en `panel/src/styles.css` reemplaza al peso suave. Una prueba del navegador cuenta los elementos con fondo rojo de Inicio con 9 pendientes y con 4 y falla si hay más de uno.
**Condiciones de reversión:** Que Martín pida de nuevo la insignia teñida: se restituye el peso suave de la ronda 2 cambiando `quiet` por `soft` en un solo lugar de la hoja de estilos.

## [UD-037] Conexiones se lista una vez, apagada y con su razón

**Fecha:** 2026-10-21
**Contexto:** UD-012 y MASTER-SPEC §4.1 dejan la vista Conexiones visible y apagada, con la razón, hasta que se pruebe que la descomposición funciona. La ronda 3 del juez A vio cinco filas idénticas «No disponible todavía» sin acción (J3-A-45) y un submenú en la barra lateral que desplazaba lo de abajo al abrirse (J3-A-46).
**Decisión:** Se mantiene la vista, porque la especificación la pide visible, y se dice una vez: el título lleva la razón («Apagadas hasta que la descomposición esté probada») y cada conexión es un nombre, sin repetir un estado idéntico por fila. La barra lateral tiene una sola entrada, Conexiones, sin submenú. No se ocultan hasta que existan: eso contradice la especificación, y mostrar «lo que falta para conectarlas» sería inventar acciones de conectores que todavía no tienen diseño. Es una decisión de la sesión por encargo de Martín; la dirección `/connections/:kind` sigue abriendo la vista con esa conexión marcada.
**Alternativas descartadas:**
- Ocultar la vista: contradice MASTER-SPEC §4.1.
- Una acción por conector: no hay conector.
**Consecuencias:**
- La barra lateral no cambia de forma al abrir Conexiones; Configuración y Cerrar sesión quedan al pie.
**Condiciones de reversión:** Que se construya el primer conector: su fila pasa a mostrar su estado y su acción real, y se agrega la entrada a la barra.

## [UD-038] El presupuesto de API sube 50 USD

**Fecha:** 2026-10-21
**Contexto:** El tope de UD-027 (25 USD) quedó casi agotado con las mediciones del banco, el semáforo, los medios en el VPS y la iteración de descripciones de área, y dejó sin correr la comparación de modelos (H-80) y la corrida completa del pipeline con proyecto (H-602).
**Decisión:** Martín, textual: «subo el presupuesto 50 dólares». Se lee como 50 USD más sobre los 25 de UD-027, 75 en total. Cada encargo declara su parte antes de gastar y se detiene en ella; el gasto acumulado se lleva en `bench/results/`.
**Consecuencias:** Se pueden correr H-80, H-602 y más repeticiones para separar efectos del ruido entre corridas.
**Condiciones de reversión:** Si Martín quiso decir un tope total de 50 USD, quedan unos 26 USD sobre lo ya gastado y los encargos en curso se detienen en esa cifra.

## [UD-039] El iPhone no se prueba todavía

**Fecha:** 2026-10-21
**Contexto:** H-56 pedía probar el micrófono y la cámara en Safari e iPhone con un aparato real.
**Decisión:** Martín, textual: «Lo del iPhone me da lo mismo, no lo vamos a usar todavía porque en realidad muchas imágenes puede que se suban directamente en Whatsapp o algo así». No se prueba con un aparato real por ahora.
**Consecuencias:** H-56 deja de ser trabajo pendiente y queda como decisión del dueño. Un HEIC subido directamente se rechaza con un error claro (`image_heic_unsupported`); el Editor puede pedir que se acepte más adelante. UD-040 (2026-10-21) lo reemplaza: el HEIC se decodifica y deja de rechazarse.
**Condiciones de reversión:** Se prueba cuando haya usuarios con iPhone en el panel.

## [UD-040] El HEIC de iPhone se decodifica con el `ffmpeg` de la imagen

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «asumo que el código que hiciste ya es compatible con el formato de iPhone». No lo era: `sharp` trae `libvips` sin decodificador HEVC y la subida rechazaba un HEIC con 422 `image_heic_unsupported` (H-21, UD-039). UD-039 decidió no probar el aparato; no decidió que el formato no se aceptara cuando alguien lo suba. Safari suele convertir a JPEG en el selector de archivos y WhatsApp entrega JPEG, pero el sistema no depende de eso.
**Decisión:** Decisión de la sesión por encargo de Martín (decidir la opción con una UD, sin llamar a ningún modelo). Un HEIC o HEIF se decodifica a JPEG con el `ffmpeg` que la imagen ya lleva y sigue el flujo normal de imágenes (rotación, reducción al lado máximo, tope de 7 MiB). El `ffmpeg` mínimo ya tenía el demultiplexor `mov` y el decodificador HEVC; se le añaden los filtros `xstack` (compone las teselas de la foto), `transpose`, `hflip` y `vflip` (aplican la rotación `irot` del contenedor). Se descarta la entrada por marca `image_heic_unsupported`: un HEIC dañado falla en la extracción con `image_heic_unreadable`, y uno de más de 50 millones de píxeles con `image_too_many_pixels`, leído de las cabeceras antes de decodificar (`image.heicMaxPixels`, medido en `docs/investigaciones/mediciones/2026-10-21-heic-via-ffmpeg.md`). Del archivo se toma la imagen principal.
**Alternativas descartadas** (fuentes consultadas el 2026-10-21):
- `heic-decode` o `libheif-js` (WASM): `libheif-js` 1.23.5 es LGPL-3.0 (npm, 2026-10-04) y entraría como dependencia de npm, lo que UD-020 reserva a licencias permisivas; el WASM incorpora la biblioteca y no puede sustituirse como una biblioteca compartida. Añade 9,0 MB desempaquetados y un segundo decodificador de HEVC. `heic-decode` es ISC pero depende de `libheif-js`.
- `sharp` con `libvips` y `libheif` del sistema con HEVC: obliga a compilar `sharp` contra bibliotecas de Alpine en x86-64 y arm64 (libde265 LGPL, x265 GPL en la codificación) y rompe el binario precompilado que hoy se instala sin compilar.
- Decodificar en el panel antes de subir: no cubre la API ni los adjuntos que no pasan por el panel, y repartiría un WASM LGPL dentro del paquete del panel.
**Consecuencias:**
- Sin dependencias nuevas de npm. La capa de binarios de UD-020 no cambia: `ffmpeg` sigue en configuración LGPL, sin `--enable-gpl`; el `NOTICE` actualiza la línea de configuración con los cuatro filtros.
- La imagen crece 0,5 MB (306,96 a 307,48 MB). No hay binario nativo por arquitectura: `ffmpeg` se compila en la etapa de la imagen para la arquitectura de la construcción.
- H-21 se cierra. UD-039 sigue vigente en lo que decidió (no se prueba Safari ni el micrófono con un iPhone, H-56).
**Condiciones de reversión:** Que un redistribuidor no acepte el decodificador HEVC dentro de la imagen (patentes de HEVC); entonces el HEIC vuelve a rechazarse en la subida.


## [UD-059] Los adjuntos van primero y se miran en una galería de medios que se reutiliza en todo el panel

**Fecha:** 2026-10-21
**Contexto:** Martín revisó la lista de envíos y vio los adjuntos en un segundo plano.
**Decisión:** Martín, textual: «Me parece que el archivo adjunto no tiene la prioridad en la interfaz que yo claramente puse en la maqueta inicial de este programa. Cuando veo la lista de envíos, en ese modal me gustaría ver al tiro la foto que haya, o la galería de fotos si son varias, o galería de medios si hay fotos mezcladas con videos, y poder ir moviéndome entre una y otra manteniendo un carrusel abajo de cuál es el que estoy viendo dentro de los otros. Yo creo que sería súper útil implementarlo en todo el sitio y que este componente de galería de medios sea reutilizado donde corresponda.»
Lo que dice la maqueta (`Plataforma Team.png`, en la raíz del repositorio): la revisión de un mensaje nuevo es un par de bloques lado a lado. A la izquierda, «Mensaje o transcripción» con «editar» y la «Lista de adjuntos» con su «+»; a su derecha, «Previsualización de: imagen o galería, video o carrusel, audio(s), docx o PDF». El análisis de la IA repite el mismo par: «Área detectada», «Descripción», su propia «Previsualización de…» y la «Descripción de adjuntos» con su «+», y «Enviar». En las tarjetas de «Últimos mensajes» y «Últimas respuestas» el adjunto es un círculo grande a la derecha del texto (una imagen, un audio con su forma de onda, un video con su triángulo), y junto a la fecha van los íconos de micrófono y cámara. Es decir, el adjunto tiene un bloque propio del mismo peso que el texto y no una fila de íconos.
**Consecuencias:**
- `MediaGallery` (`panel/src/components/MediaGallery.tsx`) es el único lugar donde se mira un adjunto: visor grande con el medio elegido, carrusel de miniaturas debajo con el actual marcado (borde grueso, barra inferior y `aria-current`, no sólo color), flechas, «2 de 5», teclas Izquierda, Derecha, Inicio y Fin, deslizar en el teléfono (el visor es una fila con ajuste de desplazamiento, así que el gesto es el del navegador y no lleva una distancia propia), y sin carrusel cuando hay un solo medio. Foto: ajustada al marco, «Ampliar» la muestra a su tamaño y Escape la devuelve sin cerrar la ventana que la contiene. Video: sus controles y su primer fotograma como portada. Audio: el reproductor y, si el servidor extrajo texto, la transcripción. Documento y enlace: nombre, tipo, dominio y la forma de abrirlo. Sólo las diapositivas vecinas a la actual cargan su contenido; un archivo que falla lo dice y se reintenta. Sin dependencias nuevas.
- Se usa en: la ficha de un mensaje (los adjuntos van antes del texto), las respuestas de la ficha y la lista de Mensajes y las tarjetas de Inicio (la miniatura principal lleva la cuenta y abre la galería sobre la página), y el selector de adjuntos de cada mensaje propuesto (la miniatura abre la galería de lo que ese mensaje lleva). `AttachmentStrip` y `MediaOpener` son los dos disparadores: ambos abren `MediaGalleryDialog`, una ventana centrada, nunca un panel lateral.
- Servidor: `GET /api/attachments/:id/transcript` entrega `{ text }` de un audio o video con el mismo acceso que el archivo; los adjuntos de un mensaje llevan `extracted` para que el panel sólo la pida cuando existe. Las respuestas no se analizan y no tienen transcripción.
- Los datos de ejemplo de la galería (seis fotos, fotos con video, audio con transcripción, PDF con foto dañada y enlace, una sola foto) sólo se siembran con `PANEL_DEV_MEDIA=1`, para no alterar lo que cuentan las demás pruebas. `npm run test:gallery` las recorre en un navegador.
- Se dejó fuera, con su razón: (1) la ventana de Envíos, porque el dueño cambió su diseño a un desplegable en línea y lo construye otra rama sobre `MediaGallery`; (2) los chips de la barra de nuevo mensaje (`MediaDraft`), que son archivos locales aún sin enviar y cuyo uso es quitarlos, no mirarlos; (3) las filas del menú del selector, que es una lista de casillas; (4) la vista de la primera página de un PDF, porque el servidor entrega cada archivo con una política que prohíbe incrustarlo y dibujarlo exigiría una dependencia de renderizado de PDF de más de un megabyte; (5) el título de un enlace, que el sistema no guarda; (6) un endpoint de miniaturas y portadas: exigiría convertir imágenes en el servidor, que toca el extractor de imágenes en otra rama; el panel pide el archivo con carga diferida y el navegador dibuja el primer fotograma del video sin una portada aparte.
**Condiciones de reversión:** Si Martín prefiere una vista de documentos con primera página, se agrega el renderizado con una dependencia justificada en MASTER-SPEC §3.
