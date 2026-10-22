# Diseño visual del panel

Piel Y2K futurista sobre un programa de gestión estándar. La estructura, los rótulos, la densidad y la edición en el lugar no cambian; cambian los materiales. Orden de prioridad: jerarquía visual, identidad propia y espacio, y después la cita estética. Ningún efecto se aplica por sistema: cada uno aparece en las pocas superficies donde ordena la lectura.

## Referencias consultadas

Consulta del 2026-10-20. Los resultados son blogs de diseño y páginas de proveedores; se toman como opinión informada, no como medición.

| Fuente | Qué aporta | URL |
|---|---|---|
| daisyUI, tendencia «Y2K techno skeuomorphism» (sin fecha en la página) | Carcasa de plata cepillado, pantallas LCD azules, bordes biselados, pozos hundidos, luces de estado pequeñas, tipografía técnica condensada o mono; sugiere Orbitron, Chakra Petch, Audiowide, Michroma | https://trends.daisyui.com/trend/y2k-techno-skeuomorphism/ |
| daisyUI, tendencia «Frutiger Aero» (sin fecha; periodo 2005 a 2013, nombre acuñado en 2017) | Paleta azul y verde, controles brillantes, paneles redondeados tipo sistema operativo, humanista sans, contraste fuerte de texto oscuro sobre fondo brillante, densidad media | https://trends.daisyui.com/trend/frutiger-aero/ |
| Wikipedia, «Frutiger Aero» | Definición, brillo y texturas, Windows Aero de 2006, resurgimiento desde 2023, vínculo con Liquid Glass de Apple (2025) | https://en.wikipedia.org/wiki/Frutiger_Aero |
| Wikipedia, «Liquid Glass» y sesión WWDC25 219 de Apple (2025) | Material translúcido con reflejos especulares y desenfoque; la guía de Apple (actualizada el 2025-09-09) pide jerarquía entre contenido y controles y evitar capas de vidrio innecesarias | https://en.wikipedia.org/wiki/Liquid_Glass |
| Webflow, «Y2K aesthetic for web design» (resumen de búsqueda; la página no se pudo abrir) | Cromo y holográfico como acento en los elementos principales, no en todo el diseño; fondo oscuro o neutro, degradado de dos o tres colores iridiscentes, brillo suave, esquinas redondeadas con sombras interiores | https://origin.webflow.com/blog/y2k-aesthetic |
| daisyUI, «Y2K» y «Holographic iridescent UI» | Paleta de plata, azul hielo, rosa, lima y plástico translúcido; el holográfico en pantalla se imita con degradados y brillo especular | https://trends.daisyui.com/trend/y2k/ |
| OpenReplay, «Creating holographic effects with CSS» | Capas lineales, radiales y cónicas; interpolación en OKLCH; `prefers-reduced-motion` y color plano de respaldo | https://blog.openreplay.com/creating-holographic-effects-css/ |
| Setproduct, «Retro and brutalist UI design: a 2026 field guide» (junio de 2026) | El estilo reacciona a las páginas mínimas idénticas; advierte riesgo de accesibilidad y de conversión en software de gestión | https://setproduct.com/blog/retro-brutalist-ui-design-2026 |
| Fontsource / SIL | Orbitron y Source Sans 3, licencia OFL-1.1, variantes variables en WOFF2 | https://npmjs.com/package/@fontsource/orbitron |

Decisión: el panel es software de gestión y el riesgo de accesibilidad es real. La cita se limita a materiales (vidrio, plata, gel, luces) y todo texto se mide contra su fondo.

## Lista de valores de convergencia de la IA

El coordinador entregó una lista de valores que delatan diseño generado (versión del 2026-04, no versionada en este repositorio). Cada punto queda evitado así.

| Valor de la lista | En este panel |
|---|---|
| Acento `#6366F1`, degradado púrpura a azul, verde `#10B981` | Acento azul eléctrico OKLCH tono 250; el lila (tono 305) sólo aparece como brillo difuso de fondo y nunca en un degradado hacia el azul; verde lima (tono 125) reservado |
| Fondos `#09090B` y `#18181B` | Oscuro con tinte azul (OKLCH, luminosidad 0,17 a 0,30) |
| Texto con `bg-clip-text` y degradado | Ninguno. El cromo vive en la barra superior, no en el texto |
| Inter y `system-ui` como única familia; peso 800 con tracking negativo | Orbitron (rótulos y títulos) y Source Sans 3 (texto); tracking positivo en mayúsculas |
| `max-w-7xl mx-auto`, simetría centrada, `grid-cols-3` | Contenido alineado a la izquierda en una grilla de 12 columnas (vistas de 8, 10 y 12 columnas), columnas 5/7 y 7/5 alternadas, sin centrado |
| `p-6`, `gap-4` y `gap-6` en todo | Ritmo de 4 px exactos con valores de grupo (8, 12, 16, 20) y de sección (24, 40); relación macro a micro de 5 a 1 |
| `rounded-xl`, `rounded-2xl`, `border-gray-200`, `shadow-md` | Radios de 3 a 8 px en contenedores, forma de hoja (3 y 10 px en esquinas opuestas) y píldora sólo en controles; sombras de varias capas teñidas de azul |
| Emojis, Lucide, blobs SVG | Juego propio de 30 íconos (`src/components/icons.tsx`); la órbita y los destellos son geometría, no manchas |
| `transition-all duration-300 ease-in-out` | Transiciones por propiedad de 90 a 140 ms con `ease-out`; ninguna animación de entrada |
| Hover sobre elementos no interactivos, `focus:outline-none` | Hover sólo en filas con enlace y controles; anillo de foco visible de 2 px en todo |
| «Get Started» y similares | Rótulos de dominio: «Enviar», «Responder», «Cerrar» |

## Tokens

Todos están en `@theme` de `src/styles.css`, en OKLCH. El tema oscuro redefine los mismos nombres bajo `:root[data-theme='dark']`.

### Color

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `sky-a` `sky-b` `sky-c` | 0,955 0,045 205 · 0,945 0,03 250 · 0,95 0,03 232 | 0,20 0,05 255 · 0,17 0,045 270 · 0,20 0,065 240 | Cielo de fondo, en diagonal de 155°: de aqua a azul, sin salida al lila (el lila vive sólo en el brillo difuso de la esquina) |
| `glow-1` `glow-2` `glow-3` | aqua, lila, lima con alfa 0,55 · 0,38 · 0,28 | azul, lila, lima con alfa 0,38 · 0,28 · 0,14 | Brillos radiales de las esquinas |
| `fg` | 0,25 0,05 265 | 0,95 0,015 245 | Tinta |
| `muted` `faint` | 0,45 0,04 260 · 0,52 0,03 255 | 0,77 0,03 250 · 0,67 0,03 252 | Texto secundario y marcadores de posición |
| `accent` `accent-deep` | 0,50 0,20 250 · 0,38 0,17 255 | 0,76 0,15 240 · 0,84 0,12 235 | Enlaces, selección, estado activo |
| `gel-top` `gel-bottom` | 0,47 0,21 250 · 0,38 0,18 256 | 0,80 0,14 235 · 0,66 0,18 245 | Botón primario |
| `glass` `glass-strong` | blanco con alfa 0,64 · 0,88 | 0,30 0,05 262 alfa 0,58 · 0,26 alfa 0,90 | Paneles y ventanas emergentes |
| `chrome-1` a `chrome-4` | 0,995 · 0,92 · 0,84 · 0,94 (tono 240 a 250) | 0,40 · 0,30 · 0,21 · 0,27 | Barra superior: tubo plateado con línea de horizonte |
| `edge` | 0,58 0,07 252 | 0,64 0,08 255 | Borde de controles, 3 a 1 contra el vidrio |
| `open` `answered` `closed` | texto, fondo y luz por estado (ámbar, azul, plata) | equivalentes | Insignias de estado con luz |

### Forma, sombra y vidrio

| Token o clase | Valor | Uso |
|---|---|---|
| `--radius-sm/md/lg` | 3, 6 y 8 px | Contenedores y campos |
| `.leaf` | `3px 10px 3px 10px` | Paneles grandes y diálogos, la forma de pestaña de la maqueta |
| `--shadow-glass` | luz interior de 1 px y dos sombras azuladas | Paneles |
| `--shadow-pop` | igual, con mayor desplazamiento | Menús y diálogos |
| `--shadow-gel` | brillo superior, sombra interior inferior y halo azul | Botón primario |
| `--shadow-well` | sombra interior de 2 px | Campos y medidores |
| `.glass` | `backdrop-filter: blur(14px) saturate(1.5)` sobre `glass` | Sólo barra lateral, paneles de lista y de análisis, barra de envío |
| `.glass-strong` | `blur(18px) saturate(1.6)` | Menús, ventanas emergentes y diálogos |

El desenfoque se usa en pocas superficies grandes. Las filas no lo llevan, por costo de dibujado.

### Tipografía

| Rol | Familia | Tamaño | Notas |
|---|---|---|---|
| Marca de la cabecera y del inicio de sesión | Orbitron | 15 px | Peso 600, tracking 0,10 em, una sola tinta; el mismo componente (`Wordmark`) en la barra y en la tarjeta de entrada (J1-A-02, J1-A-04, J2-A-42) |
| Título de pantalla | Source Sans 3 | 20,8 a 26,4 px según el ancho (`clamp`) | Peso 700; las tildes de las mayúsculas de Orbitron tocan la letra (Á, Ó) |
| Rótulo de sección | Source Sans 3 | 12 px | Peso 700, mayúsculas, tracking 0,08 em; Orbitron queda para la marca porque sus mayúsculas anchas se leen mal a 12 px (J1-A-55) |
| Apoyo (`text-xs`) | Source Sans 3 | 12 px | Metadatos, extractos, rótulos de campo; ningún texto visible baja de 12 px (J1-A-53) |
| Cuerpo (`text-sm`, `text-base`) | Source Sans 3 | 15 px | Títulos de fila, valores, controles |
| Lectura (`text-read`) | Source Sans 3 | 17 px | El texto de una propuesta (UD-030) y, en peso 700, el título de cada mensaje propuesto (J3-B-02) |
| Encabezado (`text-lg`) | Source Sans 3 | 18,75 px | Escala de razón 1,25: 12, 15, 18,75, 23,4 |

Los tamaños son tokens de `@theme` (`--text-xs`, `--text-sm`, `--text-read`, `--text-lg`). Ningún componente escribe un tamaño propio por debajo del encabezado: `src/type-scale.test.ts` lo exige en el código y `test:fit` mide cada texto visible en el navegador (las iniciales de un avatar son decoración y quedan exentas).

Las fuentes están empaquetadas en `src/assets/fonts/` (WOFF2 variable, subconjunto latino) con su licencia OFL al lado. Ninguna se pide a un servidor externo; `font-src 'self'` basta, y `assetsInlineLimit: 0` impide que Vite las convierta en `data:`. Las cifras con cero tachado de Orbitron no se usan en datos: la fecha y la hora van en Source Sans 3.

### Movimiento

Una animación continua: el destello del medidor de progreso, mientras un trabajo corre. Los botones se hunden 1 px al presionarse. `prefers-reduced-motion` apaga las animaciones.

| Token | Valor | Uso |
|---|---|---|
| `--duration-hover` | 100 ms, `ease-out` | Cambio de fondo y color de las filas y controles de la barra lateral al pasar el puntero o enfocar (UD-130). Sólo color y fondo, sin desplazamiento |
| `--sidebar-count-col` | 2,75 rem | Ancho mínimo de la columna del contador de la barra lateral; termina a 10 px del borde derecho en cada fila |

### Atmósfera

`src/components/Atmosphere.tsx` dibuja una órbita anclada a la esquina superior derecha, fija y con `aria-hidden`; en teléfono no se dibuja. Una máscara la desvanece bajo la barra superior para que sus trazos no crucen títulos ni botones de la vista (J1-A-56). El cielo con brillos radiales cita el Frutiger Aero y la órbita el Y2K futurista. No hay destellos sueltos: un adorno sin ancla flota (UD-016).

## Contraste medido

`npm run contraste` calcula la razón WCAG 2 de cada par leyendo los tokens de `styles.css`. Las superficies translúcidas se componen sobre los tres extremos del cielo y se toma el peor caso. Corrida del 2026-10-20:

| Par | Claro | Oscuro | Mínimo |
|---|---|---|---|
| Texto sobre cielo | 13,69 | 15,69 | 4,5 |
| Texto sobre vidrio | 15,21 | 13,20 | 4,5 |
| Texto secundario sobre vidrio | 7,05 | 7,38 | 4,5 |
| Marcador de posición sobre vidrio | 5,21 | 5,11 | 4,5 |
| Acento profundo sobre vidrio | 9,50 | 9,38 | 4,5 |
| Enlace (`accent`) sobre vidrio | 5,52 | 7,16 | 4,5 |
| Texto sobre campo | 15,83 | 13,46 | 4,5 |
| Texto sobre cromo | 9,86 | 7,97 | 4,5 |
| Error sobre vidrio | 6,32 | 6,15 | 4,5 |
| Estado abierto, respondido, cerrado (texto sobre su fondo) | 7,89 · 7,31 · 6,78 | 8,24 · 8,42 · 6,36 | 4,5 |
| Texto del botón gel (a 30 % del alto, con brillo) | 4,59 | 7,38 | 4,5 |
| Borde de controles sobre vidrio | 4,04 | 4,54 | 3 |
| Relleno de fila elegida contra el vidrio | 1,32 | 1,51 | 1,25 |
| Barra de fila elegida sobre su relleno | 4,20 | 4,73 | 3 |
| Texto sobre fila elegida (tinta · secundario) | 11,56 · 5,36 | 8,71 · 4,87 | 4,5 |

## Grilla

Todo bloque se ancla a esta grilla; nada queda flotando sin un ancla.

| Elemento | Valor |
|---|---|
| Unidad de espacio | 4 px (`--spacing` en `styles.css`); todo `p-`, `m-`, `gap-` y `size-` de Tailwind es múltiplo de 4 |
| Columnas | 12 columnas de 6 rem (72 rem). Una vista ocupa 12 columnas (Inicio, Mensajes, Equipo, Áreas, Configuración, detalle) u 8 (formularios y lectura corrida), con el componente `Page` |
| Margen de página | 20 px en teléfono y 40 px desde 768 px, el mismo borde izquierdo en todas las vistas; 20 px arriba y abajo desde 768 px |
| Canal entre columnas | 40 px entre bloques grandes, 16 px dentro de una fila, 12 px entre ícono y texto, 8 px entre chips |
| Ritmo vertical | 16 px entre bloques de una vista y 20 px entre secciones (`Page section`) |
| Relleno de fila | 16 px a cada lado y 12 px arriba y abajo en listas y tablas |
| Columnas de una tarjeta de mensaje | desde 42 rem de ancho de la propia fila: texto (el resto), acciones 9,5 rem, miniatura 2,5 rem; el estado cae en la misma x en todas las filas. Bajo ese ancho la fila se apila y las acciones van al pie. El detalle está en «Tarjeta de lista» |

Reglas de anclaje:

1. Los elementos de una fila se alinean por su primera línea de texto o por el borde del contenedor; nunca por el centro de un bloque de alto variable.
2. Un dato del mismo tipo ocupa la misma columna en todas las filas (lo pendiente de Áreas, el estado de una tarjeta, el rol de Equipo tienen ancho fijo).
3. Lo que se coloca a la derecha de una fila (emisor, acciones) se ancla al borde derecho del contenedor, haya o no miniatura; la miniatura vive en su propio bloque.
4. Un elemento sin vecino en su línea (un chip suelto, un botón solo) toma el borde izquierdo o derecho de la columna, no queda a medias.
5. Un texto largo se envuelve en su celda: ningún rótulo, nombre, título, correo ni destinatario se corta con puntos suspensivos (UD-016). Lo que no cabe en una fila se pliega con su cuenta («+6» destinatarios, «+3» adjuntos) y se abre sobre la página, sin crecer la fila (UD-017).
6. Los íconos de medio (foto, video, audio, documento, enlace) van al lado de la fecha de cada mensaje y respuesta, uno por tipo, con la cuenta cuando hay más de uno.
7. Ningún adorno suelto: la atmósfera es una órbita anclada a la esquina superior derecha; no hay destellos sueltos ni esferas sin función.

La prohibición la hace cumplir `src/no-truncation.test.ts`, la medición del navegador (`scripts/capturas-vistas.mjs`) y `src/fits-one-screen.browser.test.mjs`.

### Tarjeta de lista

UD-241. Una sola grilla para toda fila de Inicio, Mensajes y la vista de un área. Cada dato cae a la misma x y al mismo desplazamiento en todas las filas, y todas miden lo mismo. Lo único que la interfaz corta es el extracto; el texto entero es su tooltip y se lee en la ficha. Lo que no cabe en su línea alarga la fila y no se corta (UD-016): un título de tres líneas o más, un nombre de área, un destinatario.

| Elemento | Valor |
|---|---|
| Bloque de texto (`--spacing-card-text`) | 64 px: título hasta dos líneas (15 px, seminegrita, interlineado 1,375) y debajo el extracto en una línea (12 px, apagado, puntos suspensivos). El aire de un título de una línea queda bajo el extracto |
| Línea de estado y área | forma, color y palabra del estado (UD-041) y el chip del área (UD-045), 12 px |
| Línea de quién y cuándo | emisor y fecha a la izquierda; íconos de medio y cuenta de respuestas pegados al borde derecho de la columna de texto, bajo la miniatura |
| Línea de destinatarios | «para A, B y N más», reservada aunque esté vacía; en la disposición apilada lleva también Responder y Cerrar (28 px) |
| Columna de miniatura | 2,5 rem (40 px) en toda fila, con o sin medios; canal de 16 px |
| Columna de acciones | 9,5 rem desde 42 rem de ancho de la fila; bajo ese ancho las acciones van al pie |
| Separación entre líneas | 4 px; relleno de fila 16 px a los lados y 12 px arriba y abajo |
| Alto resultante | 157 px en Mensajes, 152 px en la vista de un área (sin chip) y 166 px en la disposición apilada de Inicio, medidos en 1440×900 con los datos de ejemplo |

Lo mide `src/flows-tarjetas-vistazo.browser.test.mjs` (alto igual por lista, extracto de una línea, misma x de estado, quién y miniatura) y `src/components/MessageCard.test.tsx` (clases y tooltip del extracto).

## Lo generado por IA

UD-026. Todo contenido que genera el modelo vive en una superficie propia y se reconoce a simple vista en cualquier tamaño de pantalla: la propuesta del análisis (`AnalysisPanel`) y, en el detalle de un mensaje que nació de un análisis, una marca de origen discreta junto a la fecha.

| Elemento | Valor |
|---|---|
| Superficie `.ai-surface` | Fondo lila plano (`ai-bg`: 0,955 0,04 300 en claro, 0,255 0,052 285 en oscuro: el matiz y el croma se acercan al azul de la interfaz para que no parezca una segunda familia de color, J3-B-13), borde izquierdo de 3 px (`ai-edge`) y filete de 1 px del mismo color atenuado. No es un degradado: UD-013 prohíbe el degradado púrpura a azul |
| Marca de origen `AiMark` | Destello y la sigla «IA» en `ai-fg`, sobre un tinte del borde; nombre accesible y aviso «Generado por IA». Una por grupo, en su cabecera, no una por elemento |
| Contraste medido (`npm run contraste`) | Texto sobre la superficie 13,87 claro y 13,33 oscuro; marca 8,67 y 9,69; borde 5,69 y 6,32 |

Referencias consultadas el 2026-10-21 (opinión de sistemas de diseño publicados, no medición propia):

| Fuente | Fecha | Qué aporta |
|---|---|---|
| IBM Carbon, «Carbon for AI» (carbondesignsystem.com/guidelines/carbon-for-ai) | «Last updated Aug 12, 2026» | La etiqueta de IA es el indicador principal; el contenido de IA toma una variante visual propia con efectos de luz (brillo y degradado en los bordes, acotados para no perder lectura) |
| AWS Cloudscape, «Generative AI output label» (cloudscape.design/gen-ai/patterns) | 2024-04-08 | Etiqueta «Generated by AI» con el destello, cerca de lo generado; una sola por grupo, junto a su cabecera, no una por elemento |
| Red Hat PatternFly, «AI iconography» (patternfly.org/ai/guidelines/iconography) | Sin fecha en la página (versión 6.7.0) | El destello va siempre acompañado de texto («por IA»); un ícono propio marca la información generada en parte o del todo por IA |
| Google Design, «All That Sparkles Is AI» (design.google/library/ai-sparkle-icon-research-pozos-schmidt) | Sin fecha en la página | Estudio con 2.000 personas en ocho países: el destello se reconoce como marca de IA, pero su sentido depende del contexto y de la etiqueta que lo acompaña |
| ServiceNow Horizon, «Identifying AI content» (horizon.servicenow.com/ai/identifying-ai-content) | Sin fecha; la página respondió 403 y sólo se leyó el extracto de la búsqueda | Separa los indicadores de entrada (lo que usará IA) de los de salida (lo que IA produjo) |

No se encontraron fuentes sobre Notion AI, Linear, GitHub Copilot ni Gmail con Gemini: las búsquedas no devolvieron sus páginas, así que no se citan. La decisión sale de lo que sí coincide: destello más texto, una marca por grupo y una variante visual propia para lo generado.

## Cada vista cabe en una pantalla

UD-017. A 1440 por 900 y a 1280 por 720 ninguna vista desplaza el documento ni la región principal. Lo que se necesita ahora está a la vista; lo demás se pliega con su cuenta y las listas paginan dentro de su marco.

- `Page` ocupa el alto de la región principal desde 768 px; el bloque que crece (una lista) toma lo que queda con `flex-1 min-h-0`, y las filas de cuadrícula usan `minmax(0, 1fr)` para que el contenido no estire la fila.
- `FitList` mide el alto del espacio que le toca y el alto de cada fila ya dibujada, y deja las que caben; el resto está en las páginas siguientes, con el rango y dos flechas al pie. El tamaño de página no se escribe en ningún lado: sale de esas dos medidas, y se vuelve a medir cuando cambia la ventana, la lista o el alto de una fila (por ejemplo, cuando llega la plantilla de un campo). Si todas caben, el marco se ajusta a ellas y no hay paginador. Una página lleva al menos una fila: en una ventana más baja que esa fila, su encabezado y el paginador, el espacio de la lista no baja de esa suma y la página se desplaza, en vez de dibujar la fila sobre el paginador (H-96; `fit-list-low-window.browser.test.mjs`). En teléfono la página crece con su contenido y no hay páginas.
- Con un envío abierto, Inicio se desplaza (UD-110, que enmienda esta regla): la región principal desplaza y las dos listas toman un alto propio de `max(28rem, 56dvh)`. En reposo cabe sin desplazarse.
- Carriles con desplazamiento propio permitidos, todos declarados con `data-lane` y con el motivo en el código: el texto pegado de la vista previa, el cuerpo y los campos de un mensaje, la descripción del proyecto, la lista de áreas de la barra lateral y las listas de las ventanas emergentes. Los campos de texto desplazan por sí solos.
- La prueba (`npm run test:fit`) abre cada vista a los dos tamaños, con lo sembrado y con cada lista multiplicada por ocho en el navegador, y falla si el documento o la región principal desbordan, si un elemento tiene un carril propio fuera de la lista blanca, si algo queda bajo el borde de la ventana o si el documento esconde su desborde.

## Aire de Inicio

UD-110. Inicio es la barra de texto con espacio alrededor y, debajo, las dos listas. Los valores son tokens de `styles.css`, no números sueltos en los componentes.

| Token | Valor | Uso |
|---|---|---|
| `--spacing-block-compact` | 16 px | Entre bloques en una ventana de menos de 800 px de alto |
| `--spacing-block` | 24 px | Entre bloques desde 800 px de alto |
| `--spacing-section` | 40 px | Entre bloques y entre las dos listas desde 1000 px de alto |
| `--spacing-bar-pad` | 24 px | Relleno interior de la barra de texto |
| `--container-compose` | 56 rem (840 px) | Ancho de la barra de texto, centrada |
| `--container-inicio` | 112 rem (1680 px) | Ancho máximo de la página; antes de él crece con la ventana |

Capturas revisadas a 1280x800, 1440x900, 1920x1080, 2560x1440 y 390x844, claro y oscuro (`scripts/capturas-respira.mjs`).

## Edición en el lugar y deshacer

UD-017. `EditableText` es el único campo editable: un clic abre el texto en el mismo sitio, con la misma tipografía, el mismo ancho y el mismo alto; un clic afuera o Enter guardan, Escape cancela, Shift+Enter abre una línea nueva en la variante de varias líneas. No hay botón «Editar» ni «Guardar» ni lápiz. `useUndoStack` guarda en memoria las operaciones de la pantalla (guardados, destinatarios, área, adjuntos, activación de un miembro, borrado de una plantilla) y las dos botones «Deshacer» y «Rehacer» y Ctrl+Z y Ctrl+Shift+Z las recorren; recargar la pantalla vacía la pila. No hay historial de versiones.

## Texto corrido

UD-022. Todo bloque de texto de más de dos líneas (cuerpo de mensaje y de respuesta, vista previa, campos de plantilla, perfil, descripción del proyecto) lleva la clase `prose-block`: `text-align: justify`, `hyphens: none`, `text-wrap: pretty`, igual en lectura y en edición. Títulos, rótulos, chips, celdas y textos de una o dos líneas quedan a la izquierda. `src/prose-block.test.ts` falla si otra regla justifica o enciende `hyphens`.

## Idioma

UD-018. La interfaz sale de dos catálogos, `src/i18n/es-419.ts` (por omisión) y `src/i18n/en.ts`, con las mismas claves; cada texto, nombre accesible, marcador, plural y fecha (`Intl` con el idioma de la cuenta) viene de ahí. Un solo control en Configuración, «Idioma» o «Language», cambia todo al instante. Los errores de la API llegan con `code` y se traducen con `error.<code>`; sin traducción se muestra el mensaje del servidor. `src/i18n.test.ts` falla si un catálogo tiene una clave que el otro no, si el código nombra una clave que no existe o si hay un texto visible escrito fuera de los catálogos.

## Voz de instrumento

UD-050. El texto de la interfaz es el de un programa de gestión: sustantivo corto para un rótulo, verbo en infinitivo más objeto para una acción, una o dos palabras para un estado, causa más salida para un error. Sin segunda persona, preguntas, exclamaciones, saludos, «Aquí», «Ya», «Todavía», imperativos coloquiales, gerundios que acompañan una frase, punto final ni dos oraciones en un texto. Ayuda ninguna por omisión; un aviso de una acción que no se deshace es una oración corta, impersonal y precisa. «Nota de voz», no «Nota de voz con su transcripción»; «Correo en uso», no «Ya existe un miembro con ese correo». Las reglas R1 a R14 y sus fuentes están en `docs/investigaciones/08-lenguaje-de-instrumento-en-interfaces.md`. `src/ui-voice.test.ts` las hace cumplir sobre los dos catálogos y sobre las frases de progreso del servidor; una excepción se declara por clave, con su razón. Un texto nuevo se escribe en el catálogo en español y en el inglés con el mismo registro.

## Jerarquía y distribución

- Inicio usa una banda de dos columnas 5/7 (mensaje y análisis) y debajo otra 7/5 (mensajes y respuestas). La alternancia sostiene la asimetría sin romper la grilla de 12 columnas.
- La esfera de vidrio firma sólo la marca de la cabecera y el inicio de sesión; no se repite en cada título (UD-016: ningún adorno sin función).
- El botón gel es sólo para la acción que la pantalla pide hacer: Entrar, Enviar y Responder. Crear un área o un miembro es vidrio, porque Áreas y Equipo se leen antes de editarse (J1-A-54). En las filas de mensaje, Responder y Cerrar son botones pequeños que aparecen al pasar el cursor o con el foco, y siempre visibles en pantallas táctiles (J1-A-16).
- Una fila de mensaje tiene tres niveles: título (15 px), extracto en una línea con puntos suspensivos (12 px, apagado; UD-241), y las líneas de metadatos (12 px: estado y área, quién y cuándo, destinatarios). Cada línea ocupa el mismo lugar en todas las filas. La fila se compone según su propio ancho (container query), no el de la ventana.
- Menús y popovers son opacos (`.pop`): nada se transparenta bajo ellos (J1-A-09).
- La fila elegida (Áreas) lleva relleno y barra de acento de 4 px, medidos en `npm run contraste` (J1-A-33).
- Un campo editable vacío se dibuja con borde punteado y la palabra «Completar» (J1-A-23). El contador de lo que lista la vista va junto al título (J1-A-22). Un estado vacío o de error es un bloque en el cuerpo con su salida (`EmptyState`), y una dirección desconocida muestra «Página no encontrada» (J1-A-10).
- Deshacer y Rehacer no se dibujan mientras no haya nada que deshacer ni rehacer (J1-A-25).
- Una plantilla se edita como formulario (campos con casilla «Obligatorio» e instrucciones al modelo en su propia sección); el archivo con su cabecera YAML se construye al guardar y no se muestra (J1-A-32).
- El área de un mensaje es una pestaña de cromo con esquinas opuestas redondeadas; el estado es una insignia con luz.
- Los anchos de columna siguen el contenido: la lista de mensajes ocupa 60 rem y deja el resto al fondo.

## Estados y avisos

UD-029, UD-036 y UD-041. Un mensaje tiene tres estados y la interfaz no muestra otra categoría: abierto rojo, respondido amarillo, cerrado azul, siempre con su forma (triángulo, reloj, punto), su palabra y el número. Lo que afecta a la persona sale de una sola fuente, `GET /messages/summary`. Hay un solo lugar protagonista: la campana de la barra superior, el único relleno saturado de la interfaz, con el color del estado más alto presente (abierto antes que respondido; los cerrados no avisan). Mensajes, los chips de Para mí, los conteos por área y la marca de cada fila van en peso callado: fondo neutro y el estado sólo en el color de su forma. El borde izquierdo de cada fila lleva el color de su estado, también el de un cerrado. Los conteos por área dicen «N abiertos» y «N respondidos» y llevan a Mensajes filtrado por esa área y ese estado. La campana lista, mensaje por mensaje, lo que su número suma (`items` del resumen), cada uno con la palabra de su estado. Un contador que cambia de una cifra a otra pulsa una vez. `npm run contraste` mide el texto sobre el relleno de la campana (4,5) y el borde de cada estado sobre vidrio, cromo y su fondo suave (3).

## Vista de un área

UD-041. `/areas/:areaId`: el título editable en el lugar, el filtro por los tres estados con el conteo de cada uno (`StateTabs`, el estado elegido vive en la URL), la lista de mensajes de Mensajes filtrada por el área, y debajo dos secciones plegadas (`Fold`): Descripción, con el lugar del control de color del área, y Plantillas. La lista ocupa lo que queda y pagina; las secciones van justo bajo la lista (`footer` de `FitList`), sin vacío entre ambas, y abiertas las dos la vista sigue cabiendo en una pantalla. Las filas no llevan chip de área (UD-160). Los cuatro filtros van en un mismo contenedor: una fila en escritorio, dos filas de dos en teléfono. En la lista de áreas la fila es una grilla: nombre con el chevrón pegado a su última palabra, conteos en columna fija y descripción; un área sin abiertos ni respondidos muestra los dos conteos en cero, en tinta apagada (UD-211); en teléfono la descripción ocupa el ancho de la fila y los conteos van debajo, en una línea. El título de la vista de un área lleva el cuadro de color del área, que es su control (UD-045). Las cifras de la barra superior cuentan lo que es para mí y las de la barra lateral cuentan al equipo; cada una lo dice en su nombre accesible y su tooltip (UD-210).

## Avisos de la pantalla

Un aviso no mueve lo que se lee. En el teléfono flota al pie. Desde el ancho de una tableta ocupa el centro vacío de la barra superior, entre el nombre y la campana, donde no tapa contenido ni la paginación de las listas (J3-B-15). Dentro de la ventana de envíos ocupa la barra del título, que sólo tiene el título y el botón de cerrar. Lleva un enlace o una acción, nunca los dos Deshacer: lo que está en el historial se deshace con los botones del historial.

## Color de área

UD-045. Cada área lleva un color que elige el Editor, un solo valor `#rrggbb`. Todo lo demás sale de él con `panel/src/lib/area-color.ts`, que trabaja en OKLCH. El chip es el color elegido con texto blanco o negro según cuál contraste más; es el único lugar donde el color principal es un relleno. El recuadro de cada mensaje analizado lleva el color secundario del área: mismo tono, luminosidad 0,95 en el claro y 0,27 en el oscuro, un tercio de la cromaticidad, texto del mismo tono a 0,25 o 0,95 y un borde que se aleja del fondo hasta 3:1. Dentro del recuadro, el texto secundario y la marca de origen de la IA siguen al texto del recuadro (`.area-box` redefine `muted`, `faint` y `ai-fg`). Lo enviado por la persona (el original) es neutro, para que se vea cuál es su texto y cuál el análisis. Cambiar el área de un mensaje cambia el chip y el recuadro a la vez.

Regla de distinción: el estado de un mensaje es una marca con su forma y su palabra (rojo abierto, amarillo respondido, azul cerrado); el área es un chip con su nombre. Un color de área nunca reemplaza la palabra, la paleta inicial evita el rojo, el amarillo y el azul puros, y las pruebas que cuentan rellenos rojos de la pantalla no cuentan los de un chip de área. `npm run contraste` mide los tres pares de cada color en los dos temas, con los cinco iniciales y diez extremos.

## Envíos, desplegable y revisión

UD-025, UD-046, UD-070 y UD-071. Inicio va de arriba abajo como la maqueta: nombre del proyecto y fecha (la franja «Para mí» y «Por área» salió de Inicio por UD-100), «Nuevo mensaje» con la barra de texto, el desplegable y las dos listas. El desplegable es un bloque de la página, no una ventana. Se abre solo al enviar y muestra ese envío: a la izquierda el original (texto o transcripción, editable, y la galería de medios), a la derecha el análisis, con su progreso real mientras corre y, al terminar, los mensajes ya publicados, cada uno en su recuadro de color con chip, título, texto, campos, destinatarios y adjuntos editables en el lugar por quien los envió. Un mensaje editado dice «Editado» con la hora; el historial de arriba (Deshacer, Rehacer) toma un cambio de vuelta. Quien no envió el mensaje no ve ningún control de edición, tampoco el Editor. Con varios envíos seguidos aparece sobre el desplegable un selector compacto de todos los envíos propios con su estado, de modo que nada obliga a otro clic. El control «Envíos» de la fila del título conserva su alto con o sin envíos, plega y despliega el desplegable y lleva el estado en su cara; un envío que se publica o falla con el desplegable plegado se avisa. Con la publicación automática apagada, o con una propuesta que el sistema no pudo publicar sola, el análisis conserva la revisión de siempre: una lista de mensajes con su área, sus campos y el botón Enviar. Un envío fallido lleva su marca con contorno y su camino. El desplegable mide entre 20 y 30 rem; si la ventana no alcanza para él y para las dos listas, las listas se pliegan en una franja con su nombre y un botón que devuelve el espacio, y la página no se desplaza. La lista de mensajes del análisis es un carril con su desplazamiento, declarado, porque un texto no tiene largo máximo y ningún mensaje se corta. En el teléfono las dos columnas se apilan y la página se desplaza como siempre.

## Panel izquierdo

UD-047. Mide 256 px, antes 288. El botón de ocultar está junto al usuario; oculto, el botón de la barra superior lo muestra. La preferencia se guarda por persona en el navegador, con `try/catch`. En el teléfono es el menú de la barra y no lleva el botón. Cada área lleva su muestra de color y los conteos de abiertos y respondidos van bajo su nombre.

UD-130 (barra lateral). Cada fila es una grilla de dos columnas, enlace y contador. El contador es el ícono de estado con su número, sin contenedor, y su borde derecho y su centro vertical coinciden en todas las filas (tolerancia 1 px, `sidebar-alignment.browser.test.mjs`). Al pasar el puntero se ilumina la fila entera y su ícono; con el teclado, el mismo cambio y un anillo de 2 px dentro de la fila. «+», desplegable, ocultar y el contador de cada área responden igual. El rótulo de plantilla no se parte en 256 px ni en teléfono; un nombre largo escrito por una persona puede partirse.

## Envíos, la barra y la edición

La barra de nuevo mensaje crece sobre la página y nunca la empuja. En reposo reserva su alto. Con texto largo, adjuntos o enlace se abre encima, con fondo opaco desde el primer cuadro (el fondo no lleva transición) y la página de abajo se atenúa con un velo que deja pasar el puntero, así que ningún trozo de la tarjeta de abajo se ve a través ni asoma recortado (J3-B-01). El campo de texto llega a 120 px y desde ahí desplaza, con un desvanecido arriba.

El texto que se edita en el lugar no lleva caja en reposo: con ratón la caja aparece al pasar, y donde no hay puntero (`hover: none`) lleva un subrayado punteado (J3-B-10, J3-B-16). Cada adjunto de un mensaje propuesto es una ficha con su imagen, su nombre y su equis dentro, en una fila propia (J3-B-11). Una dirección larga se parte entre los segmentos de su ruta, nunca a la mitad de una palabra (J3-B-20). El menú de área tiene como máximo 22 rem y envuelve un título largo (J3-B-28).

## Teclado en la revisión

J y K recorren los envíos. Intro no publica desde ningún lado: publicar es un clic en Enviar, o Intro con el foco en ese botón. Guardar o cancelar una edición con el teclado devuelve el foco al texto editado. Escape dentro de un campo cancela sólo esa edición y no cierra la ventana (`src/flows.browser.test.mjs`, «Intro nunca publica»).
### Reglas de la ronda 2, juez A

- Una acción de fila se dibuja siempre, en reposo sin fondo, en toda lista y en toda pantalla (J2-A-11). Lo que sólo existe bajo el cursor no existe para el teclado ni para el tacto: la × de un destinatario y Responder o Cerrar de una fila siguen la misma regla.
- Lo elegido se ve igual en todas partes: relleno `selected` y barra de acento de 4 px en la barra lateral, en las filas de Áreas y de Conexiones, y borde de acento con ese relleno en los controles segmentados (J2-A-41).
- El estado de un mensaje en una fila es la luz y la palabra, sin píldora (`StatusBadge quiet`): una fila dice su estado una sola vez, con su forma y su palabra (J2-A-05, UD-041).
- Una acción reversible se confirma bajo la barra superior con su Deshacer (`undo.run(op, { announce })`): cerrar o reabrir (con el estado al que vuelve), desactivar o reactivar, reemplazar la descripción del proyecto. Eliminar una plantilla deja en su lugar una fila ««Nombre» eliminada» con Deshacer, mientras no se haga otra cosa (J2-A-18, J2-A-23, J2-A-30, J2-A-35). Deshacer y Rehacer de la pantalla son de vidrio sin relleno: pesan menos que la acción.
- La ventana de campos de una plantilla guarda al instante (UD-017) y lo dice con «Guardado» al pie, junto al único botón que sale, «Listo». Las casillas son `ui/checkbox` (pozo, borde y acento del panel), nunca las del navegador (J2-A-24).
- Un menú de filtros marca lo aplicado: casilla y valor en cada filtro encendido, y el botón lleva su cuenta y el relleno elegido (J2-A-13).
- Una lista que espera dibuja filas que guardan su lugar; una que falla dibuja icono, motivo y Reintentar, y dice «Reintentando» mientras repite (`LoadState`, J2-A-46, J2-A-47). Una fila de la barra lateral con insignia tiene el alto que tiene con ella y la columna de la insignia está reservada, así que nada se corre cuando llegan los números.
- El anillo de foco mide 3 px (J2-A-48). Configuración, Tema y Cerrar sesión no se repiten en un menú superior: en teléfono la barra lateral es el cajón que abre el botón de la izquierda (J2-A-38, J2-A-40). Conexiones lleva a `/connections/:kind`, una lista con el estado de cada conector (J2-A-34).

## Archivos

| Archivo | Contenido |
|---|---|
| `src/styles.css` | Tokens, fuentes, vidrio, gel, esfera, luz de estado, medidor |
| `src/components/Atmosphere.tsx` | Órbita y destellos |
| `src/components/icons.tsx` | Íconos propios |
| `src/assets/fonts/` | Orbitron y Source Sans 3 con su licencia OFL |
| `scripts/contraste.mjs` | Medición de contraste |
| `scripts/capturas.mjs` | Capturas a 1440 por 900 y 390 por 844 |
| `scripts/capturas-vistas.mjs` | Cada vista a 1440×900, 1280×720 y 390×844, en ambos temas y en español o inglés, con la medición de recortes y desbordes |
| `src/fits-one-screen.browser.test.mjs` | Cada vista cabe en una pantalla a dos tamaños, con lo sembrado y con las listas ×8 (`npm run test:fit`) |
| `scripts/capturas-ronda2b.mjs` | El flujo de enviar a publicar a 1440×900 y 390×844, en claro y oscuro |
| `src/flows.browser.test.mjs` | Edición en el lugar, deshacer, propuesta, reintento, respuestas con medios, equipo, contraseña e idioma (`npm run test:flows`) |
| `src/flows-equipo-config.browser.test.mjs` | Equipo, Configuración y entrada de la ronda 4: botón de alta, pliegue del perfil, acción en teléfono, rótulos, márgenes de la tarjeta (`npm run test:flows`) |
| `src/flows-ronda2a.browser.test.mjs` | Los hallazgos de la ronda 2, juez A, cada uno con una comprobación que falla si vuelve (`npm run test:flows`) |
| `src/i18n.test.ts` · `src/prose-block.test.ts` | Catálogos completos y sin texto visible fuera de ellos; una sola clase de justificado |
| `src/no-truncation.test.ts` | Prohíbe `truncate`, `line-clamp` y `text-overflow` sin justificación en la misma línea |

## Equipo, Configuración y entrada (ronda 4, 2026-10-21)

- Los rótulos de campo de Configuración, tanto de Cuenta como de Proveedores, usan `text-sm text-muted`; el valor o el control va en tinta normal debajo. Una prueba compara tamaño, peso y color de seis rótulos.
- Los valores de Nombre, Correo y Rol de Configuración son texto plano porque no se editan ahí; su ayuda dice quién los cambia y dónde (UD-122).
- En Equipo, la acción «Desactivar» comparte la fila del rol en teléfono. La lista mantiene en la página la fila cuyo perfil se abre (`reveal`).
- En la entrada, el aviso de error va bajo la tarjeta y no reserva una fila dentro de ella: el margen bajo la nota es el del logo sobre la tarjeta (UD-170 para la nota).
