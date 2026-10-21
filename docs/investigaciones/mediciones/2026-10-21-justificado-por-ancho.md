# Justificado de párrafos según el ancho del contenedor, 2026-10-21

Resultado: un párrafo justificado cumple el hueco máximo que se vio a 1440 px desde 438 px de ancho hacia arriba. Debajo de 438 px el hueco entre palabras llega a 20 px (hasta 49 px a 250 px de ancho). UD-034 justifica desde 29,2 rem (438 px con la raíz de 15 px) y alinea a la izquierda debajo.

## Método

- Comando: `cd panel && npm run build && node scripts/medir-justificado.mjs` (y con `TEXT_SIZE=text-read` para el cuerpo de un mensaje, de 17 px). Sin llamadas a proveedores.
- Corpus: los 22 párrafos de más de 12 palabras que el panel justifica en los datos de ejemplo del servidor de desarrollo (cuerpos de mensaje, respuestas, descripción del proyecto, perfiles del equipo).
- Cada párrafo se compone en un contenedor del ancho medido con la tipografía del panel y la regla `text-align: justify; hyphens: none; text-wrap: pretty`. Cada palabra va en su propio `span`. Se mide la separación entre palabras consecutivas de cada renglón, sin contar el último renglón de cada párrafo, que no se estira.
- Barrido: de 200 a 380 px de a 10, de 390 a 590 px de a 2, de 600 a 900 px de a 10.
- Referencia: el hueco más grande que dan estos mismos párrafos en los anchos que tienen los bloques justificados a 1440 px (394, 400, 438, 448, 453, 465, 486, 584, 604 y 618 px, leídos de la pantalla). Es lo que Martín vio al pedir el justificado (UD-022).

## Resultado

Espacio natural entre palabras a 15 px: 3,0 px. Hueco de referencia: 14,2 px (4,7 veces el espacio natural).

| Ancho | Hueco máximo | Sobre la referencia |
|---|---|---|
| 200 px | 33,5 px | sí |
| 240 px | 44,0 px | sí |
| 260 px | 17,8 px | sí |
| 290 px | 20,5 px | sí |
| 300 px | 15,5 px | sí |
| 320 px | 25,8 px | sí |
| 350 px | 16,0 px | sí |
| 400 px | 14,2 px | no |
| 410 px | 16,2 px | sí |
| 420 px | 18,2 px | sí |
| 436 px | 21,4 px | sí |
| 438 px | 9,9 px | no |
| 470 px | 7,5 px | no |
| 540 px | 8,8 px | no |
| 700 px | 7,2 px | no |
| 800 px | 8,1 px | no |

Desde 438 px ningún ancho del barrido pasa de la referencia. No sirve un umbral más bajo: entre 402 y 436 px un renglón del corpus abre el hueco de 14,6 a 21,4 px, y por debajo de 400 px hay anchos que lo superan (350 px: 16,0 px).

Con el cuerpo de un mensaje (17 px) la referencia sube a 19,0 px y el ancho estable es 404 px. Se usa el mayor de los dos (438 px) para todo bloque.

## Consecuencias

- Una pantalla de 390 px da a un párrafo unos 290 a 330 px: queda a la izquierda. A 1440 px la ficha de un mensaje daba 394 px a su cuerpo (columnas de 5 y 7 partes de 12); con columnas de 0,9 y 1 partes el cuerpo mide unos 480 px y las respuestas unos 480 px, y siguen justificados.
- `panel/src/lib/prose-width.ts` guarda el valor y lo cita; `panel/src/prose-block.test.ts` falla si el valor o UD-034 se mueven por separado, y `flows-ronda3a.browser.test.mjs` mide en el navegador los huecos de los párrafos reales a 390 px y a 1440 px.
- Límite: el corpus son 22 párrafos de ejemplo en español. Un párrafo con una palabra muy larga puede abrir un hueco mayor a cualquier ancho; la regla acota el caso común, no lo elimina.
