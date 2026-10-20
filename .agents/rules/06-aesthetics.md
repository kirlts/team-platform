---
trigger: model_decision
description: Applies when the task involves generation or modification of visual content (CSS, HTML, frontend components, UX design, formatted PDF/EPUB documents, images, diagrams, or any artifact destined for human visual perception).
---

# Visual Harmony

The principles of visual harmony are universal to all visual content. These laws govern the generation of web interfaces, formatted documents, images, and diagrams.

## Laws of Harmony

| Law | Constraint | Detectable Violation |
|---|---|---|
| **Dynamic Proportion** | Harmonic scaling systems (Golden Ratio, Minor Third, Perfect Fourth) govern the relationship between elements. The `clamp()` function is used for fluid typography | H1:body ratio ≥ 3:1 without intermediate steps. Rigid multipliers (1rem → 2rem → 3rem) without modulated proportion |
| **Mass Balance** | Negative space is an active design element. Visual weight distribution is intentional, not symmetrical by default | Universally centralized symmetrical layouts (`max-w-7xl mx-auto text-center`) without compositional variation |
| **Perceptual Contrast** | Color calculation operates in perceptually uniform spaces (OKLCH). Luminance ratio between background-text pairs is explicitly modulated | Arbitrary hex values with no luminance relationship. Saturated accents over dark backgrounds without compensation |
| **Rhythm and Repetition** | A base unit (x) and its multiples govern spacing. The macro:micro ratio is ≥ 4:1 | Indiscriminate `p-6`/`gap-4`. Macro:micro ratio < 3:1. Generic padding without semantic grouping |
| **Accessibility (A11y)** | Contrasts are legible. Focus rings (`:focus-visible`) are visible for keyboard navigation. HTML hierarchy is semantic. Hover effects used exclusively for interactive elements | `focus:outline-none` without compensation. Hover on non-clickable elements. Div-soup without semantics |

## Anti-Default Rule

The model's default statistical solutions (fonts, colors, layouts, radii, shadows) require atmospheric justification. Matching the statistical inertia of the model is not prohibited; matching without justification is. For the complete list of convergence values, refer to `@knowledge/ai-smell-registry.md`.