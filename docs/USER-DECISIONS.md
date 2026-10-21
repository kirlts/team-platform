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

## [UD-028] Lo que afecta a cada miembro se cuenta en el servidor, con un criterio mínimo, y los abiertos por área llevan a Mensajes filtrado

**Fecha:** 2026-10-21
**Contexto:** Martín vio Inicio en su teléfono y en el PC y dijo, textual: «si me llegó un mensaje a mí, la interfaz no me avisa como debería. Además la pestaña Mensajes debería tener una notificación que indique cuántos mensajes abiertos me afectan específicamente, y el área Error en general debería mostrar pendientes; si uno hace clic en esos pendientes debe llevar a la vista de Mensajes filtrando por los pendientes de esa área». La API no guarda quién leyó qué: no existe «respuesta sin leer» como dato.
**Decisión:** Un mensaje no cerrado afecta a un miembro cuando está asignado a él, o cuando él lo emitió y ya tiene respuestas. El criterio usa sólo datos que la API ya tiene (asignados, emisor, estado). `GET /api/messages/summary` devuelve, para quien tiene la sesión, el conteo por prioridad (`mine`: `red`, `yellow`, `blue`, `total`) y, por área, los mensajes abiertos (`open`) y cuántos de ellos están asignados a él (`mine_open`). Cada mensaje cae en un solo estado. Un conteo por área es clicable y lleva a `/messages` con los filtros `area` y `status`. UD-041 reemplaza los colores por los estados: asignado y abierto cuenta como abierto; asignado y respondido, o emitido por él con respuestas, cuenta como respondido; `mine` devuelve `open`, `answered` y `total`, y cada área `open`, `answered`, `closed` y `mine_open`.
**Alternativas descartadas:**
- Estado de lectura por miembro (tabla de «visto hasta»): contestaría «sin leer» de verdad, pero agrega esquema, escritura en cada apertura y una decisión de cuándo un mensaje cuenta como leído. Se evalúa si el uso demuestra que el criterio mínimo no alcanza (H-93).
- Contar en el panel recorriendo `GET /messages`: la lista pagina con tope de 100 y el conteo quedaría incompleto con más mensajes.
- Contar también lo emitido por el miembro sin respuestas: no es una respuesta que espera ni una acción que le toque.
**Consecuencias:**
- La insignia baja cuando el mensaje se responde o se cierra, no cuando se lee.
- Prueba de la API: cada mensaje cae en una sola prioridad, uno cerrado no cuenta, los abiertos se cuentan por área y la ruta exige sesión.
**Condiciones de reversión:** Si el criterio sin estado de lectura deja avisos que la persona ya vio y siguen contando, se agrega el estado de lectura por miembro (H-93).

## [UD-029] El aviso lleva el color del estado más alto presente (enmendada por UD-041)

**Fecha:** 2026-10-21 (enmendada el mismo día)
**Contexto:** Martín pidió, por el coordinador, que el ícono de notificación sea mucho más prominente y que su fondo se tiña del color de la notificación de mayor prioridad, «porque hay notificaciones azules, amarillas y rojas». La sesión definió entonces tres prioridades propias («Por atender», «Pendiente», «Novedad»). Martín corrigió, textual: «quien dijo esto de que por atender es distinto a abierto, no lo entiendo, yo creo que fui super explícito respecto a las categorías de cosas. Yo dije mensajes abiertos, mensajes respondidos y mensajes cerrados o atendidos. Esos son los tres estados que quiero ver en esta interfaz». Esas tres palabras contradecían MASTER-SPEC §1.1, que ya definía los estados.
**Decisión:** El aviso no tiene categorías propias: sus colores son los de los tres estados de un mensaje. Abierto es rojo, respondido es amarillo y cerrado es azul. El fondo de la campana es el color del estado más alto presente, abierto antes que respondido; los cerrados no generan aviso. El color nunca es el único indicador: cada estado lleva su forma (triángulo, reloj, punto), su palabra y el número. Los fondos y bordes cumplen contraste en claro y oscuro (`npm run contraste`: 4,5 el texto sobre su fondo y 3 el borde sobre vidrio y cromo). Qué mensajes afectan a un miembro lo fija UD-028.
**Alternativas descartadas:**
- Las palabras «Por atender», «Pendiente» y «Novedad», y la prioridad como categoría aparte: Martín las rechazó con la cita de arriba.
- Rojo para el área «Error»: un `if` sobre el nombre de un área editable por el Editor; el color sale del estado, no de un título.
- Color como único indicador: falla para quien no distingue colores.
**Consecuencias:**
- `panel/src/lib/states.ts` es el único lugar donde se decide el estado más alto; `NotifyBadge` y la campana lo leen de ahí.
- Una prueba falla si aparece en los catálogos o en la interfaz una de las palabras retiradas («Por atender», «Pendiente(s)», «Novedad», «To do», «Pending»).
**Condiciones de reversión:** Si Martín cambia el color de un estado, se cambia `panel/src/styles.css` (tokens `--color-state-*` y `--color-open-*`) en el mismo commit.

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
**Enmienda (UD-046):** El diálogo de envíos y su botón dejan de ser el camino principal. Inicio sigue la maqueta: franja, título con fecha, barra de texto, desplegable en línea y listas. Con un envío abierto las listas pueden plegarse a una franja.
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
**Contexto:** UD-029 pidió que el aviso lleve el color del estado más alto y que cada estado tenga forma, palabra y número. Martín pidió que el ícono de notificación fuera más prominente y que su fondo se tiñera del color de mayor prioridad. La ronda 3 del juez A contó en Inicio más de 18 elementos rojos con el mismo peso (J3-A-04, severidad 5): campana, pestaña Mensajes, chips, áreas, marcas y borde de cada fila. La ronda 2 los había bajado a un tono suave y no alcanzó.
**Decisión:** El fondo de color del estado es de la campana, y sólo de la campana. Toda otra cuenta o marca de estado (pestaña Mensajes, chips de Inicio, conteos por área, avisos de la lista de la campana, marca de una fila) va en peso callado: fondo neutro, borde neutro, texto en tinta, y el estado sólo en el color de su forma (triángulo, reloj, punto) junto a su palabra y su número. En una fila de mensaje el estado se dice una sola vez, en la columna de estado, y el borde izquierdo de 3 px lleva el color de ese estado (UD-041: también en los cerrados, en azul). UD-029 conserva el significado de los tres colores y que el color nunca es el único indicador. Enmendada por UD-041: donde decía «prioridad» se lee «estado». Es una decisión de la sesión por encargo de Martín de atender el 100 % de los hallazgos de la ronda; la palabra «fondo de toda insignia» de UD-029 es del coordinador y no una cita de Martín.
**Alternativas descartadas:**
- Mantener el tono suave de la ronda 2: el juez lo siguió contando como rojo.
- Quitar el número de la pestaña Mensajes o el de la campana: UD-028 pide ambos.
**Consecuencias:**
- `[data-weight='quiet']` en `panel/src/styles.css` reemplaza al peso suave. Una prueba del navegador cuenta los elementos con fondo rojo de Inicio con nueve mensajes abiertos o respondidos y con cuatro y falla si hay más de uno.
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

## [UD-041] Los tres estados son la única categoría de un mensaje en la interfaz, y el área se abre en sus mensajes

**Enmienda (UD-100):** en la barra superior los tres estados se dibujan sólo con su forma, su color y su número; la palabra es el nombre accesible y el tooltip.

## [UD-040] El HEIC de iPhone se decodifica con el `ffmpeg` de la imagen

**Fecha:** 2026-10-21
**Contexto:** Dos correcciones del dueño, textuales. Sobre los estados: «quien dijo esto de que por atender es distinto a abierto, no lo entiendo, yo creo que fui super explícito respecto a las categorías de cosas. Yo dije mensajes abiertos, mensajes respondidos y mensajes cerrados o atendidos. Esos son los tres estados que quiero ver en esta interfaz». UD-029 había inventado «Por atender», «Pendiente» y «Novedad», contra MASTER-SPEC §1.1. Sobre Áreas: «la pestaña de áreas me parece que no funciona como uno esperaría. Si yo hago clic en idea por ejemplo, yo no espero que ese sea el lugar donde solamente puedo editar las plantillas de idea. Yo creo que puedo editar las plantillas y la descripción del área, sí por supuesto, pero también quiero ver al tiro los mensajes asociados a esa área porque eso es lo que uno pensaría cuando está ocupando el sitio».
**Decisión:** En toda la interfaz la única categoría visible de un mensaje es su estado: abierto, respondido o cerrado (en inglés open, answered, closed). Ninguna otra palabra de estado o de prioridad. Los colores se atan a los estados: abierto rojo, respondido amarillo, cerrado azul, siempre con la palabra y el número. La campana y la insignia de Mensajes cuentan los mensajes abiertos y respondidos que afectan al miembro (criterio de UD-028) y toman el color del estado más alto presente; los cerrados no generan aviso, pero se muestran con su color en listas y filtros. Los contadores por área dicen «N abiertos» y «N respondidos» y llevan a Mensajes filtrado por esa área y ese estado. `GET /messages/summary` devuelve `mine: { open, answered, total }`, `items[].status` y, por área, `open`, `answered`, `closed` y `mine_open`. Al elegir un área, en la página Áreas o en la barra lateral, se abre su vista en `/areas/:areaId`: sus mensajes primero, con la misma lista y la misma fila de Mensajes, filtrada por el área, con un filtro por cada estado y el conteo de cada uno (el estado elegido va en la URL); debajo, plegadas, su descripción editable en el lugar y sus plantillas. `/areas` sigue siendo la lista de todas las áreas, para crearlas y abrirlas. Enmienda UD-029 y UD-036.
**Alternativas descartadas:**
- Mantener «Por atender» como urgencia distinta de «abierto»: el dueño lo rechazó con la cita de arriba.
- Dejar las plantillas como contenido principal del área y los mensajes en otra pestaña: el dueño pidió ver los mensajes al tiro.
- Un panel lateral para las plantillas del área: UD de 2026-10-20 (sin paneles que salen por la derecha).
**Consecuencias:**
- `panel/src/lib/states.ts` reemplaza a `priority.ts`; los tokens `--color-tone-*` pasan a `--color-state-*` y los de estado (`--color-open-*`, `--color-answered-*`, `--color-closed-*`) toman rojo, amarillo y azul.
- La vista de área reutiliza `MessageList` y `MessageCard`; las plantillas viven en `components/AreaTemplates.tsx`. Junto a la descripción queda el lugar (`data-slot="area-color"`) del control de color del área.
- Pruebas: la prioridad más alta gana en las combinaciones de estados; ninguna palabra retirada aparece en los catálogos ni en la interfaz renderizada; un flujo en navegador elige Idea, ve sus mensajes con su estado, filtra por respondido y edita la descripción.
**Condiciones de reversión:** Si el dueño pide de nuevo una categoría de aviso distinta de los estados, se registra con su cita y se enmienda esta decisión.

- Sonnet 5.5 por omisión: 0,31 USD por entrada con caché tibia contra 0,017, para ganar en destinatarios, que el equipo corrige en la revisión.
- `classifyEffort` `medium`: el área baja de 94,7 % a 87,1 % (p 0,008) y 2 de 33 corridas quedan inválidas.
**Consecuencias:** Sin cambios en el producto. H-1100 queda cerrado (el proveedor elige `thinking` según el modelo) y H-1102 abierto.
**Condiciones de reversión:** Se pasa a Sonnet 5.5 si la asignación de destinatarios pesa más que el costo (más de 20 entradas diarias con 0,31 USD cada una son 6 USD al día) o si el equipo mide que corrige más de la mitad de los destinatarios que propone Haiku.

## [UD-060] Las descripciones v2-orden se mantienen, y una unidad con varios puntos se recoge completa en su mensaje

**Fecha:** 2026-10-21
**Contexto:** El dueño necesita confiar en la clasificación por área. UD-033 dejó dos preguntas abiertas: la corrida completa con proyecto (H-602) y si alguna variante sube la exactitud hacia el techo de 95,5 %. El coordinador agregó un hallazgo (H-1600): una oración con elogio y dos defectos producía un solo mensaje y el segundo defecto desaparecía. Mediciones: `docs/investigaciones/mediciones/2026-10-21-areas-pipeline-completo-y-variantes.md` y `2026-10-21-oraciones-con-varios-puntos.md`. UD-038 subió el presupuesto de API; esta tarea gastó 10,1 USD de un tope de 12.
**Decisión:** Se conservan las descripciones de `templates/areas.json` (UD-033) y el esfuerzo `low` y la ventana de 100 unidades de la clasificación. La corrida completa con proyecto da 87,5 % de área por mensaje (82-91 %), sobre el 82,6 % de UD-033; por unidad 81,5 %. Ninguna de seis variantes (reglas para tramos de reunión, para tablas de estado, un orden de preguntas, esfuerzo `medium`, ventana de 200, descripciones cortas) supera a v2-orden con significación. Además, la regla 4 de la descomposición exige que el mensaje de una unidad con varios puntos trate todos: título, cuerpo con una frase por punto y campos de la plantilla.
**Alternativas descartadas:**
- Adoptar v4-tramo, la mejor variante nueva: queda 1,7 puntos bajo v2-orden con 10 repeticiones (p 0,085).
- Esfuerzo `medium` en la clasificación: empata (-0,3 puntos) sin bajar el costo ni la latencia.
- Ventana de 200 unidades: 5,1 puntos peor (p 0,034), aunque 25 % más rápida y 20 % más barata.
- Separar la oración compuesta con una expresión regular o una lista de conjunciones: lo prohíben las reglas 4 y MASTER-SPEC §4.2.
**Consecuencias:**
- H-602 se cierra con la medición y la fila de «Descripciones de área largas v2» no se revierte.
- Lo que impide subir más: el error se concentra en el tramo de reunión o chat largo, donde el modelo traza un grupo distinto del de las referencias y le da un área entera; el ruido entre corridas (3,6 puntos de desviación) esconde efectos menores de 2 a 3 puntos con menos de unas veinte repeticiones por variante.
- Una oración compuesta sigue siendo un solo mensaje. Dividirla en dos exige cambiar el contrato de unidades y no se hizo.
- `bench/areas-classify.mjs` acepta `--project`, `--effort`, `--window` y `--label`; `bench/areas-stats.mjs` compara variantes por casos; `bench/probe-compound.mjs` y el caso público 09 miden las oraciones compuestas.
**Condiciones de reversión:** Volver a la regla 4 anterior si una corrida del banco privado muestra mensajes con puntos inventados o de relleno por la obligación de cubrir cada punto.
## [UD-070] Los mensajes se publican solos al terminar el análisis; la bandeja pasa a ser historial

**Fecha:** 2026-10-21
**Contexto:** UD-003 dejó el acto de confirmar en el botón Enviar de la propuesta, para que una mala categorización no llegara al equipo sin filtro. Tras usar el programa, el dueño lo vio categorizar bien.
**Decisión:** Martín, textual: «estoy viendo que el programa ya está funcionando bastante bien para categorizar. Quiero que cambiemos la lógica y dejemos a nivel de experiencia de usuario la bandeja como algo que sirve para que alguien pueda revisar todo lo que ha enviado desde la vista principal y también para que pueda revisar el estado de todos sus envíos que pueda haber mandado en ráfagas, pero en lugar de tener que presionar enviar mensaje, los mensajes ya queden enviados al equipo, ya quede listo todo: no sea necesario confirmar un mensaje porque estoy viendo que se hace bien.» Cuando el análisis termina con una propuesta válida, sus mensajes se publican en la misma transacción que cierra el trabajo (mismo camino y misma validación que la publicación manual, un solo lugar que inserta mensajes) y el input queda `published`. Una propuesta vacía o que no valida no publica nada: queda `proposed` con `error_code: publish_blocked` y su motivo, y su emisor la corrige y publica con `POST /api/inputs/:id/publish`. Un análisis fallido queda `failed`. La bandeja es el historial de los envíos propios (`GET /api/inputs?mine=1&order=desc`, todos los estados, paginado), con los mensajes de cada envío publicado.
**Alternativas descartadas:**
- Publicar fuera de la transacción del trabajo, en un paso aparte: una caída entre ambos deja un input `proposed` que nadie confirma, justo lo que el dueño quiere evitar.
- Publicar aunque la propuesta no valide (completar campos vacíos): el sistema no inventa datos; un campo obligatorio vacío o un área borrada se arreglan a mano.
**Consecuencias:**
- Idempotencia: sólo un input `proposed` se publica. La cola repite el cierre de un trabajo sin duplicar (si el input ya está `published`, no escribe), `POST /publish` sobre un publicado es 409 `already_published` y reprocesar un publicado es 409 `not_reprocessable`: el contenido de un mensaje ya publicado se cambia editándolo (UD-071), no reanalizando su input.
- El evento `done` trae `input_status` (`published` o `proposed`) y `message_ids`; los avisos `message` al equipo salen como hasta ahora.
- Perilla del Editor `auto_publish` (`GET/PATCH /api/settings/publication`), encendida por omisión por decisión del dueño, no por medición. Apagada vuelve la revisión previa de UD-003.
- UD-003 queda enmendada en el paso de confirmar; sigue vigente la cola de trabajos que desacopla el procesamiento del navegador. UD-017 sigue vigente para la edición en el lugar.
**Condiciones de reversión:** Apagar `auto_publish` desde la configuración. La cuenta de ediciones por mensaje (`message_edits`) es la evidencia para decidir si se apaga por omisión.

## [UD-071] Sólo el emisor edita su mensaje publicado, con historial y control de versión

**Fecha:** 2026-10-21
**Contexto:** Sin confirmación previa, la corrección ocurre después de publicar. UD-017 dejaba editar al emisor y a cualquier Editor.
**Decisión:** Martín, textual: «Lo que sí me importa es que un mensaje ya enviado sea muy fácil de editar por la persona que envió dicho mensaje. Otra persona que no envió el mensaje no debe poder editar un mensaje ajeno.» `PATCH /api/messages/:id` lo hace sólo el emisor (título, texto, campos, plantilla, área, destinatarios y adjuntos del envío de origen); cualquier otro, también el Editor, recibe 403 `not_message_author`. Responder, cerrar y reabrir siguen abiertos a todos. El cuerpo lleva la `version` leída; si otra edición se coló, 409 `edit_conflict` con la versión vigente y nada se escribe. Cada edición real sube la versión, fija `edited_at` («editado» con la hora), deja una fila en `message_edits` (quién, cuándo y qué campos, sin valores) y avisa con un aviso dirigido a los destinatarios nuevos. Cambiar el área mueve el mensaje de área y exige una plantilla de ella.
**Alternativas descartadas:**
- Dejar editar al Editor como árbitro: el dueño lo excluye; el Editor corrige por la vía de siempre, pidiéndoselo al emisor o respondiendo.
- Control de concurrencia por `updated_at`: dos ediciones en el mismo milisegundo comparten marca; un contador no se repite.
- Guardar los valores anteriores: UD-017 descarta el historial de versiones; el historial dice qué campos cambiaron y quién, no su contenido.
**Consecuencias:**
- Un `PATCH` que no cambia nada deja el mensaje, su versión y su historial como estaban.
- Los adjuntos se quitan o reordenan entre los del envío con `attachment_ids`, y se agregan archivos y enlaces nuevos con `POST /api/messages/:id/attachments` (multipart con `version`), que cuenta como una edición y encola la lectura del adjunto.
**Condiciones de reversión:** Si el equipo necesita que un Editor corrija mensajes ajenos, se registra una decisión nueva que lo permita con su propia fila de historial.

## [UD-072] Un envío puede pedir quedarse en borrador, y una subida rechazada no deja archivos

**Fecha:** 2026-10-21
**Contexto:** Con la publicación automática (UD-070), el guion `scripts/vps-check.mjs` habría publicado su texto de prueba al equipo real y no habría podido cancelarlo (409). Además H-1804: una subida rechazada (versión vencida, mensaje cerrado) dejaba su archivo en el volumen sin fila que lo use.
**Decisión:** Decisión de la sesión por encargo de la coordinación; el dueño no la dijo con estas palabras. `POST /api/inputs` acepta `auto_publish=false` (campo del multipart o booleano del JSON `{ text, links, auto_publish }`) para ese envío solo: su propuesta espera como `proposed` aunque la perilla del proyecto esté encendida. `true` o sin el campo sigue la perilla; no puede forzar una publicación que el proyecto apagó. Otro valor es 400 `auto_publish_invalid`. El guion `vps-check` lo usa y cancela sin publicar nunca. Una subida que el servidor rechaza borra lo que alcanzó a escribir, en la misma ruta y al terminar la petición, salvo un archivo que una fila ya usa o que otra subida en curso del mismo archivo todavía va a usar.
**Alternativas descartadas:**
- Un usuario de prueba con la perilla apagada: la perilla es del proyecto, no del miembro.
- Cancelar un `published` desde el guion: UD-070 lo define definitivo y los mensajes ya habrían llegado al equipo.
- Barrer por reloj: el barrido por antigüedad (`sweepOrphans`) queda como red para una caída entre escribir el archivo y su fila; el caso normal no espera a un reloj.
**Consecuencias:**
- Columna `inputs.keep_draft` (migración 0008). Un envío repetido con el mismo contenido devuelve el que ya existe y no cambia su `keep_draft`.
- Un envío cancelado conserva sus archivos a propósito: Deshacer lo restaura (J1-B-26), así que no son huérfanos.
**Condiciones de reversión:** Retirar el campo si el guion de verificación deja de enviar textos reales.

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

## [UD-042] El estado de un mensaje se deriva de sus respuestas y de su cierre, y nunca se escribe a mano

**Enmienda (UD-100):** el vocabulario y los colores (abierto rojo, respondido amarillo, cerrado azul) no cambian; la barra superior no escribe la palabra, la dice en el nombre accesible.

**Fecha:** 2026-10-21
**Contexto:** Inicio mostraba una tarjeta «Abierto» con dos respuestas. El servidor real ya pasa de abierto a respondido al responder; el servidor de ejemplo del panel sembraba el estado a mano y lo contradecía. Martín, textual: «El estado respondido debería aplicarse siempre automáticamente cuando exista una respuesta a un problema abierto, independiente de si esa respuesta agrega más información, porque eso ya no es algo que el sistema evalúe. Lo único que no importa es si un problema no tiene respuesta: eso es abierto. Si hay una o más respuestas, está respondido. Y si alguien lo marcó como cerrado, está cerrado.»
**Decisión:** El estado es una función de dos datos: la marca de cierre y la cantidad de respuestas. Con la marca de cierre, cerrado; sin ella, respondido con una respuesta o más, y abierto sin ninguna. Ninguna lectura del texto de la respuesta interviene. Reabrir un mensaje cerrado lo devuelve al estado que esa función da. Enmienda UD-029 y MASTER-SPEC §1.1 (la definición de «Mensaje» ya decía esto; ahora es una invariante con prohibición).
**Alternativas descartadas:**
- Que el panel corrija un mensaje con respuestas y estado `open` al mostrarlo: tapa un defecto del servidor. El panel muestra lo que la API entrega y una prueba falla si la API entrega un estado que contradice sus respuestas.
- Estados escritos a mano en los datos de ejemplo: pueden contradecir las respuestas y lo hicieron.
**Consecuencias:**
- `src/api/message-state-derivation.test.js` ejerce la invariante tras responder, cerrar, reabrir, editar y reprocesar, y recorre todos los mensajes de la base después de cada paso.
- `panel/dev-server.mjs` deriva el estado al sembrar y al responder, cerrar y reabrir (`syncStatus`); una prueba de flujo revisa todo lo que el servidor de ejemplo sirve.
**Condiciones de reversión:** Si el dueño quiere que cierta clase de respuesta no cuente como respuesta, se registra con su cita y se cambia la función en un solo lugar.
## [UD-058] El modelo por omisión sigue siendo Haiku 5.5

**Fecha:** 2026-10-21
**Contexto:** H-80 comparó Haiku 5.5 con Sonnet 5.5 sobre los mismos prompts (medición `docs/investigaciones/mediciones/2026-10-21-modelos-y-esfuerzo-de-clasificacion.md`). Sonnet asigna mejor (conjunto exacto 80,0 % contra 53,0 %, p 0,002) y cuesta 17 veces más por entrada; cobertura y área no se separan.
**Decisión:** Propuesta del coordinador, no cita de Martín. Se mantiene Haiku 5.5 como modelo por omisión y `classifyEffort` en `low`. Sonnet 5.5 queda como opción por configuración (`TEXT_MODEL`) una vez resuelto H-1100.
**Alternativas descartadas:**
- Sonnet 5.5 por omisión: 0,31 USD por entrada con caché tibia contra 0,017, para ganar en destinatarios, que el equipo corrige en la revisión.
- `classifyEffort` `medium`: el área baja de 94,7 % a 87,1 % (p 0,008) y 2 de 33 corridas quedan inválidas.
**Consecuencias:** Sin cambios en el producto. H-1100 queda cerrado (el proveedor elige `thinking` según el modelo) y H-1102 abierto.
**Condiciones de reversión:** Se pasa a Sonnet 5.5 si la asignación de destinatarios pesa más que el costo (más de 20 entradas diarias con 0,31 USD cada una son 6 USD al día) o si el equipo mide que corrige más de la mitad de los destinatarios que propone Haiku.


## [UD-080] La clasificación relee lo descartado y cada ventana ve las 40 unidades que la preceden

**Fecha:** 2026-10-21
**Contexto:** El dueño: «es difícil confiar en la herramienta si no sabe clasificar bien por área». H-1600 midió 8,2 % de unidades de referencia sin mensaje y H-1003 una desviación de 3,6 puntos entre repeticiones. Medición: `docs/investigaciones/mediciones/2026-10-21-reuniones-cobertura-y-estabilidad.md`. Gasto: 6,01 USD de un tope de 7.
**Decisión:** Decisión de la sesión por encargo del dueño, sin cita suya. Dos perillas del analizador con valor por omisión medido: `coveragePasses` 1 (tras la clasificación, las unidades descartadas se leen de nuevo aparte y el modelo decide si alguna es un punto; el sistema sólo valida la forma) y `classifyContextUnits` 40 (cada ventana de clasificación recibe, de sólo lectura, las 40 unidades que la preceden). `classifyDraws` queda en 1.
**Alternativas descartadas:**
- Bajar la temperatura: Haiku 5.5 responde 400 a todo valor distinto de 1.
- Ventana de 60 unidades: más grupos (174), más costo y sin mejora de acuerdo.
- Una nota de cobertura que dice dejar las unidades sueltas en descartadas: +1,5 puntos de área, no significativo.
- Contexto de 20 unidades: acuerdo 0,74 contra 0,78 con 40.
- Tres lecturas con mayoría (`classifyDraws` 3): triplica el costo de la clasificación y no se midió con el modelo real.
**Consecuencias:**
- En 39 casos, 3 repeticiones: unidades sin grupo 8,1 a 2,1 %; área sobre todas las unidades esperadas 74,9 a 79,9 % (p 0,011); área por unidad agrupada sin cambio (81,7 y 81,6). Cinco transcripciones: acuerdo entre repeticiones 0,62 a 0,78.
- Costo de clasificación +19 %, tiempo +11 %; sin llamadas nuevas más que una por entrada con descartes.
- H-1003 se cierra. H-1900 a H-1904 quedan en el libro.
- `classifyInput` se exporta para medir la etapa sola (`bench/classify-stage.mjs`).
**Condiciones de reversión:** Poner `coveragePasses` en 0 y `classifyContextUnits` en 0 si una corrida del banco muestra que los grupos más gruesos funden puntos que el equipo necesita asignar por separado (H-1904).
## [UD-050] La interfaz habla como un instrumento, no como una conversación

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «cuando haces interfaces tiendes a escribir rótulos y textos que parecen hablarle directamente al lector, como si fuese una conversación, y eso es porque eres un modelo conversacional, pero es un vicio que tenemos que evitar». Pidió investigar qué se dice del patrón en 2026 y purgarlo de la interfaz, con «lenguaje estándar de software, como un instrumento que se ocupa, no como algo que te está hablando a ti». Su ejemplo del patrón: «Nota de voz con su transcripción». Los catálogos ya cumplían UD-013 en casi todo (rótulos cortos, sin segunda persona); la medición del 2026-10-21 encontró el patrón en 18 claves en español, 21 en inglés y 37 frases de progreso que entrega el servidor (H-1500).
**Decisión:** Todo texto visible es una etiqueta de instrumento: sustantivo o grupo nominal corto para un rótulo, verbo en infinitivo (inglés: imperativo estándar) más objeto para una acción, etiqueta de una o dos palabras para un estado, causa más salida para un error. Quedan fuera la segunda persona, las preguntas, las exclamaciones, los saludos, las aperturas «Aquí», «Ya», «Todavía», «Parece que» y «Oops», los imperativos coloquiales, los gerundios que acompañan una frase, el punto final en un texto de una oración y las dos oraciones en un mismo texto. El texto de ayuda no existe por omisión. Un aviso de una acción que no se deshace puede ser una oración corta, impersonal y precisa. Las reglas (R1 a R14) y sus fuentes fechadas están en `docs/investigaciones/08-lenguaje-de-instrumento-en-interfaces.md`; las que se pueden medir las hace cumplir `panel/src/ui-voice.test.ts` sobre los dos catálogos y sobre las frases de progreso del servidor, con una lista de excepciones por clave que exige su razón.
**Alternativas descartadas:**
- Hablarle a la persona de «tú» en oraciones completas, como piden Adobe Spectrum, Grafana y Microsoft: sirve en productos de consumo; en un panel de uso diario los rótulos estables se escanean mejor y NN/g (2026-01-09) mide un costo en la calidez de un modelo.
- Una lista de textos a mano sin guardia: el vicio vuelve con cada texto nuevo que escribe un modelo.
- Leer el texto de las personas para detectar el patrón: la guardia sólo lee el código de la interfaz, nunca lo que escribe una persona (MASTER-SPEC §4.2).
**Consecuencias:**
- 18 claves del catálogo en español y 21 del inglés, y 37 frases de progreso del servidor, pasan a etiquetas de instrumento; los textos de prueba de los flujos siguen a los nuevos.
- Un texto nuevo que caiga en el patrón rompe `npm test` del panel; la excepción se declara por clave, con su razón.
- Las frases de progreso del servidor se muestran en el idioma de la cuenta: el panel las asigna a claves `progress.*` (H-1502) y una prueba exige una entrada por cada frase nueva.
**Condiciones de reversión:** Que el producto cambie de público o de registro; Martín lo dice y se revisan R3 y R7.

## [UD-090] La interfaz se mide con instrumentos antes de juzgarla

**Fecha:** 2026-10-21
**Contexto:** Cada ronda de jueces tomó entre 9 y 14 minutos por juez, un arreglo entre 29 y 87 minutos y una fusión con choques entre 10 y 20. Los jueces repitieron hallazgos que el dueño ya había refutado: en la ronda 3, 21 de 84 filas del libro reaparecen de rondas anteriores y 16 quedaron refutadas.
**Decisión:** Martín, textual: «para esto ocupamos OpenTelemetry, para tener muchos datos sobre qué es lo que se necesita mejorar, y las rondas de jueces nos quitan demasiado tiempo; hay que encontrar una forma más eficiente, quizás darle un encargo más acotado a varios jueces en paralelo». Lo medible se mide con detectores en navegador y con telemetría de uso; el juicio queda para lo que ninguno ve.
**Alternativas descartadas:**
- Seguir con rondas de un juez por área: tiempo de pared de 9 a 14 minutos por juez y 25 % de repeticiones.
- Sólo detectores: no ven rótulos, jerarquía ni flujo.
**Consecuencias:**
- Telemetría de interfaz (UD-091), detectores (`panel/scripts/ui-detectors.mjs`) y jueces acotados (UD-092).
**Condiciones de reversión:** Que la medición del marco (`docs/investigaciones/mediciones/2026-10-21-jueces-acotados-contra-juez-unico.md`) muestre menos hallazgos válidos por minuto de pared que el juez único.

## [UD-091] Telemetría de la interfaz: módulo propio, JSON validado, encendida por omisión

**Fecha:** 2026-10-21
**Contexto:** UD-090 pide datos de uso. El informe 09 encontró que el SDK de navegador de OpenTelemetry sigue experimental (`sdk-trace-web` fue retirado en la serie 3.0.0 y las convenciones `browser.*` están en «development»).
**Decisión:** El panel emite eventos con un módulo propio (`panel/src/lib/telemetry.ts`, unos 0,7 KB comprimidos según el informe) a `POST /api/telemetry/ui`. El servidor valida la forma sin campos desconocidos y los guarda como spans OpenTelemetry `ui.*` en la tabla `spans`. Ningún evento lleva texto de personas, contenido, nombres de archivo ni identificadores de miembro: sólo conteos, duraciones, pantallas, tareas y rutas con sus identificadores reemplazados. Nace encendida (informe 09, recomendación 12: sin cookies, almacenamiento local, identificador persistente ni contenido, y con interruptor); el Editor la apaga en Configuración, «Telemetría de uso», y `UI_TELEMETRY=0` fija el valor inicial. El envío usa `fetch` con `keepalive` y no `navigator.sendBeacon`, porque un beacon no puede llevar la cabecera `X-Team-Request` que el servidor exige a toda petición con sesión. La decisión de encender por omisión la tomó la sesión por encargo del dueño («decide con UD: justifica»).
**Alternativas descartadas:**
- SDK de navegador de OpenTelemetry: 16,3 KB comprimidos y API experimental (informe 09, §2).
- `sendBeacon`: sin cabeceras propias, choca con el CSRF (informe 09, §5).
- Apagada por omisión: sin datos el informe queda vacío y los cinco productos comparados nacen encendidos.
- Rage clicks y dead clicks: ninguna fuente fija umbrales comunes (informe 09, §4); quedan fuera hasta que un hallazgo los pida.
**Consecuencias:**
- Cifras con fuente: cuerpo de 64 KiB (cuota de `keepalive`), 145 eventos por lote (80 % de la cuota sobre el evento más largo posible, 360 bytes), 100 peticiones por 10 s por dirección y la misma cota en el cliente (10 eventos por segundo con ráfaga de 100, como PostHog).
- Retención: la de los spans, 7 días.
- Abandono: sólo con `pagehide` definitivo; un navegador móvil que descarta la página oculta sin `pagehide` no lo registra.
- Mide el estado de Chrome, Firefox 128 o Safari 16.4 como el navegador lo permita: CLS y tareas largas sólo existen en Chromium y en los otros quedan sin dato, no en cero.
**Condiciones de reversión:** Apagarla es el interruptor o `UI_TELEMETRY=0`. Si se agrega un identificador persistente o contenido, debe nacer apagada.

## [UD-092] Jueces acotados en paralelo, con instrumentos y restricciones

**Fecha:** 2026-10-21
**Contexto:** UD-090.
**Decisión:** Un encargo de unos 5 minutos por pantalla o flujo, todos los jueces a la vez (`scripts/juicios.mjs`, `docs/JUICIOS.md`). El juez recibe las salidas de los detectores y de la telemetría y reporta sólo lo que ninguna ve. Recibe como reglas del alcance las decisiones del dueño y los hallazgos refutados, nunca qué se cambió, y la nota parte en 2. Un consolidador marca cada hallazgo contra el libro y contra los otros jueces.
**Alternativas descartadas:**
- Decirle al juez qué se cambió: ancla el juicio (informe 10, §5).
- Descartar automáticamente por similitud de títulos: la precisión medida es 0,67 con umbral 0,35, por eso sólo marca.
**Consecuencias:**
- Un hallazgo cuenta cuando se reproduce con captura o se mide.
**Condiciones de reversión:** UD-090.

## [UD-045] Cada área tiene un color que el Editor elige, y de él salen el chip y el fondo del análisis

**Fecha:** 2026-10-21
**Contexto:** El área en que se clasifica un mensaje se leía como una palabra más entre otras. Martín, textual: «es muy importante que el área en la cual se clasifica lo que uno escribió tenga un contraste visual marcado y su propio contenedor tipo chip, para que no haya dudas. Cada área debe poder tener su color y eso determina el chip que se muestra en cada mensaje; la idea es mejorar la comprensión a primer vistazo. Si el área es verde, todo el recuadro de análisis hecho por la IA debe tener fondo verde, un verde secundario; cada color tiene dos colores, principal y secundario, pero el usuario sólo escoge uno: si escojo rojo, el secundario será una especie de rosado pálido. Debe haber una distinción visual muy clara entre lo que envié como mensaje original y el área donde terminó ubicado, y si cambio el área en el mensaje analizado también cambian los colores.»
**Decisión:** El área guarda un solo valor, `color`, en formato `#rrggbb` (columna `areas.color`, migración 0008, campo de `POST` y `PATCH /api/areas`, validado en el servidor). Cada área inicial de `templates/areas.json` trae el suyo y una área nueva toma el siguiente de una paleta de ocho. El panel deriva el resto con una función pura, `panel/src/lib/area-color.ts`, que trabaja en OKLCH: el chip lleva el color elegido con texto blanco o negro según cuál contraste más; el color secundario conserva el tono y lleva luminosidad 0,95 en el tema claro y 0,27 en el oscuro, con un tercio de la cromaticidad (hasta 0,05); el texto sobre el secundario es el mismo tono a luminosidad 0,25 o 0,95; el borde se oscurece o se aclara hasta quedar a 3:1 del secundario. Se eligió OKLCH y no HSL porque su luminosidad es perceptual: un amarillo y un azul con la misma luminosidad HSL difieren mucho en brillo, y el secundario de cada tono tiene que verse igual de suave. El chip de área se ve en cada tarjeta (como la pestaña «Área» de la maqueta), en el detalle y en el análisis; el recuadro de cada mensaje analizado lleva el fondo secundario de su área y cambia al cambiar el área. Lo enviado (el original) es neutro. El selector está en la vista de Áreas: ocho muestras y un color libre.
**Regla de distinción:** El estado de un mensaje (abierto, respondido, cerrado; UD-041) es una marca con su forma y su palabra; el área es un chip con su nombre. Un color de área nunca sustituye a la palabra, y los colores de estado no se ofrecen en la paleta inicial.
**Alternativas descartadas:**
- Guardar los dos colores: el usuario elige uno, y dos valores se desalinean.
- Derivar en HSL: tonos distintos con el mismo secundario de luminosidad diferente.
- Teñir también la página: el contraste de lo enviado contra el análisis es el punto, y un tercer color lo diluye.
**Consecuencias:**
- `npm run contraste` mide, en los dos temas, el texto del chip (4,5), el texto sobre el secundario (4,5) y el borde sobre el secundario (3) para los cinco colores iniciales y para diez colores extremos (negro, blanco, amarillo, verde, azul, rojo, cian, magenta, gris y crema). La prueba de `area-color.test.ts` lo repite con trece.
- Un área sin color (servidor anterior) usa un índigo de respaldo.
**Condiciones de reversión:** Si el Editor necesita un segundo color por área, se agrega como campo aparte y la derivación pasa a ser su valor por omisión.

## [UD-046] Inicio sigue la maqueta y el envío se ve en un desplegable bajo la barra de texto

**Fecha:** 2026-10-21
**Contexto:** UD-030 puso la revisión de los envíos en un diálogo tras un botón «Envíos». Martín, textual: «cuando escribo un mensaje o grabo un video o mando un audio y hago click en enviar, la única retroalimentación es una barra superior que muestra que algo está cargando y después tengo que hacer click y desplazarme hacia abajo en la bandeja de envíos para recién ver cómo quedó lo que mandé. Eso es súper contraintuitivo. En la interfaz original que maqueté había puesto un desplegable dinámico debajo de la barra de texto en la página principal, y es en ese desplegable donde esperaba que apareciera lo que uno está enviando y cómo lo analizó la IA. [...] Lo de la bandeja de envíos es bueno pero no me gusta que muestre esos 7 para revisar, porque significa que tengo que hacer otro clic; esperaba ver la respuesta en esta misma interfaz. Lo que te acabo de escribir es aún más importante que los últimos mensajes y las últimas respuestas. La barra de Para mí y por área debería estar arriba de todo, con la barra de texto más abajo, y mucho mejor distribuida a nivel de espacio, para que no ocupe tanto.» Después, con UD-070 y UD-071, los mensajes dejaron de esperar una confirmación.
**Decisión:** Inicio se dibuja de arriba abajo así: una franja de una sola fila con «Para mí» y «Por área», el nombre del proyecto con la fecha, «Nuevo mensaje» con la barra de texto, el desplegable y, debajo, «Últimos mensajes» y «Últimas respuestas». El desplegable es un bloque de la página, no una ventana: se abre solo al enviar y muestra ese envío, a la izquierda el original (texto o transcripción editable y la galería de medios, cuya tira es la lista de adjuntos) y a la derecha lo que la IA hizo de él. Con el progreso real mientras corre, y al terminar los mensajes ya publicados, cada uno en su recuadro del color de su área, con chip, título, texto, campos, destinatarios y adjuntos editables en el lugar por quien lo envió; las ediciones guardan sobre el mensaje publicado y se pueden deshacer. No hay botón «Enviar N mensajes» ni «Descartar envío» como paso: sólo una propuesta que el sistema no pudo publicar sola (`publish_blocked`) o con la publicación automática apagada conserva la revisión de UD-003. Con varios envíos seguidos (UD-025) el desplegable muestra el actual y un selector compacto de todos los envíos propios con su estado (en cola, analizando, publicado, fallido), en el mismo lugar. El control «Envíos» de la fila del título plega y despliega el desplegable y lleva el estado de los envíos en su cara.
**Alto (UD-017):** El desplegable mide entre 20 y 30 rem, 40 % de la altura de la ventana. Las dos listas de abajo necesitan una fila y su paginador para existir; cuando la ventana no alcanza para el desplegable y para ellas, se pliegan en una franja con su nombre y el botón que devuelve el espacio. La decisión sale de medir si la página se desborda con las listas dibujadas, no de un umbral de altura. En 1440×900 con un envío abierto las listas se pliegan; a ventanas más altas conviven.
**Enmienda:** UD-030 queda enmendada: el diálogo de envíos y su botón dejan de ser el camino principal (la maqueta manda), y «Últimos mensajes» y «Últimas respuestas» dejan de ser lo más prominente cuando hay un envío abierto. La fecha del día vuelve a Inicio, porque la maqueta la lleva; sigue sin haber reloj.
**Alternativas descartadas:**
- Una pestaña por envío arriba de la barra: contradice el orden de la maqueta.
- Dejar fuera el «+» de «Lista de adjuntos»: la API ahora lo permite (`POST /api/messages/:id/attachments`), así que cada mensaje publicado lo lleva y la tira de la galería hace de lista.
- Paginar los mensajes de la propuesta en el desplegable: un texto no tiene largo máximo; la lista es un carril con su desplazamiento declarado, y ningún mensaje se corta.
**Consecuencias:**
- `SendDrawer`, `PublishedPane` y `SendSwitcher` reemplazan al diálogo y a la lista paginada de la bandeja; `ReviewPane` pasa a dos columnas.
- Las pruebas que revisan una propuesta con el botón Enviar arrancan el servidor de ejemplo con la publicación automática apagada; el camino automático tiene su propio archivo, `flows-inicio.browser.test.mjs`.
**Condiciones de reversión:** Si el desplegable resulta ser un mal lugar para revisar muchos envíos, la bandeja completa vuelve a una ventana, pero abierta desde el desplegable y no en su lugar.

## [UD-047] El panel izquierdo es más compacto y se oculta con el botón junto al usuario

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «el panel de la izquierda debería ser un poco más compacto y ocultable; en la maqueta inicial hay un botón específico para ocultarlo.»
**Decisión:** El panel mide 256 px en lugar de 288, con filas y márgenes más chicos, y los conteos de cada área van bajo su nombre para que un nombre largo no se parta letra por letra. El botón para ocultarlo está al lado del usuario, como en la maqueta; oculto, el botón de la barra superior lo muestra de nuevo. La preferencia se guarda por persona en el almacenamiento del navegador (`team-sidebar-hidden:<id>`), con `try/catch`: sin almacenamiento el panel arranca visible y la elección vale para la pestaña. En el teléfono es el menú de la barra, que se cierra solo, y el botón de ocultar no se dibuja. Cada área lleva en el panel una muestra de su color.
**Alternativas descartadas:**
- Ocultarlo con CSS desde un ancho: la persona decide, no el ancho.
- Guardar la preferencia en el servidor: es una comodidad de ese navegador.
**Consecuencias:** `panel/src/lib/sidebar.ts` con su prueba; una prueba de navegador oculta, recarga y muestra, y comprueba que otra persona no se ve afectada.
**Condiciones de reversión:** Ninguna prevista.


## [UD-120] Proveedores y claves de API se gestionan desde Configuración, con prueba antes de cambiar

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «Otro gran problema es que no hay una forma de reemplazar un proveedor con otro de una manera segura, o de simplemente retirar una clave de API. No es una interfaz utilizable para poder agregar un nuevo proveedor, reemplazar una clave de API, diagnosticar un proveedor, etc.» Investigación 11.
**Decisión:** La sección «Proveedores» (sólo Editor) lista cada proveedor con estado (sin clave, configurada, fallando), últimos 4 caracteres de la clave, origen (guardada o entorno) y funciones que lo usan (Texto, Visión, Transcripción). Agregar un proveedor y reemplazar una clave prueban la clave nueva con una llamada mínima; sólo si funciona se guarda y la anterior sigue activa hasta entonces. Retirar una clave pide confirmación y se bloquea (409 `provider_in_use`) si una función depende de ella, con las funciones nombradas y el cambio de cada una ofrecido en el mismo diálogo. Cambiar proveedor o modelo de una función prueba antes de guardar; si falla queda la configuración anterior. El diagnóstico entrega duración, causa clasificada (clave inválida, sin cuota, modelo inexistente, sin red, límite de tasa, tiempo agotado, dirección inválida, error del proveedor) y los modelos que el proveedor lista. El plazo de cada prueba es `PROVIDER_PROBE_TIMEOUT_MS` (30 s). Cada cambio deja una fila de auditoría sin valores.
**Alternativas descartadas:**
- Guardar primero y probar después: deja una clave mala activa.
- Mostrar la clave completa tras guardarla: ninguna ruta la devuelve.
**Consecuencias:** Migración 0009, `src/api/routes/connections.js`, `src/providers/probe.js`, OpenAPI y MASTER-SPEC al día; el proveedor falso simula 401, 429, modelo inexistente, sin red y tiempo agotado.
**Condiciones de reversión:** Si una prueba con costo real resulta frecuente, la prueba previa pasa a opcional por función.

## [UD-121] Las claves guardadas se cifran en reposo y nunca salen del servidor

**Fecha:** 2026-10-21
**Contexto:** Mismo pedido que UD-120; la regla 6 de MASTER-SPEC §4.6 prohíbe credenciales en la base.
**Decisión:** AES-256-GCM con nonce aleatorio por sellado y el nombre del proveedor como dato autenticado. La clave maestra es `SECRETS_KEY` o `<DATA_DIR>/secrets.key`, generada en el primer arranque con modo 600. La API sólo expone los últimos 4 caracteres. La clave no aparece en logs, spans, telemetría, errores, auditoría ni respuestas de prueba; los cuerpos de error del proveedor se redactan. Una variable de entorno sigue valiendo como valor de arranque, y una clave guardada la reemplaza. Rotación: `scripts/rotate-secrets-key.mjs`.
**Alternativas descartadas:**
- Mantener las claves sólo en variables de entorno: no permite reemplazo ni retiro desde la pantalla.
**Consecuencias:** `src/api/secrets-never-leak.test.js` ejerce valores centinela en respuestas, registros, tablas y archivo SQLite. Respaldar la base sin la clave maestra deja las claves ilegibles; el panel las muestra «fallando».
**Condiciones de reversión:** Si se adopta un gestor de secretos externo, `vault.js` se reemplaza por su cliente.

## [UD-122] Configuración lleva una línea de explicación bajo cada ajuste

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «los rótulos no tienen explicación de lo que hacen. Por ejemplo "Publicación" y "Telemetría de uso" no significan nada para un usuario que configure esto.»
**Decisión:** Sólo en Configuración, cada ajuste lleva bajo su rótulo una explicación de una línea (`hint.*`, componente `SettingHint`), impersonal y de hasta 90 caracteres. La guardia `panel/src/ui-voice.test.ts` la admite sólo con esas condiciones y falla con segunda persona, gerundio, imperativo, adjetivo valorativo o más de 90 caracteres. «Publicación» pasa a «Publicación automática».
**Alternativas descartadas:**
- Ícono de información con descripción emergente: oculta justo lo que faltaba.
**Consecuencias:** Enmienda la regla «sin texto de ayuda por defecto» únicamente para esta pantalla.
**Condiciones de reversión:** Ninguna prevista.

## [UD-123] Configuración se desplaza como página y el texto largo crece con su contenido

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «La parte para escribir la descripción del proyecto tiene texto truncado que obliga a desplazarse dentro de la misma página para escribir la configuración del proyecto. Eso es un gran problema.»
**Decisión:** La descripción del proyecto es un área de edición de al menos 16 filas que crece con el texto, a todo el ancho de su columna, sin caja con scroll propio. Tiene contador contra el tope, estado de guardado, deshacer y rehacer, «Reemplazar con .md» y «Descargar .md». Configuración se desplaza como página.
**Alternativas descartadas:**
- Alto máximo con scroll interno: es lo que se rechazó.
**Consecuencias:** Enmienda UD-017 para esta vista; `test:fit` la exime sólo de las comprobaciones de alto de documento y mantiene las de carriles propios, texto bajo 12 px y repetidos.
**Condiciones de reversión:** Ninguna prevista.
## [UD-130] La barra lateral va sobre una grilla, sus contadores no llevan contenedor y todo lo clicable responde al puntero

**Fecha:** 2026-10-21
**Contexto:** Martín, textual, con una captura de la barra lateral: «Otro error que frecuentemente aparece son los problemas de alineación. Por ejemplo acá los iconos que se muestran con cada fila están desalineados verticalmente. Eso es inaceptable. Además arriba un icono está rodeado de un contenedor y abajo no. Necesito que no estén rodeados con contenedor, pero además que cuando uno pase el mouse por encima se ilumine el icono dando la sensación de que es cliqueable, igual que en la barra de arriba en el icono rojo que ya se ve súper cliqueable. Necesito que pasar el mouse por encima también tenga un efecto. Investiga cuál es el patrón imperante en 2026 para este tipo de cosas.»
**Decisión:** Cada fila de la barra lateral (Inicio, Mensajes, Áreas, cada área, Equipo, Conexiones, Configuración, Cerrar sesión) es una caja con dos columnas: el enlace (ícono y rótulo) y la columna del contador. La columna mide al menos 2,75 rem (`--sidebar-count-col`), termina a 10 px del borde derecho en todas las filas y se centra en la altura de la fila. Los contadores son un ícono de estado con su número, sin contenedor ni borde, con la misma forma y color de la barra superior (`StateMark` y `NotifyBadge`, no copias). La fila entera es lo que se ilumina: al pasar el puntero el fondo cambia a `--color-hover` y el ícono pasa de `--color-muted` a `--color-accent`; con el teclado, el mismo cambio más un anillo de 2 px dentro de la fila. «+», desplegable de áreas, ocultar panel y el contador de cada área tienen su propio estado de hover y foco. La transición es de 100 ms (`--duration-hover`). El rótulo puede partirse sólo cuando el nombre lo escribió una persona y es largo; los rótulos fijos y las cinco áreas de plantilla caben en una línea en 256 px y en teléfono. Fuente: `docs/investigaciones/12 - Alineación y estados de los elementos de navegación.md` (R1 a R11).
**Alternativas descartadas:**
- Iluminar sólo el ícono: ninguno de los sistemas revisados lo hace; todos cambian el fondo de la fila, y el ícono acompaña. Se hacen las dos cosas.
- Recortar el rótulo con puntos suspensivos (UD-016): la regla del dueño lo prohíbe.
- Una píldora para todos los contadores: el dueño pidió que no hubiera contenedor.
**Consecuencias:** `panel/src/sidebar-alignment.browser.test.mjs` (`npm run test:sidebar`, dentro de `test:flows`) mide coordenada derecha y centro vertical de los contadores con tolerancia de 1 px, una sola línea por rótulo, ausencia de contenedor y cambio de estilo calculado en hover y foco. `panel/scripts/ui-detectors.mjs` suma la regla `sibling-alignment`. `panel/DISENO.md` declara los tokens.
**Condiciones de reversión:** Ninguna prevista.

## [UD-100] La barra superior muestra los tres estados con ícono y número, y abre sus mensajes en un desplegable

**Fecha:** 2026-10-21
**Contexto:** El conteo de lo pendiente se repetía en la campana (insignia con 8), la insignia de Mensajes en la barra lateral, los conteos por área de la barra lateral y la franja «Para mí» y «Por área» de Inicio. El dueño, textual: «Todo esto debería quedar integrado de manera eficiente, ordenada y no redundante en la barra superior del sitio, siempre visible, pero NO en inicio. Inicio ya tiene demasiados elementos.» Después precisó: «Los rótulos "Abierto", "Respondido" o "Cerrado" no deben aparecer en la barra superior, sino que simplemente bastan los íconos de color con un número, que al ser clickeados deben desplegar un pequeño desplegable según el ícono desplegado que permita ver rápidamente los elementos sin salir de la página donde se está.» Y corrigió una primera versión que agregaba contadores por área: «Yo NO pedí esto, en la barra superior SOLO íconos de abierto, respondido y cerrado.»
**Decisión:**
- La barra superior de todas las páginas lleva tres marcas entre el nombre y la campana: abierto (triángulo, rojo), respondido (reloj, amarillo) y cerrado (punto, azul), cada una con su número y sin texto visible. La palabra del estado es el nombre accesible y el tooltip nativo («4 abiertos»), de modo que el color nunca va solo: lo acompañan la forma y el nombre. Las marcas son del peso callado de UD-036.
- Un clic, Enter o Espacio abre bajo la marca un desplegable anclado (popover del kit; no un panel lateral ni un modal) con los mensajes de ese estado que me conciernen: título, chip de área con su color, autor y hora. Una fila abre el mensaje; el pie enlaza a Mensajes filtrado por ese estado y «para mí». Las flechas recorren las filas, Escape cierra y devuelve el foco a la marca. Abrir no navega.
- «Me conciernen» es la regla de UD-028: asignado a mí, o emitido por mí y respondido; un cerrado cuenta si fui asignado o emisor. El desplegable lista exactamente lo que la marca cuenta.
- La barra no lleva ningún contador por área, ni cuadros de color, ni «+N». Los conteos por área viven donde ya estaban: la barra lateral junto a cada área y la vista de cada área. El chip de área aparece sólo como parte de una fila del desplegable.
- La campana queda para novedades: lista los mensajes que llegaron con el panel abierto y su única marca es cuántas no se leyeron. Ya no repite el conteo de pendientes ni lleva color de estado.
- Se retiran la insignia de Mensajes de la barra lateral (repetía la suma de las dos primeras marcas) y la franja «Para mí» y «Por área» de Inicio. Los conteos por área de la barra lateral se conservan.
- En el teléfono la barra lleva las mismas tres marcas con su número, cada una con su desplegable (enmendado por UD-141).
- Los cerrados no levantan aviso (UD-041), pero el dueño pidió los tres estados y se muestran.
**Enmienda a UD-041 y UD-042:** la regla «cada estado se dice con su forma, su palabra y su número» rige en las filas, las listas y la barra lateral. En la barra superior la palabra no se dibuja: se dice en el nombre accesible. UD-029 queda enmendada: el fondo saturado de la campana desaparece porque la campana ya no cuenta estados.
**Alternativas descartadas:**
- Desglose por área en la barra (menú, chips o «+N»): el dueño lo rechazó por escrito.
- Mantener un conteo en la campana: repetía la cifra de la barra.
- Un panel lateral deslizante para los mensajes: prohibido por el dueño (05-10).
- Mostrar la palabra de cada estado en la barra: el dueño pidió sólo íconos.
**Consecuencias:**
- `StatusBar` en `panel/src/components/StatusBar.tsx`; `Header` la monta y la campana pierde el modo «pendientes».
- Pruebas de flujos nuevas fallan si aparece un contador o chip de área en la barra o un texto visible de estado, abren cada desplegable por clic y por teclado, y comparan su lista con la cifra.
- La lista que un mensaje del desplegable usa es la de `noticeState`, no el filtro «para» del servidor, que sólo conoce los asignados (H-2000).
**Condiciones de reversión:** Si el dueño quiere ver los cerrados fuera de la barra, se quita la tercera marca sin tocar el resto.

## [UD-141] En el teléfono la barra superior conserva las tres marcas de estado

**Fecha:** 2026-10-21
**Contexto:** Cinco de diez jueces de la ronda 4 marcaron lo mismo con severidad 3: en el teléfono la barra juntaba los tres estados en un solo «9» con el triángulo rojo de abierto (4 abiertos y 5 respondidos sumados), mientras el escritorio mostraba tres marcas separadas. El dueño pidió, textual, que la barra superior lleve «SÓLO los íconos de abierto (rojo), respondido (amarillo) y cerrado (azul), cada uno con su número, sin rótulos» y que al hacer clic despliegue «un pequeño desplegable con esos mensajes».
**Decisión:**
- En todos los anchos la barra lleva tres marcas, abierto rojo, respondido amarillo y cerrado azul, cada una con su número y su propio desplegable. Se retira el botón único del teléfono y su menú de tres líneas. Esto enmienda la viñeta del teléfono de UD-100; el vocabulario y los colores no cambian.
- En el teléfono cada marca mide 36 x 36 px (mínimo exigido 24 px; escritorio 50 x 36 px) con 4 px entre ellas. La campana mide 36 x 36 px y el margen derecho de la barra baja a 8 px.
- Medida en 360 px: el nombre del proyecto («DESARROLLO TEAM») cabe en dos líneas con espacio de sobra y las marcas y la campana terminan dentro de la pantalla; en 390 px también. Con 38 px por marca el nombre se partía a mitad de palabra en 360 px, de modo que el espaciado de las marcas se estrechó y el rastreo del nombre en teléfono bajó de 0,08 em a 0,05 em. No hizo falta ocultar nada en 360 px.
- Las filas del desplegable llevan el título en una línea propia y debajo el chip de área, el autor y la hora. Con el chip a la derecha del título, un área de nombre largo reducía el título a una columna de 130 px.
**Alternativas descartadas:**
- Un solo botón con el total en el teléfono: sumaba abiertos y respondidos bajo el ícono de abierto y ocultaba el cerrado.
- Ocultar el cerrado en el teléfono: el dueño pidió los tres.
**Consecuencias:**
- La prueba de flujos «on a phone the bar keeps the three marks» mide a 390 y 360 px: tres marcas, sólo el número visible, cada una de al menos 24 x 24 px, el nombre del proyecto termina antes que la primera marca, las marcas terminan antes que la campana, sin desborde horizontal, y el desplegable cabe en la pantalla y devuelve el foco con Escape.
- La barra no tiene un botón de resumen: `summary-menu` desaparece.
**Condiciones de reversión:** Si en una pantalla de menos de 360 px las marcas no caben, se decide con medida y se registra aquí.

## [UD-140] El presupuesto de API sube a 100 USD en total

**Fecha:** 2026-10-21
**Contexto:** El tope de UD-038 (75 USD en total) tenía unos 25 USD por gastar. Quedan por hacer las mediciones de la Fase 4 del plan de cierre y la ampliación de casos del banco privado con insumos reales.
**Decisión:** Martín, textual: «aumentemos el gasto por api hasta 100 dólares, es decir que de los 200 dólares que me da Anthropic por este plan de Devalis van a quedar 100 dólares». Se lee como un tope total de 100 USD para team-platform, 25 más que UD-038, y 100 USD que quedan para el otro proyecto del autor. Cada encargo declara su parte antes de gastar y se detiene en ella.
**Consecuencias:** Quedan unos 50 USD por gastar sobre lo ya gastado, unos 50 USD. Cabe la ampliación de casos del banco (hasta 3 USD), la medición de Sonnet de H-1103 (unos 5 USD) y repeticiones para separar efectos del ruido.
**Condiciones de reversión:** Si Martín quiso decir 100 USD más sobre los 75 de UD-038, el tope total es 175 y la parte del otro proyecto cae a 25 USD de los 200; se confirma con él antes de pasar de 100 de gasto acumulado.

## [UD-110] Inicio con espacio: la barra de texto manda, la página crece con la ventana y un envío abierto desplaza la página

**Fecha:** 2026-10-21
**Contexto:** Martín, textual, con la captura de Inicio en una pantalla de 2000 px y una captura de Gemini: «La barra de texto necesita respirar mucho más, la UI debe ocupar mejor el ancho en pantalla, tener más espacio negativo para que los elementos respiren. Mira la página de Gemini para inspiración.» El contenido ocupaba una columna de 1215 px con unos 400 px vacíos a la derecha.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. La barra de texto es una caja de 840 px centrada, de bordes muy redondeados y con 24 px de relleno; adjuntar, cámara, micrófono y enviar son controles pequeños dentro de ella. La página deja de ser una columna fija: crece con la ventana hasta 1680 px. Entre bloques hay 24 px, 16 px en una ventana de menos de 800 px de alto y 40 px en una de 1000 px o más; los valores son tokens (`--spacing-block-compact`, `--spacing-block`, `--spacing-section`, `--spacing-bar-pad`, `--container-compose`, `--container-inicio`) y están en `panel/DISENO.md`. El control «Envíos» sólo se dibuja cuando hay envíos. UD-017 se enmienda así: en reposo Inicio cabe sin desplazarse a todos los tamaños; con un envío abierto la región principal se desplaza y las dos listas toman un alto propio (el mayor entre 28 rem y el 56 % de la ventana), nunca una caja interna con desplazamiento propio salvo el texto largo de un original. La franja «Para mí» y «Por área» ya no está en Inicio (UD-100).
**Alternativas descartadas:**
- Ancho fijo mayor para la barra: a 2560 px sigue dejando vacío a los lados; un máximo con evidencia de capturas a 1280, 1440, 1920 y 2560 px lo evita sin estirar una línea de escritura.
- Plegar las listas con un envío abierto: la enmienda de UD-017 las deja visibles y la página se desplaza.
**Consecuencias:** `test:fit` mide también 1920x1080 y 2560x1440 y sigue fallando si algo se corta, se solapa o una caja desplaza por su cuenta; mide además que el contenido de Inicio use el ancho. `FitList` no vuelve a medir cuando el espacio lo sostiene su piso de una fila (H-2100).
**Condiciones de reversión:** Si el espacio en blanco esconde las listas en pantallas bajas, vuelve el relleno de 16 px a todas las alturas.

## [UD-150] Tarjetas de lista, ficha y respuesta: el estado abre la línea de datos y Cerrar va junto al campo

**Fecha:** 2026-10-21
**Contexto:** La ronda 4 de jueces encontró catorce defectos en las tarjetas, la ficha y el flujo de responder y cerrar. Estado y botón compartían raíz y fila. Los títulos dejaban 145 px vacíos. La categoría cambiaba de lugar entre filas. El naranja de «Error» se parecía al rojo de «Abierto». El campo de respuesta desaparecía al cerrar. «Cerrar» estaba a 550 px del campo. Enviar no confirmaba. Los adjuntos no tenían nombre.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla.
- En la fila de un mensaje el estado va primero en la línea de datos (autor, fecha, adjuntos, respuestas) y la columna de acciones lleva solo «Responder» y «Cerrar». Enmienda UD-036 en el lugar, no en el color: el estado se sigue diciendo una vez, con su forma y su palabra.
- El chip de área va siempre en su propia línea sobre el título, y el título llena el ancho (`text-wrap: pretty` en lugar de `balance`). El conteo de respuestas es un dato más de la línea.
- En el filtro de cada lista de Inicio («Para mí», «Todos») las opciones son texto con subrayado en la elegida, sin píldora; el selector de lista del teléfono conserva la suya.
- En la ficha el botón «Cerrar» o «Reabrir» está en la fila del formulario de respuesta, antes de «Responder», y deja de estar en el encabezado. Quien no puede responder (el autor, o un mensaje cerrado) lo ve en una caja con su razón: «Enviado por mí» o «Cerrado: no admite respuestas».
- El selector de tipo lleva su rótulo visible «Tipo de respuesta»; el tipo `fix` se llama «Solución» (antes «Resuelto») para que no se lea como cierre. El valor guardado no cambia.
- Enviar una respuesta se confirma en el propio formulario («Respuesta enviada») hasta la siguiente letra escrita. Un aviso flotante cubre justo esa zona en el teléfono.
- En las respuestas, el audio, el documento y el enlace llevan su nombre al lado del ícono.
- «Ampliar» sobre una foto tiene fondo propio opaco.
- El color inicial del área «Error» pasa de `#c2410c` a `#854d0e` en `templates/areas.json` y en el servidor de ejemplo: su tono estaba a 13 grados del rojo del estado «Abierto». La paleta de ocho y la migración 0008 no cambian; una base ya sembrada conserva su color hasta que el Editor lo cambie en Áreas.
**Alternativas descartadas:**
- Renombrar el botón «Responder» o el estado «Respondido»: UD-041 fija los nombres de los estados.
- Una migración que recolorea «Error» en las bases existentes: el color lo elige el Editor (UD-045) y el número de migración puede chocar con otras ramas.
- Aviso flotante para el envío: tapa los botones de la fila del formulario en el teléfono.
**Consecuencias:** `flows-ronda4-tarjetas.browser.test.mjs` mide cada punto con cajas reales; la prueba de J2-A-21 pasa a exigir que «Cerrar» esté con el formulario y no en el encabezado.
**Condiciones de reversión:** Si Martín quiere «Cerrar» en el encabezado, se mueve `CloseMessage` de `ReplyThread` a `MessageDetail`. Si quiere el estado en la columna de acciones, se devuelve `StateMark` a esa columna en `MessageCard`.

## [UD-151] El chip de área conserva su color; su peso se ajusta por tamaño de letra y no por color

**Fecha:** 2026-10-21
**Contexto:** El juez de la ficha y el del flujo de respuesta dijeron que el chip verde de área pesa más que el estado. La restricción del dueño es UD-045, textual: «Cada área debe poder tener su color y eso determina el chip que se muestra en cada mensaje; la idea es mejorar la comprensión a primer vistazo».
**Decisión:** Decisión de la sesión; el color del chip no se toca. El chip pasa de negrita (700) a seminegrita (600) en toda la interfaz. En la ficha el estado sube de 12 px a 14 px, con su luz y su palabra y sin píldora (UD-036 y J2-A-05). El recuadro del análisis conserva el color secundario. Los estados «abierto», «respondido» y «cerrado» no cambian de nombre ni de color.
**Alternativas descartadas:**
- Quitar el relleno del chip o pasarlo a contorno: contradice la cita de UD-045.
- Poner el estado en píldora para que pese lo mismo: UD-036 reserva el relleno de color a la campana.
**Condiciones de reversión:** Si Martín sigue viendo el chip más pesado, la medida siguiente es bajar su letra a 12 px en `.area-chip`. Esa decisión es suya porque cambia la escala de tipos.

## [UD-170] La nota de la entrada queda sin vía de contacto

**Fecha:** 2026-10-21
**Contexto:** El juez de la ronda 4 observó que «Cuentas creadas por el Editor del equipo» nombra un cargo sin decir a quién pedir una cuenta ni cómo. Evidencia: `src/config.js` no tiene ajuste de contacto. La entrada no tiene sesión, así que mostrar el correo de un Editor exige un endpoint público y un ajuste nuevos. El equipo es pequeño y quien necesita una cuenta conoce a su Editor.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. La nota queda como está, una línea impersonal que nombra el cargo (UD-050). No se agrega una vía de contacto: sería una función nueva que ningún pedido del dueño menciona (RULES 7 y 8).
**Alternativas descartadas:**
- Un ajuste «contacto» que el Editor configure y la entrada muestre: publica un correo sin sesión y agrega una superficie que nadie pidió.
- Enlace `mailto:` a un Editor elegido por el servidor: expone el correo de un miembro a cualquiera que abra la página.
**Consecuencias:** Ninguna en código. La fila H-3008 queda cerrada con esta decisión.
**Condiciones de reversión:** Si el dueño quiere la vía de contacto, se agrega el ajuste `contact` con valor opcional y la nota lo muestra cuando existe.

## [UD-160] La vista de un área no repite el chip de su área en cada mensaje

**Fecha:** 2026-10-21
**Contexto:** Un juez de pantallas anotó que «Error» se repetía en las 4 filas de una vista que ya es el área Error (H-2905). UD-041 fija los mensajes del área con su filtro por estado; UD-045 fija que el color del área determina su chip.
**Decisión:** La vista de un área no dibuja el chip de área en sus filas. El área es el filtro de la vista y su nombre es el título. El chip sigue en Mensajes, el detalle, el análisis, Inicio y la barra superior, con el color del área. `MessageCard` y `MessageList` reciben `hideArea` (por omisión, falso).
**Alternativas descartadas:**
- Dejar el chip en cada fila: repite el título de la página sin dato nuevo.
- Quitar el chip de todas las listas: UD-045 lo fija como la marca del área en cada lugar donde el área no es evidente.
**Consecuencias:** Una prueba de `flows-states-areas.browser.test.mjs` cuenta cero chips en la vista del área y más de cero en Mensajes.
**Condiciones de reversión:** Si el dueño pide el color del área también en esta vista, vuelve el chip o se pinta el título con él.

## [UD-180] La marca del servidor de ejemplo dice «Servidor de ejemplo» y lleva borde discontinuo

**Fecha:** 2026-10-21
**Contexto:** H-906 pidió que el análisis del servidor de ejemplo se marcara para que nadie lo juzgara como real. El juez de la ronda 4 leyó «Simulado» sin saber de qué.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. La marca sigue en la cabecera del análisis, sólo cuando la propuesta trae `simulated`, y se llama «Servidor de ejemplo» con borde discontinuo; el texto emergente dice «Propuesta inventada por el servidor de ejemplo». El estado «Publicado» pasa a chip y va antes de la marca. Contra la API real no se dibuja nada.
**Alternativas descartadas:**
- Quitar la marca: H-906 la pide.
- Un color de estado para la marca: los colores de estado son de los mensajes (UD-045).
**Condiciones de reversión:** Si el nombre se lee como un dato del proyecto y no de la propuesta, vuelve «Simulado» con el texto emergente nuevo.

## [UD-190] «Cerrar sesión» no se dibuja cuando el servidor no tiene ruta de cierre

**Fecha:** 2026-10-21
**Contexto:** En modo `trusted-header` el botón llamaba a `POST /api/auth/logout`, que no existe (404), y la persona seguía dentro (H-2605). `GET /api/me` informa el proveedor (`local` o `delegated:<modo>`). Medido en `src/identity/identity.test.js`: la ruta existe en `local` y en `delegated:sso-redirect`, y no en `trusted-header`, `jwt` ni `signed-header`.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. La barra lateral no dibuja la fila «Cerrar sesión» cuando el proveedor no es `local` ni `delegated:sso-redirect` (`canSignOut` en `panel/src/lib/identity.ts`). El pedido decía «distinto de `local`»; se excluyó `sso-redirect` porque su ruta de cierre funciona y ocultarla quitaría una función que anda. El riesgo de suplantación en `trusted-header` sigue declarado en `docs/INSTALACION.md`.
**Alternativas descartadas:**
- Dejar el botón con el 404: es un botón que no hace nada.
- Ocultarlo en todo proveedor distinto de `local`: quita el cierre de sesión a quien entra por `sso-redirect`.
- Una ruta de cierre falsa en los modos sin sesión propia: aparenta cerrar una sesión que no existe.
**Consecuencias:** Pruebas `panel/src/components/Sidebar.test.tsx`, `panel/src/flows-ronda3a.browser.test.mjs` (tres proveedores y teléfono) e `identity.test.js` «H-2605».
**Condiciones de reversión:** Si el dueño quiere el botón visible en todo modo, se borra la condición `me && canSignOut(me.provider)` de `Sidebar.tsx`. Si un modo delegado nuevo trae ruta de cierre, se agrega su nombre a `canSignOut`.

## [UD-191] Hallazgos de los detectores en Equipo, Configuración y la ficha del mensaje

**Fecha:** 2026-10-21
**Contexto:** `npm run ui-detectors -- --screens team,settings,message-detail` dio 5 hallazgos (H-2302). Medidos antes: «Ver más» de 39 x 17 px y correo de 227 x 21 px en Equipo; Configuración con 2,33 ventanas de alto en escritorio y el campo «Proyecto» a 16 px en teléfono; 6 miniaturas sin vista previa con el mismo relleno saturado en la ficha del mensaje, tema oscuro.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla.
- Objetivos táctiles: «Ver más» y el correo suben a 24 px de alto con relleno y margen negativo del mismo valor; el tamaño de letra y el flujo de la fila no cambian. El relleno del correo va sólo hacia abajo para que su área no se monte sobre la del nombre.
- Alto de página: `ui-detectors.mjs` lee `SCROLLING_PAGES` de `panel/src/scrolling-pages.mjs`, la misma lista que usa `test:fit` (UD-123), y no marca el alto de las páginas declaradas. La página no se toca.
- Campo «Proyecto» en teléfono: el campo de texto pasa de 16 px, fuera de la escala, a 17 px, el paso de lectura (`--text-read`). Fuente: Safari en iOS amplía la página al enfocar un campo con tamaño menor a 16 px ([Rick Strahl, «Preventing iOS Textbox Auto-Zooming and ViewPort Sizing»](https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing); [Telerik, «Disable Auto Zoom for Input Controls on iPhone Safari»](https://docs.telerik.com/devtools/aspnet-ajax/knowledge-base/common-disable-autozoom-input-safari-iphone)). Los pasos de la escala son 12, 15, 17 y 18,75 px; 15 provoca el zoom, 17 es el único paso de 16 px o más. Afecta a todo campo en pantallas de hasta 640 px.
- Peso igual: la miniatura de un adjunto sin vista previa (documento, audio, enlace) y el fondo del video pasan de `accent-soft` a `raised`, neutro, con el ícono en `accent-deep`. Los colores de estado (UD-041) y el chip de área (UD-045) no cambian.
**Alternativas descartadas:**
- Agrandar la letra de «Ver más» y del correo: el pedido es no hacer los textos más grandes de lo necesario.
- Añadir el paso de 16 px a la escala: agrega un cuarto tamaño de apoyo a 1 px de otro.
- Subir el límite `--max-saturated` o excluir las miniaturas en el detector: tapa la medida en vez de calmar la pantalla.
**Consecuencias:** Pruebas `panel/src/type-scale.test.ts` (campo en teléfono, paso de la escala y 16 px o más), `panel/src/ui-detectors.test.mjs` (páginas declaradas) y la corrida de `ui-detectors` con 0 hallazgos en las tres pantallas.
**Condiciones de reversión:** Si el dueño prefiere 16 px, se agrega ese paso a `styles.css` y a `type-scale.test.ts`. Si quiere la miniatura en azul, vuelve `bg-accent-soft` en `Thumb.tsx` y el detector vuelve a marcar la ficha.

## [UD-200] La ficha dice qué cierra, qué escribe y qué tipo de medio es cada adjunto

**Fecha:** 2026-10-21
**Contexto:** La ronda 5 de jueces encontró once defectos en la ficha y el flujo de responder y cerrar (H-3300 a H-3310). Medido en 390x844: el aviso de cierre cubría «Reabrir», la página mide 1,87 ventanas, y el ícono de un audio y el de un documento compartían contorno.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. Restricciones del dueño intactas: los estados Abierto, Respondido y Cerrado conservan nombre y color (UD-041) y el chip de área su color (UD-045, UD-151).
- «Cerrar mensaje» y «Reabrir mensaje» en la ficha, sin relleno y a 16 px de «Responder». Las tarjetas de lista conservan «Cerrar» y «Reabrir».
- El campo de respuesta dice «Texto» y el grupo de tipo «Tipo»; sus nombres accesibles siguen siendo «Respuesta» y «Tipo de respuesta». La opción de tipo sigue llamándose «Respuesta».
- Clip, cámara y micrófono del campo de respuesta llevan su nombre visible. Un tooltip no existe en teléfono.
- En teléfono el cierre no lanza aviso flotante: lo dicen la caja «Cerrado: no admite respuestas» y «Reabrir mensaje», que lo deshace. En escritorio el aviso con «Deshacer» se mantiene. Enmienda en el lugar el efecto de J2-A-18 sólo en teléfono.
- La confirmación «Respuesta enviada» se dibuja sobre la esquina del campo y no ocupa fila. Tras enviar o cerrar, el pie del hilo se trae a la ventana.
- En teléfono la fila superior de la ficha lleva «Responder», un enlace que lleva el foco al campo. UD-059 fija el orden de la página y no se toca.
- Cada adjunto de una respuesta es una fila con su nombre. Un mapa único de íconos por tipo de medio (foto, video, audio, documento, enlace) sirve a miniaturas y filas; el audio usa el micrófono, que no comparte contorno con el documento.
**Alternativas descartadas:**
- Renombrar la opción de tipo «Respuesta»: es el nombre natural del tipo por omisión y ya se distingue del título por su lugar.
- Un aviso flotante más arriba en teléfono: cubre el título y el estado.
- Sólo tooltip en los íconos del campo: no hay hover en teléfono.
**Consecuencias:** `panel/src/flows-ronda5-respuestas.browser.test.mjs` (12 pruebas), `panel/src/components/MediaIcon.test.tsx` y `src/domain/attachments.test.js`.
**Condiciones de reversión:** Si el dueño quiere «Cerrar» a secas, se cambian `reply.close` y `reply.reopen` en los catálogos. Si quiere el aviso en teléfono, se quita la condición `desktop` de `CloseMessage.tsx`.
