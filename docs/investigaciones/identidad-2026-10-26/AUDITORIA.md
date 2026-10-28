# Auditoría de identidad visual del panel

Auditoría del 2026-10-26 sobre `origin/desarrollo` (`9380f7cb`). Las capturas son del panel canónico contra el servidor de ejemplo. Se tomaron en Chromium sin ventana, a 1440 y 390 de ancho, en tema claro y oscuro, con `panel/scripts/capturas-mensajes.mjs` y `capturas-gestion.mjs` sin cambios. Quedan en `capturas/`. Los conteos salen de `git grep` sobre `panel/src/components` y `panel/src/pages` en el commit `ea507084` (2026-10-20, entrada de la piel) y en el estado actual.

## Resultado

La piel del 20 de octubre sigue montada, pero queda sólo el fondo: cielo celeste, vidrio blanco, botón gel y una esfera en la marca. Lo que la hacía parecer una centralita se retiró en 59 commits sobre `styles.css` posteriores a su entrada. Eran los títulos en Orbitron, las luces de estado, los contadores con presencia y los bordes de pantalla de instrumento. Cada commit tiene una razón de legibilidad o de jerarquía que se sostiene sola. Ninguno nombra la identidad como motivo (0 de 59 mencionan «identidad» o «Y2K»). La suma de todos la quitó.

| Elemento de la piel original | Estado hoy | Dónde se diluyó |
|---|---|---|
| Títulos de pantalla y rótulos de sección en Orbitron | Perdido. Orbitron queda sólo en la marca (`--wordmark-font`); 0 usos en componentes | `cd001a46` (2026-10-21, ronda 1 A): las tildes de Á y Ó tocan la letra y las mayúsculas anchas se leen mal a 12 px (J1-A-55) |
| Luces de estado (`.led`) como lenguaje de estado | Casi perdido. 3 usos el 20 de octubre y 7 hoy; la barra superior usa triángulo, reloj y círculo en contorno | `56a49550` y `99e34df1` (2026-10-21): «la campana es el único relleno»; contadores en peso callado, sin fondo ni luz |
| Barra de cromo con tubo y horizonte | Presente pero sin función. Es una franja de 52 px con la marca a la izquierda y tres contadores en contorno | Sin cambio de estilo: se debilitó al desaparecer lo que la rodeaba |
| Vidrio en paneles de lista, barra lateral y análisis | Presente en 27 usos, pero con opacidad de 0,64 sobre un cielo casi blanco: se lee como tarjeta blanca | `45b96860` (barra de envío con velo y sin fondo en transición) y `cd001a46` (menús opacos) |
| Cielo con brillos aqua, lila y lima | Aqua y lima presentes; el lila salió del degradado | `64d7f7ef` (2026-10-21) |
| Órbita decorativa | Presente pero desvanecida bajo la barra; en teléfono no se dibuja | `0d04140c` (J1-A-56) |
| Esfera de vidrio en avatares y marca | Presente en avatares; en la marca sigue | Sin pérdida |
| Botón gel | Presente y es el elemento con más carácter de todo el panel | Sin pérdida |
| Forma de hoja (3 y 10 px en esquinas opuestas) | Presente, 18 usos | Sin pérdida |
| Pozos hundidos en campos | Presente, 15 usos | Sin pérdida |
| Barra de selección en la fila activa | Nuevo y plano: barra de 4 px sobre relleno azul pálido | `cd001a46`, `89babb15` |

## Dónde se perdió, por tipo de cambio

Las 62 modificaciones de `styles.css` desde el 2026-10-01 (59 tras la entrada de la piel) se reparten en cuatro tipos. Los tres primeros son legítimos y siguen; el cuarto es el que quitó identidad sin que nadie lo pidiera.

| Tipo | Commits representativos | Efecto sobre la identidad |
|---|---|---|
| Escala y alineación (tipografía, grilla de 12 columnas, ancho de Inicio, tarjetas de una altura) | `cd001a46`, `3b79733d`, `e7efaf50`, `6b0f665b` | Neutro. Dio el orden que pidió UD-013 |
| Ganchos de tema (`f2dec8ac`, `bca95c59`, `34736488`, `3e8fa1ea`, `3d88b7ff`) | 143 líneas de variables nuevas | Positivo: cada material es hoy una variable, así que un refresco se hace cambiando tokens en un solo archivo |
| Jueces de accesibilidad y de peso visual (J1 a J3) | `56a49550`, `99e34df1`, `64d7f7ef`, `0d04140c` | Quitaron Orbitron, luces, lila y órbita. Cada uno con su medición; ninguno propuso un material de reemplazo |
| Retirada del adorno sin ancla (UD-016) | `1a50a912` | Quitó destellos sueltos; la regla sigue vigente |

El defecto de método está en el tercer tipo. Los jueces miden contraste y jerarquía, nunca identidad. Una ronda que sólo resta converge a la omisión de un panel de gestión neutro, la alternativa que UD-013 descartó («Estética neutra de panel administrativo: era la omisión y no la quiso»).

## Pantalla por pantalla

Cada hallazgo lleva su captura. «Presente» es lo que sigue de UD-013 y `panel/DISENO.md`.

### Inicio

Capturas: `capturas/1-inicio-desktop-light.png`, `1-inicio-desktop-dark.png`, `1-inicio-mobile-light.png`.

| Id | Hallazgo |
|---|---|
| I-01 | Presente: cielo aqua, composer en vidrio, botón gel. Se lee como un tablero estándar con fondo celeste |
| I-02 | Perdido: los dos listados («Últimos mensajes», «Últimas respuestas») son cuatro filas planas con una barra amarilla de 3 px. No hay encabezado de tabla, ni barra de categoría, ni pie con totales. Un foro de 2002 abría cada bloque con una barra de color y cerraba con estadísticas |
| I-03 | Perdido: el estado «Respondido» es un reloj de contorno con texto. La luz de estado existe en CSS y no se usa aquí |
| I-04 | Perdido: el título «Desarrollo» y los rótulos «NUEVO MENSAJE», «ÚLTIMOS MENSAJES» están en Source Sans; la hora «26 oct 2026, 20:12» queda suelta a la derecha sin función de reloj de consola |
| I-05 | En teléfono la marca se parte en dos líneas («DESARROLLO / TEAM») y los tres contadores ocupan más de la mitad del ancho de la barra |

### Lista de mensajes

Capturas: `capturas/3-mensajes-desktop-light.png`, `3-mensajes-desktop-dark.png`, `3-mensajes-mobile-light.png`, `3-mensajes-vacio-desktop-light.png`.

| Id | Hallazgo |
|---|---|
| M-01 | Presente: contenedor de vidrio con forma de hoja, paginación en círculos de gel |
| M-02 | Perdido: es la pantalla donde el modelo de foro y de cola de operador encaja mejor y no tiene columnas ni encabezado fijo. Cada fila de cuatro líneas reúne estado, área, número, adjuntos, autor, destinatarios y tres acciones, sin columnas que permitan recorrer un dato hacia abajo |
| M-03 | Perdido: en el tema oscuro la fila abierta (roja) y la respondida (amarilla) se distinguen sólo por una barra de 3 px a la izquierda; sin luz de estado el color no es el protagonista que debería ser |
| M-04 | Las tres acciones por fila («Borrar», «Responder», «Cerrar») tienen tres pesos distintos, bien; pero se repiten cuatro veces por pantalla sin separación visual entre filas más que una línea fina |

### Ficha de mensaje

Capturas: `capturas/4-detalle-desktop-light.png`, `4-detalle-desktop-dark.png`, `4-detalle-mobile-light.png`, `4-detalle-mobile-dark.png`.

| Id | Hallazgo |
|---|---|
| F-01 | Presente: esferas en los avatares de destinatarios, miniaturas con borde de luz, botón gel «Responder», anillo de foco |
| F-02 | Perdido: la ficha es una sola página corrida. Meta, adjuntos, texto, resumen y respuestas no tienen marcos propios; sólo el hilo de la derecha usa tarjetas. No hay una estructura de ventanas ni de entradas de foro, que es lo que esta pantalla es |
| F-03 | Perdido: el hilo mezcla autor, hora y cuerpo en el mismo renglón sin columna de autor. Es el lugar natural de la «entrada de foro» (autor a la izquierda, mensaje a la derecha) |
| F-04 | Perdido: el título de 23 px en peso 700 compite con el cuerpo de 17 px; el rótulo «RESUMEN» y «DISPOSITIVO O AYUDA TÉCNICA» son los únicos rótulos de instrumento de la página |
| F-05 | En teléfono oscuro el título ocupa 4 líneas y empuja las acciones («Reenviar», «Borrar») bajo el título, sin barra de acciones propia |

### Hilo con avisos del sistema

Capturas: `capturas/5-hilo-desktop-light.png`, `5-hilo-desktop-dark.png`, `5-hilo-mobile-light.png`.

| Id | Hallazgo |
|---|---|
| H-01 | Presente y es lo más cercano a la consola: línea vertical con puntos, «Claude empezó a trabajar» como evento, «En espera: entrega a producción». Es un registro de llamadas |
| H-02 | Perdido: el fallo «Claude no pudo responder: se acabó el tiempo» se dibuja como un mensaje más, en una tarjeta blanca sin luz roja. En una consola un fallo del sistema tiene su propia señal |
| H-03 | El aviso de reenvío es un cuadro azul claro sin luz ni marca de origen distinta |

### Áreas

Capturas: `capturas/20-areas-desktop-light.png`, `20-areas-desktop-dark.png`, `21-area-desktop-light.png`, `20-areas-mobile-light.png`.

| Id | Hallazgo |
|---|---|
| A-01 | Presente: botón gel «Crear área», forma de hoja en la tabla |
| A-02 | Perdido: tabla con encabezado en versalitas grises sobre blanco. Los contadores de «Abiertos», «Respondidos» y «Plantillas» son íconos de contorno con número; en una centralita serían tres celdas con luz y cifra |
| A-03 | Seis casillas vacías en la primera columna y seis «Borrar» idénticos: 12 controles iguales sin selección activa. Es el patrón de tarjeta repetida que la skill `interfaces-sin-marcas-de-ia` nombra |
| A-04 | La mitad inferior de la pantalla está vacía: el panel no usa el espacio para una barra de estado con totales |

### Equipo

Capturas: `capturas/10-equipo-desktop-light.png`, `10-equipo-desktop-dark.png`, `10-equipo-mobile-light.png`.

| Id | Hallazgo |
|---|---|
| E-01 | Presente: avatares de esfera con iniciales, píldora azul «Agregar miembro» |
| E-02 | Perdido: es la lista de usuarios de un foro (avatar, nombre, rol, descripción) y no tiene columna de rol con insignia ni de última actividad. Ocho botones «Acciones» idénticos en vidrio |
| E-03 | La descripción de cada miembro se corta con puntos suspensivos a mitad de frase en las nueve filas, sin forma de leerla completa en la lista |

### Configuración

Capturas: `capturas/30-configuracion-desktop-light.png` (3331 px de alto), `30-configuracion-desktop-dark.png`, `30-configuracion-mobile-light.png`, `31-conexiones-desktop-light.png`.

| Id | Hallazgo |
|---|---|
| C-01 | Presente: pozos de campo, selector segmentado con gel, luces verde y roja en «Configurada» y «Fallando» |
| C-02 | Perdido, y es donde más: once paneles blancos del mismo peso en dos columnas, con rótulo en versalitas gris. Es la «tarjeta para todo» que UD-013 prohíbe. No hay un panel de control: no hay interruptores con luz, ni medidores, ni jerarquía entre «Tema» (una elección de tres) y «Auditoría» (una tabla de seis filas) |
| C-03 | La «Cola» muestra cinco contadores («En espera 0», «En curso 0», «Terminados 3», «Fallidos 1», «Cancelados 1») como texto corrido. Es el contenido más parecido a un tablero de operador y es el menos tratado |
| C-04 | Los selectores de proveedor y modelo con botones «Aplicar», «Diagnosticar», «Reemplazar clave», «Retirar clave» y «Eliminar» repiten hasta cuatro acciones por fila, tres de ellas con el mismo contorno |

### Entrada

Capturas: `capturas/01-entrada-desktop-light.png`, `01-entrada-desktop-dark.png`, `01-entrada-mobile-light.png`.

| Id | Hallazgo |
|---|---|
| L-01 | Presente: esfera, marca «TEAM» en Orbitron, botón gel, órbita |
| L-02 | Perdido: la tarjeta de 360 px en un fondo vacío de 1440 px es la pantalla que más se parece a una plantilla de login. No hay marco de ventana, ni barra de título, ni línea de estado («Servidor de ejemplo», fecha, versión) |

## Lo que sí está cumplido

La lista de valores de convergencia de `DISENO.md` se cumple entera: no hay índigo, ni degradado púrpura a azul, ni Inter, ni `rounded-xl`, ni `transition-all`. La paleta es OKLCH con acento 250; el contraste de texto sobre vidrio, campo y estado está medido (`npm run contraste`); ningún tamaño baja de 12 px. Falta un material propio en las zonas donde hoy sólo hay blanco.
