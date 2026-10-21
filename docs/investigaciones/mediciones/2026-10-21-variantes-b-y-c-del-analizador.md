# Variantes B y C del analizador, 2026-10-21

Resultado: se mantiene la variante A (dos llamadas). B, una sola llamada, cuesta 44 % menos pero cubre 89,3 % de los puntos contra 97,4 % de A y falla en los casos con varias áreas. C, descomposición especulativa, cubre 98,8 % y cuesta 15 % más; la especulación acertó en 3 de 27 corridas, así que no ahorra tiempo.

## Variantes (`bench/variants.mjs`, sólo para medir)

- A: el producto. Clasificación y una descomposición por grupo.
- B: una llamada con el catálogo y todas las plantillas en el sistema; la respuesta trae la propuesta completa con `fields` como lista de nombre y valor (la gramática del proveedor rechaza un objeto abierto) y se valida después contra la plantilla elegida.
- C: la clasificación corre a la vez que la descomposición de todo el input con la plantilla más probable (Reporte de error). Si la clasificación da un solo grupo con esa plantilla, se conservan los mensajes especulativos; si no, se descompone por grupo como en A.

B y C tienen un reintento con el error como contexto y cierre de solapes y huecos por aritmética de conjuntos, sin llamada de rescate. El banco público tiene 9 casos, no 7; se corrieron los 9, con 3 repeticiones.

## Cifras (27 corridas por variante, Haiku 5.5)

| Medida | A | B | C |
|---|---:|---:|---:|
| Cobertura media | 97,4 % | 89,3 % | 98,8 % |
| Corridas MECE | 16 de 27 | 17 de 27 | 17 de 27 |
| Tiempo medio por caso | 7,9 s | 9,4 s | 9,1 s |
| Mediana | 6,1 s | 6,5 s | 7,4 s |
| Costo de las 27 corridas | 0,078 USD | 0,044 USD | 0,090 USD |

Por caso, B cubre 67 % del chat de grupo, 82 % del monólogo, 67 % del mensaje mezclado y 56 % de la reunión: una sola llamada pierde puntos cuando hay varias áreas o muchas unidades. B es más rápida en casos de un punto (2,3 s contra 4,8 s en la idea suelta) y más lenta en el docx de 40 puntos (28,6 s contra 17,7 s) porque emite todo en una salida. C empata con A en calidad y la especulación fallaba en los casos de varias áreas o de otra plantilla.

## Recomendación

Mantener A. Una sola llamada ahorra costo, no calidad ni tiempo. Si se quiere bajar el tiempo en inputs de un solo punto, B sirve sólo tras un clasificador barato que detecte un grupo; no se justifica con estas cifras.

## Gasto

0,21 USD. Registro en `bench/results/variantes/private-spend.jsonl`.

## Cómo repetirlo

```sh
node bench/run-variants.mjs --repeat 3 --out bench/results/variantes/variantes.json
```
