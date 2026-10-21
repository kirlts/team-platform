# Technical Debt

> Archivo temporal y autoliquidable. Se borra cuando el 100 % de las tareas está completo.

| Símbolo | Significado |
|---|---|
| 🚨 | Bloqueo crítico o deuda técnica urgente |

---

## [DT-003] El proveedor de texto de respaldo no se usa

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** `src/providers/index.js` construye `textFallback` desde `TEXT_FALLBACK_*` y lo informa en `GET /health`, pero ningún paso del analizador ni del pipeline lo invoca. MASTER-SPEC §7.5 y la investigación 02 prevén ofrecerlo cuando el proveedor principal rechaza (`refusal`) o falla. Hoy un `refusal` falla el input con `error_code: refusal`.
**Remediation plan:** Decidir qué dispara el respaldo (rechazo, error de red, ambos), implementarlo en `callText` de `src/analyze/api.js`, probarlo con el proveedor falso y medirlo en el banco.
**Status:** ☐ Pending

## [DT-004] Falta el gancho de pre-commit contra credenciales

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** MASTER-SPEC §4.6 afirmaba que un gancho de pre-commit impide subir una credencial. El repositorio no tiene `core.hooksPath` ni un script de escaneo. Lo que existe: HP-007 (ninguna columna guarda una llave), `.gitignore` con `.env` y `.env.*`, y `scripts/llave.mjs`, que guarda las llaves fuera del árbol.
**Remediation plan:** Agregar un gancho versionado (`.githooks/pre-commit`) que escanee los archivos preparados con patrones de llaves de los proveedores configurados. Agregar una prueba que verifique que existe y falla ante una llave de ejemplo.
**Status:** ☐ Pending

## [DT-005] El tope de documentos difiere entre la subida y la extracción

**Severity:** Low
**Origin:** manual (`/document`, 2026-10-20)
**Description:** `UPLOAD_MAX_DOCUMENT_BYTES` vale 25 MiB (`src/config.js`) y `document.maxBytes` vale 24 MiB (`src/extract/config.js`). Un documento de entre 24 y 25 MiB sube bien, se encola y falla al extraer con `document_too_large`. El extractor no recibe la configuración de la aplicación (`src/contracts.md` §1), así que no se alinean solos.
**Remediation plan:** Bajar la subida a 24 MiB o subir el extractor a 25 MiB, según lo que indique el informe 05. Agregar una prueba que compare los dos topes.
**Status:** ☐ Pending

## [DT-006] La cabecera de `src/analyze/api.js` describe el diseño anterior

**Severity:** Low
**Origin:** manual (`/document`, 2026-10-20)
**Description:** El comentario inicial del archivo dice que la segunda llamada usa esfuerzo `medium` y exige `discarded`. El código usa `low` sin pensamiento y un esquema sin `discarded` (medición `2026-10-20-primera-corrida-real.md`). Un lector que se fíe del comentario entiende mal el analizador.
**Remediation plan:** Corregir el comentario durante la traducción a inglés de UD-015 (DT-009).
**Status:** ☐ Pending

## [DT-007] Prohibiciones de alta prioridad sin prueba propia

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** De las 20 prohibiciones de `docs/TEST.md`, estas no tienen prueba completa con su nombre. HP-003 no cubre `src/analyze/`: la prueba revisa `domain`, `api`, `identity`, `queue` y `events`. HP-010 (literales numéricos fuera de `src/config.js`) no tiene prueba. HP-015 la cubren hoy tres afirmaciones sueltas de `api.test.js`. HP-018 se cumple al extraer y no «antes de encolar», como decía el texto original. HP-019 no llega: el monólogo del banco alcanza 90 % de cobertura. HP-020 espera la revisión humana de pantallas.
**Remediation plan:** Extender HP-003 a `src/analyze/`. Escribir HP-010 y HP-015 como pruebas con su ID. Cubrir HP-018 por tipo de adjunto (el texto de TEST.md ya se corrigió). Cerrar HP-019 mejorando el caso 03 o su referencia. HP-020 la hace una persona.
**Status:** ☐ Pending

## [DT-008] Las capas 3 y 5 de la estrategia de pruebas no existen

**Severity:** Low
**Origin:** manual (`/document`, 2026-10-20)
**Description:** `docs/TEST.md` prevé pruebas de propiedades con `fast-check` y un recorrido con Playwright sobre la imagen Docker. `fast-check` no es dependencia de ningún `package.json` y el recorrido existe sólo como `src/testing/smoke-panel.mjs`, que se corre a mano.
**Remediation plan:** Agregar `fast-check` como dependencia de desarrollo para la numeración de unidades, el puntaje del banco y la fusión de trozos de audio. Convertir el humo del panel en un recorrido que levante la imagen con proveedores falsos.
**Status:** ☐ Pending

## [DT-009] El código y los comentarios siguen en español (UD-015)

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** UD-015 pasó al inglés los comentarios, los nombres y descripciones de pruebas, los mensajes de registro y los prompts del analizador. Al sincronizar, `src/`, `panel/`, `bench/` y `scripts/` conservan comentarios, nombres de prueba, registros y prompts en español. HP-008 sólo comprueba identificadores. Además sólo mira el núcleo (`config.js`, `server.js`, `worker.js`, `log.js`, `db`, `queue`, `api`, `events`, `identity`, `domain`, `testing`) y no `analyze`, `extract`, `providers`, `telemetry`, `panel` ni `bench`.
**Remediation plan:** Una pasada de traducción por módulo y actualizar HP-008 para que también falle ante comentarios en español. Los textos de interfaz, los mensajes de error que ve una persona y las plantillas de `templates/` se quedan en español.
**Status:** ☐ Pending

## [DT-010] `VERIFICATION.md` no tiene checks

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** El archivo conserva el cuerpo de la plantilla y espera a `/derive`. Mientras tanto, los checks de las tareas de `docs/TODO.md` son las prohibiciones HP-001 a HP-020 de `docs/TEST.md`, que no llevan el formato `[ACTOR.CAT.NN.VER]`.
**Remediation plan:** Ejecutar `/derive` y reemplazar las referencias a HP por los IDs de VERIFICATION.
**Status:** ☐ Pending

---

<!--
INPUT FORMAT:

## [DT-NNN] Debt item title

**Severity:** High | Medium | Low
**Origin:** [/fix | /derive | manual]
**Description:** [What is owed and why it exists]
**Remediation plan:** [How to resolve it]
**Status:** ☐ Pending | ✅ Resolved (YYYY-MM-DD)

SELF-LIQUIDATION RULE:
When 100% of the entries show ✅, this file is deleted from the repository.
Its resolution is backed up in CHANGELOG.md or MASTER-SPEC.md.
-->
