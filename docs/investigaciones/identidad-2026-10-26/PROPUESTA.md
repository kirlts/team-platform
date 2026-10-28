# Propuesta de refresco de identidad

Tres direcciones para devolverle identidad al panel, con una recomendación al final. El panel no se toca. Cada dirección tiene un boceto estático de la ficha de mensaje (#109) en `bocetos/`. Se genera con los tokens de este documento (`bocetos/generar.mjs`) y se captura a 1440 de ancho, claro y oscuro (`bocetos/capturar.mjs`). Lo que se perdió y dónde está en `AUDITORIA.md`.

## Pedido de Martín

2026-10-26, textual: «originalmente la idea era que esto se viera como una mezcla entre un foro de los años 2000 con un programa para operadores de call center y que tuviera como ese look optimista, futurista y reflectivo de ese tipo de sitios … como de una compañía telefónica … hay que refrescar eso y darle más identidad». Los límites vigentes son UD-013 (nada muy loco; identidad, espaciado y jerarquía), UD-110, UD-241 y `panel/DISENO.md`. Eso significa lenguaje de programa estándar, contraste medido y ninguna fuente ni imagen de otro dominio.

## Referencias

Consulta del 2026-10-26. Los colores de las filas de foros y de Nokia se midieron en píxeles sobre una captura de la página archivada (Chromium sin ventana, 1024 de ancho). No salen de un artículo.

| Fuente | Fecha de la página | Qué se midió o se leyó |
|---|---|---|
| [phpBB.com, índice del foro](https://web.archive.org/web/20030408232755/http://www.phpbb.com:80/phpBB/index.php), tema subSilver (phpBB 2) | 2003-04-08 | Cabecera de tabla `#006699` con texto naranja en negrita; barra de categoría `#d1d7dc` con texto azul en negrita y espaciado; filas alternas `#efefef` y `#dee3e7`; celdas separadas por 1 px; contadores centrados en columnas; «La hora ahora es…» sobre la tabla. El `#006699` figura como fondo de `th` en [un tema derivado publicado en phpbb.de](https://www.phpbb.de/community/viewtopic.php?p=321975); `#DEE3E7` y `#EFEFEF` figuran en [otro](https://www.phpbb.de/community/viewtopic.php?p=442718), sin confirmar que sean de las filas |
| [vBulletin.com, foro de la comunidad](https://web.archive.org/web/20021010004955/http://www.vbulletin.com:80/forum/) (vBulletin 2.2.8) | 2002-10-10 | Fondo de página `#666696` y barra de categoría `#606096` con texto amarillo; cabecera de columnas `#8080a6`; filas `#f1f1f1`; botones de cabecera en imagen con biselado de 1 px y texto en minúsculas; icono de «ir a la última respuesta» al final de cada fila |
| [Invision Power Board, foro de IPS](https://web.archive.org/web/20030528113355/http://forums.invisionpower.com:80/) | 2003-05-28 | Barra de navegación superior celeste con enlaces separados por punto medio; tira de iconos pequeños con rótulo (Ayuda, Buscar, Miembros, Calendario); «Bienvenido, invitado» y «su última visita fue…» en la cabecera |
| [Nokia.com](https://web.archive.org/web/20030603070428/http://www.nokia.com:80/) | 2003-06-03 | Barra de navegación azul `#0033cc` con rótulos blancos en negrita y la pestaña activa en gris claro; columna derecha de cajas con título gris sobre filete; botón «GO» gris con bisel |
| [BellSouth.com](https://web.archive.org/web/20030602144729/http://www.bellsouth.com:80/) | 2003-06-02 | Enlaces naranjas con subrayado y títulos azules; formulario de búsqueda en caja con filete celeste. Las imágenes no se conservaron en el archivo: sólo se leyó el texto y el color |
| Entel.cl (2002-11-30) y Telefónica.cl (2003-06-01), versiones archivadas | 2002 y 2003 | No se pudieron leer: la primera cargó en blanco y la segunda cargó un error de script. Ningún rasgo de esas dos empresas entra en esta propuesta |
| [Cisco, estados del agente en Agent Desktop](https://cisco.com/c/en/us/support/docs/voice-unified-communications/unified-contact-center-express/44782-CAD-WorkStateAfterCall.html) | sin fecha visible | Estados Ready, Work, Reserved, Talking y Wrap-Up, tres de ellos automáticos |
| [Guía de wallboard de ICC](https://docs.icc.infracom.se/docs/wallboard) | sin fecha visible | Verde para agente disponible, amarillo para llamada sonando, rojo para ocupado y gris para pausa; las llamadas en cola cambian de color según el nivel de servicio |
| [Citel QV-M1, tableros LED para Nortel Meridian 1](https://manualmachine.com/citel/qvm1/21778712-brochure/) | sin fecha visible | Tableros de LED que difunden estadísticas de cola y estado de agentes; caracteres legibles a 15 m. El folleto no trae fecha, así que su pertenencia a 1998 o 2006 no está comprobada |
| [Wikipedia, Frutiger Aero](https://en.wikipedia.org/wiki/Frutiger_Aero), editada el 2026-10-25 | 2026 | Bordes redondeados y elementos translúcidos; texturas brillantes («Web 2.0 Gloss»); pico entre 2004 y 2013; el nombre se acuñó en 2018 |
| [Wikipedia, Aqua](https://en.wikipedia.org/wiki/Aqua_(user_interface)) | consulta 2026-10-26 | Franjas finas en fondos de ventana y menús; botones de gel hasta 2014; barras de progreso con rayas diagonales animadas |
| [MDN, box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow), [repeating-linear-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/repeating-linear-gradient()), [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) | consulta 2026-10-26 | Sombras apiladas con `inset` para biseles y halos; dos paradas en la misma posición dan un borde duro; la consulta de movimiento reducido |

No se encontró ninguna captura ni manual de consolas de operador de Avaya, Nortel o Genesys de 1998 a 2006; sólo hay documentación actual. Tampoco se encontró un uso de 2025 o 2026 de esta estética en un producto de gestión. El panel LCD y el reflejo de cromo con horizonte vienen de `DISENO.md` (consulta del 2026-10-20) y de la técnica de MDN, no de una fuente de consola leída hoy.

## Rasgos que se pueden traer

| Rasgo | De dónde | Cómo se trae | Riesgo y límite |
|---|---|---|---|
| Barra de categoría con título en versalitas sobre un tono plano | phpBB, vBulletin | Título de región con fondo en degradado, 26 px de alto, texto de 12 px en negrita con 0,08 em de espaciado | El texto blanco sobre el tramo claro del degradado se mide en el peor punto (ver «Contraste medido») |
| Filas alternas con dos tonos cercanos | phpBB (`#efefef` y `#dee3e7`), vBulletin | `--row-alt` a 0,03 de luminosidad del fondo | Sin diferencia de contraste de texto entre las dos |
| Rejilla de celdas de 1 px | phpBB | `gap: 1px` sobre un fondo del color de la línea | Sólo en tablas, nunca en texto corrido |
| Columna de autor a la izquierda de cada entrada | phpBB, vBulletin | `grid-template-columns: 104px 1fr` en cada respuesta del hilo | En teléfono pasa a una columna con el autor arriba |
| Estado con luz y palabra | Cisco, ICC (verde, amarillo, rojo, gris) | LED de 9 px con brillo especular y halo, siempre junto a la palabra | WCAG 1.4.1: el color no va solo; 2.3.1: no parpadea |
| Contadores de cola en pantalla de cifras | Citel, wallboards | Panel oscuro con cifras de color y rótulo; cifras en Source Sans 3 negrita con `tabular-nums` | El cero tachado de Orbitron lo prohíbe `DISENO.md` en datos: las cifras no van en Orbitron |
| Barra de navegación con pestaña activa distinta | Nokia, IPB | Fila activa con gel y brillo | Texto sobre el brillo medido |
| Cajas con título gris sobre filete | Nokia | Panel con barra de título de una línea | Máximo una barra por región con nombre, nunca por fila |
| Brillo superior con horizonte | Aqua, Frutiger Aero | Capa de blanco al 0,18 a 0,22 sobre la mitad superior de una barra | No se aplica sobre texto corrido ni sobre botones secundarios |
| Franjas finas de fondo | Aqua | `repeating-linear-gradient` de 1 px cada 4 px a baja opacidad | Sólo en el fondo de página, nunca bajo texto corrido |

No se traen el texto de 11 px de los foros, los degradados de imagen, las imágenes de cielo, pasto o peces, las teclas de función como único camino de una acción ni el parpadeo de luces.

## Dirección A, Centralita

Una consola de operador sobre el cielo actual. Cada región con nombre del modelo de datos es una ventana con barra de título. El estado vive en un panel LCD de la barra superior y en luces de 9 px. Las listas alternan filas. Boceto: `bocetos/a-centralita-light.png` y `a-centralita-dark.png` (fuente `bocetos/a-centralita.html`).

### Tokens y materiales

| Token | Hoy | Propuesta (claro / oscuro) |
|---|---|---|
| `--color-glass` en paneles de contenido | blanco con alfa 0,64 | Reemplazado por `--color-panel`: `oklch(.985 .006 240)` / `oklch(.23 .04 257)`. El vidrio queda para menús y diálogos |
| `--color-panel-edge` (nuevo) | no existe | `oklch(.52 .06 252)` / `oklch(.50 .07 255)` |
| `--tb-1`, `--tb-2` (nuevos, barra de título) | no existen | `oklch(.44 .15 250)` y `oklch(.30 .15 255)` / `oklch(.40 .13 250)` y `oklch(.26 .10 255)` |
| `--tb-gloss` (nuevo) | no existe | `.22` / `.18`, blanco sobre la mitad superior de la barra |
| `--tb-height` (nuevo) | no existe | `26px` |
| `--row-alt` (nuevo) | no existe | `oklch(.955 .014 245)` / `oklch(.26 .04 257)` |
| `--lcd-bg`, `--lcd-edge` (nuevos) | no existen | `oklch(.24 .045 255)` y `oklch(.14 .04 255)` / `oklch(.14 .03 255)` y `oklch(.08 .02 255)` |
| `--lcd-ok`, `--lcd-warn`, `--lcd-info`, `--lcd-alert`, `--lcd-label` (nuevos) | no existen | `oklch(.88 .17 150)`, `oklch(.86 .15 85)`, `oklch(.80 .12 235)`, `oklch(.80 .19 28)`, `oklch(.72 .05 250)` (iguales en oscuro) |
| `.led::before` | 6 px, halo de 6 px | 9 px, `radial-gradient(circle at 35% 30%, #fff 0 14%, transparent 40%)` sobre el color, halo `0 0 7px 1px` |
| `--led-red` / `--led-amber` / `--led-blue` (nuevos, uno por estado de UD-029) | `--color-open-led`, `--color-answered-led`, `--color-closed-led` | `oklch(.62 .24 25)`, `oklch(.82 .17 85)`, `oklch(.60 .20 250)` / `oklch(.70 .21 25)`, `oklch(.85 .16 85)`, `oklch(.72 .16 240)` |
| `--color-gel-top`, `--color-gel-bottom` | `oklch(.47 .21 250)`, `oklch(.38 .18 256)` | Sin cambio en el panel. Los bocetos usan `.46` y `.36` con brillo plano de `.16`, una medición más severa que la de `contraste.mjs` |
| Fondo de página (`body`) | tres brillos radiales y degradado diagonal de 155° | Degradado vertical `oklch(.93 .022 245)` a `oklch(.87 .035 250)` más una capa de franjas `repeating-linear-gradient(180deg, rgb(255 255 255/.18) 0 1px, transparent 1px 4px)` al 35 % de opacidad (oscuro: blanco al 0,04, opacidad 1). Se eliminan `--color-glow-1` a `--color-glow-3` |
| `--color-chrome-1` a `--color-chrome-4` | tubo plateado con horizonte | Sin cambio |
| `--h2-*` | 12 px, 700, mayúsculas, 0,08 em | Sin cambio: pasa a ser el estilo de la barra de título de ventana |

`DISENO.md` cambia en cuatro secciones: «Tokens» (las filas anteriores), «Atmósfera» (la órbita se conserva, el cielo pasa a franjas), «Lo generado por IA» (se agrega «ventanas» como material) y una sección nueva «Estado en el panel LCD».

### Componentes que se tocan

| Componente | Cambio |
|---|---|
| `Header.tsx`, `StatusBar.tsx` | Los tres contadores pasan a un panel LCD continuo: luz, cifra, rótulo («Abiertos», «Respondidos», «Cerrados») |
| `NotifyBadge.tsx`, `StatusBadge.tsx`, `StateIcon` | El estado dibuja la luz y la palabra; el triángulo, el reloj y el círculo de contorno salen de las listas y quedan en la campana |
| `Page.tsx`, `PageHeader.tsx`, `SettingsBox.tsx` | Nuevo componente `Window` (barra de título más cuerpo). `SettingsBox` pasa a usarlo: las once cajas de Configuración se agrupan en cuatro ventanas con nombre |
| `MessageDetail.tsx` | Cuatro ventanas: Mensaje, Adjuntos, Texto, Respuestas |
| `ReplyThread.tsx` | Filas alternas y fila de aviso del sistema con su luz |
| `QueuePanel.tsx`, `Meter.tsx` | Los cinco contadores de la cola pasan a celdas LCD con cifra y rótulo |
| `Sidebar.tsx` | Barra de título «Navegación» y fila activa con gel y brillo |
| `Login.tsx` | Tarjeta con barra de título «Entrada» y una línea de estado inferior (servidor y fecha) |

### Se prohíbe

Siguen prohibidos todos los valores de la lista de convergencia de la IA de `DISENO.md`. Para esta dirección se agrega lo siguiente.

| Prohibido | Motivo |
|---|---|
| Cifras en Orbitron | Su cero tachado; `DISENO.md` ya lo excluye de los datos |
| Luces que parpadean, o una luz sin la palabra de su estado | WCAG 2.3.1 y 1.4.1 |
| Ventana dentro de otra, o barra de título en una fila de lista | Una barra por región con nombre |
| Franjas de fondo bajo texto corrido | Contraste |
| Halo de color sobre texto fuera del panel LCD | Es el neón por omisión de los generadores |
| El verde `#10B981` de la lista y cualquier degradado de la barra de título hacia lila | Valores de convergencia |

## Dirección B, Foro 2003

Es la estructura de subSilver en Source Sans 3: barras de categoría, celdas en rejilla de 1 px, filas alternas y respuestas como entradas con la columna de autor a la izquierda. Pierde el vidrio y el cielo, y gana densidad. Boceto: `bocetos/b-foro-light.png` y `b-foro-dark.png`.

### Tokens y materiales

| Token | Hoy | Propuesta (claro / oscuro) |
|---|---|---|
| Fondo de página | cielo con tres brillos | Plano `oklch(.93 .008 240)` / `oklch(.17 .015 255)` |
| `--cell-1`, `--cell-2` (nuevos) | no existen | `oklch(.965 0 0)` y `oklch(.925 .01 240)` / `oklch(.23 .015 255)` y `oklch(.205 .02 255)` |
| `--cat`, `--cat-ink` (nuevos, barra de categoría) | no existen | `oklch(.86 .014 235)` y `oklch(.36 .10 245)` / `oklch(.30 .04 250)` y `oklch(.88 .06 235)` |
| `--th`, `--th-ink` (nuevos, cabecera de tabla y de ventana) | no existen | `oklch(.46 .10 235)` y blanco / `oklch(.38 .09 240)` y blanco |
| `--grid` (nuevo, color de la separación de 1 px) | no existe | `oklch(.70 .02 240)` / `oklch(.10 .01 255)` |
| Barra superior | tubo plateado | Degradado `oklch(.50 .11 240)` a `oklch(.34 .10 245)` con filete inferior de 3 px `oklch(.78 .16 70)` (naranja de la cabecera de phpBB) |
| `--leaf-radius`, `.btn` | hoja y píldora | `0` y `2px` con biselado `inset 1px 1px 0 #fff, inset -1px -1px 0 oklch(.60 .02 240)` |
| `.glass`, `.glass-strong` | vidrio con desenfoque | Sólo en menús y diálogos; el resto, celdas planas |
| `.led::before` | 6 px | Sin cambio; el estado se dibuja como texto con luz de 9 px dentro de la celda del contador |

### Componentes que se tocan

Se tocan `Header.tsx` y `StatusBar.tsx` (tres celdas con luz y palabra), `Sidebar.tsx` (filas con filete), `MessageList.tsx` y `MessageCard.tsx` (tabla con cabecera `--th` y columnas Estado, Mensaje, Área, Autor y Hora), `ReplyThread.tsx` (columna de autor de 104 px), `MessageDetail.tsx`, `SettingsBox.tsx` y `Login.tsx`. Es la dirección que más estructura cambia: la lista de mensajes pasa de filas de cuatro líneas a columnas.

### Se prohíbe

Siguen prohibidos los valores de la lista de convergencia. Se agregan el texto de menos de 12 px (los 11 px de la época quedan fuera), las imágenes de degradado, las esquinas de más de 2 px en celdas y botones, el hover sobre celdas que no son enlace y el naranja `oklch(.78 .16 70)` en cualquier texto (sólo vive en el filete).

## Dirección C, Aero telefónico

Es la piel actual llevada al extremo optimista: cielo más brillante, curva de operadora en la barra, barras de título de vidrio con reflejo y horizonte, y contadores en cápsulas de gel. Es la menos estructural, porque las pantallas conservan su disposición. Boceto: `bocetos/c-aero-light.png` y `c-aero-dark.png`.

### Tokens y materiales

| Token | Hoy | Propuesta (claro / oscuro) |
|---|---|---|
| `--color-sky-a`, `-b`, `-c` | `oklch(.955 .045 205)`, `oklch(.945 .03 250)`, `oklch(.95 .03 232)` | `oklch(.90 .08 205)`, `oklch(.93 .05 235)`, `oklch(.96 .06 150)` / `oklch(.22 .07 235)`, `oklch(.16 .05 268)`, `oklch(.20 .06 215)` |
| `--color-glow-1`, `-3` | aqua y lima al 0,55 y 0,28 | aqua `oklch(.88 .12 200 / .70)` y verde `oklch(.90 .10 145 / .45)` en las dos esquinas |
| Barra superior | tubo plateado | Celeste con reflejo: `linear-gradient(180deg, rgb(255 255 255/.7) 0 50%, transparent 50%)` sobre `oklch(.82 .09 215)` a `oklch(.60 .15 240)`; oscuro `oklch(.42 .10 235)` a `oklch(.26 .08 255)` |
| Curva de operadora | no existe | Dos trazados SVG dentro de la barra (alto 56 px), blanco al 0,22 y filete al 0,7; `Atmosphere.tsx` los dibuja en lugar de la órbita |
| `--tb` de ventana (nuevo) | no existe | Celeste `oklch(.84 .08 215)` a `oklch(.72 .12 235)` con reflejo de 0,6 y texto oscuro `oklch(.22 .08 255)` / `oklch(.42 .10 235)` a `oklch(.30 .09 255)` con texto blanco |
| Contadores de estado | triángulo, reloj y círculo en contorno | Cápsula de gel de 34 px con luz de 9 px, cifra y palabra |
| Fila activa de la barra lateral | barra de 4 px y relleno | Cápsula con degradado celeste a azul y texto `oklch(.20 .08 255)` (claro); `oklch(.40 .12 235)` a `oklch(.28 .10 255)` con texto blanco (oscuro) |
| `--color-glass` | blanco 0,64 | Sin cambio en valor; se usa en más superficies (ventanas de la ficha incluidas) |
| `.leaf-radius` | `3px 10px 3px 10px` | `6px 16px 6px 16px` |

### Componentes que se tocan

`Header.tsx`, `StatusBar.tsx`, `Atmosphere.tsx`, `Sidebar.tsx`, el nuevo `Window` en `MessageDetail.tsx` y `SettingsBox.tsx`, `Login.tsx`. `MessageList.tsx` no cambia.

### Se prohíbe

Siguen prohibidos los valores de la lista de convergencia. Se agregan el vidrio translúcido bajo texto corrido (sólo bajo rótulos y barras, medido sobre el peor tono del cielo), las imágenes de cielo, pasto, peces o burbujas, las curvas que crucen un título o un botón (la curva vive dentro de la barra de 56 px), el brillo sobre el texto de un botón secundario y el verde lima o menta como fondo de una fila.

## Contraste medido

`bocetos/contraste.py` calcula la razón WCAG 2 de los pares de texto de los bocetos, mezclando en sRGB codificado como el navegador. La barra con brillo se mide en tres puntos de la mitad superior y se toma el peor. Corrida del 2026-10-26, mínimo 4,5:

| Par | Razón |
|---|---|
| A claro, título de ventana, blanco sobre degradado `.44` a `.30` con brillo `.22` | 4,61 |
| A oscuro, título de ventana, `.97` sobre degradado `.40` a `.26` con brillo `.18` | 5,29 |
| A claro, fila activa, blanco sobre gel `.44` a `.34` con brillo `.18` | 5,06 |
| A oscuro, fila activa, tinta `.16` sobre gel `.80` a `.66` con brillo `.18` | 9,52 |
| A, cifra del LCD, la peor de las cuatro (verde, ámbar, azul, rojo) sobre `.24` | 6,99 |
| A, rótulo del LCD, el peor de claro y oscuro | 6,66 |
| A, texto sobre panel, claro y oscuro | 15,40 y 14,63 |
| B claro y oscuro, título de tabla blanco sobre `--th` | 6,97 y 9,87 |
| B claro, texto de categoría; texto sobre fila alterna | 7,02 y 13,19 |
| B oscuro, texto sobre fila alterna | 14,59 |
| B, barra superior, blanco sobre el peor extremo del degradado | 5,91 |
| C claro, título de ventana oscuro sobre celeste con brillo `.6` | 13,37 |
| C oscuro, título de ventana, blanco sobre degradado con brillo `.16` | 5,54 |
| C claro, fila activa, tinta `.20` sobre aqua a azul con brillo `.35` | 8,67 |
| C oscuro, fila activa, blanco sobre degradado con brillo `.12` | 6,43 |
| C claro, texto sobre cristal al 62 % sobre el cielo aqua | 14,43 |
| Botón primario claro, blanco sobre gel `.46` a `.36` con brillo `.16`; con brillo `.22` baja a 4,30 | 4,89 |
| Botón primario oscuro, tinta `.18` sobre gel `.80` a `.66` | 9,53 |

Las 20 filas de `bocetos/contraste.txt` cumplen. El primer borrador no cumplía en tres pares y se corrigió antes de capturar: la barra de título de A con luminosidad `.56` (2,91), el texto blanco de la fila activa de C sobre aqua (1,65) y el mismo texto en oscuro (2,91). `panel/scripts/contraste.mjs` modela el brillo sólo en el botón gel, y lo desvanece hacia el centro. Cualquier dirección que se adopte necesita filas nuevas ahí para las barras de título y las filas activas.

## Comparación

| Criterio | A Centralita | B Foro 2003 | C Aero telefónico |
|---|---|---|---|
| Qué parte del pedido cubre | Programa de operadores y reflejo; el cielo mantiene lo optimista | Foro; poco futurista | Optimista y reflectivo; poco de foro y de operador |
| Pérdida que corrige en la auditoría | Estado sin luz (I-03, M-03, A-02), ficha sin estructura (F-02, F-03), Configuración de cajas iguales (C-02, C-03) | Lista sin columnas (M-02), ficha sin estructura (F-02, F-03) | Entrada plana (L-02), cielo y vidrio débiles |
| Cambio estructural | Medio: un componente `Window` y un panel de estado | Alto: la lista de mensajes pasa a tabla con columnas | Bajo: materiales y una curva |
| Riesgo de accesibilidad | Bajo: el texto sobre el LCD y sobre las barras se midió | Bajo | Medio: cristal translúcido bajo rótulos |
| Riesgo de convergencia de la IA | Franjas y cifras brillantes si se usan en más superficies | El aspecto de plantilla de foro genérico | Es la dirección más cercana al «Frutiger Aero» que hoy produce cualquier generador |
| Reversible por tokens | Sí, en su mayor parte | Parcialmente | Sí |

## Recomendación

Dirección A, con la columna de autor de B sólo en `ReplyThread.tsx`.

Razones. El pedido nombra un foro, un programa de operadores y un sitio de operadora. A es la única que pone en pantalla el programa de call center: el panel LCD con cifras de cola y las luces de estado de la barra superior. Conserva el cielo y el gel, que dan el aire optimista, y cada región lleva una barra de título que hace de categoría de foro. Lo que más se perdió fue el estado con luz y la estructura de ventanas en la ficha y en Configuración. A lo repone ahí. C no toca esas dos zonas, y B las resuelve a costa de la lista de mensajes y del cielo. Casi todos los materiales de A ya son variables de tema (`f2dec8ac`, `bca95c59`, `34736488`, `3e8fa1ea`), así que color y forma cambian sin tocar componentes. Lo nuevo en código es el componente `Window` y el panel de estado. Los 20 pares de texto medidos cumplen 4,5.

Quedan tres decisiones para Martín, porque cambian lo que ve una persona. La primera es si el panel LCD sustituye a los tres contadores de hoy o los acompaña. La segunda es si Configuración se agrupa en cuatro ventanas con nombre (Cuenta, Proyecto, Proveedores, Registro) o conserva las once cajas. La tercera es si la órbita se mantiene. La propuesta es sustituir, agrupar y mantener la órbita bajo la barra.
