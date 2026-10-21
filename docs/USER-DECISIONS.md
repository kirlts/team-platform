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
**Decisión:** Una ranura de proveedor por modalidad, configurable por el operador. Martín corrige el dato de partida: DeepSeek sí tiene visión (DeepSeek V4.1 Vision). La transcripción va por la API de Groq (gratuita, como en su repo `stt-nobara`, Whisper large-v3-turbo). El video se convierte a fotogramas «de forma eficiente y repetible».
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
**Decisión:** El emisor revisa y confirma. Y, textual: «DEBE haber una cola de trabajos como en Devalis que desacople completamente el procesamiento en curso del navegador».
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

## [UD-005] Idioma: como Devalis

**Fecha:** 2026-10-20
**Contexto:** Proyecto abierto escrito por alguien que piensa en español.
**Decisión:** «Como Devalis: código en inglés, comentarios y docs en español». Identificadores, esquema, rutas y nombres de archivo de código en inglés; comentarios, eje documental y textos de trabajo en español.
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
