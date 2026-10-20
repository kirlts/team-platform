# Convergence Blacklist (CBL)

Statistical inertia values of LLMs when generating interfaces. Matching these values requires explicit atmospheric justification.

| ID | Axis | Inertia Value | Appearance Context | Required Deviation |
|---|---|---|---|---|
| CBL-01 | Primary Color | `#6366F1` (indigo-500), `#8B5CF6` (purple-500) | Buttons, links, primary accents | A custom palette is derived in OKLCH with consistent luminance between background-text pairs |
| CBL-02 | Hero Gradient | `#8B5CF6→#3B82F6` (purple→blue) via `bg-clip-text` | Hero headings, main section backgrounds | Gradient is derived from the project's atmosphere. If the gradient does not serve the identity, it is not used |
| CBL-03 | Emergent Green | `#10B981` (emerald-500) as post-purple accent | Success badges, status indicators, secondary CTAs | Color is derived from the project's chromatic identity |
| CBL-04 | Dark Surface | `#09090B` / `#18181B` (zinc-950/900) | Dark mode backgrounds, navbars, footers | Surface is derived with intentional tone and luminance |
| CBL-05 | Universal Font | Inter, system-ui, sans-serif as sole family. 48px/800/tracking-tight on H1 | All site typography, with no typographic variation | ≥1 font with character. Modulated scale (Golden Ratio, Minor Third, Perfect Fourth). `clamp()` is used for fluidity |
| CBL-06 | Symmetrical Layout | `max-w-7xl mx-auto`, symmetrical `grid-cols-3`, universal `text-center items-center` | General structure of the entire page, sections, grids | ≥1 asymmetrical or fluid-width composition. Real routing is used if ≥2 thematic contexts |
| CBL-07 | Uniform Space | Indiscriminate `p-6`/`gap-4`/`gap-6`. Macro:micro ratio <3:1 | Spacing between components, card padding, grid gaps | Macro:micro ratio is ≥4:1. Intentional variation is applied in spacing |
| CBL-08 | Generic Surface | `rounded-xl` + `border-gray-200` + `shadow-md` on everything. Identical cards | Cards, containers, modals, dropdowns | Radii, shadows, and borders are differentiated by affordance level |
| CBL-09 | Uniform Movement | Universal `transition-all duration-300 ease-in-out`. Fade-in-up without stagger | All animations and transitions | Transitions are applied selectively by property. Duration and easing are varied. Sequential stagger is used |
| CBL-10 | Corporate Copy | "Get Started", "Learn More", "Unlock your potential", "Seamless experience", "Cutting-edge" | CTAs, taglines, feature descriptions, onboarding | CTAs describe the domain's concrete action. Niche jargon copy is used. Fictitious testimonials are avoided |
