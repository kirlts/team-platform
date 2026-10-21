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

## [UD-018] El idioma de salida del análisis se fija por cuenta y se puede cambiar por envío

**Fecha:** 2026-10-20
**Contexto:** Con UD-015 los prompts del analizador pasan a inglés. Hacía falta fijar en qué idioma se redactan los mensajes que produce.
**Decisión:** Martín, textual: «si vamos a tener prompt en inglés necesitamos poder fijar de alguna forma el lenguaje de output y que por defecto sea el que está configurado por cuenta». Cada miembro tiene un idioma en su cuenta (Configuración, por omisión el del equipo, `OUTPUT_LANGUAGE`, que por omisión es `es-419`: Martín, textual, «por defecto el lenguaje configurado debe ser español latino neutro»); el análisis de un envío redacta títulos, cuerpos y campos en el idioma de la cuenta de quien envía, y la barra de envío permite cambiarlo para ese envío. El idioma viaja al modelo como dato del contexto (un código BCP 47), nunca se deduce con reglas sobre el texto.
**Alternativas descartadas:**
- Responder en el idioma del input: un audio en inglés de un cliente produciría mensajes en inglés para un equipo que trabaja en español.
- Un idioma fijo para todo el equipo: no permite a un miembro que trabaja en otro idioma.
**Consecuencias:**
- Columna `language` en `members`, campo opcional `output_language` en `POST /inputs`, `bundle.output_language` hacia el analizador, y una prueba con el proveedor real de que un input en un idioma sale redactado en el idioma pedido.
**Condiciones de reversión:** Ninguna prevista.

## [UD-019] Lo que redacta el analizador no lleva las marcas de la escritura generada por IA

**Fecha:** 2026-10-20
**Contexto:** Los mensajes que produce el analizador los lee el equipo y, a veces, el cliente.
**Decisión:** Martín, textual: «es de suma importancia evitar los vicios de Signs of AI writing en el output de team-platform». La guía de Wikipedia «Signs of AI writing» se convierte en un contrato de redacción corto dentro del prompt de descomposición (hechos llanos, título con verbo y objeto, sin trascendencia inflada, sin adjetivos promocionales, sin atribuciones vagas, sin «no es X, sino Y», sin grupos de tres de relleno, sin vocabulario típico de IA en inglés ni en español, sin raya larga, sin negritas, sin emoji, sin cierre que resume, sin charla colaborativa).
**Alternativas descartadas:**
- Un filtro que reescriba o corte la prosa del modelo después de generarla: oculta el defecto en vez de corregir la causa, que está en el contexto del modelo.
**Consecuencias:**
- El banco cuenta las marcas por mensaje en cada caso (`bench/ai-tells.js`, con la sección de la guía citada por patrón), y el objetivo es cero en todos los casos.
**Condiciones de reversión:** Ninguna prevista.
