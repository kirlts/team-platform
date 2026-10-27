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
**Enmienda 2026-10-24:** UD-287 reduce el privilegio del Editor a cambiar textos configurados; el resto es de cualquier persona activa del equipo.
**Enmienda 2026-10-22:** Se cumplió la condición escrita (UD-254, la instancia del anfitrión). Con `IDENTITY_PROVISION=host` el anfitrión da de alta al miembro en su primer ingreso y fija su rol en cada uno; el Editor local recibe 409 `role_managed_externally` (H-3720). Con `IDENTITY_PROVISION=closed`, la omisión, sigue lo de arriba.

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
**Decisión:** Martín, textual: «editar un texto es simplemente hacer clic sobre el texto en el campo de texto, cambiarlo, y luego un clic afuera guarda el texto, con un botón deshacer y un botón rehacer funcionales. Sin versionado» y «me importa que todo el diseño de la interfaz quepa en una sola página … tener que hacer scroll me parece una mala decisión de diseño … revisa cómo lo hace [el cliente] en esos sentidos». Toda pieza de texto editable (vista previa del input, título, cuerpo y campos de cada mensaje propuesto, destinatarios, área, y luego título y cuerpo de un mensaje publicado y de una plantilla) se edita en el lugar: clic entra a edición, clic afuera o Enter (Escape cancela) guarda, sin botón «Editar» ni «Guardar». Deshacer y rehacer son dos botones visibles y los atajos Ctrl+Z y Ctrl+Shift+Z, con una pila por pantalla que vive en memoria y se pierde al recargar: no hay historial de versiones en la base. Cada vista cabe en una pantalla a 1440×900 y a 1280×720: lo que se necesita ahora está a la vista, lo demás se pliega con su cuenta y llega cuando hace falta, y las listas paginan dentro del marco con un tamaño de página medido según el alto disponible.
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
**Enmienda (UD-046):** El diálogo de envíos y su botón dejan de ser el camino principal. Inicio sigue la maqueta: título con fecha, barra de texto, desplegable en línea y listas (la franja de UD-046 salió de Inicio por UD-100). Con un envío abierto las listas pueden plegarse a una franja.
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
**Decisión:** Se mantiene la vista, porque la especificación la pide visible, y se dice una vez: el título lleva la razón («Apagadas hasta que la descomposición esté probada») y cada conexión es un nombre, sin repetir un estado idéntico por fila. La barra lateral tiene una sola entrada, Conexiones, sin submenú. No se ocultan hasta que existan: eso contradice la especificación, y mostrar «lo que falta para conectarlas» sería inventar acciones de conectores que todavía no tienen diseño. Es una decisión de la sesión por encargo de Martín; la dirección `/connections/:kind` sigue abriendo la vista con esa conexión marcada. Enmienda 2026-10-21: Martín, textual: «quita "Apagadas hasta que la descomposición esté probada"»; el título queda sin esa razón.
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
**Enmienda 2026-10-22 (H-3730):** La pasada de cobertura relee sólo las unidades de voz y de texto descartadas. Un fotograma descartado queda descartado: en la revisión de dos videos de un cliente, lo que sólo se veía en pantalla se convirtió en pedidos que nadie hizo. Medición: `docs/investigaciones/mediciones/2026-10-22-analisis-de-videos.md`.
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

## [UD-046] Inicio sigue la maqueta y el envío se ve en un desplegable bajo la barra de texto (enmendada por UD-100)

**Fecha:** 2026-10-21
**Contexto:** UD-030 puso la revisión de los envíos en un diálogo tras un botón «Envíos». Martín, textual: «cuando escribo un mensaje o grabo un video o mando un audio y hago click en enviar, la única retroalimentación es una barra superior que muestra que algo está cargando y después tengo que hacer click y desplazarme hacia abajo en la bandeja de envíos para recién ver cómo quedó lo que mandé. Eso es súper contraintuitivo. En la interfaz original que maqueté había puesto un desplegable dinámico debajo de la barra de texto en la página principal, y es en ese desplegable donde esperaba que apareciera lo que uno está enviando y cómo lo analizó la IA. [...] Lo de la bandeja de envíos es bueno pero no me gusta que muestre esos 7 para revisar, porque significa que tengo que hacer otro clic; esperaba ver la respuesta en esta misma interfaz. Lo que te acabo de escribir es aún más importante que los últimos mensajes y las últimas respuestas. La barra de Para mí y por área debería estar arriba de todo, con la barra de texto más abajo, y mucho mejor distribuida a nivel de espacio, para que no ocupe tanto.» Después, con UD-070 y UD-071, los mensajes dejaron de esperar una confirmación.
**Decisión:** Inicio se dibuja de arriba abajo así: el nombre del proyecto con la fecha, «Nuevo mensaje» con la barra de texto, el desplegable y, debajo, «Últimos mensajes» y «Últimas respuestas». El desplegable es un bloque de la página, no una ventana: se abre solo al enviar y muestra ese envío, a la izquierda el original (texto o transcripción editable y la galería de medios, cuya tira es la lista de adjuntos) y a la derecha lo que la IA hizo de él. Con el progreso real mientras corre, y al terminar los mensajes ya publicados, cada uno en su recuadro del color de su área, con chip, título, texto, campos, destinatarios y adjuntos editables en el lugar por quien lo envió; las ediciones guardan sobre el mensaje publicado y se pueden deshacer. No hay botón «Enviar N mensajes» ni «Descartar envío» como paso: sólo una propuesta que el sistema no pudo publicar sola (`publish_blocked`) o con la publicación automática apagada conserva la revisión de UD-003. Con varios envíos seguidos (UD-025) el desplegable muestra el actual y un selector compacto de todos los envíos propios con su estado (en cola, analizando, publicado, fallido), en el mismo lugar. El control «Envíos» de la fila del título plega y despliega el desplegable y lleva el estado de los envíos en su cara.
**Alto (UD-017):** El desplegable mide entre 20 y 30 rem, 40 % de la altura de la ventana. Las dos listas de abajo necesitan una fila y su paginador para existir; cuando la ventana no alcanza para el desplegable y para ellas, se pliegan en una franja con su nombre y el botón que devuelve el espacio. La decisión sale de medir si la página se desborda con las listas dibujadas, no de un umbral de altura. En 1440×900 con un envío abierto las listas se pliegan; a ventanas más altas conviven.
**Enmienda (UD-100):** la franja «Para mí» y «Por área» ya no está en Inicio. El dueño la sacó de la página y la pidió en la barra superior: «debería quedar integrado […] en la barra superior del sitio, siempre visible, pero NO en inicio. Inicio ya tiene demasiados elementos». Sus tres cifras son las marcas de estado de esa barra. Una captura de Inicio sin la franja cumple UD-046 y UD-100.
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
**Enmienda 2026-10-21:** retirar una clave o eliminar un proveedor actúa con un clic, sin diálogo; el bloqueo por `provider_in_use` y el cambio de cada función se muestran en la fila (UD-253).
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
**Decisión:** Martín, textual: «aumentemos el gasto por api hasta 100 dólares, es decir que de los 200 dólares que me da Anthropic por este plan de [el cliente] van a quedar 100 dólares». Se lee como un tope total de 100 USD para team-platform, 25 más que UD-038, y 100 USD que quedan para el otro proyecto del autor. Cada encargo declara su parte antes de gastar y se detiene en ella.
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

**Enmienda 2026-10-24:** Martín, textual: «Están mal distribuidos los elementos en la pantalla de inicio; lo de nuevo mensaje, ultimos mensajes y ultimas respuestas están muy juntos». Decisión de la sesión, tomada por ese encargo; Martín puede revertirla. La barra de texto deja de medir 840 px: título, barra y las dos listas comparten el ancho de la página, que llega a 72 rem (1080 px con sus márgenes, las 12 columnas de la grilla) y no a 1680 px. Entre secciones hay 40 px desde 800 px de alto de ventana y 24 px bajo ese alto (antes 24 y 16, con 40 sólo desde 1000 px). El título de cada lista pasa a rótulo de sección sobre su caja, como «Nuevo mensaje», y las dos cajas miden lo mismo. Se retira `--container-compose`.

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
**Enmienda 2026-10-22:** Desde H-3720 toda fuente emite una sesión propia y `POST /api/auth/logout` existe en todos los modos. `canSignOut` acepta una lista de fuentes y dibuja el botón también cuando `/api/me` trae `logout_url` (`LOGOUT_URL`).

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


## [UD-220] Equipo y Conexiones explican con texto emergente, no con texto visible; el desplegable de Inicio conserva su alto mínimo

**Fecha:** 2026-10-21
**Contexto:** La ronda 5 de jueces pidió que los roles «Editor» y «Miembro» y las conexiones «API», «MCP» y «Correo» dijeran qué son, y vio 120 px vacíos bajo el análisis en el desplegable de envío. UD-122 admite texto de ayuda visible sólo en Configuración; UD-037 fija las conexiones como un nombre cada una, apagadas y con su razón en el título; UD-110 pide que el desplegable mida lo que muestra.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. (1) En Equipo el chip de rol lleva un texto emergente y su nombre accesible incluye lo que permite el rol (UD-007): «Envía mensajes y responde» y «Administra áreas, plantillas, equipo y conexiones». (2) En Conexiones cada fila lleva un texto emergente de una línea; no se agrega texto visible. (3) La fila de Conexiones no gana flecha, interruptor ni acción: UD-037 descartó «una acción por conector» porque ningún conector existe, y la vista vacía bajo cinco filas es lo que esa decisión deja. (4) El desplegable de envío conserva su alto mínimo de 20 rem aunque deje una banda vacía bajo un original corto: lo exige H-703 (salto de 247 px de severidad 4) y H-730 ya registró que los dos hallazgos no se cumplen a la vez. (5) Un envío de sólo texto dice «Enviando» y no «Subiendo» (el rótulo sigue a lo que viaja). (6) En teléfono, con el resultado publicado, el original se lee como su primer párrafo con «Ver más». (7) La repetición del título en el cuerpo de la tarjeta publicada no se toca: el cuerpo lo escribe el modelo, cuyo mensaje de sistema ya dice que no empiece repitiendo el título (`FINAL_REMINDER` en `src/analyze/prompts-en.js`), y en el servidor de ejemplo lo copia del texto enviado.
**Alternativas descartadas:**
- Texto visible bajo cada rol en Equipo: contradice la regla de ninguna ayuda por omisión fuera de Configuración.
- Una columna «Qué permite» en Equipo: repite en cada fila lo que dos roles explican.
- Una acción por conexión: UD-037.
- Quitar el alto mínimo del desplegable: mide 179 px en la cola y reaparece el salto de H-703 (la prueba de J3-B-04 falló con ese cambio).
**Consecuencias:** `panel/src/flows-ronda5-resto.browser.test.mjs` (13 pruebas, todas fallan sobre el código anterior). En teléfono los textos emergentes no se ven con el dedo; el nombre accesible sí lo dice.
**Condiciones de reversión:** Si el dueño quiere los roles explicados a la vista, se agrega una línea impersonal bajo el chip y UD-122 se enmienda para Equipo; si prefiere el desplegable sin alto mínimo, se quita `md:min-h-[20rem]` de `SendDrawer.tsx` y se enmienda H-703.
## [UD-210] Cada cifra de pendientes dice su alcance por su nombre, y las dos listas de Inicio nombran igual su filtro

**Fecha:** 2026-10-21
**Contexto:** La ronda 5 de jueces anotó que el 4 de la barra superior no coincide con la suma de los conteos de la barra lateral (6), que «Para mí» y «Por área» de UD-046 no aparece en Inicio y que las dos listas de Inicio nombran su filtro con fórmulas distintas («Para mí» y «Que me involucran»). Medido en los datos de ejemplo: la barra superior cuenta lo que me concierne (`mine.open`, UD-028) y la lateral cuenta por área a todo el equipo (`areas[].open`); 4 contra 6 es la diferencia entre los dos alcances, no un error de cuenta. UD-100, textual: «Los conteos por área viven donde ya estaban: la barra lateral junto a cada área».
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. Las dos cifras se conservan con su alcance. Cada marca de la barra superior dice en su nombre accesible y en su tooltip «4 abiertos para mí». Cada conteo de la barra lateral y de la lista de Áreas dice «Idea: 2 abiertos en el equipo», también como tooltip. No se agrega texto visible ni contador por área a la barra superior (UD-100). Los estados no cambian de nombre ni de color. En Inicio, las dos listas usan las mismas opciones, «Para mí» y «Todos» (en inglés «For me» y «Everyone»); «Que me involucran» y «Todas» salen del catálogo. Las dos listas piden lo mismo (`for=me`), así que un solo rótulo es exacto.
**Alternativas descartadas:**
- Hacer que la barra lateral cuente lo mismo que la superior: el dueño pidió los conteos por área del equipo junto a cada área (UD-028 y UD-100).
- Un rótulo visible junto al número de la barra superior: el dueño lo rechazó por escrito (UD-100).
- Devolver la franja «Para mí» y «Por área» a Inicio: UD-100 la retiró por pedido del dueño.
**Consecuencias:** Claves `bar.open`, `bar.answered` y `bar.closed` en los dos catálogos; `areas.countOf` termina en «en el equipo». Prueba «the marks of the top bar say they count what is for me» en `flows-ronda5-listas.browser.test.mjs`.
**Condiciones de reversión:** Si el dueño quiere un solo alcance, se quita el sufijo de `areas.countOf` y de las claves `bar.*`, y el conteo lateral pasa a leer `mine_open`.

## [UD-211] Un área sin mensajes abiertos ni respondidos muestra sus dos conteos en cero

**Fecha:** 2026-10-21
**Contexto:** En la lista de Áreas, una fila sin mensajes dejaba en blanco la columna de estado. El juez de la ronda 5 la tomó por datos sin cargar. La ronda 3 había pedido lo contrario: «0 pendientes» pesaba como «4» (J3-A-33, H-832).
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. Un área con 0 abiertos y 0 respondidos muestra «0 abiertos» y «0 respondidos» con el formato de las demás: forma, número y palabra. La tinta es apagada (`--color-muted`), para que pese menos que un conteo con mensajes. Una fila con al menos un conteo muestra sólo los que tienen mensajes, como antes. En teléfono la descripción ocupa el ancho de la fila y los conteos van debajo, en una línea.
**Alternativas descartadas:**
- Dejar la columna en blanco: no se distingue de una fila sin cargar.
- Mostrar el cero en todas las filas: repite «0 respondidos» en áreas que ya dicen algo.
- Un guion o «Sin mensajes»: otro formato para el mismo dato.
**Consecuencias:** `AreaRow` en `panel/src/pages/Areas.tsx`; la prueba J3-A-33 pasa a exigir los dos ceros. Enmienda J3-A-33.
**Condiciones de reversión:** Si el dueño no quiere ceros, se quita el bloque `empty` de `AreaRow` y la prueba vuelve a exigir la columna vacía.

## [UD-212] El nombre del proyecto en la barra superior cabe en una línea a 390 px y se parte a 360 px

**Fecha:** 2026-10-21
**Contexto:** Cuatro jueces de la ronda 5 vieron «DESARROLLO TEAM» en dos líneas en teléfono. Medido: el texto mide 149 px a 12 px con espaciado de 0,05 em. Entre el botón del menú y las tres marcas quedan 138 px a 390 px y 108 px a 360 px.
**Decisión:** Decisión de la sesión, tomada por ese encargo; Martín no la dijo con estas palabras y puede revertirla. En teléfono el espaciado de letras baja a 0,02 em, la separación de la esfera a 6 px y el ancho mínimo de cada marca de 36 a 32 px (el alto sigue en 36 px). A 390 px el nombre ocupa una línea. A 360 px necesita 143 px y quedan unos 122, así que se parte en dos líneas. Bajar la letra de 12 px rompe la escala de tipos (J1-A-53) y quitar la esfera o una marca contradice UD-100 y UD-141. El nombre lo escribe la persona: uno más largo también se parte, y `break-words` lo permite.
**Alternativas descartadas:**
- Letra de 10 o 11 px: bajo el piso de 12 px de la escala.
- Ocultar la esfera de la marca en 360 px: quita la identidad de la barra por 24 px.
- Quitar el espaciado por completo: 140 px, no alcanza en 360 px.
**Consecuencias:** `Wordmark.tsx` y `StatusBar.tsx`. Prueba «on a phone the name in the top bar is one line at 390 px» exige una línea a 390 px y que a 360 px no pase bajo las marcas.
**Condiciones de reversión:** Si el dueño quiere una línea a 360 px, se oculta la esfera bajo 380 px (`max-[380px]:hidden` en `Wordmark.tsx`), que libera 24 px y deja 146 px para el texto.

## [UD-230] Inicio muestra la fecha y la hora

**Fecha:** 2026-10-21
**Contexto:** `idea.md` pide en Inicio «fecha y hora actuales». La ronda 3 de jueces (J3-A-09, H-808) quitó el reloj por restar jerarquía, y UD-046 lo dejó escrito como «sin reloj». Esa exclusión salió de un juez, no del dueño. La regla 9 de `docs/RULES.md` hace mandar a `idea.md` donde difiere. La auditoría de `idea.md` del 2026-10-21 lo marcó como parcial.
**Decisión:** Inicio muestra una línea de texto corriente con la fecha y la hora («21 de octubre de 2026, 19:05»), al lado del nombre del proyecto, de 14 px o más, sin mayúsculas ni tinta de acento (H-509). La hora se renueva en cada cambio de minuto.
**Consecuencias:** `panel/src/pages/Home.tsx` dibuja el elemento `time` con `format.longDate` y `format.clock`; la prueba «Inicio shows the date and the time of the day» reemplaza a «Inicio has no clock». La hora cambia una vez por minuto, sin mover el diseño (cifras tabulares).
**Condiciones de reversión:** Si el dueño no quiere hora, se quita `format.clock(now)` y `useMinuteClock` de `Home.tsx` y se restituye la aserción de H-808. UD-046 queda enmendada en este punto.


## [UD-240] Borrar lo que existe: mensajes, respuestas, envíos y miembros, y vaciar los datos de prueba

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «falta una lógica para poder borrar mensajes existentes, areas, plantillas, respuestas, usuarios, etc. Esto es especialmente necesario para probar team-platform, investiga qué otras cosas de ese estilo faltan y arregla. Necesito poder probar esto de distintas formas». Relevado el 2026-10-21: áreas y plantillas ya se borran en blando con «Deshacer» (API y pantalla); un miembro sólo se desactiva; un envío sólo se cancela y queda; un mensaje publicado y una respuesta no se pueden borrar; no hay forma de vaciar los datos de prueba ni de sembrar un juego de prueba desde una carpeta.
**Decisión:** Todo lo que una persona crea se puede borrar desde la pantalla donde lo ve, con el mismo patrón que áreas y plantillas: la acción se ejecuta y «Deshacer» la revierte mientras no se haga otra cosa. Mensajes y respuestas se borran en blando (`deleted_at`) y se restauran; los borra su emisor o un Editor. Un envío se borra entero (adjuntos, trabajos y propuesta) por su emisor o un Editor; sus mensajes publicados quedan salvo que se pida borrarlos también. Un miembro se elimina de verdad sólo si no tiene historial; con historial, el Editor elige entre desactivarlo o eliminarlo con todo lo suyo. Nadie se elimina a sí mismo ni al último Editor. El Editor puede vaciar los datos de prueba desde Configuración (todo el contenido; o además miembros, áreas y plantillas, que vuelven al juego inicial) y por línea de comandos, y sembrar un juego de prueba desde una carpeta de archivos. Cada borrado deja su fila en la auditoría y libera los archivos que ya nadie referencia.
**Consecuencias:** Rutas `DELETE` con `?confirm=true` y `POST …/restore` para mensajes y respuestas; `DELETE /inputs/:id`; `DELETE /members/:id`; `POST /ops/reset`; `scripts/vaciar.mjs` y `scripts/sembrar.mjs`. Migración 0010. Las listas, los conteos y la búsqueda ignoran lo borrado. Filas H-3700 a H-3704.
**Enmienda 2026-10-21 (misma tarde):** Martín, al ver el resultado: «no veo un botón para borrar mensajes» y «tampoco veo cómo borrar areas. WTF?», y «se entendió mal lo que había pedido». Lo pedido es poder borrar desde la pantalla donde la cosa se ve, no sólo contar con la ruta del servidor. Cada tarjeta de mensaje lleva su ícono de borrar; cada fila de Áreas y la vista de un área llevan el suyo, con Deshacer. Una función sin control visible donde se usa no cuenta como entregada.

**Enmienda 2026-10-25 (sesión, medido en producción):** el mensaje 117 mostró su galería a Martín y los tres archivos respondieron 404 hasta que el mensaje se restauró. La tarjeta y el archivo salían de dos reglas: la ficha de un envío es de su autor y de quien lo envió con «Enviar como» (UD-255), pero el archivo sólo del autor; y un mensaje borrado se abre desde Borrados (UD-287) sin que sus archivos ni los de sus respuestas se pudieran leer. Ahora una sola regla decide ambos: `isInputParty` para el envío y `VISIBLE_MESSAGE` para el mensaje (vivo: todo el equipo; borrado: las personas del equipo y quien lo escribió). Una respuesta borrada sigue sin leerla nadie. En el panel, un archivo que no carga espera el aviso del flujo de eventos (mensaje publicado, cambio o conexión) y se vuelve a pedir solo; el error con «Reintentar» sale recién cuando falla después de ese aviso, y la miniatura que falla es el recuadro de su tipo con ícono.
**Condiciones de reversión:** Si el dueño prefiere que mensajes o respuestas no se borren, se quita el botón de la pantalla y la ruta devuelve 405; las filas `deleted_at` se restauran con `…/restore`.

## [UD-241] La descripción de la tarjeta cabe en una línea; tarjetas de altura uniforme; pulido de primer vistazo

**Fecha:** 2026-10-21
**Contexto:** Martín, textual: «La descripción debe tener máximo una linea de largo y terminar con puntos suspensivos, permitiendo que los mensajes tengan todos una altura uniforme, ademas aprovecha de pulir un poco más la UI con patrones que piensen en el "primer vistazo"; colores, jerarquias, etc.». UD-016 prohíbe cortar texto con puntos suspensivos en toda la interfaz (guardia `panel/src/no-truncation.test.ts`).
**Decisión:** UD-016 queda enmendada en un solo punto: en las tarjetas de las listas (Inicio, Mensajes, vista de área, desplegables de la barra superior) la descripción ocupa una línea y termina con puntos suspensivos, para que todas las tarjetas midan lo mismo. El texto completo sigue en la ficha del mensaje y en el nombre accesible. Nada más se trunca. Además las listas se pulen para el primer vistazo: una jerarquía visual clara (título, luego estado y área, luego quién y cuándo), color con un solo significado por elemento, y alineación idéntica entre tarjetas.
**Consecuencias:** `MessageCard.tsx` y las listas que lo usan; la guardia de UD-016 admite la línea de la descripción de la tarjeta con su comentario `justified:` y una prueba de ajuste comprueba que todas las tarjetas de una lista tienen la misma altura. Fila H-3705.
**Enmienda 2026-10-21 (misma tarde):** Martín, al ver la lista: «los elementos no tienen la misma altura vertical». Con título de una o dos líneas, el extracto y el estado caían a alturas distintas aunque la fila midiera igual. El título también ocupa una línea con puntos suspensivos; el texto entero sigue en el tooltip y en la ficha. Cada tarjeta lleva además el ícono de borrar (UD-240) a la izquierda de Responder y Cerrar, para quien escribió el mensaje o el Editor.
**Condiciones de reversión:** Se quita el `justified:` de esas líneas y el título y la descripción vuelven a envolverse; la prueba de altura uniforme se retira.

## [UD-250] Lo borrado se lista y se restaura desde la pantalla, también tras recargar

**Fecha:** 2026-10-21
**Contexto:** La enmienda de UD-240 dice: «Una función sin control visible donde se usa no cuenta como entregada». Auditoría de paridad entre la API y la pantalla (hallazgo 1): las rutas de restauración existen para mensajes, respuestas, áreas, plantillas y envíos descartados, pero el único camino de vuelta era «Deshacer» en memoria, que se pierde al recargar la página.
**Decisión:** Cada lista tiene un control de una palabra que agrega lo borrado, con «Restaurar» por fila. Áreas: «Borradas», junto a «Área», muestra las borradas bajo las vigentes, apagadas y sin contadores. Mensajes: «Borrados» dentro de «Filtro» lista los mensajes borrados de quien los escribió (todos, para un Editor); la tarjeta lleva «Restaurar» en lugar de Responder, Cerrar y borrar, y no lleva enlace a la ficha porque la ficha de un borrado responde 404 para quien no es Editor. Plantillas: «Borradas» dentro del plegable «Plantillas». Envíos: «Descartados» en la franja de Envíos de Inicio. Restaurar invalida las cachés de la lista y la fila reaparece sin recargar.
**Consecuencias:** `GET /messages?deleted=1` (sólo emisor o Editor, con la misma paginación). `useDeletedAreas`, `useDeletedTemplates` y `useDiscardedSends` en `queries.ts`; filtro `deleted` en `filters.ts`; `ShowDeleted.tsx` y `DiscardedSends.tsx`. Pruebas `src/api/restore-deleted.test.js` y `flows-restaurar.browser.test.mjs`. Fila H-3706. Las respuestas borradas siguen sin lista propia: se deshacen en la fila del hilo mientras no se recargue.
**Condiciones de reversión:** Si el dueño no quiere ver lo borrado en las pantallas, se quitan los cuatro controles y el parámetro `deleted`; las rutas `…/restore` y las filas con `deleted_at` no cambian.

## [UD-251] Cola, traza y auditoría en la pantalla, y los envíos de todos para el Editor

**Fecha:** 2026-10-21
**Contexto:** UD-240, textual del dueño: «Necesito poder probar esto de distintas formas», y su enmienda: «Una función sin control visible donde se usa no cuenta como entregada». La auditoría de paridad del 2026-10-21 encontró que la cola de trabajos, la traza de un trabajo, la bitácora y el resumen de telemetría de interfaz existían sólo como API, y que el Editor podía borrar y reprocesar envíos ajenos sin poder listarlos.
**Decisión:** Configuración lleva, para el Editor y al final, las secciones «Cola» y «Auditoría». «Cola» lista los envíos de todos (`GET /inputs?all=1`, sólo Editor) con emisor, estado, cuándo y segundos de análisis; cada fila tiene «Reprocesar», «Borrar» y «Traza». Arriba muestra los trabajos por estado y «Purgar» los terminados con la confirmación en el lugar, sin diálogo. «Auditoría» muestra la bitácora, la más reciente primero, con filtro por acción. Junto al interruptor de «Telemetría de uso», encendido, una línea con el resumen de la interfaz. Un miembro no ve nada de esto y recibe 403 en `all=1`.
**Consecuencias:** `GET /inputs` acepta `all`; el servidor doble del panel sirve `/jobs`, `/audit`, `/telemetry/ui-summary` y las trazas; la lista de la cola consulta cada 2 segundos mientras haya envíos en análisis, porque el flujo de eventos llega a quien envía y no al Editor. Filas H-3708 y H-3709.
**Enmienda 2026-10-21:** «Purgar» actúa con un clic, sin confirmación en el lugar (UD-253).
**Condiciones de reversión:** Si el dueño no quiere esas pantallas, se quitan los dos montajes de `Settings.tsx` y la API sigue como estaba; `all=1` puede quedar o retirarse sin otro efecto, porque ninguna otra pantalla lo usa.

## [UD-252] Los controles del Editor que sólo existían en la API o en la línea de comandos pasan a la pantalla

**Fecha:** 2026-10-21
**Contexto:** Martín, en UD-240: «no veo un botón para borrar mensajes» y «tampoco veo cómo borrar areas. WTF?», y la regla que salió de ahí: «Una función sin control visible donde se usa no cuenta como entregada». La auditoría de paridad del mismo día encontró tres funciones más en esa situación: la contraseña de otro miembro (hallazgo 5), sembrar ejemplos (hallazgo 6) y borrar una plantilla, que tomaba tres clics (hallazgo 8).
**Decisión:** Cada una tiene su control donde se usa. Equipo: «Contraseña» en la fila de cada otro miembro, para el Editor, con confirmación en el lugar y los errores de la política con el texto del servidor; no aparece con identidad externa. Configuración, Datos: «Sembrar ejemplos», que carga `ejemplos/` por `POST /ops/seed` y muestra «N envíos». Vista de un área: el plegable de plantillas abre por omisión, y la fila de Áreas enlaza a él con «N plantillas».
**Consecuencias:** `POST /ops/seed`, `src/domain/seed-examples.js` compartido con `scripts/sembrar.mjs`, `ejemplos/` en la imagen. La columna de acciones de Equipo mide 13rem y caben 6 filas en 1440x900 en lugar de 7. Filas H-3710 a H-3712.
**Condiciones de reversión:** Si el dueño prefiere que la contraseña ajena se cambie sólo por la API, se quita el botón y la ruta queda. Si prefiere el plegable cerrado, se vuelve `defaultOpen` a falso y el enlace de Áreas abre la sección con el hash.

## [UD-253] Respuestas editables, borrado de varios a la vez, sin confirmación de borrado, avisos efímeros y listas de Inicio parejas

**Fecha:** 2026-10-21
**Contexto:** Martín, textual, al revisar lo entregado esa noche: «esto nunca lo pedí» (la lista «Descartados» de Inicio, agregada por la auditoría de paridad). «si, deben poder editarse las respuestas y eliminarse cosas a la vez. no quiero confirmacion de eliminacion en ninguna parte del software». «el toast deberia ser efimero, no requerir que alguien lo borre, y estar centrado.» «Las secciones de ultimos mensajes y ultimas respuestas deberian ser del mismo tamaño, y ocupar mejor el espacio, creciendo y achicandose según cuantos mensajes y respuestas existan».
**Decisión:** (1) La lista «Descartados» de Inicio se retira; la ruta de restaurar un envío descartado se conserva. (2) El autor de una respuesta la edita en el lugar, como el emisor edita su mensaje (UD-071). (3) Mensajes, respuestas y lo que se liste se pueden marcar varios y borrar de una vez, con Deshacer. (4) Ningún borrado del panel pide confirmación: ni paso en el lugar, ni palabra escrita, ni diálogo. Lo reversible ofrece Deshacer en el aviso; lo irreversible se hace y se informa. La API conserva `confirm=true`, que el panel envía siempre. (5) El aviso es efímero: desaparece solo, sin botón de cerrar obligatorio, y aparece centrado. (6) En Inicio, «Últimos mensajes» y «Últimas respuestas» miden lo mismo y su alto sigue a su contenido: sin cajas vacías de alto fijo.
**Consecuencias:** Filas H-3714 a H-3718. `scripts/vps-check.mjs` borra su envío de prueba en vez de cancelarlo: diecinueve comprobaciones habían dejado diecinueve envíos «Prueba de punta a punta» en los datos del dueño.
**Condiciones de reversión:** Cada punto se revierte por separado; la confirmación vuelve como paso en el lugar de cada control.

## [UD-254] Team Platform es un framework; el anfitrión lo aloja en su consola y reemplaza la Mesa; Claude es un miembro con harness

**Fecha:** 2026-10-22
**Contexto:** Martín, textual, la madrugada del 22-10, sobre la naturaleza del proyecto: «reconocer la naturaleza de framework que tiene Team Platform … te da la estructura de mensajes, respuestas y los mecanismos de ingesta totalmente optimizados e implementados a medida para la inteligencia artificial … no es necesario utilizar la interfaz misma de Team Platform, sino que hay que utilizar el motor subyacente». Sobre el anfitrión: «recrear la interfaz que tiene Team Platform, pero utilizando los componentes de la consola superadministrador, alojar Team Platform dentro de la consola superadministrador y darle su propia URL, que sea algo como [el sitio del cliente], que comparta credenciales con los superadministradores». «Mi idea es reemplazar lo que hay hoy en [el sitio del cliente] con lo que dibujé y escribí en mi última nota». «[la persona responsable] accedió a probar esta plataforma porque ve la necesidad». Sobre Claude: «Claude (o el harness) tendría cuenta propia en [el sitio del cliente] y su perfil encajaría con las cosas que se le deben delegar». Sobre el harness: «Tiene que ser un harness con capacidades como las que tienes tú, de probar cosas, interactuar con el sistema en producción, pushear a github, etc.»; «podría ser algo como kilo code o claude code en modo desatendido corriendo en alguna parte, o claude api aprovechando que tenemos 200usd mensuales gratis en claude en [el cliente]». «No se necesita una plantilla de salida. La plantilla simplemente declara el formato de salida y claude code acata con alguna herramienta tipo pretooluse antes de mandar su output final». «El harness debe correr donde más eficiente sea. No sé si levantar todo un [el cliente] paralelo desde cero para resolver un texto truncado o un icono desalineado sea lo más eficiente». «No debe correr en mi notebook. Debe correr en otro lado». «Lo de claude code action sonaba bien, pero no entiendo por qué habría que pasar por github». La nota de Saber «[el cliente] Team Platform» (2026-10-22) dibuja el flujo: los dos miembros escriben en la UI recreada en el anfitrión; los mensajes se encargan según clasificación y plantilla a un harness que «realiza las acciones solicitadas en modo estrictamente desatendido y entrega el output solicitado en la plantilla»; Claude Code en el notebook «recibe el output y lee en tiempo real la ejecución del harness, marca los mensajes en respondido o cerrado» y «empuja a [el cliente], lee y monitorea, diagnostica, mejora, arregla»; Martín «conversa y orquesta».
**Decisión:** (1) El motor (dominio, extracción, análisis, cola, eventos, API) es lo reutilizable; otra interfaz reimplementa sólo las vistas contra la API, que sigue siendo la única puerta (UD-010). (2) El anfitrión aloja una instancia dentro de su consola de superadministrador, en `team.example.org`, con las credenciales de superadministrador; reemplaza a la Mesa. (3) Claude es un miembro con perfil propio; el analizador le asigna mensajes leyendo ese perfil como a cualquier miembro (UD-023); con esa cuenta responde y cierra por la API. (4) El harness es Claude Code en modo desatendido (`claude -p`), cobrado a la llave de API de los 200 USD del anfitrión, como trabajo `execute` de la cola de Team Platform, corrido por un trabajador fuera del notebook de Martín, en una máquina que ese trabajador crea desde la imagen horneada del anfitrión y apaga al terminar, sin pasar por GitHub Actions. (5) La plantilla declara el formato de salida en su propio archivo; se compila al esquema que se exige al harness, y sin salida válida el trabajo falla. (6) El harness no empuja a `main`: deja una rama y Martín entrega por el camino local (UD-210, UD-150). (7) el segundo miembro entra con las credenciales de superadministrador que ya conoce (Martín, 22-10: «Lo de WhatsApp no es necesario, [el médico] ya tiene acceso superadmin porque conoce las credenciales»); la Conexión de WhatsApp no es parte de este plan.
**Consecuencias:** `docs/PLAN-ANFITRION.md` con las fases A a C y la lista de lo que falta decidir. La parte de UD-007 que impide al anfitrión fijar el rol se revierte por su condición escrita. UD-012 y UD-037 (Conexiones apagadas) siguen vigentes.
**Condiciones de reversión:** Si el responsable del cliente no usa `team.example.org` en el primer mes medido por envíos propios, la Mesa vuelve a publicarse y la instancia queda sólo para Martín y Claude. Si el costo por mensaje del harness supera el tope decidido en tres mensajes seguidos, el harness pasa a sólo investigar y no construir.

## [UD-255] Decisiones de la instancia del anfitrión: sesión, roles, datos reales, harness, dos respuestas de Claude y «Enviar como»

**Fecha:** 2026-10-22
**Contexto:** Martín, textual, sobre la lista de decisiones de `docs/PLAN-ANFITRION.md`. «Diferiré lo de las áreas y plantillas de [el cliente], así como la configuración de miembros y sus perfiles, para mañana temprano hora chile». «Login aparte que comparta cookie de sesión con la consola de superadmin». «Sí, martin editor y el resto miembros». «Sí, se acepta trabajar con datos de pacientes reales». «Sonnet 5.5, max budget 10usd para empezar, reasoning medium, hasta 3 subagentes invocables por mensaje abordado para fomentar la paralelización y el trabajo eficiente de claude code. Si no le decimos que paralelice, tiende a creer que debe hacer cosas en serie o se sobrecomplica y además agota su ventana de contexto rápidamente». «Toca en producción lo mismo que puedes tocar tú. Si le piden arreglar un elemento desalineado o arreglar una página entera que no responde, va y lo hace sin problemas. Siempre en modo bypass permissions, sin necesidad de una whitelist de herramientas, igual que acá, siempre siguiendo las reglas del repo». «Claude debe responder al menos 2 veces un mensaje antes de cerrarlo. La primera vez, cuando haya recibido el mensaje y esté empezando a trabajar. La segunda vez, cuando haya terminado de trabajar, explicando en un par de párrafos lo que hizo, sin jerga interna, dirigiéndose directamente al usuario que creó el mensaje, tomando en cuenta su perfil y conociendo la descripción del proyecto. Para esto es necesario que la sesión desatendida sepa cómo usar ese endpoint api de respuesta». «Se debe poder seleccionar en un desplegable, en la página de la plataforma [el sitio del cliente], la opción "enviar como:" que permita enviar un mensaje en nombre de otro miembro. Por defecto debe ser el nombre de usuario correspondiente a las credenciales de acceso».
**Decisión:** (1) `team.example.org` tiene su propio login y comparte la cookie de sesión con la consola de superadministrador. Hecho medido: la consola guarda hoy su JWT en `sessionStorage` y la Mesa en una cookie sin `Domain`; compartir exige una cookie con `Domain=.example.org` que las dos lean. (2) Martín es editor; los dos miembros y Claude son miembros. (3) El contenido con datos de pacientes reales se acepta dentro de Team Platform, en el perímetro que ya protege a las clínicas. (4) Harness: Sonnet 5.5, razonamiento medio, `--max-budget-usd 10` por mensaje para empezar y, por UD-256, un tope de 10 USD por día en total, hasta tres subagentes por mensaje con la instrucción explícita de paralelizar, `bypassPermissions` sin lista blanca de herramientas, bajo las reglas del repositorio del anfitrión; toca en producción lo mismo que una sesión interactiva de Martín. Hecho medido: `bypassPermissions` no arranca como root fuera de un sandbox reconocido, así que la máquina del harness corre `claude` con un usuario sin privilegios. (5) Claude responde al menos dos veces antes de cerrar: al empezar, y al terminar con un par de párrafos sin jerga dirigidos a quien creó el mensaje, con su perfil y la descripción del proyecto en contexto. La sesión desatendida recibe la credencial del miembro Claude y la forma de llamar a la API de respuestas. (6) «Enviar como»: un desplegable en la barra de envío permite enviar en nombre de otro miembro; por omisión, el miembro de las credenciales. El envío queda con el autor elegido y la auditoría registra quién tenía la sesión. (7) Áreas, plantillas, miembros y perfiles del anfitrión se deciden el 2026-10-22 por la mañana, hora de Chile.
**Enmiendas del mismo día:** Martín, textual: «Le haremos su propia cuenta a [el médico]» (una fila de `platform_users` por persona queda decidida) y «La página de [el sitio del cliente] debe seguir la estética de las clínicas en [el cliente]» (la interfaz sigue el panel de la clínica, no la consola).
**Consecuencias:** `docs/PLAN-ANFITRION.md`: la Fase A suma A7 («Enviar como» y autoría delegada) y A5 incorpora las dos respuestas y la credencial del miembro agente; B2 incorpora la cookie de dominio. La Fase A arranca sin esperar las decisiones diferidas.
**Condiciones de reversión:** Cada punto por separado. El tope de 10 USD y los tres subagentes son valores de arranque que se ajustan con el costo medido de los primeros mensajes.

## [UD-256] Tope diario de gasto del harness: 10 USD por día en total

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «tope diario de 10 usd YO YA LO HABIA DICHO». Antes había dicho «max budget 10usd para empezar» (UD-255, punto 4). UD-255 lo registró sólo como tope por mensaje.
**Decisión:** El harness gasta como máximo 10 USD por día sumando todos los trabajos `execute`. `EXECUTE_DAILY_BUDGET_USD` (omisión 10) es el tope; `EXECUTE_MACHINE_COST_USD` (omisión 0; anfitrión 0.07) suma el costo fijo de cada trabajo que corre en una máquina. El día es el día local del servidor (`TZ`; UTC si no está fijada). Con el día agotado, el trabajo espera a la medianoche siguiente sin gastar su intento; con saldo parcial, `--max-budget-usd` baja al saldo.
**Consecuencias:** UD-255 punto 4 enmendado. MASTER-SPEC §7.5 «Ejecución»; `jobs.cost_usd` y `jobs.runner` (migración 0015); paso `budgetWait`; H-3727.
**Condiciones de reversión:** El monto se ajusta con `EXECUTE_DAILY_BUDGET_USD` según el costo medido de los primeros días.

## [UD-257] Los mensajes de un envío se listan plegados, con su cuenta arriba

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «a medida que se vayan generando los mensajes procesados por la inteligencia artificial, la descripción de cada cosa esté plegada, igual que como están plegadas las cosas en últimos mensajes y últimas respuestas. Debe poder desplegarse […] el punto es que quiero poder ver un listado rápidamente de las cosas que se sacaron de los videos. porque así como está ahora se genera un largo conjunto de textos todos visibles, largos que al final lo que producen es que cueste mucho leer qué es lo que se generó a partir del material fuente. yo primero quiero saber cuántos elementos se crearon […] hacer la interfaz mucho más amigable e intuitiva».
**Decisión:** El análisis de un envío, propuesto o publicado, abre con la cuenta de mensajes («4 mensajes»). Si caen en más de un área, sigue la cuenta de cada área con su chip. Debajo va una fila plegada por mensaje: número, chip de área, título en una línea con puntos suspensivos y destinatarios mientras quepan. El título sigue la regla del encabezado de las filas de Inicio (UD-241). Todas empiezan plegadas. Un clic abre la fila en el lugar con el texto, los campos, los destinatarios, los adjuntos y las acciones de siempre. La flecha al inicio del mensaje abierto lo pliega.
**Consecuencias:** UD-046 y UD-070: el análisis ya no muestra el texto completo de cada mensaje sin abrirlo. `panel/src/components/MessageFold.tsx` (`MessageTally`, `MessageFoldRow`) en `AnalysisPanel` y `PublishedPane`. MASTER-SPEC, sección de Inicio; `panel/DISENO.md`; H-3728.
**Condiciones de reversión:** Las fija Martín si pide volver a ver los mensajes abiertos.

## [UD-258] Un envío publicado se reprocesa: sus mensajes van a la papelera y se analiza de nuevo

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «los ya procesados deben reprocesarse con sonnet». Hasta hoy `reprocessInput` sólo admitía envíos con propuesta, fallidos o cancelados; uno publicado era 409 `not_reprocessable` (UD-070).
**Decisión:** El Editor reprocesa un envío publicado con un clic, sin confirmación (UD-253). Los mensajes publicados del envío pasan a la papelera (borrado suave, restaurable, UD-240) con sus respuestas, la propuesta vieja se descarta y el envío vuelve a `queued` para analizarse con el modelo y las áreas actuales. Un mensaje que alguien ya cerró o respondió también se aparta; la auditoría `input.reprocess` guarda las cuentas de mensajes y de respuestas. El emisor que no es Editor recibe 403. En el panel, «Reprocesar» está en el envío publicado del cajón de Inicio y en la cola del Editor; el aviso dice «N mensajes apartados» y enlaza a Borrados para deshacer. La selección múltiple de envíos no existe en la interfaz, así que no lleva el control.
**Consecuencias:** UD-070: «Publicar es idempotente» ya no incluye negarse a reprocesar; el reintento de la cola sigue sin duplicar. `reprocessInput` y la transición `published → queued`; MASTER-SPEC §7.1 y §7.2; `panel/src/components/ReprocessSend.tsx`; H-3729.
**Condiciones de reversión:** Las fija Martín si pide volver a negar el reproceso de un envío publicado.

## [UD-259] Terminado en el anfitrión: un error del responsable del cliente llega a producción sin que Martín lo vea

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «esto se termina cuando los errores que mandó [la persona responsable], que son directamente solucionables y no requieren un pensamiento crítico, porque simplemente la plataforma se supone que va a funcionar de una forma y no está funcionando como se espera […] se atiendan automáticamente por Claude Code, utilizando las instrucciones que yo te di anoche, donde primero mando una respuesta al mensaje cuando empiezo a trabajar y después una respuesta cuando ya terminó de trabajar, y que todo eso quede en producción. Y la gracia de esto es que yo como desarrollador ni siquiera me entere de cuál es el problema que dijo [la persona responsable] antes de que esté solucionado». Sobre la configuración: «cualquier miembro de superadministrador de [el cliente], como yo, [el médico] o [la persona responsable], deberíamos poder subir un video como los que subí hoy día […] y que queden automáticamente clasificadas las cosas según la plantilla que yo escoja y las áreas que yo escoja y los perfiles de persona que yo escoja. Por mientras, para que todo funcione, puedes probar con los mismos ajustes que habíamos probado para la plataforma en mi VPS».
**Decisión:** La instancia del anfitrión está terminada cuando un superadministrador sube un video a `team.example.org`, el análisis lo clasifica, los errores directamente solucionables quedan asignados al miembro Claude por su perfil, el harness responde al empezar, arregla, entrega a producción por el camino del anfitrión (UD-150, simulador como única puerta) y responde al terminar, sin intervención de Martín. Mientras Martín no configure el anfitrión, la instancia usa las áreas y plantillas del VPS y un perfil provisional de Claude que recibe esos errores; Martín los reemplaza cuando quiera.
Martín, el mismo día: «la idea es que yo no quiera abrir una sesion como esta, de claude code en vsc, para resolver weas directamente solucionables».
**Consecuencias:** Enmienda UD-254 y el encargo C4 de `docs/PLAN-ANFITRION.md`: el harness ya no deja una rama para que Martín entregue; entrega él. La prueba de aceptación es una corrida real con los videos del envío 33 en `team.example.org`.
**Condiciones de reversión:** Las fija Martín.

## [UD-260] La clasificación del análisis corre con esfuerzo alto y razonamiento adaptativo

**Fecha:** 2026-10-22
**Contexto:** En los dos videos reales del envío 33, con Sonnet 5.5 y tres corridas, la clasificación sin razonamiento da 7, 7 y 5 pedidos recogidos de 7, con un mensaje sobrante en una corrida. Con esfuerzo alto y razonamiento da 7, 7 y 7, sin sobrantes, al mismo costo (0,17 USD por envío) y con 51 a 65 s en vez de 18 a 25 s (`docs/investigaciones/mediciones/2026-10-22-analisis-de-videos-2.md`). Se le preguntó a Martín si encendía el razonamiento a cambio de esos 40 s. Respuesta textual: «Encender».
**Decisión:** `classifyEffort` es `high` y `classifyThinking` es `null` (razonamiento adaptativo del modelo). La descomposición sigue en esfuerzo bajo y sin razonamiento. Enmienda la medición del 2026-10-20 de `src/analyze/config.js` para la clasificación.
**Consecuencias:** Un envío con video tarda unos 40 s más en clasificarse. En el banco con Haiku el tiempo por caso sube de 21 a 322 s: los bancos de clasificación se corren con `classifyEffort: 'low'` explícito cuando se mide velocidad. MASTER-SPEC §7.5.
**Condiciones de reversión:** Las fija Martín.

## [UD-261] Una traza continua por mensaje y tiempos por fase del trabajo `execute`

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «necesitamos mejorar la observabilidad de TODO ESTO, por eso he sido tan insistente con opentelemetry». Dos mensajes de prueba de un cambio de una línea tardaron 37 y 47 minutos de punta a punta en la instancia del cliente y no se sabía dónde se fue el tiempo. El trabajo `execute` era un solo span plano.
**Decisión:** Cada mensaje tiene una traza: envío, análisis, publicación y ejecución comparten `trace_id`, guardado en el envío, el mensaje y los trabajos. El trabajo `execute` abre un span por fase (`machine.create`, `run`, `destroy`), uno por herramienta y uno por subagente, y deja los eventos `reply.start` y `reply.final`. La sesión recibe `TRACEPARENT` y las variables de `EXECUTE_OTEL_ENV`. `GET /messages/:id/timing`, `team timing` y el bloque «Tiempos» de la ficha entregan las cifras.
**Consecuencias:** Migración 0017 (columnas de traza, `jobs.phase`, `spans.links_json`). `GET /jobs/:id/trace` devuelve ahora la traza completa del mensaje, no sólo el intento. Costo por turno sólo con precio documentado.
**Condiciones de reversión:** Las fija Martín.

## [UD-262] El historial de ejecuciones del harness se guarda un año y cualquier sesión lo consulta sin credenciales

**Fecha:** 2026-10-22
**Contexto:** Martín, textual: «dónde debería guardarse y cómo podría consultarse fácilmente por cualquier sesión que esté trabajando en arreglar o mejorar la plataforma». Medido ese día: los spans viven siete días en la tabla `spans`. `GET /messages/:id/timing` y `GET /jobs/:id/trace` piden sesión. No hay histórico ni agregados. La transcripción de la sesión de Claude (`~/.claude/projects/*/*.jsonl` en la máquina) se pierde al destruir la máquina, a los 62 minutos.
**Decisión:** Cada ejecución del trabajo `execute` deja una fila en `execute_runs` al cerrar, también si falla o vence. La fila lleva identificadores, tiempos por fase, tokens, costo, turnos, resultado, entrega, referencia a la transcripción y las diez herramientas más lentas. La tabla se conserva `EXECUTE_RUNS_RETENTION_DAYS` días (365), no los 7 de `spans`. La orden opcional `EXECUTE_MACHINE_COLLECT` copia la transcripción antes de destruir la máquina, y la fila guarda dónde quedó. `scripts/tiempos.mjs` lee la base en solo lectura, sin sesión ni credenciales de la API. `GET /api/ops/execute-runs` y su resumen sirven lo mismo al panel.
**Consecuencias:** Migración 0018 (`execute_runs`, `jobs.marks_json`). Enmienda UD-261: las cifras de una ejecución sobreviven a la retención de los spans. La sesión informa juez, entrega y espera con `team mark`; sin esa marca la cifra queda desconocida (`NULL`), no cero. La retención de las transcripciones la fija el anfitrión.
**Condiciones de reversión:** Las fija Martín.

## [UD-263] La entrega a producción es un trabajo aparte, sin IA, que corre después de la sesión

**Fecha:** 2026-10-23
**Contexto:** Martín, textual, el 2026-10-22: «Debe haber una forma más eficiente, inteligente y obviamente de resolver esto» y «tiene que poder desplegar rápido con solo pruebas críticas». Medido ese día en la instancia del anfitrión: el trabajo 6 venció. La sesión de Claude esperó más de 30 minutos una entrega que es mecánica (verificar, desplegar). Además, 21 de 23 trabajos fallaron por cuota de máquinas (UD-262, `EXECUTE_CAPACITY_WAIT_MS`).
**Decisión:** El trabajo se divide en dos. `execute` arregla, prueba lo que toca, pide la marca del juez, empuja la rama `tp/<id>` y devuelve su `summary` y su `outcome`; ahí termina y la máquina se destruye. Con `outcome: done` y la rama existente, `execute` encola un trabajo `deliver` que corre `EXECUTE_DELIVER_COMMAND`, una orden de shell del anfitrión, en el host del trabajador, sin IA. La orden sale con 0 cuando quedó en producción, y su última línea de stdout es la referencia. Sale con 75 si no puede ahora, y se aplaza sin gastar intento. Cualquier otro código es un fallo y su salida es el motivo. El autor recibe una sola respuesta final cuando la entrega termina: el `summary` de Claude con «Ya está en producción» y la referencia en la parte estructurada. Si la verificación falla, un `execute` nuevo recibe la salida en su prompt, una sola vez (`EXECUTE_DELIVER_RETRIES`). Si falla de nuevo, el autor recibe el aviso llano de que no pasó la verificación, qué queda guardado y `outcome: blocked`. Un Editor lanza la entrega a mano con `POST /messages/:id/deliver`. Sin `EXECUTE_DELIVER_COMMAND` todo sigue como antes.
**Consecuencias:** Enmienda UD-254 y UD-259: la sesión ya no entrega ni espera un despliegue. El sistema entrega la rama que antes quedaba para una persona. Migración 0019 (`jobs.kind` admite `deliver`; `execute_runs.deliver_job_id` y `delivery_ref`). `delivery_ms` y `delivered` los llena la entrega en lugar de `team mark delivery`. Fases de progreso `deliverVerify`, `deliverDeploy` y `deliverWait`, span `execute.deliver`, MASTER-SPEC §7.3 y §7.5, `docs/INSTALACION.md` («La entrega aparte»), H-3735.
**Condiciones de reversión:** Las fija Martín.

## [UD-264] El tope diario del harness sube a 20 USD mientras Martín duerme

**Fecha:** 2026-10-23
**Contexto:** Martín, textual: «En realidad quiero subir el tope a $20 para que puedas hacer hartas pruebas mientras duermas. Mientras duermo yo, quiero decir. Mientras duermo yo. Mientras duermo yo.» El tope de 10 USD por día era el de UD-256 (y el de UD-248 en el anfitrión).
**Decisión:** `EXECUTE_DAILY_BUDGET_USD` pasa a 20 en la instancia del anfitrión y el tope propio del harness en el anfitrión pasa a 20 USD por día. El presupuesto por mensaje (`EXECUTE_MAX_BUDGET_USD`) no cambia. Las pruebas de la noche las hace la sesión coordinadora, de a dos mensajes por vez.
**Consecuencias:** Enmienda UD-256. El gasto de API de los bancos de análisis sigue declarándose aparte en `bench/results/private-spend.jsonl`.
**Condiciones de reversión:** Las fija Martín.

## [UD-265] Las pruebas por defecto son dirigidas; la batería completa es a pedido

**Fecha:** 2026-10-23
**Contexto:** La batería completa tardó más de una hora con la máquina cargada y frenó cuatro fusiones; las pruebas dirigidas a lo que esas fusiones podían romper corrieron en un minuto (227 del servidor, 186 del panel). Martín, textual: «SI, DEJA ESO COMO REGLA POR DEFECTO Y COMO AJUSTE POR DEFECTO, LA BATERIA COMPLETA ES MUY CARA»; antes: «solo pruebas especiales, OPTIMIZA».
**Decisión:** `npm test` es `scripts/test-dirigido.mjs`: selecciona por las rutas cambiadas contra `origin/main` (mapa `src/testing/areas.json`, con las guardias siempre). La batería completa pasa a `npm run test:completa`. Regla 12 de `docs/RULES.md`. El anfitrión aplica lo mismo en su puerta (pruebas críticas).
**Consecuencias:** La marca de la última corrida en verde (`test:rapido`) sólo se registra tras `test:completa`. Enmienda la práctica de correr `npm test` completo en cada fusión.
**Condiciones de reversión:** Las fija Martín.

## [UD-266] La entrega puede quedar en espera de una persona: código 76 y salida estructurada en la orden

**Fecha:** 2026-10-23
**Contexto:** El historial real de arreglos directos, medido el 2026-10-23: 22 de 62 tocaron migraciones, 31 de 62 datos de personas y 16 de 62 pagos. La plantilla `error-directo` declara la zona tocada y pide revisión humana con cualquier valor distinto de «ninguna», pero la entrega aparte (UD-263) sólo conocía entregado o fallo.
**Decisión:** `EXECUTE_DELIVER_COMMAND` recibe `TEAM_OUTPUT_JSON` (salida estructurada de la sesión sin `summary`, JSON compacto) y puede salir con 76 (`DELIVER_HELD`): no se entrega sola y espera la revisión de una persona; la última línea de stdout es el motivo. La plataforma no conoce zonas: el anfitrión decide. Con 76 no hay reintento ni vuelta a Claude; el trabajo termina `done` con `delivered = 0` y sin referencia; el autor recibe una sola respuesta con el `summary`, un párrafo llano con el motivo y `outcome: needs_decision`. La ficha de `execute_runs` suma `delivery_held`, y el resumen cuenta `delivery.held` aparte de entregado y fallo (`known` no lo incluye, para que la tasa de entrega no lo trate como fallo).
**Consecuencias:** Migración 0020 (`execute_runs.delivery_held`). Enmienda UD-263 (contrato de la orden). MASTER-SPEC §7.5, `docs/INSTALACION.md` («La entrega aparte»), `.env.example`, `src/contracts.md`, `packages/client` (`ExecuteRunsSummary.delivery.held`), `scripts/tiempos.mjs`.
**Condiciones de reversión:** Las fija Martín.

## [UD-267] El tope diario del harness sube a 40 USD y las mediciones vuelven a correr

**Fecha:** 2026-10-23
**Contexto:** El gasto declarado de bancos y pruebas sumó unos 31 USD en tres días (4,70, 8,67 y 17,98) y se congeló toda medición hasta consultar a Martín; la reserva de Team Platform en la cuenta de API era de 100 USD (UD-140). Martín, textual: «aumenta el gasto noma weon». No dio una cifra.
**Decisión:** `EXECUTE_DAILY_BUDGET_USD` pasa a 40 y el tope propio del harness en el anfitrión pasa a 40 USD por día. Las mediciones con modelos de pago vuelven a permitirse, cada una con su presupuesto declarado de antemano y registrado en `bench/results/private-spend.jsonl`; un agente que lo supera se detiene. La cifra de 40 es la elegida por la sesión como el doble del tope anterior, sin medición: Martín la cambia cuando quiera.
**Consecuencias:** Enmienda UD-256 y UD-264. El saldo real de la cuenta de API lo ve sólo Martín.
**Condiciones de reversión:** Las fija Martín.

## [UD-268] Las respuestas de Claude llevan capturas de la interfaz, antes y después

**Fecha:** 2026-10-23
**Contexto:** Martín, textual: «La gracia es aprovechar la mecánica que tiene Team Platform de respuesta a mensajes y hacer que Claude opere la interfaz y cuando se pueda y cuando corresponda y cuando sea útil que la primera respuesta de Claude a un mensaje sea con una foto de la interfaz en donde sea que el mensaje esté refiriéndose. O sea, por ejemplo, si el mensaje habla de una vista en la pestaña correos, y dice que algo en la pestaña correos se ve mal o que derechamente hay un mensaje de error en alguna vista, me gustaría que la primera respuesta de Claude contenga una captura de pantalla de ese mismo lugar, idealmente mostrando el mismo error. Por eso es vital que si el doctor dice que viendo la ficha de pacientes tuvo un error, Claude tendría que entrar a la consola de superadministrador, operar esa clínica con el rol del doctor que dio el problema y ahí tomar una captura de pantalla y responder con eso y el problema identificado y decir que va a empezar a resolverlo. Y después, cuando termine, su respuesta de finalización debería incluir una captura de pantalla de la interfaz mostrando la diferencia versus la primera captura que mandó. Así que también debe quedar tipificado en el repositorio y debes hacerlo de la manera más eficiente posible.»
**Decisión:** (1) La primera respuesta ya la publica la sesión con `team reply`, después de mirar, no el trabajador antes de que mire. Con `--captures` esa misma llamada sube las capturas como adjuntos de la respuesta («Antes»). No hay un paso nuevo ni una segunda respuesta. (2) La respuesta final la publica el trabajador (o la entrega, UD-263) desde la salida estructurada, que gana el campo opcional `captures`. El trabajador guarda los archivos en el volumen mientras existe el directorio del trabajo. La respuesta final adjunta la «Antes» (la misma imagen del volumen, sin copia) y la «Después». El nombre del adjunto lleva el rótulo: «Antes - <alt>» o «Después - <alt>». (3) Cada captura declara `path`, `alt` (una línea), `masked` (true o false), `place` (la ruta o el menú de la vista) y `as` (clínica y rol con que se miró). Las imágenes no pasan por el modelo: la sesión sólo escribe esa lista. (4) La plataforma no lee imágenes. Valida la forma: PNG, JPEG o WebP por sus primeros bytes y archivo dentro de `$TEAM_CAPTURES_DIR`. Admite hasta `EXECUTE_CAPTURES_MAX` por respuesta (3, declarado) y el tope de imagen de cualquier adjunto, `UPLOAD_MAX_IMAGE_BYTES` (7 MB, MASTER-SPEC §7.8). Lo que no cumple se deja fuera, con un evento `captures.rejected` y su motivo en el span `execute`, y la respuesta sale igual. (5) Privacidad: con `masked: false` la captura se adjunta sólo si la zona declarada es `EXECUTE_CAPTURES_OPEN_ZONE` («ninguna»). La zona es el campo `zone` de la salida (plantilla `error-directo`), o `--zone` en la primera respuesta; sin zona declarada se trata como sensible. «Datos de personas» es una zona distinta de «ninguna», así que el caso «el tipo es de datos de personas» queda cubierto sin que la plataforma conozca tipos. `masked: true` va con cualquier zona: lo declara la herramienta que ocultó los datos.
**Consecuencias:** Sin migración ni cambio de la API: los adjuntos de respuesta (UD-016, `POST /messages/:id/replies` multipart) ya existían. El par queda navegable en el hilo (`GET /messages/:id`, `replies[].attachments`) y el panel los muestra con su nombre bajo la imagen, sin cambio de interfaz. Con el ejecutor `machine` el directorio `captures/` de la máquina debe copiarlo `EXECUTE_MACHINE_COLLECT` a `{workdir}/captures` antes de destruirla; sin esa copia la captura final se deja fuera. La herramienta que toma la captura y la cuenta de sólo lectura son del anfitrión. MASTER-SPEC §7.5 «Capturas», `docs/INSTALACION.md` («Capturas en las respuestas»), regla 13 de `docs/RULES.md`, `src/contracts.md`.
**Condiciones de reversión:** Las fija Martín.

## [UD-269] Lo que Claude no puede decidir llega a una persona, y lo ya decidido no se le devuelve

**Fecha:** 2026-10-23
**Contexto:** Martín, textual: «que no vayamos a perder el tiempo si es que algo se le asigna a Claude que en realidad debería haberse asignado a un humano … si la sesión de Claude encuentra que algo merece la atención de un miembro como Martín o derechamente la plantilla le dice cuál es el tipo de cosas que tiene que reportar a un humano entonces debe haber una forma coherente y natural para que esto ocurra y que no sea posible que algo deba realmente ser leído por un humano como por ejemplo una decisión de producto importante que quede enterrada en la ejecución de las cosas delegadas automáticamente». Y después: «hay que tener cuidado de que no todo se me devuelva a mí … el criterio de delegación … está hecho para evitar que se me devuelvan decisiones que yo ya había tomado … Evitar devolverle decisiones a miembros cuando la decisión ya existe tipificada en el repositorio o en la intención o dentro de las reglas de Claude o dentro de la plantilla misma que está ocupando». Medido leyendo el código el 2026-10-23: con `needs_decision` o con la entrega retenida (UD-266) el único efecto era una respuesta `answer`, que dejaba el mensaje en `answered` y asignado sólo al agente; ninguna persona lo tenía en su bandeja y el resumen «mine» sólo suma lo asignado.
**Decisión:** (1) Traspaso. Con `outcome: needs_decision`, con `outcome: not_mine` (valor nuevo del contrato) o con la entrega retenida (código 76), el sistema hace en una sola transacción: la respuesta de Claude queda como `clarification` (la plataforma no tiene un tipo `question`), el agente sale de los asignados, entra quien decide en el área y el mensaje queda `open`. Se registra `message.escalate` en la auditoría y la persona recibe el aviso de asignación. La decisión sale sólo del campo estructurado o del código de salida, nunca del texto (RULES 4). (2) Quién decide. El área gana `escalation_member_id`, editable por el Editor en la vista del área («Responsable de decisiones»). Sólo puede ser una persona activa. Sin valor, o si deja de ser una persona activa, decide el primer Editor activo; sin Editor, el emisor del mensaje. (3) Devolver antes de empezar. Si al examinar la situación el pedido no le corresponde según su perfil y la plantilla, la sesión termina de inmediato en `not_mine` con el motivo en una línea y sin enviar «Recibido». (4) Filtro antes de devolver. Antes de terminar en `needs_decision` o `not_mine`, la sesión descarta en este orden: decisión ya registrada (decisiones, reglas, especificación y CLAUDE.md del anfitrión), cobertura por su perfil, sus reglas o la plantilla, intención ya dicha en el mensaje, vía técnica sin una persona, y error barato y reversible. Si una de las cuatro primeras contesta, es una restricción que se cumple; si la quinta, decide, actúa e informa. Sólo cruza lo que sobrevive, reducido a la parte de la persona. (5) El contrato lo hace cumplir. `needs_decision` exige `decision_check` con `searched` (fuentes con su ruta, al menos una), `why_not_covered`, `recommendation` (una opción), `if_wrong` y `question` (una línea). Sin el bloque válido el trabajo falla con `invalid_output` y no llega a nadie. La persona lee `question`, `recommendation` e `if_wrong`, y las fuentes revisadas debajo. (6) Invariante. `GET /health` cuenta los mensajes cuyo último resultado del agente es `needs_decision`, `not_mine` o entrega retenida, que no están cerrados y que ninguna persona tiene asignados, salvo los que tienen un trabajo en cola o en curso. Debe dar cero; con más, la sonda dice `degraded` y el detalle del Editor lista los mensajes. (7) Lo ya enterrado. La migración 0021 aplica (1) a los mensajes que estaban en esa situación y lo registra en la auditoría. (8) Medida. La vista del área muestra los traspasos de los últimos 7 días, en total y por persona.
**Consecuencias:** Migración `0021_escalation_to_person` (columna `areas.escalation_member_id` y traspaso de lo enterrado). La API del área gana `escalation_member_id` (el efectivo, como texto) y `handoffs`, y `PATCH /areas/:id` acepta `escalation_member_id` (`null` vuelve al primer Editor). `packages/client` regenerado. La plantilla `error-directo` cambia: lo respaldado por una decisión registrada se contesta al autor citándola y termina en `investigated`, sin traspaso (antes terminaba en `needs_decision`). Parte estable del prompt: de 3.827 a 4.592 caracteres (+765, medido el 2026-10-23 con plantilla vacía y sin instrucciones del anfitrión). Quien decide puede ser también el autor del mensaje (el caso de Martín): `author_cannot_reply` (MASTER-SPEC §4.8) deja de aplicarse sólo mientras el autor tenga asignado el mensaje y la última respuesta sea una `clarification` de un agente, que es lo que deja el traspaso. Al responder, la pregunta deja de estar pendiente y la regla vuelve a regir. Un `needs_decision` que no pasa el filtro de forma no se reintenta distinto de hoy: sigue la regla de `invalid_output`.
**Condiciones de reversión:** Las fija Martín.

## [UD-270] Las capturas pueden mostrar datos de personas: la máscara es una perilla del anfitrión

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «estoy viendo que se están como anonimizando las fotos y los datos de los pacientes y yo nunca pedí eso. Nosotros seguimos dentro del contexto de [el anfitrión]. Es seguro y esperado ver los nombres de profesionales, pacientes, datos confidenciales, etc. en esas capturas.» UD-268 ataba dos cosas distintas a la misma variable: la zona que tocó el cambio y si la foto puede mostrar datos de personas.
**Decisión:** Variable nueva del anfitrión `EXECUTE_CAPTURES_UNMASKED`, con omisión `denied` (el repositorio es público: por omisión se exige máscara, como en UD-268). Con `allowed` o `1`, una captura con `masked: false` se adjunta sin mirar la zona. Llega igual al trabajador (respuesta final y entrega) y a `team reply` (la sesión recibe `TEAM_CAPTURES_UNMASKED`). `masked` se sigue declarando y mostrando tal cual, y la zona sigue decidiendo lo demás que decidía.
**Consecuencias:** Enmienda el punto (5) de UD-268. Sin migración ni cambio de la API. El anfitrión que quiera ver datos reales en las capturas enciende la variable; sin ella nada cambia.
**Condiciones de reversión:** Las fija Martín.

## [UD-271] Claude cierra el mensaje cuando corresponde

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «quiero que por defecto, claude pueda decidir cerrar un mensaje si corresponde. primero hay que definir "qué corresponde".» Hasta ahora la sesión tenía prohibido cerrar y una persona cerraba después de leer. La definición de «corresponde» la fijó quien coordina el trabajo.
**Decisión:** (1) Claude cierra el mensaje tras su respuesta final sólo si se cumplen las tres: a) lo pedido quedó hecho y comprobado: la entrega terminó con código 0, o el resultado no necesitaba cambio (`outcome: investigated`, sin entrega) y la respuesta lo muestra con evidencia; b) no le deja nada al emisor: ninguna pregunta abierta, decisión pendiente ni advertencia que pida una elección; c) si la primera respuesta llevó una captura «Antes», la respuesta final lleva al menos un «Después». (2) Nunca cierra con `needs_decision`, `not_mine` ni `blocked`, con la entrega retenida (código 76), fallida o agotada, con el mensaje editado durante la corrida, ni si una persona respondió en el hilo después de la primera respuesta del agente en esa corrida. (3) La condición b la juzga el modelo: la salida estructurada gana `close` (booleano) y `close_reason` (una línea en el idioma de respuesta), y la instrucción dice que en la duda `close` es falso. Las condiciones a y c y las exclusiones las hace cumplir el sistema (`src/execute/auto-close.js`, `deliver.js`, `handler.js`): si el modelo pide cerrar y no se cumplen, no se cierra. (4) Al cerrar, en la misma transacción que publica la respuesta final, se llama `closeMessage` (la función de `POST /api/messages/:id/close`, con la auditoría `message.close` y el miembro agente como autor) y la respuesta agrega una línea «Cerrado: <motivo>» («Closed: …» en inglés). (5) Perilla del anfitrión `EXECUTE_AUTO_CLOSE`, con omisión `on` («por defecto»); `off` o `0` no cierra nunca y la sesión no recibe los campos.
**Consecuencias:** Sin migración ni cambio de la API. Cierra con `message.close` en la auditoría, igual que una persona, y cualquiera lo reabre. MASTER-SPEC §7.5 («Cierre por Claude»), `docs/INSTALACION.md`, `.env.example`, `src/contracts.md` si lista la salida, CHANGELOG. Enmienda la línea del prompt que prohibía cerrar.
**Condiciones de reversión:** Las fija Martín.
**Enmienda (UD-310, 2026-10-25):** la condición b ya no depende de que el modelo pida cerrar: lo terminado se cierra solo.

## [UD-272] Reenviar un mensaje a un miembro, con motivo, y que Claude investigue sin cerrar

**Fecha:** 2026-10-24
**Contexto:** Martín, textual (dictado por voz): «si bien nosotros estamos haciendo que Claude no resuelva algo que amerite decisiones mías, lo que está súper bien, sí creo que debería poder avanzar lo más que pueda sin tomar la decisión, en el sentido investigativo por lo menos. […] primero quiero que el sistema adecuadamente me lo clasifique a mí […] sin embargo me gustaría yo poder manualmente mandárselo a Claude ya por ejemplo que yo vea el tema abierto y haga clic en un botón como por ejemplo reenviar y que se despliegue algo con todos los usuarios que no son yo y que ahí aparezca Claude como usuario […] puede reenviarse a Claude con un clic y eso significa que si Claude recibe ese mensaje aun cuando Claude tenga entendido que es un mensaje que le reenvió otro miembro Claude debería saber hasta donde puede llegar con ese mensaje y hacer una especie de análisis de la situación con una recomendación concreta para mí respondiéndome eso en el mismo mensaje […] no se va a crear un mensaje nuevo sino que el mismo mensaje ahora va a tener como miembro extra a Claude. Eso significa que también va a gatillar la ejecución de Claude […] o yo se lo estoy reenviando con intención de que él lo resuelva o yo se lo estoy enviando con intención de que él investigue […] lo más elegante acá es poder enviárselo a un miembro pero con un motivo, teniendo que escribir sí o sí un comentario, y que ese comentario quede en el hilo de respuestas del mensaje. Esa respuesta tiene que ser especial, visualmente distinta, como un aviso de que se le reenvió el mensaje a alguien, en este caso «Reenviado a Claude», y con el comentario. […] y que Claude después no haya cambiado código sino que solamente me presente su investigación, y si es que yo le pedí un pdf entonces que me presente el pdf mismo como adjunto a su respuesta. No estoy esperando a que Claude cierre el mensaje si es que yo le pido que investigue algo.»
**Decisión:** (1) `POST /api/messages/:id/forward { member_id, comment }` (cualquier miembro). El mismo mensaje suma al destinatario entre sus asignados y el hilo gana una respuesta de tipo `forward`: autor quien reenvía, `forwarded_to` el destinatario y `body` el motivo. El motivo es obligatorio (400 `forward_comment_required`). El destinatario es un miembro activo, persona o agente, distinto de quien reenvía (400 `forward_to_self`, 400 `assignee_inactive`). Auditoría `message.forward`. (2) Un mensaje cerrado no se reenvía (409 `message_closed`, como `execute`): reabrirlo es decisión de una persona y no un efecto lateral. Un mensaje respondido vuelve a `open` para quien lo recibe, como en un traspaso (UD-269); un reenvío no cuenta como respuesta. (3) Con un agente como destinatario se encola su trabajo `execute` del mismo mensaje, con `forward: { reply_id, by }` en la carga; si el agente ya tiene uno en cola o corriendo, 409 `execute_busy` y no se escribe nada. (4) La sesión recibe el bloque `forwarded` (quién y el motivo) y el hilo con el aviso. Decide en el campo `mode` de la salida estructurada, `resolve` o `investigate`, a partir del motivo; el sistema lee el campo y nunca el texto. Con `investigate` el sistema no encola `deliver` aunque haya rama y no cierra el mensaje aunque la sesión lo pida; la sesión entrega en el mismo hilo lo que encontró, una recomendación concreta y las alternativas descartadas con su porqué. (5) Si el motivo pide un PDF, la sesión lo escribe en `$TEAM_ATTACHMENTS_DIR` y lo declara en `attachments` (`{ path, name }`); el sistema valida la forma (ruta dentro del directorio, primeros bytes `%PDF-`, tamaño hasta el tope de un documento subido y cantidad hasta `UPLOAD_MAX_FILES`) y lo adjunta a la respuesta final, también cuando pasa por `deliver`. Lo que no cumple se deja fuera y la respuesta lo dice con el motivo. Sólo PDF. (6) Sin reenvío, una sesión que termina en `needs_decision` avanza igual en lo investigativo: lo que le llega a la persona viene con el análisis, la recomendación y las alternativas descartadas, sin decidir. Enmienda la línea del prompt que decía «cut down to their part». (7) Panel: «Reenviar» en la ficha (acción secundaria) abre una ventana con el miembro (todos los activos menos quien reenvía, Claude incluido) y «Motivo»; el botón queda apagado y dice qué falta. En el hilo el reenvío es una franja con «Reenviado a <nombre>», quién lo reenvió y el motivo debajo, sin la forma de una respuesta.
**Consecuencias:** Migración `0022_reply_forward` (la tabla `replies` se reconstruye para aceptar el tipo y gana `forwarded_to`). `POST /api/messages/:id/replies` no acepta `forward`. Cliente: `useForward`, tipo `Reply.forwarded_to`, códigos de error regenerados. La máquina de trabajo declara `TEAM_ATTACHMENTS_DIR` en `run.sh`; la orden `EXECUTE_MACHINE_COLLECT` del anfitrión debe copiar también `attachments/` (INSTALACION). MASTER-SPEC §7.1, §7.5 y §7.8, `src/contracts.md`, CHANGELOG. No incluye la clasificación automática que Martín pide antes del botón (que el sistema marque lo que le corresponde a él): queda sin construir hasta que lo pida.
**Condiciones de reversión:** Las fija Martín.

## [UD-273] Inicio muestra lo de todo el equipo, y quien envía en nombre de otro ve su envío

**Estado:** vigente. Enmienda UD-210 (filtro por omisión de las dos listas de Inicio) y UD-255 (qué es «mío» en un envío).

**Fecha:** 2026-10-24

**Quién decide.** Martín, 2026-10-24, textual: «ademas recuerda que la seccion "Ultimos mensajes" es para TODOS los mensajes del equipo, igual que las respuestas!» y, al mandar un envío «como» otro miembro: «Subí un mensaje pero la UI NO ME AVISO que las cosas se están subiendo o procesando!!!!!!!».

**Decisión.**
1. «Últimos mensajes» y «Últimas respuestas» abren en «Todos»; «Para mí» queda como filtro.
2. La bandeja de envíos, la vista de un envío y su avance en vivo incluyen los que la persona mandó en nombre de otro (`sent_by_id`). Editar, cancelar y borrar siguen siendo del autor.

**Condición de reversión.** Que el equipo crezca hasta que «Todos» deje de caber en la pantalla de Inicio.
## [UD-274] Los pasos de una misma funcionalidad son un mensaje, no uno por paso

**Fecha:** 2026-10-24
**Contexto:** Un envío (input 43, 2026-10-24 13:45) describía una funcionalidad en seis pasos numerados (subir fotos clínicas a una ficha con un QR), con una captura de un chat y una nota de voz que explicaban la misma necesidad. El analizador publicó diez mensajes, uno por paso y por media oración. La causa estaba en las instrucciones: la regla 2g de la clasificación (H-3737) hacía grupo propio de cada sección o viñeta que el equipo «puede construir, corregir o aceptar por separado», «aunque todo el documento hable de una sola funcionalidad», y el chequeo de división trataba «dos cambios en pantallas o elementos distintos» como dos pedidos aunque fueran el mismo elemento numerado. Martín, textual: «10 mensajes separados!?!?!? debería ser uno a tres nomás».
**Decisión:** Un mensaje por cada pedido que se pueda decidir, asignar o entregar por separado (otra persona, otra área, otra pieza que tiene sentido sola). Los pasos, requisitos, criterios de aceptación o restricciones de UNA misma funcionalidad o de un mismo defecto van juntos en un solo mensaje, en su cuerpo y conservando la lista numerada como la escribió la persona. En la duda, menos mensajes. Se corrige en el contexto que recibe el modelo, no con reglas sobre el texto (MASTER-SPEC §4.2, regla 4 de `docs/RULES.md`). Cambian la regla 2i nueva y la 2g reescrita de la clasificación, la regla 2 del chequeo de división, las reglas 2 y de formato de la descomposición (`src/analyze/prompts-es.js`, `prompts-en.js`) y el método de `templates/feature.md`. Esto enmienda la regla 2g de H-3737 en lo que decía «aunque todo el documento hable de una sola funcionalidad» y la regla del chequeo que partía por pantalla o elemento.
**Consecuencias:** Una especificación con secciones que son piezas distintas (otra pantalla con sentido propio, otra fase) sigue saliendo en varios mensajes; los endpoints o secciones de una misma funcionalidad pasan a uno. Caso nuevo `bench/cases/10-funcionalidad-en-pasos`, con `max_messages: 3` en su `expected.json`: `bench/assert.mjs` lo aprueba con la cobertura completa y hasta tres mensajes, y lo reprueba con diez. Pruebas con proveedor falso fijan las reglas en los dos idiomas (`src/analyze/split-pass.test.js`). La medición con el modelo real sobre ese caso y sobre `02-docx-40-puntos` queda para quien coordina el despliegue.
**Condiciones de reversión:** Las fija Martín.

## [UD-275] El conducto de revisión: se revisa un cambio retenido sin salir de la plataforma

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «Pero ¿cómo voy a poder hacer la revisión sin salir de [la plataforma]?». Cuando la sesión `execute` termina con una zona sensible, la entrega queda retenida (UD-266) y una persona tiene que aprobarla; la API de entrega existía (`POST /api/messages/:id/deliver`, UD-263) pero el panel no tenía botón y la respuesta retenida no mostraba qué cambió. Después añadió, textual: «Un video demostrativo podría ayudar»; «Podríamos tener un conductor formalizado para hacer revisiones. Lo que sea más fácil, incluso puede ser la wea ya hecha con el gemelo digital levantado, o un video, o un informe, lo que salga más fácil y barato y me permita decir sí/no/comentario para reiterar»; «el video debe hacerse de forma rápida, eficiente, sin incurrir en costos adicionales, en resolución 16:9 y/o móvil según corresponda por lo que se esté haciendo, de modo que yo pueda hacer correcciones granulares y detalladas; investiga cómo hacerlo de la mejor manera»; y «Es prioritario que no haya fricción para usar esta plataforma, o sea, los textos no deben ser excesivamente largos, técnicos, usar jerga interna, etc.».
**Decisión:**
1. **El conducto es la misma revisión en el mensaje**, sin levantar entornos (costo adicional cero): resumen para jefe de proyecto, capturas y video con el rótulo «Propuesta», y tres acciones: «Entregar» (primaria, Editor), «Pedir cambios» y «Descartar».
2. **API.** `GET /api/messages/:id` suma `pending_delivery: { branch, held_reason, job_id, agent_id, delivering_job_id } | null`. Existe mientras la última corrida del mensaje terminó retenida, nadie la descartó y ninguna sesión trabaja el mensaje; `delivering_job_id` es la entrega en cola o corriendo tras aprobarla (el bloque muestra su avance por el flujo de eventos y desaparece al llegar a producción). `POST /api/messages/:id/discard-delivery { reason }` (Editor, motivo obligatorio, auditada como `message.delivery_discard`): la rama no se entrega nunca (`delivery_discarded` en `POST /deliver`), el hilo gana «Descartado por <persona>: <motivo>» y el mensaje queda abierto. Migración `0024_delivery_review` (`execute_runs.delivery_hold_reason`, `delivery_discarded_at`, `delivery_discarded_by`).
3. **Entregar tras revisar no vuelve a retener.** La orden de entrega recibe `TEAM_REVIEWED_BY` (el miembro que la lanzó a mano); un anfitrión que retiene por zona no retiene cuando viene fijada, y un 76 con revisión cuenta como falla de la orden. La respuesta final sigue el camino normal, con el «Después» tomado de producción.
4. **Pedir cambios** lleva el foco al formulario de respuesta y nombra a quién dirigirse. Que una respuesta con mención vuelva a asignar a Claude y lance otra corrida sobre la misma rama es el trabajo de las menciones: el handler descarta una corrida cuando el agente ya no es asignado del mensaje.
5. **Respuesta retenida.** Se escribe para un jefe de proyecto (qué cambia para quien usa el producto, riesgos, qué mirar, sin rutas ni nombres de archivo; instrucción en el prompt) y lleva «Cambio listo para revisar: <motivo>». Las capturas de la sesión se adjuntan con el rótulo «Propuesta» (`Proposal` en inglés) y no «Después».
6. **El recorrido en video** lo graba `team walkthrough` en la misma sesión y máquina, con el navegador que ya existe. Perfiles: 1280x720 (escritorio), 390x844 (teléfono) o ambos; el tamaño del video es el del viewport (sin barras). WebM VP8 sin audio. El recorrido va en pasos numerados: antes de cada paso se dibuja un rótulo fijo «Paso N · …» y se marca el elemento que se toca; escribe `steps.json` (segundo de cada paso) y `captures.json` (el video «Recorrido · 0:12» y una captura por paso, `alt` «0:04 · Paso 2 · …»), para que se corrija citando «paso 2» o el segundo. La salida estructurada acepta un video entre `captures` (WebM o MP4 por sus primeros bytes, hasta `UPLOAD_MAX_VIDEO_BYTES`, uno por respuesta y fuera del tope de `EXECUTE_CAPTURES_MAX`). Sin navegador o con una vista que no arma, el comando lo dice en una línea y quedan las capturas de los pasos que corrieron.
7. **Lenguaje.** Rótulos de una a tres palabras («Revisión», «Entregar», «Pedir cambios», «Descartar»), un motivo de una línea, sin «rama», «zona» ni «trabajo» a la vista. El título del bloque es «Revisión» y no «Revisión pendiente» porque UD-041 retiró «pendiente» como estado.
**Investigación (2026-10-24, fuentes consultadas ese día):** la documentación de Playwright dice que el tamaño del video «defaults to the viewport size scaled down to fit 800x800», que se fija con `recordVideo.size` junto al viewport y que el archivo se guarda al cerrar el contexto (playwright.dev/docs/videos); de ahí el tamaño igual al viewport y el costo cero. Jam graba la pantalla con registros de consola y de red, y desde el 2026-03-05 expone el video y las acciones del usuario a agentes por MCP (resultados de búsqueda, sin abrir la página del proveedor); de ahí que la revisión lleve pasos citables. No se encontró documentación de Loom ni de Chromatic sobre grabación de pasos, y no se usa como fuente.
**Consecuencias:** Panel: bloque «Revisión» en la ficha del mensaje (`ReviewPending`). Cliente: `PendingDelivery`, `useDeliver`, `useDiscardDelivery`, códigos de error regenerados. `scripts/walkthrough.mjs` y `team walkthrough`. Captura con rótulo `Propuesta`/`Proposal` y tipo `video`.
**Condiciones de reversión:** Las fija Martín.

## [UD-276] La respuesta final de Claude se escribe para un jefe de proyecto

**Fecha:** 2026-10-24
**Contexto:** Martín, 2026-10-24, textual: «las respuestas finales de Claude contienen muchos datos innecesarios, como nombres de ruta, algunos aspectos demasiado técnicos, etc. La idea es que Claude responda muy concretamente como si se le estuviera hablando a un project manager.» En la respuesta final del mensaje 115 (producción), después de dos párrafos claros, el hilo mostraba «Resultado: investigated», «Zona tocada», «Causa» con nombres de componentes, «Verificación» con un comando, «Rama» y «Archivos tocados» con una lista de rutas. La causa estaba en `replyBody`: concatenaba bajo el resumen todos los campos de la salida estructurada de la plantilla.
**Decisión:** (1) La respuesta que ve la persona es el `summary` más las líneas del sistema que le sirven: las capturas «Antes» y «Después» con su lugar, «Cerrado: …» si se cerró, «Ya está en producción» o el motivo de la retención o de la falla. Ningún campo técnico entra al texto: resultado, zona, causa técnica, verificación, rama, archivos y referencia de la entrega. (2) Esos campos se guardan con la ejecución (`execute_runs.detail_json`, migración 0023, con el rótulo de la plantilla) y la ficha los muestra en «Detalle técnico», plegado por omisión, junto a «Tiempos». `GET /api/messages/:id/timing` los devuelve en `detail`. El resultado sigue en `execute_runs.outcome` y en el traspaso (UD-269), que leen el campo y nunca el texto. (3) La instrucción del `summary` pide escribir como a un jefe de proyecto: qué pasó, qué cambia para quien usa el producto y la decisión que le queda, si hay; sin rutas, nombres de archivo, comandos, nombres de componentes ni jerga, y con una cifra sólo si le importa a la persona. Conserva el idioma y el perfil de quien envió.
**Consecuencias:** El aviso de una falla ya no termina en «Resultado: blocked». Las pruebas de la respuesta final de una entrega, de una retenida y de una investigación fijan que no aparece ningún rótulo técnico ni el bloque de archivos (`src/execute/respuesta-para-pm.test.js`, `src/execute/execute.test.js`). Las ejecuciones anteriores a la migración no tienen detalle y la ficha dice «Sin detalle».
**Condiciones de reversión:** Las fija Martín.

## [UD-278] Mencionar a un miembro en una respuesta; mencionar a Claude lo invoca

**Fecha:** 2026-10-24
**Contexto:** Martín, textual (dictado): «ahora Claude hizo el informe en PDF y su opción recomendada es lo que yo quiero. Entonces lo que me gustaría es que yo pueda responder al hilo […] y poder mencionar a una persona. Que repliquemos la mecánica de mención que tiene GitHub Issues y otras plataformas, en las cuales es posible mencionar a alguien escribiendo el arroba y ahí aparecen los nombres de los usuarios que están registrados y que no son uno mismo. Y cuando uno hace clic en uno de esos usuarios queda como mencionado. Y eso debe gatillar que llegue notificación a ese usuario y que ese usuario ahora también tiene ese mensaje o hilo asociado a su cuenta. Y además quiero que si se menciona a Claude […] esto gatille un nuevo trabajo de Claude que atienda lo que sea que se le haya dicho dentro del mensaje. Tiene que recibir como contexto todo el hilo de mensajes y los adjuntos de los mensajes. […] la necesidad subyacente es poder invocar a Claude cuando yo quiera que algo que se mencionó en un hilo lo atienda parcial o totalmente. Incluso si yo con otro miembro estamos resolviendo un problema que no involucra a Claude y yo lo menciono, ahora Claude también entró a esta conversación y tiene que hacer lo que se le pide o responder lo que se le pide. […] la idea es tener a Claude funcionando como otro componente más. Y que obviamente después de esa mención esté obligado a responder con algo. Incluso puede responder en dos partes.» Y: «no tomes mis palabras como la última palabra sobre cómo tiene que hacerse esto: entiende la necesidad subyacente; investiga cómo se hace esto normalmente».
**Investigación (consultada el 2026-10-24):** GitHub, «Basic writing and formatting syntax»: al escribir «@» se abre una lista que se filtra al escribir, se mueve con las flechas y se completa con Tab o Enter; las sugerencias son los colaboradores y los participantes del hilo; la mención avisa a la persona y la trae a la conversación (también al editar un comentario para agregarla). Linear, «Notifications»: ser mencionado en un comentario suscribe a esa persona al hilo y le genera un aviso; el autocompletado coincide con el texto hasta el cursor. Se toma: la lista con filtro y teclado, la mención como elección de la lista y no como nombre leído del texto, el aviso y la pertenencia al hilo, y el aviso al agregar una mención editando. No se toma la mención de equipos ni la lectura de nombres en el texto (RULES 4).
**Decisión:** (1) `POST /api/messages/:id/replies` acepta `mention_ids`: los miembros elegidos en la lista, validados en el servidor (existen, están activos, no son quien escribe: 404, 400 `assignee_inactive`, 400 `mention_self`). El servidor nunca lee nombres del texto. Un agente no menciona a otro agente (400 `mention_loop`). (2) En la misma transacción, cada mencionado entra a los asignados; una persona recibe un aviso por el flujo de eventos que ya alimenta la campana (`reason: 'mention'`, «Mención de <nombre>»); queda `message.mention` en la auditoría, una fila por mención. (3) Un agente mencionado recibe su trabajo `execute` sobre el mismo mensaje con `mention: { reply_id, by }` en la carga. Si ya trabaja ese mensaje, o hay una entrega en curso, la mención queda pendiente (`reply_mentions.pending`) y el fin de ese trabajo la atiende en una corrida siguiente, una por mensaje y agente, con la última respuesta como `reply_id` y las anteriores en `earlier`; no se pierde. Una mención cuya respuesta se borró, cuyo mensaje se cerró o cuyo agente se desactivó deja de estar pendiente. (4) La sesión recibe el bloque `mentioned`: quién la invocó, qué respuesta, y el hilo completo en orden con autor, tipo y hora, la respuesta que la menciona marcada, y los adjuntos del mensaje y de cada respuesta como archivos en `$TEAM_THREAD_DIR` (las imágenes para abrirlas; los documentos con su nombre y, en los del mensaje, el texto extraído al lado). Decide con `mode` (`resolve` o `investigate`) y puede adjuntar PDF como con un reenvío; el sistema no lee el texto. Una mención nunca cierra el mensaje: `close` se ignora. (5) Garantía de respuesta: tras una mención a un agente el hilo siempre recibe una respuesta suya: la primera de la sesión, la final, o, si el trabajo falla, se agota o no puede empezar, una línea del sistema a su nombre con el motivo en palabras simples («Claude no pudo responder: se alcanzó el tope de gasto.»). Esa línea también es lo que lee quien decide en el área cuando el fallo le traspasa el mensaje (UD-269). Si el mensaje se cerró entretanto no hay a quién responder. (6) El emisor de un mensaje no lo responde (§4.8), pero puede escribir en su hilo para llamar a alguien: una respuesta suya con al menos una mención se acepta, no cuenta como respuesta y el mensaje queda `open`; sin mención sigue siendo 403 `author_cannot_reply`. Un mensaje cerrado sigue sin aceptar respuestas. (7) Panel: «@» en el formulario de respuesta abre la lista de los miembros activos menos uno mismo, filtrada por lo escrito, con flechas, Enter o Tab y Escape, y con el dedo en el teléfono; elegir deja «@Nombre» como texto y el miembro en la lista que se envía; borrar el texto borra la mención. En el hilo la mención se dibuja resaltada. El emisor ve el mismo formulario y el botón queda apagado con «Falta mencionar a alguien». (8) Sin construir: «@» en «Nuevo mensaje» de Inicio. Un envío pasa por el análisis, que decide los mensajes y sus destinatarios; una mención ahí exigiría guardar las menciones en el envío y aplicarlas al publicar cada mensaje, y queda fuera de este cambio.
**Consecuencias:** Migración `0025_reply_mentions`. Reply gana `mentions`. Cliente: `mention_ids` en `NewReply`, `Notice.reason`, códigos `mention_self`, `mention_loop`, `mention_invalid`. `GET /health` y la bandeja no cambian. MASTER-SPEC §7.1 y §7.5, `src/contracts.md`, CHANGELOG. Reutiliza `enqueueExecute`, `mode` y `attachments` de UD-272. Enmienda §4.8 (el emisor y la mención).
**Condiciones de reversión:** Las fija Martín.

## [UD-279] Responder hablando y editar la respuesta con sus adjuntos y menciones

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «debe poder responderse a e incluso editar un mensaje existente, o responder a un hilo, usando los mismos adjuntos que ya se admiten incluyendo los audios, fotos, etc. Así yo podría responder a un mensaje simplemente hablando […] abrir […] el hilo que me importa, y responderle a Claude o a una persona con el botón de micrófono». Medido el 2026-10-24: el formulario de respuesta aceptaba audio y video, pero sólo los adjuntos de un envío pasaban por la lectura del habla.
**Decisión:** (1) Un audio o video adjunto a una respuesta, al escribirla o al agregarlo después, se transcribe con la misma extracción, el mismo proveedor y el mismo presupuesto de audio por hora que un envío: un trabajo `extract` con `reply_attachment_id` y el `message_id`, encolado en la transacción de la respuesta sin retrasarla. El texto queda en la fila del adjunto (migración 0026) y `GET /api/replies/attachments/:id/transcript` lo entrega con el mismo acceso que el archivo; el adjunto lleva `extracted`. Imágenes y documentos de una respuesta sólo se guardan. (2) Un agente mencionado en una respuesta con audio no empieza hasta que termine la lectura del habla del hilo: el fin del trabajo `extract` (bien o mal) libera las menciones pendientes, por evento y sin sondeo. Si la lectura falla, empieza igual y el hilo no trae ese texto. La transcripción entra al contexto del hilo como texto, bajo la respuesta que la trae, y las imágenes como archivos. (3) Una respuesta puede ir sin texto si trae un adjunto, también con una mención. (4) `PATCH /api/messages/:id/replies/:replyId` ya no exige `body`: acepta `remove_attachment_ids` (quita adjuntos; los archivos que nada más referencia se liberan) y `mention_ids` (suma menciones; sólo el mencionado nuevo recibe asignación, aviso e invocación, los que ya estaban se ignoran). `POST /api/messages/:id/replies/:replyId/attachments` agrega archivos y enlaces, sólo su autor, con `version`. Cada cambio real sube `version` y deja `reply.edit` con `fields`. Los adjuntos de un mensaje ya se agregaban y quitaban (UD-071). (5) Panel: bajo el audio o video de una respuesta se lee la transcripción, plegada con «Ver más» cuando no cabe; el autor ve en su respuesta «+ Adjunto», una cruz por archivo y «+ Mención», que deja también «@Nombre» al final del texto. La galería abre la transcripción de un audio de respuesta como la de un mensaje. Los eventos `done` de un trabajo con `message_id` refrescan el hilo.
**Consecuencias:** Migración `0026_reply_attachment_text`. `jobs` no cambia (el trabajo `extract` ya admitía `message_id`). Cliente: `replies.edit` con `mention_ids` y `remove_attachment_ids`, `replies.addAttachments`, `replies.transcript`, `DoneEvent.message_id`. MASTER-SPEC §7.1 y §7.4, `src/contracts.md`.

## [UD-277] Sin fricción: textos cortos, llanos y sin jerga interna

**Fecha:** 2026-10-24
**Contexto:** Martín, 2026-10-24, textual: «Es prioritario que no haya fricción para usar esta plataforma, o sea, los textos no deben ser excesivamente largos, técnicos, usar jerga interna, etc.».
**Decisión:** (1) Los textos de la interfaz son rótulos de una a tres palabras, sin ayuda por omisión; un error es una oración que dice qué pasó y qué hacer. No usan términos internos (cola, trabajo, propuesta, trozo, analizador externo) ni segunda persona. (2) Lo que escriben los modelos para una persona (cuerpo de los mensajes del análisis, primera respuesta y respuesta final de Claude) es corto y llano para alguien no técnico: qué se pide y para qué, con la lista de requisitos si la hay, sin rutas ni nombres de componentes. Se pide en la instrucción al modelo; ningún filtro reescribe su salida.
**Consecuencias:** El catálogo del panel pasa «En cola» a «En espera», «Propuesta» a «Borrador» y «Trabajos» a «Tareas», y acorta los errores de análisis. Un texto que el dueño pidió textual no se toca.
**Condiciones de reversión:** Las fija Martín.

## [UD-280] La revisión se hace respondiendo, no con botones (enmienda UD-275)

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «lo de sí/no/comentario no era para que literalmente implementaras botones así, un miembro debe ESCRIBIR lo que quiere, sí/no/comentario no cubre el universo de posibilidades de respuesta». UD-275 dejó en la ficha tres botones («Entregar», «Pedir cambios», «Descartar»).
**Decisión:**
1. **Sin acciones en la ficha.** Mientras un cambio espera revisión, la ficha muestra una línea de estado, «Cambio listo para revisar», sin botones ni diálogos. Con una entrega en curso muestra su avance.
2. **La revisión es una respuesta en el hilo**, escrita o hablada (UD-279), que menciona a Claude o al agente que hizo el cambio (UD-278). La persona escribe lo que quiere con sus palabras: entregar, descartar, cambiar algo, preguntar, pedir otra vista.
3. **El modelo interpreta y el sistema ejecuta.** La sesión invocada recibe el estado de la revisión (rama, motivo de la retención, si quien la llamó es Editor y quiénes lo son) y el hilo completo con el material que dejó. Devuelve el campo `review`: `approve`, `discard`, `iterate` o `none`, y `review_reason` con el motivo de un descarte. El sistema lee el campo, nunca el texto.
4. **Reglas del sistema.** `approve`: encola la entrega con `TEAM_REVIEWED_BY` = quien pidió, sólo si es un Editor; si no, la respuesta es una línea con quiénes pueden aprobar y no se entrega. `discard`: mismo requisito; marca el cambio descartado con el motivo que el modelo resumió y deja el mensaje abierto. `iterate`: la sesión trabaja la misma rama y vuelve a dejar el material de revisión. `none`: responde sin tocar la revisión. Con `approve`, `discard` y `none` la sesión no cambia código y la corrida no reemplaza a la que retuvo el cambio (`execute_runs.review_answered`). La entrega aprobada así termina con la respuesta final normal.
5. **La API no cambia.** `POST /messages/:id/deliver` y `POST /messages/:id/discard-delivery` siguen para el sistema; la ficha ya no las llama.
**Consecuencias:** Migración `0027_review_answered`. `ReviewPending` queda en una línea. Se retiran los rótulos «Entregar», «Pedir cambios» y «Descartar» del catálogo. `src/execute/approve.js` es la regla de entrega compartida por la ruta y por la sesión.
**Condiciones de reversión:** Las fija Martín.

## [UD-281] El Editor edita el perfil de un agente (enmienda UD-023)

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «Cuando yo cambie manualmente las áreas, descripciones de área, plantillas de área, y perfiles…». UD-023 deja que cada miembro edite sólo su propio perfil; el de un agente (Claude) no lo usa la pantalla, así que nadie podía cambiarlo.
**Decisión:** El Editor edita el perfil de un miembro de tipo agente con `PATCH /members/:id` (campo `profile`), con auditoría `member.update`. La pantalla Equipo se lo muestra editable en el lugar, con el mismo control del perfil propio. El perfil de una persona sigue siendo suyo: `PATCH /members/:id` con `profile` sobre una persona responde 400 `validation`.
**Consecuencias:** Sin migración. `PATCH /members/:id` acepta `profile`; MASTER-SPEC §7.1 y el glosario de Miembro se actualizan.
**Condiciones de reversión:** Las fija Martín.

## [UD-282] Reintentar una sesión de Claude que falló

**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «Debe haber un botón "reintentar" en team platform para estos casos, obviamente en una ubicación coherente y solo visible cuando haya algo reintentable». Cuando una sesión falla por un límite o un servicio (`execute_max_turns`, `execute_timeout`, `execute_budget`, `execute_no_result`, `machine_create_failed`, `execute_api_error`, `lease_expired`), el hilo dice «Claude no pudo responder: …» y no había forma de lanzarla otra vez.
**Decisión:** (1) El aviso de una sesión fallida lleva el trabajo que falló y su código (`replies.failed_job_id`, `replies.failed_code`). (2) `POST /api/messages/:id/replies/:replyId/retry` (cualquier miembro, el mismo permiso que mencionar al agente) encola un `execute` nuevo con el mismo origen: el mismo mensaje y agente y la misma carga (`mention`, `forward`, la entrega que lo originó), de modo que la sesión lee el mismo hilo, los mismos adjuntos y las mismas notas de voz. `requested_by` es quien reintentó; el agente vuelve a los asignados, como con una mención. Auditoría `message.execute_retry` con `reply_id`, `failed_job_id` y `job_id`. (3) El servidor decide cuándo hay algo reintentable y lo dice en `retryable` de cada respuesta: el trabajo fallido es el último `execute` del mensaje, ningún `execute` ni `deliver` del mensaje está en cola o corriendo, la causa es un límite o un servicio (no `invalid_output` ni una configuración del agente o del anfitrión), el mensaje sigue abierto, el agente está activo y el tope de gasto de hoy no se agotó. Fuera de eso la ruta responde 409 `not_a_failure`, `not_retryable`, `retry_stale`, `execute_busy`, `budget_spent`, `message_closed` o `not_an_agent`, y no se encola nada: un segundo clic no duplica. (4) Panel: «Reintentar» (acción secundaria del kit) bajo el aviso en el hilo, sólo con `retryable`; al encolarse el trabajo el botón desaparece porque el hilo ya muestra el avance.
**Consecuencias:** Migración `0028_reply_failed_job`. `Reply.retryable`, `client.messages.retry`, `useRetryExecute`. MASTER-SPEC §7.1 y §7.5, `src/contracts.md`, CHANGELOG. Reutiliza `enqueueExecute`.
**Condiciones de reversión:** Las fija Martín.

## [UD-283] Sin tope de pasos: sólo los topes de gasto
**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «No quiero tope de pasos mejor, solo tope de gasto». El tope de 60 pasos cortó una implementación a los 105 pasos y el de 200 dejó otra al 93 % mientras levantaba el sistema para grabar el video.
**Decisión:** `EXECUTE_MAX_TURNS=0` significa sin tope de pasos: la invocación no lleva `--max-turns` y gobiernan `--max-budget-usd` por mensaje y el tope diario. Sin tope de pasos, el avance del trabajo es la parte gastada de `--max-budget-usd`, calculada con el uso de cada mensaje del flujo y los precios de `src/telemetry/pricing.js`.
**Consecuencias:** `src/config.js` admite 0; `claudeArgs` omite `--max-turns`; `createStreamReader` recibe `budgetUsd`. Prueba: `src/execute/sin-tope-de-pasos.test.js`.
**Condiciones de reversión:** Las fija Martín.

## [UD-284] Cualquier persona del equipo aprueba o descarta un cambio retenido
**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «de dónde salió eso de que solo un editor puede hacerlo?? Los editores solo cambian textos configurados». UD-280 limitaba aprobar o descartar por respuesta al rol Editor, sin decisión suya que lo pidiera.
**Decisión:** Aprueba o descarta, escribiéndolo en el hilo y mencionando al agente, cualquier miembro activo de tipo persona. Enmienda UD-280 en ese punto.
**Consecuencias:** `handler.js` usa `byPerson`; el contexto de la mención lo dice; `review-reply.test.js` prueba que un miembro sin rol Editor aprueba.
**Condiciones de reversión:** Las fija Martín.

## [UD-285] Una mención que llega mientras Claude trabaja le llega a esa misma sesión
**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «me gustaría poder mencionar a Claude para que reciba un mensaje mientras trabaja, en caso de que se me ocurra una corrección». Una mención a un agente que ya trabaja el mensaje quedaba pendiente y abría otro trabajo al terminar el primero (UD-278).
**Decisión:** (1) La invocación de `claude -p` declara con `--settings` un gancho `PostToolBatch` cuyo comando es `team mentions`. Claude Code lo corre «después de cada tanda de llamadas a herramientas, antes de la siguiente llamada al modelo» y lee `hookSpecificOutput.additionalContext` de su salida como recordatorio de sistema (code.claude.com/docs/en/hooks, leído el 2026-10-24); corre en el evento de cada paso, nunca por reloj. (2) `team mentions` llama a `POST /api/jobs/:id/mentions/take` (sólo el agente del trabajo, con el trabajo corriendo): devuelve las menciones pendientes de ese agente en ese mensaje y las marca en la misma transacción (`pending = 0`, `job_id` = el trabajo en curso, `live_at`), con texto, adjuntos bajados a `$TEAM_THREAD_DIR` y lo dicho en audios y videos (UD-279). Sin menciones nuevas responde la lista vacía con una consulta indexada. (3) Una mención tomada no abre otro trabajo al terminar: ya no está pendiente. La que llega después del último paso sigue pendiente y la atiende el fin del trabajo, como hasta ahora. (4) El hilo muestra una línea fija a nombre del agente («Recibido. Lo tomo en cuenta en lo que estoy haciendo.»), escrita por el sistema; no cuenta como la respuesta de UD-278, así que una sesión que falla después igual dice que no pudo. (5) Ninguna decisión sale del texto de la persona: la mención ya viene en `mention_ids`. Se descartó `--input-format stream-json` para empujar un mensaje a la sesión viva: la sesión corre con el prompt por entrada estándar y la documentación de ejecución programática no describe una cola de mensajes a mitad de turno.
**Consecuencias:** Migración `0029_live_mentions`. `src/domain/live-mentions.js`, `team mentions`, `LIVE_MENTION_SETTINGS`. MASTER-SPEC §7.5, CHANGELOG. Prueba: `src/execute/live-mention.test.js`. En el repositorio del anfitrión, una línea en `instrucciones-del-harness.md`.

## [UD-286] Lo ya aprobado no se vuelve a pedir, y ninguna zona retiene una entrega
**Fecha:** 2026-10-24
**Contexto:** Martín, textual: «debería dejar de pedirme confirmación, mi confirmación estaba explícita desde que dije "dale con todo" y diversos "si". A este punto la espera de revisión es un estorbo». En el mensaje 116 cada sesión implementó y volvió a retener el cambio por «datos de personas»; con la aprobación dada, `POST /messages/116/deliver` encoló la entrega y la orden del anfitrión salió otra vez con 76 porque ignoraba `TEAM_REVIEWED_BY`. Después, textual: «Estoy chato de que siga frenando cosas porque tienen datos de personas, eso no es trazable a ninguna decisión mía». UD-266 y UD-275 retienen por zona sin cita de Martín que lo pida (su contexto es una medición del historial).
**Decisión:** (1) La sesión de una mención declara `approved` (y `approved_reply`) cuando quien la mencionó ya pidió, con sus palabras, implementar y publicar; el modelo interpreta, el sistema lee el campo y nunca el texto (invariante 11). Con `approved` y una persona activa que mencionó, la entrega se encola con `approved_by` y la orden corre con `TEAM_REVIEWED_BY` fijada, sin segunda aprobación; queda auditada como `message.deliver_preapproved`. Sin `approved` (la persona pidió revisar antes, o nadie pidió implementar) la retención sigue como estaba. (2) `POST /messages/:id/deliver` y `discard-delivery` exigen rol `member`, no Editor, coherente con UD-284. (3) Los textos del hilo no nombran «Editor». (4) El anfitrión deja de retener por zona (pagos, datos de personas, migración de datos, servicio externo, permisos): la plataforma conserva el código 76 como mecanismo, y la plantilla `error-directo` ya no promete espera. Sigue retenido sólo un cambio en `infra/`, por un límite técnico (la llave del estado de OpenTofu), no por zona.
**Consecuencias:** `src/execute/handler.js`, `prompt.js`, `mention-context.js`, `deliver.js`, `routes.js`; pruebas en `src/execute/sin-reconfirmar.test.js`; anfitrión: `infra/team-platform/entrega/entregar-rama.sh` y las instrucciones del harness.
## [UD-287] El Editor sólo cambia textos configurados
**Fecha:** 2026-10-24
**Contexto:** Martín, textual y en mayúsculas: «el editor no es una especie de dios que puede autorizar cuando el resto no, SU PRIVILEGIO SOLO ES EL DE PODER CAMBIAR TEXTOS CONFIGURADOS». Antes había dicho: «Los editores solo cambian textos configurados» (UD-284). UD-007 le dio a ese rol áreas, plantillas, equipo y conexiones, y las decisiones siguientes le fueron sumando acciones (UD-251, UD-252, UD-258, UD-281) sin que él las pidiera. Medido el 2026-10-24: 45 comprobaciones de rol Editor en el servidor.
**Decisión:** (1) Texto configurado es lo que la plataforma inyecta como configuración al analizador o a una sesión: nombre y descripción del proyecto, encuadre del análisis por idioma, áreas (título, descripción, color, orden y quién decide) con sus plantillas, y el perfil de un miembro agente. Sólo eso exige el rol Editor: `POST`, `PATCH`, `DELETE` y restauración de áreas y plantillas, `PATCH /settings/project`, `PATCH /settings/analysis`, y `profile` en `POST /members` y `PATCH /members/:id`. (2) Todo lo demás que pedía Editor pasa a cualquier miembro activo de tipo persona (`requireRole('person')`, que rechaza al agente): lanzar `execute`, reprocesar un envío propio o ajeno, publicado o no, borrar y restaurar mensajes y respuestas ajenos y envíos ajenos, ver lo borrado, listar los envíos de todos, vaciar y sembrar datos, cola, traza y purga, auditoría, telemetría, proveedores y conexiones, modo de publicación, altas, cambios (rol incluido), contraseñas y bajas de miembros, el detalle de `GET /health` y la lectura de las plantillas y del encuadre. (3) Se mantiene lo que no es un privilegio: siempre queda un Editor activo (`last_editor`), un área sin quien decida pasa al primer Editor activo (UD-269), y sólo el emisor edita su mensaje o su respuesta (UD-071, UD-279). (4) Ninguna decisión con cita textual de Martín pide Editor para algo fuera de esa lista: UD-024 («el usuario con el rol administrador debe poder cambiar la descripción del proyecto») y UD-281 («cuando yo cambie manualmente las áreas, descripciones de área, plantillas de área, y perfiles») son textos configurados y se respetan. (5) En el panel, Configuración, Conexiones y Equipo dejan de ocultarse al miembro; Áreas, la descripción del proyecto, el nombre, el encuadre y el perfil de un agente siguen siendo del Editor. El rótulo de rol dice «Cambia los textos configurados».
**Consecuencias:** Enmienda UD-007, UD-024, UD-070, UD-120, UD-240, UD-251, UD-252, UD-258 y UD-281 en lo que daban de más al Editor. `src/identity/index.js` gana la barrera `person`. Prueba: `src/api/editor-solo-textos.test.js` (tabla de rutas: sólo las de texto configurado aceptan únicamente al Editor). Las rutas `deliver` y `discard-delivery` y los textos de la entrega van en la rama `wt-sin-reconfirmar` (UD-286).
**Condiciones de reversión:** Las fija Martín.

## [UD-288] El Editor redacta el perfil de cualquier miembro
**Fecha:** 2026-10-24
**Contexto:** Martín, textual (22:30): «aunque sea editor, no puedo redactarle el perfil a los otros miembros, wtf». El perfil es un texto configurado, y cambiar los textos configurados es el privilegio del Editor (UD-287). `PATCH /members/:id` rechazaba `profile` para una persona (UD-023) y sólo lo aceptaba para un agente (UD-281).
**Decisión:** El Editor edita el perfil de cualquier miembro, persona o agente, con `PATCH /members/:id`; cada persona sigue editando el suyo con `PATCH /members/me`. Un miembro sin rol Editor no cambia el perfil de otro. En Equipo, el perfil se abre entero en una ventana y ahí se edita en el lugar. Enmienda UD-023 y UD-281 en ese punto.
**Consecuencias:** `src/api/routes/members.js` deja de rechazar el perfil de una persona. `src/api/api.test.js` prueba que el Editor lo cambia y que un miembro no. El servidor de ejemplo y `Team.tsx` siguen la misma regla. MASTER-SPEC §1 y §7.1.
**Condiciones de reversión:** Las fija Martín.
## [UD-289] El hilo dice la verdad: una respuesta es una respuesta, y lo fallido se reintenta
**Fecha:** 2026-10-24
**Contexto:** Auditoría del mensaje 116. Martín, textual: «Debe haber un botón "reintentar" en team platform para estos casos, obviamente en una ubicación coherente y solo visible cuando haya algo reintentable» y, sobre la etiqueta «Pregunta» de las respuestas finales: «recuerda que yo quité esa tontera, una respuesta es una respuesta y punto». El selector de tipo ya se había quitado del formulario; quedaba el rótulo «Pregunta» en la respuesta de un traspaso. Además el encabezado decía «Cambio listo para revisar» con la entrega fallida, y un aviso apuntaba a «Propuesta» sin capturas.
**Decisión:** (1) Una entrega fallida se reintenta como un trabajo `execute` fallido (UD-282): el aviso lleva el trabajo `deliver` que falló, el servidor decide `retryable` con la misma regla (último trabajo del mensaje, sin otro en curso, mensaje abierto, rama no descartada, orden de entrega declarada), el botón va en el mismo lugar del aviso, cualquier miembro lo aprieta y un segundo clic no encola nada. Corre la orden de entrega sin IA por la ruta de `POST /messages/:id/deliver` y queda auditada como `message.deliver_retry`. (2) Ninguna respuesta lleva rótulo de tipo, de nadie. El `kind` sigue en la API sólo como mecanismo (la persona que recibe un traspaso puede responder), nunca se dibuja. (3) `pending_delivery.state` (`held`, `delivering`, `failed`) sale del estado real de la rama y el encabezado dice «La entrega falló» cuando falló. (4) «Cómo queda, en «Propuesta»» sólo va cuando la respuesta trae capturas.
**Consecuencias:** `src/execute/retry.js`, `deliver.js`, `routes.js`, `src/domain/delivery-review.js`; panel: `ReplyThread.tsx`, `ReviewPending.tsx`, claves `review.failed` y fuera `replies.question`. Pruebas: `src/execute/deliver.test.js`, `panel/src/components/RetryExecute.test.tsx` (ninguna etiqueta de tipo, ni en el catálogo), `ReviewPending.test.tsx`.
**Condiciones de reversión:** Las fija Martín.


## [UD-290] «Reintentar» responde en el clic
**Contexto:** Martín, 2026-10-25 00:52, textual: «Hice clic en reintentar y no pasó nada, solamente desapareció el botón de reintentar. Necesito ver feedback visual en la interfaz al tiro cuando yo haga clic, porque tiene que haber algún tipo de indicador de que la cuestión realmente se está reintentando». Medido en producción: `POST /api/messages/117/replies/113/retry` respondió y el trabajo 155 arrancó al instante; el defecto era sólo visual (UD-282 dejaba el aviso de error sin cambios hasta que llegaba el trabajo).
**Decisión:** (1) Patrón: actualización optimista con reemplazo en el lugar y vuelta atrás si falla. TanStack Query lo documenta como mostrar el resultado de la mutación antes de que termine y revertirlo en el error (tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates, leído el 2026-10-25). GitHub Actions conserva el intento anterior y abre uno nuevo al reejecutar (docs.github.com, «Re-running workflows and jobs», leído el 2026-10-25). (2) Al hacer clic, sin esperar al servidor, el aviso de error se reemplaza en su lugar por «Reintentando», la barra del kit (viaja hasta el primer paso) y la frase de progreso del trabajo que llega por el flujo de eventos; sin recargar ni sondear. (3) Si el servidor rechaza, vuelve el aviso con el motivo y el botón. Si el trabajo nuevo falla, su propio aviso ocupa el lugar. Si responde, su respuesta. (4) El servidor marca el aviso con `replies.replaced_by_job_id` y no lo borra. La API lo dice en `replaced_by_job_id` y `retrying` (trabajo en cola o corriendo). El hilo dibuja «Reintentando» mientras `retrying` y omite el aviso cuando el trabajo terminó, así que al recargar se ve el estado real. Un reintento rechazado no marca nada.
**Consecuencias:** Migración `0032_reply_replaced_by_retry`. `Reply.replaced_by_job_id` y `Reply.retrying` (`packages/client` regenerado). Panel: `RetryExecute.tsx` envuelve el texto del aviso y `ReplyThread.tsx` omite los reemplazados. Pruebas: `src/execute/retry.test.js`, `panel/src/components/RetryExecute.test.tsx`, `panel/src/flows-reintento-visible.browser.test.mjs`. Enmienda UD-282 (4) y UD-289 (1).
**Condiciones de reversión:** Las fija Martín.

## [UD-291] «Para»: el envío se dirige a miembros, Claude entre ellos
**Fecha:** 2026-10-25
**Contexto:** Martín, 01:18, textual: «la lógica que estamos usando para decidir cuándo se le envía algo a Claude es medio contraintuitiva. Estamos pidiendo demasiadas cosas del usuario … eso es tener que reenviarse a Claude manualmente e introducir un paso de fricción innecesario» y «el día de mañana alguien va a querer enviárselo directamente a Claude desde otro canal que aún no existe … Deberíamos tener un botón que sea simplemente para enviar a un desplegable y tú puedes agregar uno o varios miembros y que uno de esos miembros va a ser Claude … si la persona agrega destinatarios manualmente, eso debería sobreescribir lo que sea que el sistema decida como ruteo. Pero si la persona no marcó ningún integrante del equipo o derechamente eliminó los que había marcado ya, entonces debería correr el ruteo automático».
**Patrón vigente (leído el 2026-10-25):** (1) GitHub: el agente de código de Copilot se asigna a un issue desde el mismo control «Assignees» que una persona; al asignarlo corre sin otro paso y devuelve un pull request (docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-a-pr). (2) Linear: asignar un issue a un agente lo deja como delegado y la persona sigue de responsable, porque «un agente no puede responder por el resultado» (linear.app/docs/assigning-issues; linear.app/docs/agents-in-linear). (3) Slack: el agente se agrega al canal y se menciona en un mensaje para encargarle algo (slack.com/intl/en-ie/help/articles/33076000248851-Work-with-AI-agents-in-Slack). Los tres comparten lo que importa aquí: el agente se elige en el mismo selector que una persona y elegirlo basta para que trabaje.
**Decisión:** (1) `POST /inputs` acepta `recipient_ids` (JSON y multipart, un campo por destinatario). Son los asignados de cada mensaje del envío; el enrutamiento automático sigue eligiendo área y plantilla y no reasigna. Sin destinatarios, asigna como siempre. (2) Claude es un destinatario más: no hay ruta aparte. Un agente entre los destinatarios recibe su trabajo `execute` cuando el mensaje se publica, sin otra confirmación (UD-286). (3) Cada id debe ser un miembro activo; si no, 400 `recipient_invalid`. (4) Los destinatarios entran en el hash del envío: el mismo texto a otros destinatarios es otro envío. (5) En la barra de nuevo mensaje, el control «Para» elige uno o varios miembros con su avatar; vacío o con todos quitados corre el ruteo automático. (6) Linear separa responsable y delegado. Aquí el autor del mensaje ya queda como responsable de lo que envió (`author_id`), así que el agente se asigna como cualquier miembro y no se agrega la figura de delegado.
**Consecuencias:** Migración `0033_input_recipients` (`inputs.recipient_ids_json`); `resolveRecipients` en `src/domain/inputs.js`; la asignación se aplica en el análisis (`src/domain/pipeline.js`), antes de guardar la propuesta. `packages/client`: `NewInput.recipientIds`, `InputRecord.recipient_ids`. Panel: `ComposeBar`, `RecipientsEditor`. Pruebas: `src/api/recipients.test.js`, `panel/src/flows-destinatarios.browser.test.mjs`.
**Condiciones de reversión:** Las fija Martín.

## [UD-292] Eliminar un miembro conserva lo que publicó y retira su correo

**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 02:10, textual: «debe existir una forma de eliminar miembros del equipo y debe eliminar el miembro super admin». La acción «Eliminar» de Equipo existía (UD-240, UD-253), pero borraba con todo lo suyo o respondía 409 con historial, y no impedía que el ingreso del anfitrión creara al miembro de nuevo. Medido en producción: «Super Admin» es la cuenta `super_admin` genérica de la consola del anfitrión (creada el 2026-10-06, rol `member`, correo `superadmin@` del dominio del anfitrión). El anfitrión firma un token con su correo en cada ingreso de esa cuenta y `IDENTITY_PROVISION=host` crea al miembro si no existe, así que eliminarlo sin más no servía.
**Decisión:** (1) `DELETE /members/:id?confirm=true` elimina al miembro: sus mensajes, respuestas y envíos publicados quedan en el hilo con el autor «Miembro eliminado» (un solo miembro inactivo, `removed`, que no se lista en Equipo ni se edita ni se elige); sus envíos sin publicar se retiran con sus archivos; sus asignaciones y menciones se quitan. `purge=true` conserva el borrado total de UD-240. (2) Puede hacerlo cualquier persona activa del equipo salvo sobre sí misma y sobre el último Editor (UD-287: no es un texto configurado). (3) El correo queda en `retired_identities`: el ingreso del anfitrión responde 403 `member_retired` y no crea al miembro. Una persona del equipo que lo agrega a mano (`POST /members`) lo saca de la lista. El anfitrión manda el rol en cada token, así que no hay un rol explícito que distinga una readmisión: la readmisión es siempre un alta a mano. (4) Se mantiene UD-253: sin diálogo de confirmación; el aviso dice cuántos mensajes y respuestas se conservan. (5) `scripts/remove-member.mjs EMAIL --by CORREO` hace lo mismo desde el contenedor.
**Consecuencias:** Migración 0034. Enmienda UD-240 en el 409 `member_has_history`, que desaparece del camino por omisión. Pruebas: `src/api/member-retirement.test.js` y `panel/src/flows-eliminar-miembros.browser.test.mjs`.
**Condiciones de reversión:** Las fija Martín.

## [UD-293] Avisos de progreso en el hilo mientras Claude trabaja

**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 02:31, textual: «Me gustaría eso sí que se vayan dando actualizaciones de progreso cada 20 minutos cuando Cloud esté trabajando y que esas actualizaciones se den en los mensajes. Eso debería poder ser configurable por plantilla, pero también quiero que esté prendido por defecto … soy ansioso con ese tema de que no veo progreso». Hasta hoy el avance de una sesión era una barra y una frase que no quedan en el hilo. Quien abre el mensaje una hora después no ve que algo pasó.
**Decisión:** (1) Cada plantilla lleva `progress_interval_min`, un entero de 0 a 1440. El 0 apaga los avisos. La omisión es 20 y las plantillas existentes parten en 20. Se edita en el lugar, en la ventana de contenido de la plantilla, bajo «Avisos de progreso» con el sufijo «min». `POST` y `PATCH` de la plantilla aceptan el campo.
(2) Mientras corre la sesión de un trabajo `execute`, desde que arranca en la máquina hasta que termina, el trabajador escribe un aviso en el hilo cada `progress_interval_min` minutos. El reloj pertenece al trabajo. Arranca y se detiene con la fase `run` y nunca es un cron aparte. Un trabajador que reinicia y se engancha a la sesión (9c7aeb3) arranca el suyo y cuenta desde el inicio que el primer aviso dejó anotado.
(3) El contenido sale de lo que el flujo de la sesión ya informó, sin tocar la máquina ni sus guiones. Lleva los minutos transcurridos, los turnos de la sesión principal, las llamadas a herramientas, el último paso (la frase que mueve la barra) y el último commit, empujado o no. El commit se lee de lo que imprimieron `git commit` y `git push` en el resultado de una llamada Bash. Una línea se escribe sólo si su dato existe.
(4) Un aviso no es una respuesta. Vive en su propia tabla, `progress_notes` (migración 0035). Una respuesta cuenta para el estado del mensaje, su recuento, la última respuesta, quién respondió primero y las anclas del cierre automático y de las menciones. Un aviso no debe mover nada de eso. `GET /messages/:id` los devuelve en `progress_notes` y el trabajador publica el mismo evento `changed` que una respuesta escrita por la API. El hilo los dibuja por hora como filas discretas entre el mensaje y la respuesta final. Llegar la respuesta final no los borra, y no cuentan para el límite que pliega un hilo largo.
**Consecuencias:** Migración 0035. Código en `src/domain/progress-notes.js`, `src/execute/progress-timer.js`, la lectura de commits y empujes en `src/execute/stream.js` y el arranque del reloj en `src/execute/handler.js`. `packages/client` regenerado (`ProgressNote`, `Template.progress_interval_min`). Panel: `ReplyThread.tsx` y `TemplateEditor.tsx`. Pruebas: `src/api/progress-interval.test.js`, `src/execute/progress-notices.test.js` (la sesión de prueba hace commit y push, y el minuto se acorta a 40 ms con `progressUnitMs`), `panel/src/components/ProgressNotes.test.tsx` y `panel/src/components/ProgressInterval.test.tsx`.
**Condiciones de reversión:** Las fija Martín.
## [UD-294] Un envío se descompone en tantos mensajes como pedidos traiga, y el análisis corre con Haiku 5.5

**Fecha:** 2026-10-25
**Contexto:** Martín, textual: «es súper importante que el sistema pueda adecuadamente crear un número entre uno y varios mensajes a partir de un solo mensaje fuente. Se supone que eso ya está probado y funcional en Team Platform, pero de todas maneras hay que garantizarlo porque de ahí viene la gracia de tener múltiples áreas con múltiples plantillas. Eso es lo que nos da el control fino y realmente granular». Los dos envíos reales de producción (44 y 45) salieron como un mensaje cada uno, y cada uno trae un solo pedido, así que el resultado era correcto. El banco de 12 envíos de `bench/envios/` encontró el caso que no: un párrafo dictado sin puntuación con tres pedidos de tres áreas es una sola unidad, y una unidad no se reparte entre mensajes; salió un mensaje (Sonnet 5.5: 0 de 4 corridas de los dos envíos de ese tipo; Haiku 5.5: 0 de 2).
**Decisión:** (1) Antes de clasificar corre un paso de corte (`cutPass`, `src/analyze/api.js`, MASTER-SPEC §7.5 paso 1b): el modelo cita las palabras donde empieza cada pedido posterior al primero y el sistema comprueba que estén en la unidad una sola vez, corta y numera de nuevo. El sistema no lee el texto de la persona: valida la forma de lo que el modelo citó (invariante 11). (2) Un mensaje lleva los adjuntos de donde salen sus unidades, aunque el modelo no los nombre. (3) El banco `bench/envios/` pasa a la batería con el analizador falso (`bench/envios/envios.test.js`) y, con `TEAM_LIVE_ENVIOS=1`, contra un modelo real por `claude -p`. (4) Propuesta, no cita de Martín: `TEXT_MODEL` pasa de `claude-sonnet-5-5` (valor de producción hoy) a `claude-haiku-5-5`, el valor por omisión del código. Con el paso de corte, Haiku 5.5 descompone 24 de 24 corridas del banco (36 de 36 en la tanda anterior) y Sonnet 5.5 12 de 12; la medición completa está en `docs/investigaciones/mediciones/2026-10-25-un-envio-varios-mensajes.md`. El cambio de la variable en producción lo hace quien despliega; el código no lo fija.
**Alternativas descartadas:**
- Cortar por la puntuación o por conectores («y», «además») en `units.js`: es un `if` sobre el texto de la persona, lo que prohíbe la invariante 11.
- Subir el esfuerzo de la clasificación: ya corre en `high` (UD-260) y falló igual, porque la unidad sigue siendo una y la clasificación no puede citar la mitad de una unidad.
- Citar partes de una unidad en la clasificación (`u7.2`): obliga a que el modelo numere lo que todavía no existe en la misma llamada que lo usa.
**Consecuencias:** Una llamada más por envío (una por ventana de unidades, en `low`). Los ids de unidad de una propuesta que cortó una unidad se numeran después del corte, y `units_json` de la propuesta guarda ese texto. El caso 09 del banco público ya no espera un mensaje por oración compuesta: espera uno por hecho (`cuts` en su `expected.json`). Un caso nuevo sale de agregar un envío a `bench/envios/cases.js`.
**Condiciones de reversión:** `cutPass: false` vuelve al comportamiento anterior. Se vuelve a Sonnet 5.5 si el banco con Haiku baja de 11 de 12 envíos en dos corridas seguidas.

## [UD-295] Modelo por área, evaluación de cada mensaje y juicio de cada trabajo
**Fecha:** 2026-10-25
**Contexto:** Martín, textual (01:40): «vamos a poder fijar un modelo de Anthropic según área. Eso significa que ese va a ser el modelo con el que corre la sesión desatendida … el punto es utilizar ese tipo de criterio para determinar si algo es un arreglo directo que se le puede asignar a un modelo bien ligero, o algo que requiere un modelo más complejo, o que derechamente se debería derivar únicamente a un humano sin pasar por un modelo. Es algo que me importa mucho. Impleméntalo». Después, en el mismo encargo: «especialmente cuando hablamos de Haiku … cuidemos bien los tokens. Y que le demos las reglas de tal forma que le haga imposible no seguirlas … también darle un indexado pequeño al código» (01:55); «cuando se ocupe Haiku no sea solamente en algunos poquitos arreglos … empujar un poco los límites de Haiku … quiero ahorrar costos, y al mismo tiempo tener la flexibilidad de pasar a Sonnet cuando sea necesario» (02:25); «no me parece bien restringir cuáles son los niveles y decir que van a ser 3 arbitrariamente … El tema es qué tan bien o qué tan adecuadas son las cosas que hace» (02:35); «sin tope de pasos por nivel, solamente el tope de presupuesto diario» (02:38). El detalle y las fuentes están en `docs/investigaciones/mediciones/2026-10-25-arranque-del-arreglo-directo.md` y en `docs/investigaciones/mediciones/2026-10-25-los-limites-del-modelo-ligero.md`.
**Lo que se retiró el mismo día.** La primera versión repartía el trabajo en tres cajones (niveles de Bloom: arreglo directo, complejo, sólo persona) y en tres tipos de salida (código, investigación, decisión). Se retiró por lo que Martín dijo a las 02:35: un LLM puede hacer varias cosas a la vez, y lo que importa es qué tan adecuado es lo que hace. Un cajón decide antes de mirar el trabajo; una estimación continua con su razón y un juicio después del trabajo no.
**Patrón vigente (leído el 2026-10-25):** (1) Enrutar tareas de código por dificultad entre modelos chicos y grandes ahorra costo sólo si el modelo chico acierta más que lo que cuesta de más equivocarse: el trabajo «Triage» (arXiv 2604.07494, 8 de abril de 2026) lo formula como que la tasa de acierto del nivel ligero debe superar el cociente de costos entre niveles y que la señal debe distinguir el nivel (diseñado, sin ejecutar). (2) SWE-Router (arXiv 2607.00053, junio de 2026) mide que un enrutador que sólo lee la descripción de la tarea tiene un piso de error, porque un typo y una refactorización de varios módulos se leen igual, y que unos pasos de trabajo del modelo chico dan la señal que falta: por eso aquí la estimación se hace antes pero la escalada se decide por una falla comprobada después. (3) El costo de enrutar mal es el retrabajo: un resumen de junio de 2026 de Unblocked (getunblocked.com/blog/model-routing-coding-agents) reporta ahorros de 30 a 40 % y advierte que una mala ruta barata cuesta más que no enrutar. (4) Anderson y Krathwohl (2001) revisaron la taxonomía de Bloom como una escala de niveles cognitivos; aquí se usa como escala continua (`understand_vs_create`), no como casilleros.
**Decisión:**
(1) Cada área elige un modelo ligero y un modelo mayor de una lista cerrada con los ids de la tabla de modelos de Anthropic leída el 2026-10-25 (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`); por omisión, Haiku 5.5 y Sonnet 5.5. Es texto configurado, así que lo cambia el Editor (UD-287), con dos selectores de rótulo corto, «Ligero» y «Mayor». El trabajador pasa el elegido a `claude -p --model`.
(2) El área describe su espacio con su descripción y escribe sus Guardias, el único límite booleano: cada Guardia lleva su texto, el mecanismo que la sostiene y si es de una persona.
(3) El analizador, que ya interpreta cada mensaje con un LLM, devuelve por mensaje, como parámetros estructurados y nunca por patrones sobre el texto de nadie (regla 11 del repositorio del anfitrión): lo que se espera de Claude en palabras naturales, las Guardias del área que toca, y estimaciones de 0 a 1 con su razón (cuánto es comprender y cuánto crear, qué tan irreversible es, qué tan seguro está) y quién tiene el valor que falta, persona o modelo.
(4) El sistema lee esos números e ids: usa el modelo ligero mientras ninguna estimación pase su límite (`EXECUTE_LIGHT_LIMITS`, derivados de la tabla de abajo) y el mayor en otro caso o cuando el mensaje no trae estimaciones. Una Guardia de persona tocada, o un valor que falta que es de una persona, deja a una persona entre los asignados junto a Claude y Claude no cierra solo; un destinatario elegido en «Para» manda sobre el reparto automático (UD-291).
(5) La escalada es por falla comprobada, nunca por pasos (UD-283): la sesión ligera que termina con `cannot_close: true` o `outcome: blocked`, o cuya entrega no pasa la verificación, se relanza una vez en el modelo mayor sobre la misma rama con lo hecho; el hilo dice «Haiku 5.5 no cerró: siguió Sonnet 5.5» y queda auditado; el reintento de una sesión ligera fallida también va al mayor. Nunca al revés y nunca dos veces.
(6) Al terminar cada trabajo, un modelo juez barato lo juzga con una rúbrica: cuadrante de McGrath, doce indicadores de −2 a +2 con cita, afirmación y razonamiento, y cuatro ejes contra la meta del cuadrante. Un indicador que no se puede observar en un trabajo sin supervisión no se puntúa. El juicio se guarda con el trabajo y se ve en su ficha («Adecuación»), junto al modelo y al costo de todos los trabajos del mensaje.
(7) Economía de contexto, lo que se carga al empezar y no un límite que corte la sesión: una sesión ligera recibe el prompt mínimo, solo las herramientas que usa (`--tools`), el mapa corto del repositorio (carpetas, dónde viven pantallas, API, migraciones y pruebas, los diez archivos más tocados en 30 días, a lo más 800 tokens, la estructura en caché hasta que cambien las carpetas) y los ganchos de Claude Code que hacen cumplir lo que no se pide como prosa: `team guard` impide empujar `main` y forzar un push, y `EXECUTE_DIRECT_STOP_COMMAND` es el gancho `Stop` con el que el anfitrión exige sus pruebas críticas antes de terminar. Un modelo mayor recibe el mapa entero.
**Opinión fundada.** Haiku 5.5 para los arreglos con estimaciones bajas: sí, con la escalada y el juicio como red, y sin dar por probado el ahorro. Precios publicados (platform.claude.com/docs/en/about-claude/pricing, leído el 2026-10-25), por millón de tokens: Haiku 5.5 entrada 0,10, salida 0,50, lectura de caché 0,01 y escritura 0,125 con prompts de hasta 100.000 tokens (0,50, 2,50, 0,05 y 0,625 por encima); Sonnet 5.5 entrada 2, salida 10, lectura 0,10 y escritura 2,50. Haiku cuesta 5 % de Sonnet en entrada y salida, 10 % en lectura de caché (50 % sobre 100.000 tokens). Costo real medido en producción (38 trabajos `execute`, lectura de `/data/team.db` en sólo lectura, 2026-10-25): 35,45 USD en total, media 0,93, mediana 0,70, percentil 90 1,66; los 24 que terminaron en `done` costaron 1,04 de media, 11,1 minutos y 35 pasos; 96 % de los tokens de entrada son lecturas de caché, justo los que Haiku cobra a 10 % de Sonnet. El 24 de octubre se gastaron 19,76 USD en 20 trabajos, con tope de 40. Medido con el banco (seis tareas reales, misma instrucción, sólo cambia el modelo): Haiku cerró 6 de 7 corridas y Sonnet 6 de 6. Por los precios publicados las seis tareas costaron 0,055 USD con Haiku y 0,557 con Sonnet: diez veces menos, y con una escalada que falle la mitad de las veces seguiría saliendo más barato. Por el costo que informa la CLI, Haiku costó 2,18 USD y Sonnet 0,86: 2,5 veces más. La diferencia no se explicó, y de ella depende que ahorrar sea cierto: se lee en el informe de uso de la consola de Anthropic antes de contar con el ahorro. En tiempo Haiku tardó 48 minutos y Sonnet 10, con la máquina compartida: pesa contra la meta de diez minutos del anfitrión. Conviene Haiku por omisión, como pidió Martín, porque cierra casi todo lo que se le da y la escalada y el juicio miden el resto; no conviene darlo por barato hasta ver el informe de uso, y se pasa el área a Sonnet con un selector si no ahorra. La salvaguarda es la que no depende del modelo: la comprobación de cierre del anfitrión como gancho `Stop` (pruebas críticas, video y revisión), porque el único fallo medido de Haiku no avisó: terminó sin cambiar ningún archivo y sin pedir ayuda.
**Límites medidos de Haiku 5.5.** Seis tareas de este repositorio, de un rótulo a una migración con API y pantalla, con Haiku 5.5 y Sonnet 5.5 (`bench/model-limits.mjs`; una corrida por tarea y modelo, T5 de Haiku dos veces). Haiku cerró T1, T2, T3, T4 y T6, y T5 en una de dos corridas. Sonnet cerró las seis. Las estimaciones del analizador no separan el fallo de los cierres: T5 tiene las mismas estimaciones de crear e irreversibilidad que T3, que cerró, y la misma certeza que T4 y T6. Por eso `EXECUTE_LIGHT_LIMITS` nace sin límite (`create=1 irreversibility=1 certainty=0`) y el límite se fija con los trabajos que juzgue el modelo juez (criterio y tabla completa en `docs/investigaciones/mediciones/2026-10-25-los-limites-del-modelo-ligero.md`). La escalada mide el resto.

| Tarea | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| T1 texto | cierra, 12 pasos, 4,7 min, 0,241 USD | cierra, 7 pasos, 2,6 min, 0,149 USD |
| T2 pantalla chica | cierra, 5 pasos, 0,5 min, 0,142 USD | cierra, 4 pasos, 0,5 min, 0,083 USD |
| T3 defecto con causa clara | cierra, 15 pasos, 12,6 min, 0,285 USD | cierra, 9 pasos, 0,4 min, 0,103 USD |
| T4 defecto sin causa clara | cierra, 20 pasos, 11,1 min, 0,413 USD | cierra, 8 pasos, 1,2 min, 0,103 USD |
| T5 unificación de dos piezas | no cierra (sin cambios) y cierra, 7 y 13 pasos, 2,3 y 10,9 min | cierra, 6 pasos, 0,8 min, 0,104 USD |
| T6 migración, API y pantalla | cierra, 5 pasos, 16,8 min, 0,929 USD | cierra, 15 pasos, 4,3 min, 0,321 USD |

Costos de la CLI (USD); los precios publicados dan diez veces menos para Haiku, como en la opinión de arriba.
**Consecuencias:** Migración `0034`. `src/domain/assessment.js`, `src/domain/execute-models.js`, `src/execute/judge.js`, `scripts/repo-map.mjs`, `bench/model-limits.mjs`. `team map` y `team guard`. `PUT /api/messages/:id/assessment`. `GET /areas` trae `execute_model`, `execute_model_light` y `guards`; `GET /messages/:id/timing` trae `model`, `cost_usd` y `judgment`. Variables `EXECUTE_LIGHT_MODEL`, `EXECUTE_LIGHT_LIMITS`, `EXECUTE_JUDGE_MODEL`, `EXECUTE_DIRECT_HOST_INSTRUCTIONS`, `EXECUTE_DIRECT_SESSION_ENV`, `EXECUTE_DIRECT_STOP_COMMAND` y `EXECUTE_DIRECT_TOOLS`. Pruebas: `src/execute/area-model.test.js`, `src/execute/light-session.test.js`, `src/analyze/assessment.test.js`, `scripts/repo-map.test.mjs`, `panel/src/flows-modelo-por-area.browser.test.mjs`. MASTER-SPEC §7.5.
**Enmienda 2026-10-26:** el juez de trabajos va por el proveedor de texto, el mismo del analizador, y no por un `claude -p` lanzado en el trabajador: la imagen del trabajador no trae ese ejecutable y ningún trabajo quedó juzgado. Su modelo es el del proveedor de texto (`TEXT_MODEL`); `EXECUTE_JUDGE_MODEL` se retira. El resto de la decisión no cambia.
**Enmienda 2026-10-26 (UD-313):** una Guardia `person` tocada retiene la entrega hasta que una persona la levante, y el juez recibe anclas y evidencia, valida su salida y juzga también el intento que escala; los puntos 4 y 6 quedan completados por esa decisión.
**Condiciones de reversión:** Las fija Martín.

## [UD-296] El hilo muestra todas las respuestas, una entrega fallida lo dice cada vez y una rama ya entregada cuenta como entregada
**Fecha:** 2026-10-25
**Contexto:** Mensaje 117, medido en producción a las 11:30. Martín veía 8 respuestas de 9: faltaba la 122, el aviso «El cambio no pasó la verificación…» de las 03:30. Tres trabajos `deliver` fallaron (157 a las 03:22, 159 a las 03:45 y 160 a las 04:11) y sólo el primero dejó una respuesta. Causas medidas: (1) la 122 llevaba `replaced_by_job_id = 160` porque alguien apretó «Reintentar», y el hilo omitía todo aviso reemplazado cuando su trabajo terminaba (UD-290), con el supuesto de que el trabajo nuevo dejaba una respuesta o un aviso propio. (2) El 160 falló con las mismas palabras que la 122 y `handOff` de `deliver.js` compara el cuerpo con la última respuesta (`alreadyHandedOver`): al ser igual no publicó nada y sólo movió la marca `failed_job_id` de la 122 al 160, así que el aviso reemplazado y oculto fue lo único que decía el fallo. El 159, la segunda entrega de la pasada que vuelve a Claude, cayó por la misma comparación. Además la pasada que vuelve a Claude (`execute` con `deliver_failure`) no avisaba nada hasta que terminaba la segunda entrega. (3) La rama `tp/117` entró a producción a las 10:43 por el lote de la noche del anfitrión, sin que Team Platform lo supiera: el mensaje siguió `open` y quedaba una entrega por reintentar de algo ya publicado.
**Decisión:** (1) Todas las respuestas del hilo se dibujan, en orden, siempre. Un aviso que un reintento reemplazó se queda; «Reintentando» sigue dibujándose mientras el trabajo nuevo está en cola o corriendo. Enmienda UD-290 (4). (2) Cada intento de entrega que falla deja una respuesta de Claude con el motivo en una frase, «No pasó la verificación: <prueba>», con el nombre de la primera prueba que la orden imprimió como `FALLA prueba:` y cuántas más cayeron; sin nombre en la salida, «No pasó la verificación.». Vale para la pasada que vuelve a Claude («Claude lo corrige y vuelve a entregar»), para el aviso final y para un fallo idéntico al anterior: la comparación con la última respuesta se retira de `deliver`. El último aviso lleva «Reintentar» (UD-289). (3) `EXECUTE_DELIVER_CHECK_COMMAND` declara la orden con que el anfitrión responde si la rama ya está en producción. `deliver` la corre antes de la orden de entrega con `{message_id}`, `{job_id}` y `{branch}`. Código 0 quiere decir que la rama es antecesora de lo que sirve el anfitrión y la última línea de stdout es la referencia: `deliver` no corre la orden de entrega, marca la entrega lograda, publica la respuesta final con la línea «ya estaba en producción» y deja el mensaje `answered`. No lo cierra, porque el sistema no verificó ese cambio. Con cualquier otro código, el plazo de 60 s o un error, la entrega corre como siempre.
**Alternativas descartadas:**
- Ocultar sólo el aviso reemplazado cuando existe otro posterior: sigue suponiendo que algo posterior lo cuenta, que es lo que falló.
- Que la plataforma corra `git merge-base --is-ancestor` ella misma: el trabajador de producción no lleva git ni `EXECUTE_REPO_DIR` (medido el 2026-10-25 en el contenedor del trabajador de producción), y la entrega trabaja en una máquina aparte con su propio clon.
- Un endpoint de versión del anfitrión fijo en la plataforma: cada anfitrión sirve la suya; la orden declarada deja que cada uno responda con lo que tiene.
**Consecuencias:** `panel/src/components/ReplyThread.tsx`, `src/execute/deliver.js`, `src/config.js`. Prueba de render con la secuencia exacta del mensaje 117 en `panel/src/components/RetryExecute.test.tsx`; pruebas del trabajador en `src/execute/deliver.test.js` (fallo repetido, pasada que vuelve a Claude, remoto de mentira con la rama fusionada). Producción necesita que el anfitrión declare `EXECUTE_DELIVER_CHECK_COMMAND` (un guion suyo que pregunte a su repositorio) para que el punto (3) actúe.

## [UD-297] Las plantillas de un área son una lista de filas y cada una se abre en una ventana

**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 11:4x, textual, mirando la sección «Plantillas» del área «Ficha y agenda»: «esto de ver las plantillas acá se ve pésimo porque mira está todo desalineado está todo mal esto no cumple con la guía de diseño del repositorio además que si hay cuatro plantillas las cuatro deberían ser visibles acá y cada una desplegable en un modal … solamente el editor debería poder cambiar los modelos». Medido en el código: la sección dibujaba cada plantilla como una tarjeta de alto variable (descripción larga, etiquetas de campos y de salida, tres botones) dentro de un `FitList` de `min(22rem, 30dvh)` que paginaba, así que con cuatro plantillas se veía una; los rótulos «Campos» y «Salida» salían de la tarjeta por el alto fijo del marco, y la casilla de selección quedaba a 12 px del borde sin relación con la línea del título.
**Decisión:** (1) Las N plantillas del área se dibujan todas, sin paginar: la cifra del pliegue «Plantillas N» es el número de filas que hay debajo. (2) Cada plantilla es una fila de la grilla de `panel/DISENO.md` (regla de anclaje 2: un dato del mismo tipo ocupa la misma columna en todas las filas): nombre, cuántos campos pide, cuántas salidas declara y los minutos entre avisos de progreso (`Apagado` si es 0), con la acción «Eliminar» a la derecha, siempre dibujada y sin relleno (J2-A-11). Un encabezado de rótulos de 12 px comparte la grilla. En teléfono la fila se apila y cada cifra lleva su palabra. La descripción, las etiquetas y el modelo no están en la lista: el modelo es del área, no de la plantilla, así que no tiene columna. (3) El nombre abre una ventana del kit (`TemplateContentDialog`) con el nombre y la descripción completos, editados en el lugar, los campos, las salidas, «Avisos de progreso» y las instrucciones, con el guardado al instante de UD-017 y «Listo» como única salida. Sin panel lateral (T46 retirado). (4) «Obligatorio» es una insignia (`Badge`: rellena si lo es, de contorno si no) junto a su casilla, en los campos y en las salidas, en la ventana y en el formulario de plantilla nueva; deja de ser texto suelto. (5) Los modelos «Ligero» y «Mayor» (UD-295) los ve como selectores y los cambia sólo el Editor, que es texto configurado del área (UD-287); `AreaModels` lee el rol por sí mismo, así que ninguna pantalla puede dibujarlos para otro. Quien no es Editor lee el valor como texto. En el servidor, `PATCH /areas/:id` con cualquiera de los dos campos, solo o junto a otro, responde 403 `forbidden` a un miembro y no guarda nada.
**Alternativas descartadas:** Mantener las tarjetas y paginarlas por altura: dejaba tres de cuatro plantillas fuera de vista, que es lo que Martín reclamó. Una columna «Modelo» por plantilla: la plantilla no tiene modelo; repetir el del área en cada fila sería un dato igual en todas, que la guía manda borrar. Dejar «Obligatorio» como texto al lado de la casilla: es el texto suelto que Martín nombró.
**Consecuencias:** `panel/src/components/AreaTemplates.tsx` (lista y fila), `TemplateEditor.tsx` (`RequiredToggle`, `lead` de la ventana), `AreaModels.tsx` (sale de `AreaView.tsx`). Claves `templates.outputs` y `templates.columnProgress`. `panel/DISENO.md` «Vista de un área» y «Plantillas de un área». Pruebas: `panel/src/components/AreaTemplates.test.tsx`, `panel/src/components/AreaModels.test.tsx`, `panel/src/flows-plantillas-area.browser.test.mjs` (cuatro filas, misma x de nombre, casilla y cifras, ventana, insignias, 390 y 1440 px en claro y oscuro) y `src/api/area-model-editor.test.js` (403 por cada campo de modelo).
**Condiciones de reversión:** Las fija Martín.

## [UD-298] Una prueba que cae es la siguiente tarea de Claude; la respuesta final sólo dice lo comprobado
**Fecha:** 2026-10-25
**Contexto:** Martín, mensaje 117, textual: «Que Claude no falle solamente porque una prueba falló», «si una prueba falla, Claude también puede arreglarla igual que tú», «su comentario me dice que voy a ver algo apenas se publique, pero ¿qué pasa si la publicación falla? El comentario promete algo que es mentira. Claude solamente debería contestar que algo terminó cuando efectivamente ya está comprobado en producción, no antes», «no quiero que me trate de usted» y «no mostró fotos ni videos». Medido en producción: (1) la respuesta 126 decía «Lo verá en la ficha apenas se publique, y la publicación empieza al terminar esta respuesta» y terminaba en «Ya está en producción»: el trabajador publica la respuesta de la sesión sólo cuando la entrega termina bien, pero el texto lo escribió la sesión antes y prometía. (2) El trabajo 161 cerró sin captura ni video porque la sesión lo decidió («No se tomó captura ni video: es un cambio de un rótulo y no se levantó pila»): ningún paso de la cadena falló. (3) Ni el perfil de Claude ni el de Martín decían cómo dirigirse a él, y el prompt pedía escribir «como a un project manager»: el modelo eligió «usted». (4) Una verificación fallida daba una sola vuelta (`EXECUTE_DELIVER_RETRIES` 1) y después la respuesta era un final.
**Decisión:** (1) Una verificación que falla vuelve a Claude después de cada falla, también la de una entrega lanzada a mano y sea la prueba del cambio o ajena (intermitente, de la cadena), mientras alcance el presupuesto diario (UD-295: sin tope de pasos ni de rondas). El prompt de esa vuelta pide arreglarla de raíz, sin saltarla ni esconderla tras un reintento o una espera (regla dura 14 del anfitrión) y volver a entregar. `EXECUTE_DELIVER_RETRIES`, si se declara, acota las vueltas. La escalada de Haiku a Sonnet (UD-295) aplica igual. Cada vuelta deja su aviso en el hilo (UD-296). Con el presupuesto agotado la respuesta es «No quedó en producción: no pasó la verificación (<prueba>)» con el tope como motivo. (2) La respuesta final de la sesión se publica sólo cuando la entrega terminó y la comprobación la confirmó, con la hora real y su zona: «En producción desde HH:MM UTC». Mientras tanto el hilo lleva avisos («Construido; entregando a producción.», en `progress_notes`, que no cuentan como respuesta) y ninguna promesa. Las instrucciones prohíben a la sesión escribir sobre cuándo se publicará. (3) La salida lleva `touches_screen` y `no_capture_reason`: con un cambio de pantalla y ninguna captura ni video, la respuesta dice «No incluye captura ni video: <motivo>» y el mensaje no se cierra solo. El sistema lee el booleano; el motivo es la frase de la sesión. (4) La sesión se dirige a cada persona como dice su perfil y, sin instrucción, en español de tú, nunca de usted. En producción, el perfil de Martín dice «Quiero que me traten de tú, en chileno directo, y nunca de «usted»» y el de Claude lleva la cláusula de trato.
**Alternativas descartadas:**
- Que la plataforma lea el resumen de la sesión y quite las promesas: sería un patrón sobre la prosa del modelo (invariante 11 del anfitrión). Se prohíbe en la instrucción y se publica el texto sólo con la entrega confirmada.
- Detectar «cambio de pantalla» por los archivos tocados: la plataforma no conoce el repositorio del anfitrión. La sesión lo declara en un campo booleano y el sistema actúa sobre él.
**Consecuencias:** `src/execute/deliver.js`, `prompt.js`, `handler.js`, `captures.js`, `auto-close.js`, `src/domain/progress-notes.js`, `src/config.js`. Pruebas en `src/execute/deliver.test.js` (tres rondas, texto final ausente hasta la confirmación, presupuesto agotado, pantalla sin captura), `prompt.test.js` y `respuesta-para-pm.test.js`. La hora lleva el nombre de la zona `TZ` del servidor (UTC si no está definida, como hoy en el contenedor de producción): declarar `TZ=America/Santiago` la muestra en hora de Chile. Un anfitrión con una prueba que ninguna sesión logra arreglar repite vueltas hasta agotar el presupuesto del día: es lo pedido, y `EXECUTE_DELIVER_RETRIES` lo acota si se quiere.
**Condiciones de reversión:** Las fija Martín.

## [UD-299] Un texto largo se lee entero y la columna es la que se desplaza
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 13:3x, textual: «es ilegible la descripción de un mensaje en la plataforma». En el detalle del mensaje 123, con seis adjuntos y cuatro pliegues, la descripción se veía como un cuadro de una línea, cortado por la mitad de las letras y con flechas de desplazamiento a la derecha. Medido en el panel de ejemplo con ocho líneas y seis adjuntos a 1440x900: el bloque del texto medía 202 px de 804 px (`scrollHeight`), porque era el único elemento de la columna con `min-h-0` y `overflow-y-auto`, y se encogía primero. A 390 px no ocurría: la página se desplaza sola.
**Decisión:** (1) El texto de un mensaje no tiene desplazamiento propio ni tope de alto: ocupa lo que necesita. (2) Desde 768 px la columna izquierda del detalle (`data-lane="message-column"`) es el carril declarado: adjuntos, texto, campos y pliegues se desplazan juntos y ningún bloque se encoge. (3) La descripción de un área pierde el tope de 32 % del alto de la ventana: se lee entera y la lista de mensajes toma el resto (la pantalla sigue cabiendo en una ventana). (4) La edición en el lugar no cambia (UD-017): el campo crece con el texto, sin tirador. La descripción de plantilla y el perfil de un miembro ya vivían en una ventana que se desplaza completa y quedan como estaban. Un texto pegado por la persona (texto original, texto de un envío) sigue siendo un carril declarado: no tiene largo máximo.
**Alternativas descartadas:**
- Dar al texto un alto mínimo de N líneas dentro del carril: el número sería elegido, y con adjuntos y pliegues suficientes el mínimo tampoco alcanza.
- Quitar el carril y dejar que la página se desplace desde 768 px: rompe la regla de una pantalla (UD-017) para el resto del detalle y para el hilo de respuestas, que comparte la altura.
**Consecuencias:** `panel/src/pages/MessageDetail.tsx`, `panel/src/pages/AreaView.tsx`. Prueba de navegador `panel/src/flows-descripcion-legible.browser.test.mjs`: ocho líneas con seis adjuntos a 1440x900, 1280x720 y 390x844, claro y oscuro, sin desplazamiento propio del texto, y campo de edición sin tirador; la descripción de 1024 caracteres de un área sin caja que se desplace.

## [UD-300] Un mensaje no se envía a quien lo escribe

**Fecha:** 2026-10-25
**Contexto:** Martín, 13:4x, textual: «yo te había dicho que un miembro no debería poder enviarse un mensaje a sí mismo y sin embargo veo que me aparece la opción de enviarme un mensaje a mí mismo dentro del envío de un mensaje en Team Platform». La regla estaba escrita para dos puertas: reenviar (`forward_to_self`, UD-272) y mencionar en una respuesta (`mention_self`, UD-278). No estaba para el control «Para» (UD-291), para los asignados de un mensaje ni para el reparto automático; el prompt del análisis pedía lo contrario («quien envía el input puede ser también el responsable»).
**Decisión:** (1) El autor de un mensaje no es su destinatario ni su asignado, por ninguna puerta. Con «Enviar como» (UD-255) el autor es el miembro elegido: quien envía en nombre de otro puede dirigirlo a sí mismo, y el autor no. (2) Servidor: `POST /inputs` con el autor en `recipient_ids` es 400 `recipient_self`; publicar una propuesta o `PATCH /messages/:id` con el autor en `assignee_ids` es 400 `assignee_self`. Un autor que ya estaba asignado antes de esta regla puede quedarse. (3) El reparto automático quita al autor de los asignados de cada propuesta, y la Guardia de persona (UD-295) no lo agrega como quien decide. El prompt del análisis lo dice. (4) Panel: el selector de «Para» de la barra de nuevo mensaje y el de asignados de una propuesta o de un mensaje publicado no ofrecen al autor; al cambiar «Enviar como», el nuevo autor sale de «Para». Reenviar y mencionar ya excluían a quien escribe.
**Consecuencias:** `resolveRecipients` y `checkAssignees` reciben `authorId`; `RecipientsEditor` recibe `authorId`. Pruebas: `src/api/recipients.test.js` y `panel/src/components/RecipientsEditor.test.tsx`.

## [UD-301] El anfitrión pregunta por los avisos de una persona con el token que firmó, sin darla de alta
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25, textual: «necesitamos una pestaña "Team Platform" en la consola de superadmin […] Y deberían poder verse las notificaciones de Team Platform desde la consola de Super Administrador para las credenciales apropiadas». Con `IDENTITY_PROVISION=host`, cualquier ruta con el token del anfitrión crea al miembro desconocido en su primera llamada: preguntar por los avisos de una cuenta de la consola que no está en el equipo la habría dado de alta.
**Decisión:** (1) `GET /api/host/notices` entrega los conteos de la campana (`open`, `answered`, `total`, el criterio de UD-028 y UD-041) y los últimos `limit` avisos (5 por omisión, 20 como máximo), con la dirección de cada mensaje en el panel. Sólo lee y sólo contesta por el miembro del token. (2) Identifica con las fuentes del anfitrión (`identifyExisting`) sin entrar a la persona: un correo desconocido es 404 `member_not_registered` aunque el anfitrión provisione al entrar, un miembro desactivado es 403 `account_inactive`, no se aplica el rol que declara el token y no se emite sesión propia. La cookie de sesión propia no sirve en esta ruta. (3) La ruta es pública para la tabla de políticas porque el gancho `requireRole` es el que provisiona; la política que la reemplaza es la de (2) y la prueba `src/api/host-notices.test.js` la hace cumplir.
**Alternativas descartadas:**
- Llamar a `GET /api/messages/summary` con el token: ya existe, pero provisiona al miembro desconocido y la consola ofrecería una pestaña a cuentas que Team Platform no tiene.
- Que el anfitrión pase el correo como parámetro: la pregunta podría nombrar a otra persona. Con el token, sólo existe la propia.
- Un estado de lectura por miembro para contar «sin leer»: la API no guarda quién leyó qué (UD-028). El aviso sigue siendo el de la campana.
**Consecuencias:** `src/api/routes/host.js`, `src/identity/index.js` (`identifyExisting`), `src/identity/delegated.js` (`resolveMember` con `existingOnly`). Prueba en `src/api/host-notices.test.js`: conteos y avisos propios y no los de otro miembro, 404 sin crear la cuenta, ningún rol aplicado ni sesión emitida, 401 sin token o con otra audiencia, 403 desactivado.

## [UD-303] El hilo dice cuándo Claude empieza a trabajar y cuándo espera
**Fecha:** 2026-10-25
**Contexto:** Martín, 13:44, tras mandar a las 13:32 un mensaje que se dividió en seis (#118 a #123), todos para Claude: «Debería haber respuestas AUTOMÁTICAS cuando se gatille el inicio de una sesión de Claude, algo tipo "Claude comenzó a trabajar en este mensaje"». Medido en producción a esa hora: cuatro trabajos corrían y dos (#118 y #122) esperaban, y el hilo de ninguno decía nada; el log del trabajador repetía cada 30 s `job deferred: [object Object]`. Causa de la espera en `docs/investigaciones/mediciones/2026-10-25-por-que-esperan-los-trabajos.md`: las reservas de gasto de las sesiones en curso (4 × hasta 10 USD) cubrían el saldo del día (40 USD).
**Decisión:** (1) Cuando la sesión de un trabajo `execute` empieza de verdad (la máquina existe y arranca `claude`), el sistema escribe en el hilo la fila «<agente> empezó a trabajar», con la hora, una por intento. Es una fila de `progress_notes` (UD-293), no una respuesta: no cambia el estado, no cuenta como respuesta y no es la primera respuesta del agente. (2) Cuando un trabajo queda en espera, el sistema escribe una fila «En espera: N trabajos de Claude delante» y, debajo, el tope que lo retiene en una frase (máquinas, gasto reservado por las sesiones en curso, máquina no disponible). N cuenta los trabajos `execute` que corren ahora y los encolados antes (la cola atiende por llegada). Es una sola fila por trabajo: se reescribe si cambia N o el tope y no se repite en cada reintento de 30 s. Al empezar, o si el trabajo termina sin empezar, pasa a «Estuvo en espera N min». El tope diario agotado conserva su respuesta propia («En espera: se alcanzó el tope de gasto de hoy…») y no escribe esta fila. (3) El log del trabajador imprime el texto del paso diferido y, como datos, `defer_code` y `reason`. (4) Estas filas no se apagan con `progress_interval_min` 0, que gobierna sólo los avisos periódicos. (5) Mientras el anfitrión acaba de responder 75 al crear una máquina, los demás trabajos de ese ciclo (`EXECUTE_CAPACITY_WAIT_MS`) reciben la misma respuesta sin que el trabajador corra ningún guion de máquina, y una sesión que termina reabre la consulta. Motivo medido el 2026-10-25 13:50: cada espera corría `crear.sh` y su `gcloud compute instances list` (1 a 2 s de CPU de Python), y la máquina de producción llegó a carga 14,9 con el trabajador al 238 % de CPU. El anfitrión puede agregar a su error estándar `##team quota machines=<N>`; el hilo dice «la cuota de Google admite N máquinas».
**Alternativas descartadas:**
- Una respuesta del agente al empezar («Claude comenzó…»): una respuesta cambia el estado del mensaje y cuenta como respuesta; una fila de aviso no (UD-293).
- Escribir la fila al tomar el trabajo de la cola: el trabajo puede quedar diferido un instante después y el hilo diría que empezó algo que no empezó. Se escribe cuando la sesión arranca.
- Mover la reserva de gasto en esta decisión: es otro cambio, con su propia medición (la reserva de 10 USD es el valor por omisión de UD-255, no una medición, y los trabajos terminados costaron entre 0,48 y 1,87 USD).
**Consecuencias:** `src/domain/progress-notes.js`, `src/domain/pipeline.js` (`Deferred` lleva `reason`), `src/worker.js`, `src/execute/handler.js`. Pruebas en `src/execute/progress-notices.test.js` (arranque, espera con N, cierre de la espera, motivo en el log, textos).
**Condiciones de reversión:** Las fija Martín.

## [UD-304] Ningún número elegido limita cuántas sesiones de Claude corren a la vez
**Fecha:** 2026-10-25
**Contexto:** Martín, 13:4x, al ver que dos de seis mensajes esperaban: «no entiendo por qué hay un tope de cuántos Claudes pueden correr si se supone que esto tiene un tope máximo de plata; no tiene sentido que limitemos cuántos Claudes desatendidos pueden haber». Medido en producción (`docs/investigaciones/mediciones/2026-10-25-por-que-esperan-los-trabajos.md`): `EXECUTE_MAX_MACHINES` 6 y `QUEUE_CONCURRENCY` 12 (de ahí 10 sesiones) no retenían nada; retenía el gasto reservado por las sesiones en curso. El 6 salía de la memoria del anfitrión por conexión remota (175 MB cada una) y el 2 anterior, de una cuota de núcleos que ya no gobierna con la máquina compartida.
**Decisión:** (1) Se quitan `EXECUTE_MAX_MACHINES` y `EXECUTE_CONCURRENCY`, y un trabajo `execute` no ocupa un lugar de `QUEUE_CONCURRENCY` (la sesión corre en una máquina; el trabajador sólo la espera). (2) Lo único que detiene un trabajo nuevo es el presupuesto diario (`EXECUTE_DAILY_BUDGET_USD`, con la reserva de lo que los trabajos vivos pueden todavía gastar) y, como límite externo, la capacidad que el anfitrión declara con el código 75 al crear la máquina; el hilo la dice con las palabras de la cuota de Google cuando el anfitrión informa cuántas máquinas admitió. (3) Las entregas a producción conservan su carril de uno: es un orden (dos entregas chocan en el mismo `main`), no un tope de sesiones.
**Alternativas descartadas:**
- Subir el número (de 6 a otro): sigue siendo un número elegido, y la plata ya acota.
- Contar las sesiones vivas con un guion por sesión: multiplica procesos en la máquina de producción (compuerta de UD-301).
**Consecuencias:** `src/config.js`, `src/queue/index.js`, `src/worker.js`, `src/execute/handler.js`, `plataforma/docker-compose.yml` del anfitrión. Un trabajo `local` (sin máquinas) tampoco tiene tope: es para anfitriones chicos o pruebas. Pruebas en `src/queue/caza.test.js` y `src/execute/execute.test.js`.
**Condiciones de reversión:** Las fija Martín.

## [UD-305] Lo que una sesión reserva del día sale de lo que cuestan las sesiones
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25: «no tiene sentido que limitemos cuántos Claudes desatendidos pueden haber; lo único es el tope máximo de plata». Medido en producción (`docs/investigaciones/mediciones/2026-10-25-por-que-esperan-los-trabajos.md`): los trabajos 164 y 168 esperaron con `budgetWait`; `EXECUTE_DAILY_BUDGET_USD` 40, gasto del día 3,76 USD, y cada sesión viva reservaba 10 USD (valor por omisión de UD-255, un número elegido), de modo que tres sesiones reservaron 30 y la cuarta el saldo. Los últimos trabajos terminados costaron entre 0,48 y 1,87 USD (`execute_runs.cost_usd`) y el más caro de la noche, 3,1 USD, se cortó a los 60 min: la reserva retenía entre 5 y 20 veces lo que una sesión gasta.
**Decisión:** (1) La reserva de una sesión es el percentil 90 de `jobs.cost_usd` de los trabajos `execute` terminados del mismo modelo en los últimos 7 días. Si la ventana tiene menos de 10, se amplía hacia atrás hasta los últimos 10, sea cual sea su edad; con menos de 10 en total, el máximo de los que haya. Cuentan los terminados (`done` o `failed`) con costo medido mayor que cero. Una máquina suma su costo fijo (`EXECUTE_MACHINE_COST_USD`), que el día cuenta y `jobs.cost_usd` no tiene. (2) Sin ningún dato del modelo, la reserva es `EXECUTE_SESSION_RESERVE_FALLBACK_USD`, declarada como cortesía: 10 USD, el valor de UD-255, sin medición detrás, y sólo hasta el primer trabajo terminado de ese modelo. (3) `EXECUTE_SESSION_RESERVE_USD`, si está declarada, manda sobre la medición. (4) El tope de una sesión (`--max-budget-usd`) sigue siendo `EXECUTE_MAX_BUDGET_USD` o lo que quede del día si es menos: la reserva es lo que se espera que gaste, el tope es lo que puede gastar. (5) La primera sesión empieza mientras quede algo del día; las siguientes, sólo si el día deja al menos su reserva. (6) La reserva sigue al costo real: si la sesión ya gastó más de lo que reservó, reserva lo gastado. Se libera al terminar el trabajo, y desde ahí cuenta como gasto en `jobs.cost_usd`. (7) El log y el hilo de espera dicen la reserva y su origen (`reserve_usd`, `reserve_basis`: `knob`, `measured` o `fallback`).
**Alternativas descartadas:**
- Bajar el 10 a otro número fijo: sigue siendo un número elegido, y la medición ya existe.
- Fijar el tope de la sesión en la reserva: cortaría a las sesiones que pasan del percentil 90 (una de cada diez) en medio del trabajo; el tope del día lo gobierna el gasto real, no el estimado.
- Calcular la reserva como `EXECUTE_TIMEOUT_MS` por un costo por minuto: no hay una medición de costo por minuto de las sesiones sin datos, y con datos el percentil ya la contiene.
**Consecuencias:** `src/execute/budget.js` (`sessionReserve`, `admitSession`, `percentile`), `src/execute/handler.js`, `src/config.js`. Pruebas en `src/execute/session-reserve.test.js` (con 4 trabajos de 1 USD medidos y 40 USD de presupuesto caben 40 sesiones y no 4; perilla; sin datos, respaldo; ventana) y en `src/execute/caza.test.js` (tres sesiones juntas bajo un día de 3 USD). Con sesiones que superen su reserva el gasto del día puede pasar un poco el tope hasta que sus costos llegan; la reserva que sigue al costo real y el saldo que ve cada sesión nueva lo acotan.

## [UD-306] Un campo que no tiene dato no se dibuja, y lo que es del modelo o del sistema no es campo de persona
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 14:0x, mirando el detalle del mensaje #123, textual: «estos campos de acá son totalmente inútiles y nadie que los lea va a hacer nada con estos datos. Yo creo que cada mensaje debería tener su descripción, un contexto inferido y algo así; todos estos campos que quedaron como "No indicado" o "Completar" probablemente siempre van a quedar así, entonces no nos sirven esos campos en la plantilla y están puros gastando espacio, espacio muy valioso. Trata de mirarlo con un ojo de águila y ver si hay un patrón subyacente o varios que causan este tipo de problemas». Medición en producción (`messages.fields_json`, 9 mensajes, 2 plantillas en uso): en Capacidad nueva, «Quién lo necesita», «Cómo se sabrá que está listo», «Qué queda para después» y «Cómo se deshace» tienen contenido en 0 de 4; «Qué falta y de quién es el valor» y «Límites que toca» dicen «No indicado» en 2 de 4. En Arreglo, «Quién lo vio» tiene contenido en 1 de 5 y «Cómo se deshace» en 0 de 5; «Qué falta» y «Límites» llevan «nadie» y «ninguno» en 5 de 5. Con contenido real, «Necesidad» y «Qué debería hacer» repiten el título y la descripción en un 81 y un 82 % de sus palabras; «Qué pasa», en un 66 %.
**Decisión:** (1) El detalle y la propuesta dibujan sólo los campos con dato: ni vacíos, ni «No indicado» (la marca que el propio analizador escribe en un obligatorio sin dato). Un obligatorio vacío sí se dibuja y lo dice. (2) Quien edita agrega un campo ausente desde una fila de nombres bajo los campos, sin un hueco por cada uno. (3) Lo que se le pregunta al modelo o al sistema no es campo de persona: «Qué falta y de quién es el valor», «Límites que toca» y «Cómo se deshace y cuánto cuesta» salen de las plantillas porque el analizador ya los guarda como `value_holder`, `guards_touched` e `irreversibility` y se leen en el pliegue Evaluación. (4) Un campo que repite la descripción sale: «Necesidad» y «Qué debería hacer» pasan a un solo «Contexto» opcional, «Qué pasa» queda en la descripción. Ninguna plantilla tiene ya un obligatorio, porque un obligatorio sin dato obliga al modelo a escribir el relleno. (5) Lo que un mensaje viejo guardó bajo un nombre que su plantilla ya no pide se conserva, se muestra en Evaluación como «Datos anteriores» y no hace fallar la edición de otro campo; un nombre nuevo o un cambio de plantilla siguen validándose entero.
**Alternativas descartadas:**
- Ocultar los campos vacíos sólo con CSS: el espacio se recupera y el relleno sigue en la base y en el texto que lee el modelo que ejecuta el mensaje.
- Quitar sólo «Completar» y dejar el rótulo: un rótulo sobre nada sigue gastando la línea.
- Borrar de los mensajes viejos lo que ya tenían: es contenido de una persona o del analizador; se conserva y se lee.
**Consecuencias:** `panel/src/components/TemplateFields.tsx`, `Assessment.tsx`, `EditableText.tsx` (`startEditing`), `panel/src/lib/template.ts` (`isStated`, `retiredValues`), `src/domain/messages.js` (nombres antiguos en la edición). Pruebas: `panel/src/components/TemplateFields.test.tsx` y un caso en `src/api/editing.test.js`. Las plantillas de producción se acortan en el archivo de carga del repositorio del anfitrión.
**Condiciones de reversión:** Las fija Martín.

## [UD-307] Una idea se construye y se muestra; sólo el visto de una persona la publica
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 13:5x, textual, sobre el mensaje 124 de uno de los médicos del equipo («una página de [el sitio de la empresa] con una sola pantalla con la esfera de la IA de venta, que además muestre videos e información»): «Tu idea de que eso lo decida una persona es súper simplista. No es eso, sino que hay que entender bien qué es lo que se está pidiendo y el espíritu del mensaje. Y en este caso lo que el doctor dijo es una idea; entonces, si es una idea, no hay que cambiar nada permanentemente sin aprobación o sin un visto humano». Y la corrección de diseño del mismo día: no poner un umbral ni una perilla sobre un número de 0 a 1 para decidirlo, porque es otra vez un cajón; lo único booleano es la Guardia.
**Decisión:** (1) La Guardia es «nada cambia de forma permanente sin el visto de una persona cuando lo pedido es explorar una idea». El analizador la juzga por mensaje, leyendo el espíritu de lo pedido y a quien lo escribe, y devuelve `idea_guard` (booleano) con `idea_reason` (una frase), junto con `idea` (0 a 1), que es contexto para la sesión y para el juicio del trabajo y no decide nada. Se guardan en `estimates_json`. (2) El sistema sólo obedece el booleano: con `idea_guard: true` la sesión construye y muestra (rama, capturas, video y una vista previa si las reglas del anfitrión la describen), el hilo recibe «Lista para ver» en lenguaje natural y no se encola ninguna entrega; el trabajo queda como entrega retenida (UD-275). No hay botón: la respuesta de una persona en ese hilo vuelve a lanzar a Claude como lo hace una mención, con todo el hilo, y el modelo lee lo que la persona escribió (seguir explorando, cambiar algo o publicarlo) y actúa; si entiende que debe publicarlo, entrega por el camino normal (UD-298, campo `review: approve` de UD-280). La única condición que el sistema verifica es estructural: quien responde es un miembro persona y existe una muestra esperando. Con `idea_guard: false`, o en un mensaje anterior que no lo trae, la entrega sigue como siempre; una entrega aprobada de antemano (UD-286) o la pasada que arregla una verificación caída no se retienen otra vez. (3) Un mensaje analizado antes de que existiera la Guardia (sin `idea_guard` booleano en su evaluación) se juzga al arrancar su trabajo: `src/execute/idea-guard.js` pide al modelo barato sólo esa Guardia y su razón, la guarda junto a la evaluación existente y recién entonces el trabajador decide; si el juicio no se puede hacer, el trabajo se reintenta y nunca entrega sin él. (4) La sesión recibe el bloque `exploration` en la parte variable del prompt, sin léxico especializado: propone, muestra alternativas si las hay y pregunta lo que de verdad falta.
**Alternativas descartadas:**
- Un umbral y una perilla del área sobre `idea` para decidir si se publica: un número elegido que hace de cajón; la decisión la toma el modelo y el sistema obedece un booleano.
- Dejar la decisión a una persona de entrada en cada mensaje: devuelve el juicio a quien delegó (Martín: «súper simplista»).
- Una lista de palabras o un patrón sobre el texto («quizás», «me gustaría») para reconocer una idea: un `if` sobre texto humano (invariante 11 del anfitrión).
**Enmienda, 2026-10-25 14:5x:** Martín rechazó el botón «Publicar» que esta decisión traía, textual: «Nunca pedí un botón publicar, eso va CONTRA [el marco]; la idea es interactuar con Claude como si fuera un alumno en práctica; bastaría con una respuesta de un miembro distinto a Claude diciéndole qué tiene que hacer». Es la misma falta de los botones sí/no/comentario del 24-10: un miembro escribe lo que quiere. Se retiran el botón, `PublishIdea.tsx` y el campo `publishable`; la columna `replies.publish_json` de la migración `0037` queda sin uso, porque la migración ya está publicada.
**Consecuencias:** `src/analyze/schema.js`, `prompts-es.js`, `prompts-en.js`, `validate.js`, `src/domain/assessment.js`, `proposals.js`, `messages.js`, `src/execute/handler.js`, `prompt.js`, `approve.js`, `routes.js`, `src/domain/messages.js` (`addReply`). Pruebas en `src/execute/idea-se-muestra.test.js` y `src/analyze/assessment.test.js`. Una medición del juicio del analizador sobre mensajes reales (el 124 y uno decidido) queda por correr con el modelo vivo; el juicio de cada trabajo mostrado dirá después si el criterio fue adecuado.
**Condiciones de reversión:** Las fija Martín.

## [UD-308] Con un anfitrión que gobierna la identidad, la entrada es la del anfitrión
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 14:4x, volvió al panel del equipo y vio el formulario propio de correo y contraseña; al enviarlo, `POST /api/auth/login` respondió 404. Medido en producción: la tabla `credentials` está vacía y todos los miembros entran por el ingreso firmado del anfitrión (`identity_links`, proveedor `host-role`). El borde manda a `/session/login` sólo cuando no hay cookie de sesión; con una cookie vencida o inválida la petición llegaba a Team Platform, que dibujaba un formulario sin salida para todos.
**Decisión:** Cuando el anfitrión gobierna la identidad (`jwt` con `JWT_JWKS_URL` o `JWT_SECRET`, `signed-header` o `trusted-header`), una sesión ausente, vencida o inválida lleva a `HOST_LOGIN_URL` (por omisión `/session/login`). El servidor responde las páginas del panel con un 302 a esa dirección y el destino original en `next`; el 401 de la API trae `login_url` con la misma dirección; el panel, al recibir ese `login_url`, redirige y no dibuja el formulario. El formulario propio sólo existe sin anfitrión. `sso-redirect` conserva su ruta de inicio.
**Alternativas descartadas:**
- Arreglar sólo el borde del anfitrión para tratar la cookie vencida como ausente: deja el defecto en Team Platform para cualquier otro anfitrión.
- Quitar el formulario del panel: un despliegue sin anfitrión lo necesita.
**Consecuencias:** `src/config.js` (`hostEntryUrl`, `HOST_LOGIN_URL`), `src/identity/index.js`, `src/api/index.js`, `panel/src/App.tsx`, `.env.example`. Pruebas: `src/api/host-entry.test.js` y `panel/src/host-entry.browser.test.mjs`.
**Consecuencias:** `src/analyze/schema.js`, `prompts-es.js`, `prompts-en.js`, `validate.js`, `src/domain/assessment.js`, `proposals.js`, `messages.js`, `src/execute/handler.js`, `prompt.js`, `approve.js`, `routes.js`, `panel/src/components/PublishIdea.tsx`. Pruebas en `src/execute/idea-se-muestra.test.js` y `src/analyze/assessment.test.js`. Una medición del juicio del analizador sobre mensajes reales (el 124 y uno decidido) queda por correr con el modelo vivo; el juicio de cada trabajo mostrado dirá después si el criterio fue adecuado.
## [UD-309] La vista del mensaje pone el texto primero y junta lo que explica el análisis
**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25, sobre el mensaje #123: «esa es la vista que vamos a tener que ver para darle trazabilidad a cualquier encargo, tiene que ser mucho más eficiente visualmente». Dibujó sobre la captura: Reenviar y Borrar a la línea del título, el contador de respuestas junto al título, sin la marca «IA», un solo pliegue «Detalles» con lo útil, la columna del hilo «más angosta» y el ancho del navegador aprovechado. La vista tenía cuatro pliegues de una fila cada uno, 40 % de la pantalla a la derecha para un hilo vacío y un margen lateral de 480 px a 1920 px.
**Decisión:** (1) Reenviar y Borrar van a la derecha de la línea del título; la barra superior conserva el regreso, Deshacer y Rehacer. (2) «Respuestas» con su cuenta queda pegado al título; el hilo ya no lleva cabecera propia. (3) La marca «IA» sale de esta vista. (4) Los destinatarios van en la misma línea que el área, el estado, el autor y la hora; si no caben, bajan a una fila pegada. (5) Evaluación, Tiempos, Detalle técnico, Adecuación y Observaciones son un solo pliegue «Detalles»; cada parte se dibuja sólo si tiene dato y, sin ninguna, el pliegue no se dibuja. Las partes se nombran dentro, no son pliegues. (6) La vista ocupa todo el ancho de la región (`Page cols="fill"`) y el hilo mide `clamp(26rem, 28%, 28rem)`; el mensaje toma el resto.
**Alternativas descartadas:**
- Un pliegue por parte con un contador común: sigue siendo una fila por parte y cuatro clics.
- Un ancho máximo para el texto: Martín pidió que el mensaje use el ancho y el margen muerto es lo que se quitó.
**Consecuencias:** `panel/src/pages/MessageDetail.tsx`, `panel/src/components/Details.tsx` (nuevo), `Assessment.tsx`, `Timing.tsx`, `Observed.tsx`, `ReplyThread.tsx`, `Page.tsx`. Prueba de navegador `panel/src/flows-vista-del-mensaje.browser.test.mjs` a 1920, 1440 y 390 px, claro y oscuro. El visor de adjuntos, su pie y el cuadro «+» los cambia otro encargo.
**Condiciones de reversión:** Las fija Martín.

## [UD-310] Lo terminado se cierra solo

**Fecha:** 2026-10-25
**Contexto:** Martín, 2026-10-25 20:3x: «si algo queda cerrado, debe marcarse como cerrado». Con UD-271 el sistema sólo cerraba si el modelo lo pedía (`close`), y encargos entregados y comprobados quedaban abiertos y parecían sin atender.
**Decisión:** (1) Un mensaje cuyo trabajo quedó terminado se cierra sin depender de que el modelo lo pida. Terminado es: la entrega salió con código 0 y quedó comprobada en producción, o el resultado no cambia nada (`investigated`) y ya respondió. (2) No se cierra solo lo que no está terminado: una idea que espera la respuesta escrita de una persona (UD-307: sin entrega, sigue abierta hasta que esa respuesta la publique), una Guardia sobre una persona (UD-295), un traspaso a una persona (`needs_decision`, `not_mine`, `blocked`, entrega retenida con 76), un mensaje editado durante la corrida, una captura «Antes» sin «Después» ni un cambio de pantalla sin captura (UD-298), ni si una persona escribió en el hilo después de la primera respuesta del agente en esa corrida y la sesión todavía no la atendió. (3) `close` y `close_reason` pasan a ser opcionales en el efecto: con `close: true` y motivo, el motivo de la sesión es el de la línea «Cerrado: …»; sin ellos, el sistema escribe una línea fija con el hecho («Entregado y comprobado en producción.» o «Revisado, no había nada que cambiar.»). `close: false` ya no impide el cierre: decide el resultado y no la petición. (4) La entrega que sale de la aprobación de una idea (UD-280) cierra igual al llegar a producción. Una mención sin entrega no cierra (UD-278). `EXECUTE_AUTO_CLOSE=off` sigue sin cerrar nunca.
**Consecuencias:** Enmienda UD-271 (condición 2 y apartado 3) y MASTER-SPEC §7.5 «Cierre por Claude». `src/execute/auto-close.js`, `deliver.js`, `handler.js`; pruebas en `auto-close.test.js` y C14 del contrato.
**Condiciones de reversión:** Las fija Martín.

## [UD-311] El contrato de anfitrión tiene versión y sólo cambia de forma aditiva por ahora
**Fecha:** 2026-10-26
**Contexto:** Martín, 2026-10-26: «Quiero que todo lo que hemos hecho en Team Platform tratemos de integrarlo en la versión canónica de Team Platform, que es el repositorio Team Platform, porque siempre fue conceptualizado como un sistema open source». El contrato entre el núcleo y un anfitrión estaba repartido entre MASTER-SPEC §7.5, `.env.example` y el código, sin versión ni prueba que dijera si un driver lo cumple.
**Decisión:** (1) El contrato vive en `docs/CONTRATO-DE-ANFITRION.md` y lleva `contract_version`, hoy 1. (2) `GET /health` publica `contract_version`, y el driver puede declarar la versión que cumple con `EXECUTE_CONTRACT_VERSION`: con otra versión mayor el trabajador no arranca, y sin declararla arranca igual. (3) `scripts/host-conformance.mjs --driver <dir>` es la prueba de conformidad. (4) Mientras el primer anfitrión estabiliza su camino a producción, el contrato sólo cambia de forma aditiva: variable nueva con omisión, orden opcional o campo nuevo en `/health`. Un cambio incompatible sube la versión.
**Alternativas descartadas:**
- Dejar el contrato en MASTER-SPEC §7.5: un segundo anfitrión no puede saber qué es obligatorio ni qué versión cumple.
- Subir la versión con cada variable nueva: obliga a cada driver a declarar de nuevo sin que nada se haya roto.
**Consecuencias:** `docs/CONTRATO-DE-ANFITRION.md`, `docs/MASTER-SPEC.md` §7.5 «Ejecución», `src/config.js`, `src/api/index.js` y `scripts/host-conformance.mjs`, estos tres últimos en piezas aparte del plan.
**Condiciones de reversión:** Las fija Martín.

## [UD-312] La estética del panel es la actual, DISENO.md es su referente y nada la rediseña

**Fecha:** 2026-10-27
**Contexto:** Antes de integrar piezas al canónico, la auditoría de identidad (`origin/wt-identidad`, `docs/investigaciones/identidad-2026-10-26/`) propuso una dirección nueva y midió dos derivas respecto de `panel/DISENO.md`: Orbitron fuera de los títulos (`cd001a46`) y las luces de estado reemplazadas por marcas de contorno (`56a49550`, `99e34df1`). Martín, 2026-10-27 00:45, textual: «no perdamos tiempo en esto. Solo me importa que lo que vaya integrándose al canónico lo haga siguiendo su estética actual sin estropearla».
**Decisión:** (1) No hay rediseño: la propuesta y los bocetos de esa auditoría quedan descartados y no se usan. (2) `panel/DISENO.md` es el referente de la estética del panel. Un cambio de tokens, colores, fuentes o materiales que no esté en ese documento no entra a `panel/src/styles.css` ni a un componente; si hace falta, primero se cambia el documento, con su medición. (3) Las dos derivas estaban decididas por escrito (UD-036, UD-041, UD-100, UD-130 y los hallazgos H-355 y H-541), así que el panel no se toca y `DISENO.md` pasó a decir lo que el panel es hoy.
**Alternativas descartadas:**
- Reponer Orbitron en los títulos y la luz con halo en las marcas de estado: contradice decisiones escritas del dueño (UD-041, UD-100, UD-130) y mediciones de legibilidad (J1-A-55).
- Adoptar la dirección de la auditoría: Martín pidió no perder tiempo en esto.
**Consecuencias:** `panel/DISENO.md` abre con su condición de referente y documenta dónde hay luz de estado y dónde contorno, y que Orbitron es sólo la marca.
**Condiciones de reversión:** Que Martín pida un rediseño.

## [UD-313] Un límite de una persona no se cruza sin que una persona lo levante, y el juez se mide contra anclas y evidencia

**Fecha:** 2026-10-26
**Contexto:** Sin cita del dueño: es una decisión técnica que sale de la auditoría de coherencia del método de reparto (2026-10-26) y del propio método. El método define el límite como la única restricción booleana, que no se cruza por defecto, y exige que cruzarlo sea una decisión explícita de una persona. En el producto, una Guardia `person` tocada (UD-295) sumaba a una persona a los asignados y Claude no cerraba solo. El trabajo seguía, y la entrega llegaba a producción sin que nadie levantara el límite. Para dinero o algo irreversible la diferencia importa. La misma auditoría midió cuatro defectos del juez de trabajos. Puntuaba sin las anclas de los niveles y sin ver la descripción del área ni la del proyecto. Aceptaba cualquier salida, con ids repetidos o faltantes y citas que no están en la evidencia. Tres indicadores (3.2, 4.2, 4.3) pedían evidencia que no recibe. El intento del modelo ligero que escalaba nunca se juzgaba, y eso inclinaba la comparación entre modelos hacia el ligero.
**Decisión:**
(1) Mientras un mensaje toque una Guardia `person` que ninguna persona levantó, la entrega a producción espera. La plataforma la retiene en el trabajo `deliver`, antes de correr la orden del anfitrión, con el mecanismo que ya existe: el mismo efecto del código 76 (`delivery_held`, UD-266), la revisión de UD-275 (`pending_delivery`) y el traspaso a quien decide en el área (UD-269). No hay tabla, endpoint ni estado nuevos.
(2) La levanta un acto explícito de una persona sobre esa revisión: aprobar la entrega a mano o con `review: approve` en el hilo (UD-280, UD-284). Eso llega a `deliver` como `requested_by` y sólo cuenta si es un miembro activo de tipo `person`. La aprobación de antemano (`approved`, UD-286) se dio antes de que el límite se mostrara y no lo levanta; un agente tampoco.
(3) Cada levantamiento queda en la auditoría como `message.guard_lifted`: quién, qué Guardias y qué trabajo de entrega dejó pasar. Vale para ese mensaje, de modo que una segunda pasada de verificación no vuelve a pedirlo, y no para los siguientes.
(4) A la sesión se le dice, en el bloque `expectation`, que esa Guardia no se cruza sin que una persona la levante: debe nombrar cuál toca y qué pasa si se cruza, y proponer una alternativa que haga lo pedido sin cruzarla. Puede preparar el trabajo en la rama. El sistema no lee su prosa: la retención depende de ids y de quién aprueba.
(5) El cierre sigue siendo de la persona mientras haya una Guardia `person` tocada, como antes (`closeReason`).
(6) El juez recibe las anclas de los cinco niveles de cada indicador (`KPIS[].levels`, reescritas para un trabajo sin supervisión), la descripción del área y la del proyecto como evidencia delimitada, y cada intento lleva la nota `no_cerro` cuando no cerró. Su respuesta se valida: cada indicador una vez, cada cita presente en la evidencia entregada (sin distinguir espacios). Una respuesta que no valida no se guarda como juicio; el costo se cuenta y el motivo queda en la auditoría como `job.judge_rejected`.
(7) El 3.2 pasa a llamarse «Comprensibilidad del resultado» y mide lo que se le entrega a la persona, porque la experiencia de la persona durante la sesión no existe en un trabajo sin supervisión. El 4.2 sólo cuenta las intervenciones que la respuesta final y la salida técnica dejan ver, con tres intensidades en sus anclas. El 4.3 declara que necesita la primera propuesta como evidencia (`requires`) y el sistema lo deja sin puntuar mientras la plataforma no la entregue.
(8) Se juzgan todos los trabajos, también el intento del modelo ligero que no cerró y sigue el mayor. `judgmentsOfMessage` los devuelve todos; `judgmentOfMessage` mantiene el último.
**Alternativas descartadas:**
- Un mecanismo de anulación propio (estado nuevo del mensaje, botón y tabla de levantamientos): duplica la revisión de UD-275 y el traspaso de UD-269, que ya hacen esperar, avisar y registrar.
- Detener la sesión de Claude en cuanto toca el límite y exigir `needs_decision`: Claude pierde el trabajo preparado en la rama y la persona decide sin verlo; la espera en la entrega protege lo mismo.
- Aceptar la aprobación de antemano como levantamiento: el límite todavía no se había mostrado, y el método pide que se levante tras advertir.
- Descartar sólo el indicador cuya cita no está en la evidencia: deja un juicio parcial que parece completo; una salida que no valida no es un juicio.
- Puntuar 4.2 y 4.3 sin su evidencia: producen números que no se pueden comparar con nada.
**Enmienda, 2026-10-27 (segunda auditoría de coherencia del método de reparto; sin cita del dueño):** La auditoría midió que los puntos (1) a (3) sólo se cumplen con `EXECUTE_DELIVER_COMMAND` declarada. Sin esa orden la sesión entrega por las reglas del anfitrión, el trabajo `deliver` no existe, la retención no corre y la espera de una idea (UD-307) tampoco. El límite tiene que sostenerse en los dos modos de entrega. Se elige el mecanismo más chico que no abre una puerta lateral y que cabe en el contrato aditivo.
(a) Con la orden de entrega nada cambia: retiene el trabajo `deliver`.
(b) Sin ella, el anfitrión declara en su archivo de guardias (`EXECUTE_GUARDS_FILE`) la lista `commands.deliveries`: las órdenes de Bash que ponen trabajo en producción, con la forma de una regla (`match`, `unless`, `message`). Mientras el mensaje toque un límite de persona sin levantar, o una idea no esté liberada, la sesión nace con esas órdenes negadas por el gancho de órdenes que ya existe (`team hook commands`), con el motivo del anfitrión y, después, el que escribe el sistema. Lo que la sesión deja en la rama con `outcome: done` no se cierra ni se entrega: va a quien decide en el área como entrega retenida (UD-275, UD-269), con `delivery_held`, el motivo y la auditoría `message.limit_held` (o `message.idea_shown`).
(c) Lo levanta el mismo acto explícito: `review: approve` de una persona activa en el hilo. Sin orden de entrega no hay trabajo `deliver` que aprobar, así que el sistema levanta los límites abiertos (`message.guard_lifted`), anota `message.hold_released` y lanza una pasada nueva con `released_by`, la única que no lleva las órdenes negadas. Una respuesta que no resuelve nada (`review: none`) deja el límite cerrado. La aprobación de antemano (`approved`) tampoco levanta nada en este modo.
(d) Sin lista declarada nada puede negar la entrega, y eso se declara como estado degradado: `GET /health` pasa a `degraded` cuando alguna área tiene un límite de persona (`limits.degraded`), el campo `limits` dice el modo (`deliver`, `hook` o `none`) y el trabajador lo avisa al arrancar. La sesión recibe la instrucción de no entregar y el mensaje sigue sin cerrarse solo, pero eso es una instrucción. El muro cubre lo que se entrega por las órdenes que el anfitrión lista. Lo que la sesión hace mientras trabaja (pagar, enviar, borrar) necesita su propio mecanismo declarado en la Guardia.
(e) Un límite instalado después de evaluar el mensaje retiene igual. `messages.guards_seen_json` (migración `0041`) guarda los ids que el analizador vio. Al arrancar el trabajo, las Guardias del área que el mensaje nunca conoció se juzgan una vez (`src/execute/guards-judge.js`, la misma llamada que la Guardia de la idea de UD-307) y las que aplican se suman a `guards_json`. Un mensaje anterior a la migración las juzga todas una vez.
(f) La salida de la plantilla se lee: los booleanos `touches_<nombre>` (el `key` de la Guardia, que el Editor puede escribir, o su id) se cruzan con las Guardias que marcó el analizador. Una que la sesión declara tocar y el analizador no marcó se trata como tocada: se suma al mensaje (`message.guards_declared`) antes de entregar o de traspasar, y el juez la ve.
(g) El juez recibe `idea` como contexto del juicio (bloque `idea_del_pedido`), como promete UD-307.
(h) El juez sólo cuenta para decidir mientras está calibrado contra personas. `EXECUTE_JUDGE_REFERENCE_FILE` nombra un archivo con los puntajes que personas dieron, sin ver los del juez, a trabajos que el juez también juzgó. El alfa de Krippendorff ordinal se calcula por eje entre el juez y las personas, con intervalo por remuestreo sobre trabajos (`src/execute/judge-calibration.js`). Un eje está calibrado con alfa de 0,80 o más y el extremo inferior del intervalo en 0,667 o más (Krippendorff, 2004, *Content Analysis*, 2.ª ed., p. 241); el juez lo está si lo están todos los ejes que el archivo cubre y hay al menos dos personas. Mientras no, los juicios se muestran con `calibrated: false` («Sin calibrar» en el panel) y `judgmentsForDecisions` no entrega ninguno: no mueven un área al modelo mayor ni fijan los límites del modelo liviano. `/health` publica el estado en `judge`.
(i) La meta de un eje se calcula sobre los indicadores puntuados. Con el 4.3 sin puntuar, el eje 4 de «elegir» y «negociar» pide +2 en 4.1 y 4.2. El eje informa `kpis` de `defined` y `partial: true`, y un eje parcial se compara con ejes de la misma forma y no con uno completo.
(j) La sesión recibe la descripción del área en el bloque `area_description`, porque el juez la mide contra ella.
(k) La escalada al modelo mayor lleva su disparador en la auditoría. `trigger: 'declared'` cuando la sesión dice `cannot_close` o termina `blocked`; `trigger: 'checked'` cuando la verificación de la entrega quedó en rojo. Sólo ese segundo caso es comprobado. Una falla silenciosa (terminar sin cambios y sin avisar) no escala por ninguna de las dos vías.
**Alternativas descartadas de la enmienda:**
- Declarar sólo el estado degradado en `/health`: no sostiene el límite en el anfitrión que sí conoce sus órdenes de entrega. Queda como último recurso del punto (d).
- Un conjunto fijo de órdenes que el núcleo niegue: el núcleo no conoce cómo entrega cada anfitrión.
- Dejar que cualquier respuesta de una persona en el hilo levante el límite: no sería un acto explícito.
**Consecuencias:** Aditivo: un área sin Guardias `person` no cambia. Un anfitrión con Guardias `person` verá más entregas retenidas, sin cambiar su orden de entrega. `src/domain/assessment.js` (`openPersonGuards`, `liftPersonGuards`, `declaredGuards`), `src/execute/deliver.js`, `src/execute/handler.js`, `src/execute/judge.js`, `src/execute/limits-hold.js`, `src/execute/guards-judge.js`, `src/execute/judge-calibration.js`, `src/execute/hooks/guards.js`, `docs/MASTER-SPEC.md` §7.5, `docs/CONTRATO-DE-ANFITRION.md`. Pruebas en `src/execute/deliver.test.js`, `judge.test.js`, `area-model.test.js`, `limite-sin-orden-de-entrega.test.js` y `judge-calibration.test.js`. Corrige además el número de la migración de UD-295, que es la `0036`.
**Condiciones de reversión:** Las fija Martín.
