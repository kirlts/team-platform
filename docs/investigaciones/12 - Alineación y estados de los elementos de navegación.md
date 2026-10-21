# Alineación y estados de los elementos de navegación en 2026

Consultado el 2026-10-21. El número entre corchetes remite a la tabla de fuentes del final; todas se abrieron ese día con WebFetch. Los fragmentos de código y de criterios los devolvió WebFetch; las clases de shadcn/ui se contrastaron además con una descarga directa del archivo. «Derivado» marca una cifra calculada a partir de valores citados. «Sin verificar» marca lo que no tiene fuente abierta. El buscador sólo devuelve resultados de Estados Unidos. Una fuente de más de doce meses lleva su fecha a la vista.

Alimenta una decisión sobre la barra lateral del panel (React, 256 px de ancho). Las filas son Inicio, Mensajes, Áreas, un contador de avisos por área, Equipo y Conexiones. Regla del repositorio: nunca puntos suspensivos en un rótulo (UD-016).

## 1. Resumen

En el código de shadcn/ui, Primer, Carbon, Fluent, Polaris y Material 3, el ícono de una fila de navegación no lleva contenedor en reposo. Material 3 pone una píldora de 56 por 32 dp detrás del ícono del riel sólo en el destino seleccionado [40]. Linear quitó en marzo de 2026 los fondos de color de los íconos de equipo [47].

El contador va al final de la fila y se centra en vertical dentro de ella. En shadcn/ui es una caja de 20 px dentro de una fila de 32 px, con `tabular-nums` y sin fondo [16]. En el cajón de Material 3 es texto con el color `OnSurfaceVariant`, separado 12 dp del rótulo [31][32]. Primer lo dibuja como píldora con borde y radio de 20 px [18].

Todos los sistemas abiertos cambian el fondo de la fila entera al pasar el puntero. Ninguno ilumina sólo el ícono. En shadcn/ui, Carbon y Polaris cambia además el color del texto [16][22][30]. Las transiciones documentadas van de 0 a 150 ms para fondo y color [16][17][27][28][30][41].

Con la elipsis prohibida, el rótulo debe caber en una línea; si no cabe, se parte o se acorta la palabra. Cortar el texto sin elipsis incumple WCAG 1.4.4 y 1.4.12 [8][9]. El tooltip complementa pero no reemplaza.

La sección 8 fija once reglas con valor y tolerancia.

## 2. Alineación del contador y del ícono de aviso

### 2.1 Estructura de la fila

| Sistema | Estructura de la fila | Valores | Fuente |
|---|---|---|---|
| shadcn/ui, `SidebarMenuButton` | `flex w-full items-center gap-2 ... p-2`, ícono `[&>svg]:size-4` | Alto `h-8` (32 px), padding 8 px, ícono 16 px, separación 8 px | [16] |
| shadcn/ui, `SidebarMenuBadge` | Posición absoluta: `absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1`, con `peer-data-[size=default]/menu-button:top-1.5` | Caja de 20 px, a 4 px del borde derecho de la fila y 6 px del borde superior | [16] |
| Material 3, `NavigationDrawerItem` | `Row(Modifier.padding(start = 16.dp, end = 24.dp), verticalAlignment = Alignment.CenterVertically)`; rótulo en `Box(Modifier.weight(1f))`; insignia después de `Spacer(Modifier.width(12.dp))` | Alto mínimo 56 dp (`ActiveIndicatorHeight`), ícono 24 dp, separación ícono-rótulo 12 dp | [31][32] |
| Carbon, panel izquierdo | Enlace `display: flex; align-items: center; padding: 0 mini-units(2); min-block-size: mini-units(4)`; ícono `flex: 0 0 mini-units(2)` | Alto 32 px, padding 16 px, ícono 16 px, panel de 256 px según la página de estilo | [22][23] |
| Primer, `ActionListSubContent` | Cuadrícula `grid-template-areas: 'label trailingVisual trailingAction'` con `grid-template-columns: minmax(0, auto) min-content min-content`; `VisualWrap` con `align-items: center`, `min-height: var(--base-size-20)`, `line-height: 20px`, `pointer-events: none` | Visual final de 20 px de alto | [17] |

Derivado de [16]: el contador mide 20 px dentro de una fila de 32 px, así que `top-1.5` (6 px) lo centra: (32 − 20) / 2 = 6. Su texto queda a 8 px del borde derecho (`right-1` 4 px más `px-1` 4 px), igual que el padding `p-2` de la fila.

Lectura del código de [16]: el único padding derecho reservado en el botón es `group-has-data-[sidebar=menu-action]/menu-item:pr-8`, y aplica cuando hay una acción. El contador, en posición absoluta, no reserva ancho; con un rótulo largo puede quedar encima. Primer lo resuelve con columnas propias de la cuadrícula [17] y Material 3 con una fila donde el rótulo ocupa el espacio restante [31].

Carbon indica que un enlace, un submenú y un ítem de submenú miden 32 px, con 16 px de padding a cada lado [22]. Fluent 2 fija el ancho por omisión de Nav en 260 px [26].

### 2.2 Números tabulares

`SidebarMenuBadge` incluye `tabular-nums` [16]. MDN describe el valor como «the set of figures where numbers are all of the same size, allowing them to be easily aligned like in tables» (página modificada el 2026-09-10) [12]. El CSS abierto de `CounterLabel` de Primer no declara `font-variant-numeric` [18]. Con figuras proporcionales, cada número ocupa un ancho distinto y las unidades no quedan en una misma vertical.

Ninguna fuente abierta fija la alineación del texto dentro de la caja del contador: shadcn/ui lo centra (`justify-center`) [16]. Alinearlo a la derecha para que coincidan las unidades es un criterio derivado de [12], no una práctica documentada.

## 3. Insignias con o sin contenedor

| Sistema | Contador dentro de una lista de navegación | Contenedor | Fuente |
|---|---|---|---|
| shadcn/ui | `SidebarMenuBadge`, 12 px (`text-xs`), `font-medium`, color del rótulo; cambia con la fila (`peer-hover/menu-button:text-sidebar-accent-foreground`) | Ninguno: las clases no traen fondo ni borde | [16] |
| Material 3, cajón | Parámetro `badge` «from the end side»; color `LargeBadgeLabelColor = OnSurfaceVariant`, tipografía `LabelLarge` | Ninguno | [31][32] |
| Material 3, insignia suelta | `LargeSize` 16 dp, `Size` 6 dp (punto), forma `CornerFull`, color `Error` | Píldora o punto de color sobre el ícono | [33][37] |
| Primer | `CounterLabel`: `padding: var(--base-size-2) var(--base-size-6)`, `border-radius: 20px`, borde fino, fondo neutro | Píldora con borde | [18][19] |
| Polaris | `.Badge` con `margin-left: var(--p-space-200)` dentro del ítem | Componente Badge | [30] |
| Linear | Ajuste de usuario: el aviso sin leer se muestra «as a count or a dot» (2024-12-18) | Depende del ajuste | [49] |

Dentro de cada lista, shadcn/ui, Material 3 y Primer ofrecen un solo componente para los contadores de fila. Son `SidebarMenuBadge`, el parámetro `badge` y `CounterLabel` [16][31][19]. Ninguna fuente abierta enuncia una regla escrita de consistencia; la regla R6 sale de ese patrón de código. Un extracto del buscador atribuye a Polaris una guía contra insignias en los ítems de navegación. No se pudo abrir y queda sin verificar.

Primer usa la píldora para todos los contadores [18] y documenta `CounterLabel` como «Adds a count to navigational elements and buttons» [20]. shadcn/ui usa el texto para todos [16]. El código leído no mezcla, en una misma lista, contadores con contorno y sin él.

### 3.1 Íconos con y sin contenedor

En las clases de shadcn/ui el ícono lleva `size-4` y `shrink-0`, sin fondo [16]. En Carbon el ícono es una caja flex de 16 px sin fondo [23]. En Fluent el ícono mide al menos 20 px y cambia de color al seleccionarse (`colorNeutralForeground2BrandSelected`). El indicador es una barra de 4 por 20 px [27]. Apple indica que los íconos del sidebar usan el color de acento. Un color fijo se usa con moderación (página con cambios hasta 2026-06-08) [43].

El riel de Material 3 sí dibuja un contenedor. El indicador activo mide 56 por 32 dp, con radio del 50 % y color `colorSecondaryContainer`. En el riel expandido mide 56 dp de alto y se ajusta al contenido [40]. Aparece sólo en el destino seleccionado.

Linear, en la actualización del 2026-03-12, «reduces icon usage, scales their sizes down» y elimina los fondos de color de los íconos de equipo [47]. El cambio del 2024-03-28 incluyó «aligning labels, icons, and buttons, both vertically and horizontally in the sidebar and tabs» (fuente de más de doce meses) [48].

El changelog del mismo día dice «Icons across the app have been redrawn and resized» [46].

Notion y Slack: se buscaron changelogs y blogs de diseño. Ninguno trae medidas de íconos, contadores ni estados de la barra lateral, y no se citan.

## 4. Estados hover, focus-visible, selected y pressed

### 4.1 Qué cambia en cada estado

| Sistema | Hover | Focus-visible | Selected | Pressed | Fuente |
|---|---|---|---|---|---|
| shadcn/ui | `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground` | `focus-visible:ring-2` | `data-[active=true]:bg-sidebar-accent ... font-medium ... text-sidebar-accent-foreground` | `active:bg-sidebar-accent active:text-sidebar-accent-foreground` | [16] |
| Primer | `background-color: var(--control-transparent-bgColor-hover)` dentro de `@media (hover: hover)`; `cursor: pointer` | Mixin `focusOutline`; en colores forzados `outline: solid 1px transparent !important` | `--control-transparent-bgColor-selected`, `::after` con `activeIndicatorLine`, rótulo en `font-weight: var(--base-text-weight-semibold)` | `--control-transparent-bgColor-active` | [17] |
| Carbon | Dentro de `@media (any-hover: hover)`: fondo `$background-hover`, texto `$text-primary`; la página de estilo agrega ícono `$icon-primary` | `focus-outline('outline')` | `aria-current='page'`: fondo `$background-selected`, `font-weight: 600`, barra `inline-size: 3px` en `$border-interactive` (4 px en la página de estilo) | Sin regla propia en el SCSS abierto | [22][23] |
| Fluent 2 | Fondo `colorNeutralBackground4Hover` | `outline` de `strokeWidthThick` en `colorStrokeFocus2`, con `outlineOffset` negativo del mismo ancho | Barra de 4 por 20 px, texto `body1Strong`, ícono en color de marca | Token `colorNeutralBackground4Pressed` definido; sin regla aplicada en el archivo | [27] |
| Polaris | `:is(:hover, :focus-visible)` con fondo `--p-color-nav-bg-surface-hover` | Igual que hover | `--p-color-nav-bg-surface-selected`, color `--p-color-text-brand-hover` al pasar | `--p-color-nav-bg-surface-active` | [30] |
| Material 3 | Capa de estado al 8 % (`HoverStateLayerOpacity = 0.08f`) | 10 % (`FocusStateLayerOpacity = 0.1f`) | Indicador `secondaryContainer`, ícono `onSecondaryContainer` | 10 % (`PressedStateLayerOpacity = 0.1f`) | [34][36] |

Los siete sistemas cambian el fondo de la fila completa en hover. Carbon, shadcn/ui y Polaris cambian además el color del texto, y el ícono acompaña en Carbon [22][16][30]. En ninguno el hover se limita al ícono. El cambio de color del ícono forma parte del cambio de la fila; no existe un patrón documentado de ícono solo.

Primer, Polaris y Material 3 distinguen hover, pressed y selected con valores propios. shadcn/ui usa el mismo fondo y el mismo color en los tres [16][17][30][34].

### 4.2 Duración y curva

| Sistema | Valor | Fuente |
|---|---|---|
| shadcn/ui, botón de fila | `transition-[width,height,padding]` sin duración: el cambio de fondo en hover es inmediato. El ancho de la barra usa `duration-200 ease-linear` | [16] |
| Primer, `ActionListContent` | `transition: background 33.333ms linear` (archivo del 2026-10-07) | [17] |
| Material Web, capa de hover | `transition: opacity 15ms linear, background-color 15ms linear`; la onda de presión usa `opacity 375ms linear` (archivo del 2024-07-15, de más de doce meses) | [41] |
| Fluent 2, `NavItem` | `transitionProperty: 'background'` con `durationFaster` = `100ms` y `curveLinear` = `cubic-bezier(0,0,1,1)` | [27][28][29] |
| Polaris | `background-color` con `var(--p-motion-duration-150)` y `ease-out`; el valor numérico del token no se abrió (archivo del 2024-07-16, de más de doce meses) | [30] |
| Carbon | Catálogo: `duration-fast-01` 70 ms, `duration-fast-02` 110 ms, `duration-moderate-01` 150 ms; curva estándar productiva `cubic-bezier(0.2, 0, 0.38, 0.9)`. El SCSS abierto aplica 0,11 s al ancho del panel, no al hover | [23][25] |
| Flutter, Material 3 | `Durations.short2` 100 ms, `short3` 150 ms, `short4` 200 ms; `Easing.standard` `Cubic(0.2, 0.0, 0.0, 1.0)`. La animación de selección por omisión es de 200 ms | [36][38] |

El cambio de color o fondo en hover queda entre 0 y 150 ms en todos los casos con cifra. Los 200 ms aparecen en el ancho de la barra y en la selección, no en el hover.

### 4.3 Contraste y foco

Los criterios de WCAG 2.2 (Recomendación del 2024-12-12) [1] que acotan los estados:

| Criterio | Texto o umbral | Fuente |
|---|---|---|
| 1.4.11 Contraste de no texto (AA) | 3:1 contra los colores adyacentes para «visual information required to identify user interface components and states». El documento Understanding indica que un tratamiento de hover no necesita 3:1 por sí mismo, pero el componente «must not lose contrast» con su entorno | [3] |
| 1.4.3 Contraste mínimo (AA) | 4,5:1 para texto; 3:1 para texto grande (página del 2026-09-06) | [4] |
| 2.4.7 Foco visible (AA) | «Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible»; sin umbral propio, el contraste viene de 1.4.11 (página del 2026-09-06) | [5] |
| 2.4.13 Apariencia del foco (AAA) | Área al menos igual a la de un perímetro de 2 px CSS y contraste 3:1 entre los mismos píxeles en estado enfocado y no enfocado (página del 2026-09-06) | [6] |
| 2.4.11 Foco no oculto, mínimo (AA) | El componente enfocado no queda totalmente oculto por contenido del autor (página del 2026-06-15) | [7] |

2.4.13 es AAA, no AA. Se usa como referencia porque shadcn/ui (`ring-2`, 2 px) y Fluent (`strokeWidthThick`) dibujan un anillo de ese orden [16][27].

### 4.4 Cursor y movimiento reducido

Tailwind 4 cambió los botones a `cursor: default`; la guía de migración da la regla para restaurar `cursor: pointer` en `button:not(:disabled)` y `[role="button"]:not(:disabled)` (sin fecha visible) [14]. Primer pone `cursor: pointer` en las reglas de hover y active del ítem [17]. En Tailwind 4, la variante `hover:` sólo aplica si el dispositivo principal admite hover. La guía recomienda tratar el hover como mejora [14]. Primer y Carbon lo envuelven en `@media (hover: hover)` y `(any-hover: hover)` [17][23].

WCAG 2.3.3 (AAA) pide poder desactivar la «motion animation triggered by interaction» salvo que sea indispensable (página del 2025-09-16) [11]. MDN define `prefers-reduced-motion: reduce` (página del 2026-06-10) [13]. El CSS abierto de Primer no trae consulta de movimiento reducido y los archivos de Carbon y Material Web abiertos tampoco [17][23][41]. Derivado: un cambio de fondo de 100 ms es un cambio de color, no el movimiento de 2.3.3. Un desplazamiento o una escala sí lo sería.

## 5. Rótulo que no cabe

| Opción | Quién la usa | Evidencia | Con la elipsis prohibida |
|---|---|---|---|
| Que quepa: ajustar ancho, padding o tamaño | Material 3: `labelMaxLines` = 1 por omisión [40]. Carbon: panel de 256 px y texto de 14 px [22]. Fluent: Nav de 260 px [26] | Apple pide «omit unnecessary words» para mantener cortos los rótulos del sidebar [43]. Shopify: «Use nouns instead of verbs to keep the navigation menu concise» en su guía de navegación de apps (sin fecha visible) [51] | Aceptada como primera vía. Se comprueba midiendo `scrollWidth <= clientWidth` |
| Permitir salto de línea | Fluent: «Long labels wrap by default» [26]. Primer: `.ItemLabel { word-break: break-word }`, sin `text-overflow` [17]. Polaris: `.Text` sin regla de overflow [30] | Wikimedia Codex: «Use wrapping as the base solution to content overflow», salvo donde importa la uniformidad de altura (sin fecha visible) [50]. Apple pide que el texto use «as many lines as needed» antes de truncarse cuando crece la fuente (cambios hasta 2025-12-16) [45] | Aceptada como respaldo, con `min-height` en lugar de `height`. Cambia la altura de esa fila |
| Truncar con elipsis | shadcn/ui: `[&>span:last-child]:truncate`; `truncate` = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` [15][16]. Carbon: `text-overflow()` = `overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap` [23][24]. Polaris: `.Text-truncated` con `-webkit-line-clamp: 1` [30] | WCAG 1.4.4 admite el truncado si el contenido completo está disponible al enfocar o activar [8] | Descartada por UD-016 |
| Recortar sin elipsis | Ningún sistema abierto | WCAG 1.4.4, falla F69: texto «clipped, truncated or obscured» al ampliar al 200 % [8]. WCAG 1.4.12: «if there is no mechanism to show the truncated text, it fails this success criterion» [9] | Descartada |
| Tooltip con el texto completo | Fluent: tooltip a la derecha del nodo, porque encima tapa otros nodos [26]. shadcn/ui: el tooltip de `SidebarMenuButton` sólo se muestra con la barra colapsada (`hidden={state !== "collapsed" || isMobile}`) [16] | WCAG 1.4.13 exige que el contenido adicional se pueda descartar, sobrevolar y que persista (página del 2026-07-12) [10] | Complemento, no solución: el rótulo debe caber o partirse |
| Reducir el tamaño de letra | shadcn/ui: tamaño `sm` = `h-7 text-xs` (28 px de alto, 12 px) [16]. Carbon: 14 px [22] | Apple: tamaño mínimo de texto 11 pt en iOS y 10 pt en macOS, por defecto 17 y 13 pt [45] | Aceptada hasta 12 px; por debajo no hay fuente que la sostenga |

Se buscó una fuente que acepte cortar sin elipsis, para refutar el descarte. No apareció ninguna; sólo aparecen las fallas de 1.4.4 y 1.4.12. SAP Fiori y Workday, que según el buscador tratan el tema, devolvieron 403 y no se citan.

Caso «Retroalimentación»: el espacio del rótulo es 256 − 16 (padding) − 16 (ícono) − 8 (separación) − la columna del contador. Con una columna de 20 px y 8 px de separación quedan 188 px (derivado). La medida real de la palabra con la fuente del panel no se tomó.

## 6. Tamaño de objetivo y alto de fila

| Fuente | Valor | Cita o paráfrasis |
|---|---|---|
| WCAG 2.2, 2.5.8 Tamaño de objetivo, mínimo (AA) | 24 por 24 px CSS | «The size of the target for pointer inputs is at least 24 by 24 CSS pixels», con excepciones de espaciado, equivalente, en línea, agente de usuario e indispensable (página del 2026-05-11) [2] |
| Material 3 (Compose) | 48 dp | `minimumInteractiveComponentSize`: «Reserves at least 48.dp in size to disambiguate touch interactions» [35]. Ayuda de accesibilidad de Google: «at least 48x48dp, separated by 8dp of space or more» (©2026, sin fecha de página) [42] |
| Material 3, cajón y riel | 56 dp de alto de ítem en el cajón; 60 dp mínimo en el riel (64 dp en Expressive); riel de 80 dp de ancho, extendido desde 256 dp | [32][39][40] |
| Apple HIG, controles | iOS: 44 por 44 pt por omisión y 28 por 28 mínimo. macOS: 28 por 28 por omisión y 20 por 20 mínimo (cambios hasta 2025-06-09) | [44] |
| shadcn/ui | Filas de 32 px (`h-8`), 28 px (`h-7`) o 48 px (`h-12`); `SidebarMenuAction` mide `aspect-square w-5` (20 px) | [16] |
| Carbon | 32 px por fila | [22] |

Una fila de 32 px supera el mínimo de 24 px de WCAG y el valor por omisión de macOS (28 pt). El botón «+» de la fila Áreas, si se construye como `SidebarMenuAction` (20 px), queda bajo 24 px. WCAG lo admite sólo si ningún círculo de 24 px centrado en él corta otro objetivo [2].

Los contadores llevan `pointer-events: none` en shadcn/ui y en Primer. No son objetivos; el objetivo es la fila [16][17]. Primer indica que los visuales finales «don't have dedicated interaction targets» [21].

## 7. Fuentes que no se pudieron abrir

| Fuente | Resultado |
|---|---|
| Material Design 3, páginas de especificación (`m3.material.io/components/navigation-rail/specs`, `.../badges/specs`) | Sin verificar. WebFetch devolvió sólo el título; la página se arma con JavaScript. Se usaron en su lugar los tokens y el código de androidx y Flutter, que son la implementación de esas especificaciones |
| Apple HIG, página HTML de Sidebars | Sin verificar. Devolvió sólo el título. Se leyó el JSON público de la misma página [43] |
| Atlassian, `side-nav-items` y `side-navigation` | Sin verificar. La página sólo indica que el paquete pasó a `@atlaskit/side-nav-items`, y el README del paquete no trae guías |
| Polaris, guía de uso de Navigation | Sin verificar. Conexión cerrada en cuatro intentos. La regla de no agregar insignias a ítems de navegación sólo aparece en un extracto del buscador. Se usó el CSS del componente [30] |
| Primer ViewComponents, lookbook de truncado de NavList | Sin verificar. Error 503 en dos direcciones. El extracto del buscador dice que el truncado es un patrón inaccesible si se usa; no se cita |
| SAP Fiori y Workday Canvas, guías de truncado | Sin verificar. Error 403 |
| Slack y Notion | Sin dato. Hay changelogs de rediseños de la barra lateral (Slack, diciembre de 2023; Notion 3.4, marzo de 2026) pero ninguno trae medidas de alineación, contadores ni estados |
| Material Web, estilos de navigation-drawer y navigation-tab | Sin dato. Los archivos de entrada sólo importan otro módulo |

## 8. Reglas para la barra lateral de team-platform

R1. Cada fila es una caja `display: flex` (o `grid`) con `align-items: center` y `min-height: 32px` (no `height`). Tiene padding horizontal de 8 px, ícono de 16 px y 8 px entre ícono y rótulo. Se comprueba con `getBoundingClientRect().height >= 32` en todas las filas, tolerancia 0 px hacia abajo. Los controles propios de una fila («+», desplegable) miden al menos 24 por 24 px. Fuentes: [16][22][2][44].

R2. El último elemento de cada fila (contador, «+» o desplegable) termina a la misma distancia del borde derecho de la barra: 8 px. Se comprueba con la diferencia entre `row.right` y el `right` del último elemento: tolerancia 0 px, igual en Mensajes, Áreas, cada área, Equipo y Conexiones. Derivado de [16] (4 px de `right-1` más 4 px de `px-1` igualan el `p-2` de 8 px de la fila); [31] mantiene un padding final constante.

R3. El centro vertical del ícono, del rótulo y del contador coincide con el de la fila. La diferencia de `centerY` con la fila es de 1 px como máximo. El contador mide 20 px de alto en una fila de 32 px, con 6 px arriba y 6 px abajo. Fuentes: [16][17][31].

R4. El contador ocupa una columna reservada al final de la fila, con `min-width: 20px`, `height: 20px`, `padding-inline: 4px`, `font-size: 12px`, `font-weight: 500` y `font-variant-numeric: tabular-nums`. El texto del rótulo termina al menos 8 px antes de esa columna (`label.right <= counter.left - 8`), con tolerancia 0 px; el contador nunca se superpone al rótulo. Un ícono de estado más un número forman una sola unidad dentro de la columna, con la misma altura de 20 px. Fuentes: [16][17][12]; la alineación del texto a la derecha es derivada.

R5. Los íconos no llevan contenedor en ninguna fila ni estado. En el elemento del ícono, `background-color` es transparente y `border-width` es 0, en reposo, hover y foco. La selección se muestra en la fila, no en el ícono. Fuentes: [16][23][27][43][47]. El indicador de 56 por 32 dp de Material 3 [40] es el único contenedor de ícono documentado y aparece sólo al seleccionar.

R6. Todos los contadores de la barra comparten un mismo estilo. Por omisión es texto sin contenedor (sin fondo ni borde), de 12 px y peso 500, en el color del rótulo secundario. Cambia junto con la fila en hover y selección. Si algún contador lleva píldora, todos la llevan. Se comprueba comparando `background-color`, `border-width` y `border-radius` computados de todos los contadores: iguales, tolerancia 0. Fuentes: [16][31][32][18].

R7. Hover: cambia el fondo de la fila completa a un token de acento. El color del texto y del ícono pasa al token de primer plano de énfasis. Todo ocurre dentro de `@media (hover: hover)`. El contador cambia con la fila. La transición es de `background-color` y `color` con duración de 100 ms (rango admitido de 33 a 150 ms) y curva lineal `cubic-bezier(0,0,1,1)`. Sin `transform`. Fuentes: [16][17][27][28][29][30][14].

R8. Foco: `:focus-visible` dibuja un anillo de 2 px con contraste de al menos 3:1 contra los colores adyacentes. Va dentro del borde de la fila (`outline-offset: -2px`), para que ningún `overflow: hidden` lo recorte. Se comprueba con teclado: el anillo se ve completo en las cuatro caras de cada fila. Fuentes: [16][27][5][6][3].

R9. Contraste en todos los estados (reposo, hover, selected, pressed): el rótulo tiene al menos 4,5:1 contra el fondo de la fila. El ícono tiene al menos 3:1. El fondo de hover no necesita 3:1 contra el panel [3], pero no puede bajar el contraste del texto [4]. Selected se distingue de hover por tres señales: fondo propio, `font-weight` 500 o más y `aria-current="page"`. Pressed usa un fondo igual o más marcado que hover. Fuentes: [3][4][16][17][19][23].

R10. Cursor y movimiento: `cursor: pointer` declarado en las filas y en los controles de fila, porque Tailwind 4 los deja en `default`. Si alguna transición mueve algo (desplazamiento, escala), se anula con `@media (prefers-reduced-motion: reduce)`. El cambio de color y de fondo de R7 no lo necesita. Fuentes: [14][17][11][13].

R11. Rótulos sin elipsis: fuente de 14 px (piso de 12 px). Cada rótulo cabe en una línea al ancho de 256 px, comprobado con el más largo («Retroalimentación»): `scrollWidth <= clientWidth`, tolerancia 0. Si no cabe, se actúa en este orden: reducir el padding o la columna del contador, ensanchar la barra, acortar la palabra. Carbon usa 256 px y Fluent 260 px. La fila usa `min-height`, `white-space: normal` y `overflow-wrap: break-word`. Con zoom del 200 % o con el espaciado de texto de WCAG el rótulo se parte y no se recorta. Un tooltip no reemplaza ninguno de estos pasos. Fuentes: [8][9][10][17][22][26][43][45][50].

### Decisiones que la evidencia no cierra

El contador de Mensajes, si debe llevar énfasis. shadcn/ui [16] y el cajón de Material 3 [31] usan texto sin contenedor. Material 3 usa una insignia roja sobre el ícono cuando va suelta [33][37] y Primer una píldora neutra [18]. Linear lo deja como ajuste del usuario: conteo o punto [49]. Ninguna fuente dice cuándo un aviso sin leer merece color. R6 fija la consistencia, no el énfasis.

El alto de fila en pantallas táctiles. WCAG pide 24 px [2]; Apple y Material piden 44 pt y 48 dp para el toque [44][35]. Subir el alto a 44 o 48 px con `@media (pointer: coarse)` sigue ese criterio. La evidencia no dice si el panel se usa en pantalla táctil; depende del uso real.

## Fuentes

Todas se abrieron el 2026-10-21. En los archivos de código, la fecha es la del último commit del archivo según la API de GitHub, o «rama principal» si no se consultó.

| n | Fuente | Fecha | URL |
|---|---|---|---|
| 1 | W3C, Web Content Accessibility Guidelines 2.2 | 2024-12-12 | https://www.w3.org/TR/WCAG22/ |
| 2 | W3C, Understanding 2.5.8 Target Size (Minimum) | Actualizada 2026-05-11 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| 3 | W3C, Understanding 1.4.11 Non-text Contrast | Sin fecha visible | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| 4 | W3C, Understanding 1.4.3 Contrast (Minimum) | Actualizada 2026-09-06 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| 5 | W3C, Understanding 2.4.7 Focus Visible | Actualizada 2026-09-06 | https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html |
| 6 | W3C, Understanding 2.4.13 Focus Appearance | Actualizada 2026-09-06 | https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html |
| 7 | W3C, Understanding 2.4.11 Focus Not Obscured (Minimum) | Actualizada 2026-06-15 | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |
| 8 | W3C, Understanding 1.4.4 Resize Text | Actualizada 2026-09-06 | https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html |
| 9 | W3C, Understanding 1.4.12 Text Spacing | Actualizada 2025-10-01 | https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html |
| 10 | W3C, Understanding 1.4.13 Content on Hover or Focus | Actualizada 2026-07-12 | https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html |
| 11 | W3C, Understanding 2.3.3 Animation from Interactions | Actualizada 2025-09-16 | https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html |
| 12 | MDN, font-variant-numeric | Modificada 2026-09-10 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-numeric |
| 13 | MDN, prefers-reduced-motion | Modificada 2026-06-10 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion |
| 14 | Tailwind CSS, guía de migración a v4 | Sin fecha visible | https://tailwindcss.com/docs/upgrade-guide |
| 15 | Tailwind CSS, text-overflow | Sin fecha visible | https://tailwindcss.com/docs/text-overflow |
| 16 | shadcn/ui, `sidebar.tsx` (new-york-v4), commit c257f68 | 2026-09-04 | https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx |
| 17 | Primer React, `ActionList.module.css`, commit 7f5303d | 2026-10-07 | https://raw.githubusercontent.com/primer/react/main/packages/react/src/ActionList/ActionList.module.css |
| 18 | Primer React, `CounterLabel.module.css`, commit a05b1f9 | 2025-11-13 | https://raw.githubusercontent.com/primer/react/main/packages/react/src/CounterLabel/CounterLabel.module.css |
| 19 | Primer, documentación de NavList | Sin fecha visible | https://primer.style/product/components/nav-list/ |
| 20 | Primer, documentación de CounterLabel | Sin fecha visible | https://primer.style/product/components/counter-label/ |
| 21 | Primer, guías de ActionList | Sin fecha visible | https://primer.style/product/components/action-list/guidelines/ |
| 22 | IBM Carbon, UI shell left panel, estilo | Sin fecha visible | https://carbondesignsystem.com/components/UI-shell-left-panel/style/ |
| 23 | Carbon, `side-nav/_side-nav.scss`, commit e36e2ea | 2026-10-20 | https://raw.githubusercontent.com/carbon-design-system/carbon/main/packages/styles/scss/components/ui-shell/side-nav/_side-nav.scss |
| 24 | Carbon, `utilities/_text-overflow.scss` | Rama principal | https://raw.githubusercontent.com/carbon-design-system/carbon/main/packages/styles/scss/utilities/_text-overflow.scss |
| 25 | IBM Carbon, Motion | Sin fecha visible | https://carbondesignsystem.com/elements/motion/overview/ |
| 26 | Microsoft Fluent 2, Nav, uso | Sin fecha visible | https://fluent2.microsoft.design/components/web/react/core/nav/usage |
| 27 | Fluent UI React, `sharedNavStyles.styles.ts`, commit 16db0e6 | 2026-02-12 | https://raw.githubusercontent.com/microsoft/fluentui/master/packages/react-components/react-nav/library/src/components/sharedNavStyles.styles.ts |
| 28 | Fluent UI, `tokens/src/global/durations.ts` | Rama principal | https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/durations.ts |
| 29 | Fluent UI, `tokens/src/global/curves.ts` | Rama principal | https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/curves.ts |
| 30 | Shopify Polaris, `Navigation.module.css`, commit 8f0f1b7 | 2024-07-16 (más de doce meses) | https://raw.githubusercontent.com/Shopify/polaris/main/polaris-react/src/components/Navigation/Navigation.module.css |
| 31 | androidx, Compose Material 3, `NavigationDrawer.kt`, commit 0e6d660 | 2026-08-27 | https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/NavigationDrawer.kt |
| 32 | androidx, `NavigationDrawerTokens.kt` | Rama principal | https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/NavigationDrawerTokens.kt |
| 33 | androidx, `BadgeTokens.kt` | Rama principal | https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/BadgeTokens.kt |
| 34 | androidx, `StateTokens.kt` | Rama principal | https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StateTokens.kt |
| 35 | androidx, `InteractiveComponentSize.kt` | Rama principal | https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/InteractiveComponentSize.kt |
| 36 | Flutter, `navigation_drawer.dart`, commit c4f0386 | 2026-09-11 | https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/navigation_drawer.dart |
| 37 | Flutter, `badge.dart` | Rama principal | https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/badge.dart |
| 38 | Flutter, `motion.dart` | Rama principal | https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/motion.dart |
| 39 | Flutter, `navigation_rail.dart` | Rama principal | https://raw.githubusercontent.com/flutter/flutter/master/packages/flutter/lib/src/material/navigation_rail.dart |
| 40 | Material Components Android, NavigationRail.md | Rama principal | https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/NavigationRail.md |
| 41 | Material Web, `ripple/internal/_ripple.scss`, commit 55b4650 | 2024-07-15 (más de doce meses) | https://raw.githubusercontent.com/material-components/material-web/main/ripple/internal/_ripple.scss |
| 42 | Google, Ayuda de accesibilidad de Android, tamaño de objetivo | Sin fecha de página (©2026) | https://support.google.com/accessibility/android/answer/7101858 |
| 43 | Apple, Human Interface Guidelines, Sidebars (JSON público de la página) | Cambio más reciente 2026-06-08 | https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sidebars.json |
| 44 | Apple, Human Interface Guidelines, Accessibility (JSON público) | Cambio más reciente 2025-06-09 | https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json |
| 45 | Apple, Human Interface Guidelines, Typography (JSON público) | Cambio más reciente 2025-12-16 | https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json |
| 46 | Linear, changelog «UI refresh» | 2026-03-12 | https://linear.app/changelog/2026-03-12-ui-refresh |
| 47 | Linear, «Behind the latest design refresh» | 2026-03-12 | https://linear.app/now/behind-the-latest-design-refresh |
| 48 | Linear, «How we redesigned the Linear UI» | 2024-03-28 (más de doce meses) | https://linear.app/now/how-we-redesigned-the-linear-ui |
| 49 | Linear, changelog «Personalized sidebar» | 2024-12-18 (más de doce meses) | https://linear.app/changelog/2024-12-18-personalized-sidebar |
| 50 | Wikimedia Codex, Content overflow | Sin fecha visible | https://doc.wikimedia.org/codex/latest/style-guide/content-overflow.html |
| 51 | Shopify, Design guidelines, Navigation (apps) | Sin fecha visible | https://shopify.dev/docs/apps/design-guidelines/navigation |
