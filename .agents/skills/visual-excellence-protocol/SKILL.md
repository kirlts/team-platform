---
name: visual-excellence-protocol
description: Activates to verify that visual and experience artifacts comply with harmony laws, forcing deviation from the parametric footprint of AI Smell. Operates on web interfaces, CSS, PDFs, EPUBs, images, diagrams, and all content intended for visual perception.
---

# Visual Excellence Verification

This skill operationalizes the `.agents/rules/06-aesthetics.md` rule. Its function is to verify that each visual artifact has its own identity and is not exclusively a generic product of the model's statistical distribution. It does not define the aesthetic laws (which are handled by the rule), but strictly enforces them before artifact delivery.

## Phase 0: Reference Loading

`.agents/knowledge/ai-smell-registry.md` is loaded to obtain the Convergence Blacklist (CBL) encompassing the 10 vectors and their exact values. This operation is internal and silent.

## Phase 1: Contextual Audit (Internal)

1. **Brownfield Check:** Existing style files (CSS, tailwind.config, theme) are inspected. Legacy constraints are identified.
2. **Interchangeability Test:** "If I substitute the logo for that of a generic entity, would this copy/layout still apply?" If the answer is yes, the artifact lacks domain anchoring.

## Phase 2: Verification Gates

The system executes mandatory verification before delivering any visual artifact.

### Gate A. Anti-Slop (mechanical, binary)

| Condition | Result |
|---|---|
| ≥3 artifact values match CBL without domain justification | BLOCK → The system rewrites with domain-specific values |
| ≥1 Unicode emoji used as a UI icon | BLOCK |
| ≥1 link points to `#` without being a declared placeholder | BLOCK |
| A CTA uses literal strings from the CBL without rewriting to the domain | BLOCK |

### Gate B. Intentional Harmony (cognitive)

| Condition | Result |
|---|---|
| A visual decision violates the laws defined in `06-aesthetics.md` | BLOCK → residue of statistical inertia |
| Hover elements are not interactive, or focusable without `:focus-visible` | BLOCK |
| Empty space does not communicate semantic grouping (Gestalt) | BLOCK → generic padding |

### Gate C. Contextual Integrity (brownfield)

| Condition | Result |
|---|---|
| MASTER-SPEC §4 constraints or existing project design systems not respected | BLOCK |
| Harmony law contradicts legacy constraint | BLOCK → The system declares to the user and requests a verdict |

## Output Mandate

Upon delivering the artifact, the system explicitly communicates in standard technical language:
1. The reference design logic applied.
2. The deviations executed regarding the AI convergence values.
3. Justification for any matches with convergence values.
