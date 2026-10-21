# TODO: team-platform v0.1.0

> Trazabilidad directa: cada tarea referencia checks de `VERIFICATION.md`.

## Leyenda de símbolos Kairós

| Símbolo | Significado |
|---|---|
| 🤖 | Check verificable por IA o herramienta automática |
| 🧑 | Check que requiere verificación humana |
| 🤖🧑 | Check pre-verificable por IA, validación final humana |
| ⏳ | En curso |
| 🔲 | Pendiente |
| 🚨 | Bloqueo crítico |

---

## [EPIC-001] Eje documental y diseño

> Ref: MASTER-SPEC §1 a §8

### [TASK-001] Inicializar el eje documental Kairós

> Ref: MASTER-SPEC §1

**Checks cubiertos:** Gobernanza transversal

- [x] `docs/` desde las plantillas, REPOMAP, `.gitignore` con el bloque Kairós `2026-10-20 21:05:00`
- [x] Decisiones UD-001 a UD-010 con las palabras de Martín `2026-10-20 22:10:00`
- [x] Investigación del motor de análisis y adjuntos en `docs/investigaciones/` `2026-10-20 21:50:00`
- [x] MASTER-SPEC §1 a §8, RULES, LICENSE MIT `2026-10-20 22:30:00`
- [ ] Ejecutar `/derive` sobre MASTER-SPEC para poblar VERIFICATION.md y las tareas de los épicos siguientes

### [TASK-002] Revisión humana del MASTER-SPEC

> Ref: MASTER-SPEC §1 a §7

**Checks cubiertos:** Gobernanza transversal `[Requiere validación humana]`

- [ ] Martín confirma o corrige §1 (vector, vocabulario, lo que NO es)
- [ ] Martín confirma o corrige §3 (valores por omisión por modalidad) y §5

---

## [EPIC-002] Núcleo: esquema, API y cola

> Ref: MASTER-SPEC §7.1, §7.2, §7.3, §7.10

*Tareas por derivar con `/derive`.*

## [EPIC-003] Extractores

> Ref: MASTER-SPEC §7.4, UD-009

*Tareas por derivar con `/derive`.*

## [EPIC-004] Analizador y proveedores

> Ref: MASTER-SPEC §7.5, §7.6, §7.9, UD-001, UD-008

*Tareas por derivar con `/derive`.*

## [EPIC-005] Panel

> Ref: MASTER-SPEC §6, §7.8, UD-006

*Tareas por derivar con `/derive`.*

## [EPIC-006] Identidad

> Ref: MASTER-SPEC §7.7, UD-002, UD-007

*Tareas por derivar con `/derive`.*

## [EPIC-007] Empaquetado e instalación

> Ref: MASTER-SPEC §3 (Empaquetado), §4.5

*Tareas por derivar con `/derive`.*

## [EPIC-008] Banco de referencia y mediciones

> Ref: MASTER-SPEC §7.11, §1.3, §4.9

*Tareas por derivar con `/derive`.*

---

## Resumen de cobertura

| Épico | Tareas | Estado | 🤖 .LLM | 🧑 .HUM | 🤖🧑 .MIX | Total checks |
| --- | --- | --- | --- | --- | --- | --- |
| EPIC-001 | TASK-001 a 002 | ☐ En curso | 0 | 0 | 0 | 0 |
| EPIC-002 a 008 | por derivar | 🔲 Pendiente | 0 | 0 | 0 | 0 |
