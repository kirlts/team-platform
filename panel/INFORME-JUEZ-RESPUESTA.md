# Respuesta al informe del juez de pantallas

Cada hallazgo que quedaba sin arreglar en la entrega anterior, con lo que se hizo o, donde el hallazgo no corresponde, la razón. Las capturas están en `panel/capturas/`.

| Id | Resultado |
|---|---|
| I8 | Corregido (UD-026): Inicio ya no repite el nombre del proyecto como título; el nombre vive en la cabecera. |
| I13 | Corregido: clip, cámara y micrófono siguen siendo los tres íconos de la maqueta y ahora llevan aviso al pasar el puntero además del nombre accesible. |
| I14 | Corregido: el marcador de la barra es «Escribe o adjunta» y cabe en una línea a 390 px. |
| M7 | Corregido: el filtro «Respuestas» se escribe «Con respuestas» o «Sin respuestas» y ya no lleva el operador «es». |
| M8 | Sin cambio: el informe lo marca como cumple. |
| M9 | Corregido: los destinatarios pasan de chips con fondo a texto atenuado con su avatar, y la fila conserva una sola acción de peso (Responder). |
| M11 | Corregido: cuando quien mira es el emisor, el lugar de «Responder» queda reservado, así «Cerrar» cae en la misma columna en todas las filas. El emisor no responde su propio mensaje (invariante del producto), así que el botón no se dibuja. |
| M12 | Corregido: la fecha de cada fila lleva su fecha y hora completas en el aviso, además de «hoy», «ayer» o el día. |
| D12 | Corregido: una foto se abre ampliada en una ventana dentro de la página, con el enlace a otra pestaña como opción. |
| R8 | Corregido: en teléfono la cuenta de pendientes pasa bajo el texto del área, que recupera todo el ancho; los lápices ya no existen. |
| R10 | Sin cambio: cumple. |
| R12 | Corregido: un Miembro que abre `/areas` ve el título y «Sólo el Editor administra las áreas», en vez de volver a Inicio sin aviso. |
| R13 | Sin cambio, por decisión escrita: MASTER-SPEC §6 y la maqueta ponen las áreas con su cuenta en la barra lateral. La vista de Áreas la usa para editar y la barra para navegar; son dos usos de la misma lista. |
| E2 | Sin cambio: cambiar un rol se deshace con «Deshacer», y la regla del producto es no confirmar lo reversible. El menú que cubre la fila siguiente es el comportamiento normal de una ventana emergente. |
| E8 | Corregido: el encabezado de la tabla pasa a 13 px en seminegrita. |
| E11 | Sin cambio: cumple. |
| K4 | Corregido: Conexiones es un grupo plegable con API, MCP, Correo, WhatsApp y GitHub (UD-012), todos sin destino todavía. |
| K6 | Corregido: las entradas deshabilitadas usan el color de texto secundario, que mide 7,05 sobre vidrio en claro, no el tenue. |
| K8 | Sin cambio: cumple. |
| S7 | Corregido: ya no hay lápices en ninguna pantalla; el campo se descubre al pasar el puntero y por su nombre accesible. |
| S8 | Corregido: el rótulo de sección pasa de 12 a 13 px, igual al valor. |
| S9 | Sin cambio: cumple. |
| S10 | Corregido: el marcador «Sin dato» deja de ir en monoespaciada; sólo el valor real la usa. |
| H2 | Corregido: la esfera sale de los títulos de pantalla (queda en la marca y en el inicio de sesión), se retiran los destellos sueltos y el cielo ya no termina en lila. |
| H3 | Corregido: la marca de la cabecera pasa de 17 a 21 px y la barra a 56 px. |
| H4 | Sin cambio: cumple. |
| H6 | Corregido: la salida junto al usuario lleva su palabra «Salir» además del ícono. La salida del menú de la cabecera se mantiene: es el menú de la maqueta. |
| H7 | Corregido: el cajón de navegación en teléfono muestra su título y su botón para cerrar. El ícono que lo abre es el de panel lateral; el menú de tres líneas de la maqueta es el de ajustes. |
| H8 | Corregido en el panel: la barra lateral muestra `unresolved_count` (abiertos y respondidos). Depende de que la API entregue ese campo con el valor correcto. |
| H9 | Corregido: los títulos de pantalla pasan a Source Sans 3 en negrita; la tilde de la Á de Orbitron toca la letra y no tiene arreglo por CSS. Orbitron queda en la marca y en los rótulos de sección. |
| H10 | Sin cambio: cumple. |
| L2 | Sin cambio en el contenido: antes de iniciar sesión el panel no puede saber el nombre del proyecto, porque `GET /settings/project` pide sesión. La marca crece de tamaño. |
| L3 | Corregido: «Entrar» no se apaga con los campos vacíos; si falta uno, el error aparece bajo el campo. |
| L4 | Corregido por consecuencia: el gris que se leía mal era el botón deshabilitado (opacidad 45 %); ya no se deshabilita. El texto del gel mide 7,38 en oscuro. |
| L6 | Corregido: los campos usan el mismo foco de 1 px, sin el anillo grueso. |
| L7 | Sin cambio: en teléfono no se dibuja la órbita a propósito (UD-016: ningún adorno suelto); la tarjeta conserva la esfera y la marca. |
| L8 | Corregido en lo que se podía: se retiraron la esfera repetida y los destellos sueltos que compartía con las demás vistas. |
| L9 | Sin cambio: cumple. |
