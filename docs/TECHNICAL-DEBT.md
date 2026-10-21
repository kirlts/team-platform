# Technical Debt

> Archivo temporal y autoliquidable. Se borra cuando el 100 % de las tareas está completo.

| Símbolo | Significado |
|---|---|
| 🚨 | Bloqueo crítico o deuda técnica urgente |

---

## [DT-007] Dos prohibiciones de alta prioridad sin cierre

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** HP-003, HP-010, HP-015 y HP-018 tienen prueba completa con su ID (2026-10-21). Faltan dos. HP-019: con el proveedor real el monólogo del banco llega a 90 % de cobertura y el criterio es 100 %. HP-020: ninguna persona distinta de quien escribió cada pantalla la revisó en captura.
**Remediation plan:** HP-019: revisar la referencia de `03-monologo-prueba` y después el prompt, con `node bench/run.mjs --repeat 5` (TASK-024). HP-020: una persona mira las capturas de `cd panel && npm run build && npm run capturas` contra MASTER-SPEC §6 (TASK-019).
**Status:** ☐ Pending

## [DT-010] `VERIFICATION.md` no tiene checks

**Severity:** Medium
**Origin:** manual (`/document`, 2026-10-20)
**Description:** El archivo conserva el cuerpo de la plantilla y los checks de `docs/TODO.md` son las prohibiciones HP-001 a HP-029 de `docs/TEST.md`.
**Remediation plan:** Ninguno. El eje de verificación es `docs/TEST.md`.
**Status:** ✅ Descartada por el dueño el 2026-10-20 22:06 (H-45): «no necesitamos que ejecutes derive»

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
