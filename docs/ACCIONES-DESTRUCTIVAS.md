# Acciones destructivas

Registro de lo que el panel borra, vacía, restablece o retira, y de qué camino de vuelta tiene cada acción. Lo lee la prueba
`panel/src/una-accion-destructiva-no-es-definitiva-sin-deshacer.test.ts`: cada método del cliente (`packages/client/src/resources.ts`) cuyo nombre
empieza por `delete`, `remove`, `reset` o `retire` tiene un `restore` en su recurso o una fila en la primera tabla. Una fila de un método que ya no
existe falla.

La regla viene del hallazgo de la clase 3 del informe de soft-locks (issue 8, 2026-11-04). UD-253 mantiene que lo que se puede deshacer no pide
confirmación y ofrece Deshacer; lo que no se puede deshacer pide un paso, y sólo lo que vacía todo el equipo pide escribir el nombre
(`panel/src/lib/catastrophic-actions.ts`).

## Sin restauración: confirmación declarada

La columna «Confirmación» toma uno de cuatro valores: `nombre de la persona`, `nombre del proveedor`, `nombre del proyecto` o `un paso`.

| Acción | Confirmación | Qué pide el panel |
|---|---|---|
| `members.delete` | nombre de la persona | Ventana «Eliminar a {nombre}» con lo que se pierde: el acceso y la restauración (UD-292) |
| `connections.retireKey` | nombre del proveedor | Ventana «Retirar clave de {proveedor}»: la clave no se recupera |
| `connections.delete` | nombre del proveedor | Ventana «Eliminar {proveedor}»: quita el proveedor con su clave |
| `ops.reset` | nombre del proyecto | «Vaciar todo» exige escribir el nombre del proyecto en su propia fila. «Vaciar contenido» (alcance `content`) pide un paso: ventana que dice qué se borra |

## Con restauración: Deshacer y lista

Cada acción tiene su `restore` en el recurso y el panel lo ofrece dos veces: el aviso de 8 segundos y una lista que no depende de la pantalla montada.

| Acción | Restaura con | Lista |
|---|---|---|
| Borrar envío (inputs.delete) | `inputs.restore` | «Borrados» de Inicio; se purga a los `DELETED_INPUTS_RETENTION_DAYS` días (30, UD-317) |
| Descartar envío (inputs.cancel) | `inputs.restore` | «Descartados» de Inicio |
| Borrar mensaje (messages.delete) | `messages.restore` | «Borrados» de Mensajes |
| Borrar respuesta (replies.delete) | `replies.restore` | «Respuestas borradas» del mensaje |
| Borrar área (areas.delete) | `areas.restore` | «Borradas» de Áreas |
| Borrar plantilla (templates.delete) | `templates.restore` | «Borradas» de las plantillas del área |
| Quitar un archivo de la propia respuesta | Deshacer de la pila, que lo envía otra vez | El aviso y la pila de la pantalla |
| Restablecer el encuadre del análisis | Deshacer de la pila, con el texto anterior | El aviso y la pila de la pantalla |
