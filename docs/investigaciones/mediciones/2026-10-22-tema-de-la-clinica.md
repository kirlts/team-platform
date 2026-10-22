# Tema para igualar la estética de la clínica (H-3732)

Fecha: 2026-10-22. El tema del anfitrión (`THEME_CSS`) cambiaba color, letra y radio. Cinco acabados quedaban fijos y no se igualaban con las variables de entonces. Ahora cada uno tiene su variable (MASTER-SPEC 7.8, «Contrato del tema»).

## Lo que quedaba fijo

| Acabado | Dónde | Qué dibujaba |
|---|---|---|
| Botón primario | `.btn-gel` | Brillo blanco en la mitad superior, borde azul fijo y sombra de la letra |
| Avatar y marca | `.orb` | Brillo radial, resplandor aqua y letra blanca fija; con un primario claro la letra no se lee |
| Barra superior | `.chrome-bar` | Sombra azul fija y borde `line-strong` |
| Selector | `Segmented`, `StateTabs` | Opción elegida en azul tenue con borde |
| Tarjeta | `MessageCard` | Borde izquierdo de color por estado |

## Valores para un anfitrión plano

Para «primario plano, avatar plano, barra con una línea, selector en pastilla, tarjeta sin borde de estado», el anfitrión redefine en `:root`, después de sus variables de color:

| Variable | Valor |
|---|---|
| `--btn-gloss` | `none` |
| `--btn-border` | `transparent` |
| `--btn-text-shadow` | `none` |
| `--orb-gloss` | `none` |
| `--orb-glow` | `none` |
| `--orb-ink` | `var(--color-accent-fg)` |
| `--orb-text-shadow` | `none` |
| `--orb-shadow` | `none` |
| `--chrome-border` | `var(--color-line)` |
| `--chrome-shadow` | `none` |
| `--selected-bg` | `var(--color-raised)` |
| `--selected-border` | `transparent` |
| `--selected-ink` | `var(--color-fg)` |
| `--selected-shadow` | `0 1px 2px oklch(0 0 0 / 0.14)` |
| `--segmented-track` | `var(--color-hover)` |
| `--card-edge-width` | `0px` |

`--orb-ink` toma `--color-accent-fg`, la letra que el tema ya da sobre el primario: sirve con un primario oscuro (letra clara) y con uno claro (letra oscura). La pastilla usa `--color-raised` sobre la pista `--color-hover`, así que cambia sola entre claro y oscuro.

Con el bloque aplicado, los avatares salen planos y las tarjetas pierden el borde de color. La opción elegida es una pastilla sobre la pista y el botón primario no lleva brillo. La barra conserva su degradado porque lo gobiernan `--color-chrome-1` a `--color-chrome-4`, que el tema del anfitrión ya redefine.

## Verificación

- Valores por omisión: `panel/src/theme.browser.test.mjs` comprueba en claro y oscuro que cada variable existe con su valor. También comprueba que una hoja del anfitrión cambia el resultado.
- Paridad con el panel anterior: capturas de seis vistas a 1440x900 y 390x844, en claro y oscuro, de `main` y de la rama. Se comparan los estilos calculados de cada elemento.
