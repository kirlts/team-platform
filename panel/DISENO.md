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
| Marca y título de pantalla | Orbitron | 15 a 23,4 px según el ancho (`clamp`) | Peso 600 a 800, tracking 0,01 a 0,14 em |
| Rótulo de sección | Orbitron | 12 px | Mayúsculas, tracking 0,08 em |
| Texto | Source Sans 3 | 15 px base | Escala de razón 1,25: 12, 15, 18,75, 23,4 |

Las fuentes están empaquetadas en `src/assets/fonts/` (WOFF2 variable, subconjunto latino) con su licencia OFL al lado. Ninguna se pide a un servidor externo; `font-src 'self'` basta, y `assetsInlineLimit: 0` impide que Vite las convierta en `data:`. Las cifras con cero tachado de Orbitron no se usan en datos: la fecha y la hora van en Source Sans 3.

### Movimiento

Una animación continua: el destello del medidor de progreso, mientras un trabajo corre. Los botones se hunden 1 px al presionarse. `prefers-reduced-motion` apaga las animaciones.

### Atmósfera

`src/components/Atmosphere.tsx` dibuja una órbita anclada a la esquina superior derecha, fija y con `aria-hidden`; en teléfono no se dibuja. El cielo con brillos radiales cita el Frutiger Aero y la órbita el Y2K futurista. No hay destellos sueltos: un adorno sin ancla flota (UD-016).

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
| Columnas de una tarjeta de mensaje | fecha 5,5 rem, íconos de medio 7,5 rem, estado el resto: el estado y los íconos caen en la misma x en todas las filas |

Reglas de anclaje:

1. Los elementos de una fila se alinean por su primera línea de texto o por el borde del contenedor; nunca por el centro de un bloque de alto variable.
2. Un dato del mismo tipo ocupa la misma columna en todas las filas (lo pendiente de Áreas, el estado de una tarjeta, el rol de Equipo tienen ancho fijo).
3. Lo que se coloca a la derecha de una fila (emisor, acciones) se ancla al borde derecho del contenedor, haya o no miniatura; la miniatura vive en su propio bloque.
4. Un elemento sin vecino en su línea (un chip suelto, un botón solo) toma el borde izquierdo o derecho de la columna, no queda a medias.
5. Un texto largo se envuelve en su celda: ningún rótulo, nombre, título, correo ni destinatario se corta con puntos suspensivos (UD-016). Lo que no cabe en una fila se pliega con su cuenta («+6» destinatarios, «+3» adjuntos) y se abre sobre la página, sin crecer la fila (UD-017).
6. Los íconos de medio (foto, video, audio, documento, enlace) van al lado de la fecha de cada mensaje y respuesta, uno por tipo, con la cuenta cuando hay más de uno.
7. Ningún adorno suelto: la atmósfera es una órbita anclada a la esquina superior derecha; no hay destellos sueltos ni esferas sin función.

La prohibición la hace cumplir `src/no-truncation.test.ts`, la medición del navegador (`scripts/capturas-vistas.mjs`) y `src/fits-one-screen.browser.test.mjs`.

## Cada vista cabe en una pantalla

UD-017. A 1440 por 900 y a 1280 por 720 ninguna vista desplaza el documento ni la región principal. Lo que se necesita ahora está a la vista; lo demás se pliega con su cuenta y las listas paginan dentro de su marco.

- `Page` ocupa el alto de la región principal desde 768 px; el bloque que crece (una lista) toma lo que queda con `flex-1 min-h-0`, y las filas de cuadrícula usan `minmax(0, 1fr)` para que el contenido no estire la fila.
- `FitList` mide el alto del espacio que le toca y el alto de cada fila ya dibujada, y deja las que caben; el resto está en las páginas siguientes, con el rango y dos flechas al pie. El tamaño de página no se escribe en ningún lado: sale de esas dos medidas, y se vuelve a medir cuando cambia la ventana, la lista o el alto de una fila (por ejemplo, cuando llega la plantilla de un campo). Si todas caben, el marco se ajusta a ellas y no hay paginador. En teléfono la página crece con su contenido y no hay páginas.
- Con una propuesta abierta, Inicio pliega las dos listas en una línea con su cuenta; cada una lleva a Mensajes.
- Carriles con desplazamiento propio permitidos, todos declarados con `data-lane` y con el motivo en el código: el texto pegado de la vista previa, el cuerpo y los campos de un mensaje, la descripción del proyecto, la lista de áreas de la barra lateral y las listas de las ventanas emergentes. Los campos de texto desplazan por sí solos.
- La prueba (`npm run test:fit`) abre cada vista a los dos tamaños, con lo sembrado y con cada lista multiplicada por ocho en el navegador, y falla si el documento o la región principal desbordan, si un elemento tiene un carril propio fuera de la lista blanca, si algo queda bajo el borde de la ventana o si el documento esconde su desborde.

## Edición en el lugar y deshacer

UD-017. `EditableText` es el único campo editable: un clic abre el texto en el mismo sitio, con la misma tipografía, el mismo ancho y el mismo alto; un clic afuera o Enter guardan, Escape cancela, Shift+Enter abre una línea nueva en la variante de varias líneas. No hay botón «Editar» ni «Guardar» ni lápiz. `useUndoStack` guarda en memoria las operaciones de la pantalla (guardados, destinatarios, área, adjuntos, activación de un miembro, borrado de una plantilla) y las dos botones «Deshacer» y «Rehacer» y Ctrl+Z y Ctrl+Shift+Z las recorren; recargar la pantalla vacía la pila. No hay historial de versiones.

## Texto corrido

UD-022. Todo bloque de texto de más de dos líneas (cuerpo de mensaje y de respuesta, vista previa, campos de plantilla, perfil, descripción del proyecto) lleva la clase `prose-block`: `text-align: justify`, `hyphens: none`, `text-wrap: pretty`, igual en lectura y en edición. Títulos, rótulos, chips, celdas y textos de una o dos líneas quedan a la izquierda. `src/prose-block.test.ts` falla si otra regla justifica o enciende `hyphens`.

## Idioma

UD-018. La interfaz sale de dos catálogos, `src/i18n/es-419.ts` (por omisión) y `src/i18n/en.ts`, con las mismas claves; cada texto, nombre accesible, marcador, plural y fecha (`Intl` con el idioma de la cuenta) viene de ahí. Un solo control en Configuración, «Idioma» o «Language», cambia todo al instante. Los errores de la API llegan con `code` y se traducen con `error.<code>`; sin traducción se muestra el mensaje del servidor. `src/i18n.test.ts` falla si un catálogo tiene una clave que el otro no, si el código nombra una clave que no existe o si hay un texto visible escrito fuera de los catálogos.

## Jerarquía y distribución

- Inicio usa una banda de dos columnas 5/7 (mensaje y análisis) y debajo otra 7/5 (mensajes y respuestas). La alternancia sostiene la asimetría sin romper la grilla de 12 columnas.
- Cada pantalla abre con una esfera de vidrio y el título en Orbitron; es la única forma que se repite, y firma la marca.
- La acción primaria de cada vista es un botón gel; las demás son vidrio o texto. En las filas de mensaje, Responder y Cerrar bajan a texto para que el título y el estado se lean primero.
- El área de un mensaje es una pestaña de cromo con esquinas opuestas redondeadas; el estado es una insignia con luz.
- Los anchos de columna siguen el contenido: la lista de mensajes ocupa 60 rem y deja el resto al fondo.

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
| `src/flows.browser.test.mjs` | Edición en el lugar, deshacer, propuesta, reintento, respuestas con medios, equipo, contraseña e idioma (`npm run test:flows`) |
| `src/i18n.test.ts` · `src/prose-block.test.ts` | Catálogos completos y sin texto visible fuera de ellos; una sola clase de justificado |
| `src/no-truncation.test.ts` | Prohíbe `truncate`, `line-clamp` y `text-overflow` sin justificación en la misma línea |
