# Perfiles, descripción del proyecto y listas, medición corregida, 2026-10-21

Resultado: sobre los mismos mensajes de referencia, los perfiles son lo que hace que el analizador asigne destinatarios, y la descripción del proyecto empeora la asignación. Con solo nombres el modelo deja sin destinatario el 69 % de los mensajes. Con perfiles en prosa deja el 1,6 %, y con perfiles más proyecto el 19 %. Con perfiles, el conjunto de destinatarios coincide con el de algún lector en 51,0 % de los mensajes (10,5 % con solo nombres y 36,2 % con proyecto). Las listas de responsabilidades y dominios no se distinguen de la prosa: 53,1 % contra 51,0 %, y de 75 mensajes donde difieren, la prosa acierta en 35 y las listas en 40 (p 0,64). La condición de reversión de UD-023 no se cumple: la prosa no asigna peor que las listas, y tampoco mejor.

La medición anterior ([2026-10-21-perfiles-y-proyecto.md](2026-10-21-perfiles-y-proyecto.md)) queda reemplazada. Su cobertura de 42,8 % a 63,3 % era sobre subconjuntos distintos por variante y no decía nada sobre la asignación.

## Qué cambió en la medición

| Defecto de la medición anterior | Corrección |
|---|---|
| La clasificación mezclaba unidades sin mensaje (19 %) con áreas equivocadas | La cobertura va aparte. La clasificación se cuenta solo sobre los mensajes que recibieron un mensaje obtenido |
| Cada variante cubría puntos distintos y se comparaba sobre 207 pares de 322 a 476 | Modo oráculo: la clasificación recibe los 376 mensajes de referencia con sus unidades agrupadas como en `expected.json`. Todas las variantes se puntúan sobre los mismos mensajes |
| Un solo lector | Segunda referencia ciega (`expected-b.json`). Se puntúa contra el lector A, contra el lector B y contra la unión (acierta si coincide con cualquiera) |
| Sin intervalos | Intervalo de Wilson al 95 % sobre mensajes distintos, y prueba de signos en las comparaciones de a pares |

Modo oráculo (`bench/oracle.mjs`, sin tocar `src/analyze/`):

- La clasificación usa `classifySystem` y `classifyUser` con la entrada completa y la agrupación de referencia agregada al turno del usuario. Cada grupo conserva el área y la plantilla que el modelo dio a la mayoría de sus unidades. El modelo dibujó el mismo agrupamiento que la referencia en el 100 % de los grupos.
- La descomposición corre una vez por grupo con `decomposeSystem(plantilla elegida, proyecto)` y `decomposeUser({ miembros, unidades })`. Los destinatarios salen de esta llamada.
- No hay validación MECE, rescate ni reducción: el grupo es el punto. Cuando un grupo vuelve como varios mensajes, el resultado conserva el texto del primero y la unión de los destinatarios (24 % a 27 % de los grupos).
- La clasificación del oráculo no recibe el equipo; el perfil actúa solo en la descomposición.

## Resultado en modo oráculo

24 casos y 308 mensajes de referencia, una corrida por variante. El tope de gasto cortó la variante con proyecto después del caso 24 de 39, y todas las variantes se recortan a esos 24 casos. Referencia: unión de los dos lectores.

| Medida | name-only | profiles | profiles+project | lists |
|---|---:|---:|---:|---:|
| Cobertura | 99,4 % | 99,4 % | 99,7 % | 99,0 % |
| Área y plantilla por mensaje | 86,9 % [83–90] | 90,5 % [87–93] | 91,5 % [88–94] | 92,1 % [89–95] |
| Destinatarios, conjunto exacto | 10,5 % [8–14] | 51,0 % [45–57] | 36,2 % [31–42] | 53,1 % [48–59] |
| Destinatarios, precisión | 58,4 % [50–66] | 72,8 % [69–76] | 68,8 % [64–73] | 71,2 % [67–75] |
| Destinatarios, recall | 18,0 % [14–23] | 87,1 % [83–90] | 71,0 % [66–76] | 81,6 % [77–85] |
| Mensajes sin destinatario | 69,0 % | 1,6 % | 19,2 % | 0,0 % |
| Marcas de IA por mensaje | 0,216 | 0,190 | 0,124 | 0,177 |
| Costo de la corrida (USD, 24 casos) | 0,14 | 0,20 | 0,50 | 0,20 |

Contra cada lector por separado (misma corrida):

| Referencia | Medida | name-only | profiles | profiles+project | lists | Techo (el otro lector) |
|---|---|---:|---:|---:|---:|---:|
| Lector A | área y plantilla | 82,7 % | 85,9 % | 87,9 % | 86,9 % | 95,5 % |
| Lector A | conjunto exacto | 5,9 % | 40,5 % | 29,6 % | 41,6 % | 55,6 % |
| Lector A | recall | 15,6 % | 79,9 % | 64,7 % | 73,5 % | 79,2 % |
| Lector B | área y plantilla | 82,0 % | 86,3 % | 87,0 % | 85,9 % | 92,8 % |
| Lector B | conjunto exacto | 8,8 % | 41,5 % | 29,0 % | 43,0 % | 55,6 % |
| Lector B | recall | 18,5 % | 82,5 % | 65,8 % | 75,7 % | 83,5 % |

El techo es un lector puntuado como si fuera el analizador contra el otro, sobre los 376 mensajes. Los dos lectores coinciden en el conjunto de destinatarios en 55,6 % de los mensajes y en el área en 95,5 % (primera etiqueta de B dentro del conjunto de A). Con perfiles y con listas, el conjunto exacto contra un solo lector (40 % a 43 %) queda 13 a 15 puntos bajo ese techo, y el recall (80 % a 83 % con perfiles) lo alcanza.

Comparación de a pares sobre los mismos mensajes (referencia unión, conjunto exacto): mensajes donde solo acierta la fila / solo acierta la columna.

| | name-only | profiles | profiles+project | lists |
|---|---:|---:|---:|---:|
| profiles | 132 / 9 (p <0,001) | - | 77 / 31 (p <0,001) | 35 / 40 (p 0,644) |
| profiles+project | 95 / 17 (p <0,001) | 31 / 77 (p <0,001) | - | 28 / 79 (p <0,001) |
| lists | 136 / 7 (p <0,001) | 40 / 35 (p 0,644) | 79 / 28 (p <0,001) | - |

## Por miembro

Oráculo, unión de lectores, 24 casos. «Firme» es el número de mensajes donde los dos lectores asignan al miembro. Los intervalos son de Wilson sobre esos mensajes.

| Miembro (mensajes firmes) | Medida | name-only | profiles | profiles+project | lists |
|---|---|---:|---:|---:|---:|
| Pablo Valencia (15) | recall | 42,9 % [21–67] | 73,3 % [48–89] | 66,7 % [42–85] | 78,6 % [52–92] |
| Pablo Valencia (15) | precisión | 27,0 % [15–43] | 22,8 % [16–31] | 24,3 % [17–33] | 24,3 % [17–33] |
| Pablo Valencia (15) | conjunto exacto | 28,6 % [12–55] | 53,3 % [30–75] | 33,3 % [15–58] | 71,4 % [45–88] |
| Alejandro Depetris (17) | recall | 17,6 % [6–41] | 70,6 % [47–87] | 64,7 % [41–83] | 82,4 % [59–94] |
| Alejandro Depetris (17) | precisión | 20,6 % [10–37] | 50,9 % [38–64] | 40,7 % [29–53] | 40,3 % [29–52] |
| Alejandro Depetris (17) | conjunto exacto | 11,8 % [3–34] | 35,3 % [17–59] | 23,5 % [10–47] | 23,5 % [10–47] |
| Javiera Hernández (44) | recall | 4,5 % [1–15] | 93,2 % [82–98] | 69,8 % [55–81] | 77,3 % [63–87] |
| Javiera Hernández (44) | precisión | 50,0 % [19–81] | 81,2 % [72–88] | 73,8 % [62–83] | 79,7 % [69–88] |
| Javiera Hernández (44) | conjunto exacto | 2,3 % [0–12] | 34,1 % [22–49] | 23,3 % [13–38] | 31,8 % [20–47] |
| Martín Gil (258) | recall | 19,0 % [15–24] | 88,0 % [83–91] | 71,8 % [66–77] | 82,5 % [77–87] |

Con 15 y 17 mensajes firmes, los intervalos de Pablo y Alejandro son de 25 a 30 puntos de ancho. Entre perfiles y listas no hay diferencia detectable en ningún miembro. La precisión de Pablo (23 % a 27 %) es baja en todas las variantes: se lo asigna a mensajes donde ningún lector lo pide. Que Pablo y Alejandro tengan menos de 20 mensajes firmes cada uno limita qué se puede afirmar de ellos.

Javiera Hernández no existe en los datos reales: su asignación sale de una regla por título que aplicó el lector A. El lector A la asigna a 123 mensajes, el lector B a 63, y coinciden en 60.

## Pipeline completo

Las 8 corridas completas anteriores (2 por variante, sin cambios en `src/analyze/`; las listas se corrieron hoy con el mismo código) se vuelven a puntuar con las métricas nuevas y la unión de lectores. Cada variante cubre un subconjunto distinto de la referencia, así que el cuadro mide el pipeline entero y no la asignación.

| Medida | name-only | profiles | profiles+project | lists |
|---|---:|---:|---:|---:|
| Cobertura de puntos | 42,8 % [38–48] | 50,4 % [45–56] | 63,3 % [58–68] | 53,6 % [49–59] |
| Clasificación, unidades que recibieron un mensaje | 65,9 % [64–68] | 64,4 % [63–66] | 57,3 % [56–59] | 74,9 % [73–76] |
| Área y plantilla por mensaje | 70,2 % [63–77] | 70,7 % [64–77] | 69,5 % [64–75] | 84,6 % [79–89] |
| Destinatarios, conjunto exacto | 19,9 % [14–27] | 43,5 % [37–51] | 25,6 % [21–32] | 54,1 % [47–61] |
| Destinatarios, recall | 39,5 % [33–47] | 85,6 % [80–90] | 52,4 % [46–58] | 84,9 % [80–89] |
| Sobre 197 pares comunes: conjunto exacto | 25,9 % | 57,4 % | 31,0 % | 62,9 % |
| Marcas de IA por mensaje | 0,155 | 0,174 | 0,091 | 0,154 |
| Costo del análisis (USD, 78 corridas) | 0,34 | 0,42 | 0,93 | 0,43 |

El orden de la asignación coincide con el del oráculo: perfiles y listas arriba, proyecto abajo, solo nombres al final. La cobertura más alta con proyecto no aparece en el oráculo, donde todas las variantes cubren el 99 %, así que viene de cómo la clasificación parte el input. Las marcas de IA sí bajan con proyecto, también en el oráculo (0,190 a 0,124).

## Juicio de utilidad del cuerpo (H-88)

Juez: claude-sonnet-5-5 (esfuerzo bajo, misma rúbrica, ciego a la variante, los mensajes de las cuatro variantes en una sola llamada y en orden aleatorio), distinto del modelo del analizador. Se juzgaron 7 puntos de referencia por variante, los mismos para las cuatro, porque el tope de gasto cortó el juicio después del caso 7 de 10 elegidos.

| | name-only | profiles | profiles+project | lists |
|---|---:|---:|---:|---:|
| Utilidad, promedio (1 a 5) | 2,86 | 2,86 | 3,14 | 3,29 |
| Mediana | 3 | 3 | 3 | 3 |

El juez de Sonnet no separa las variantes: con 7 mensajes por variante, 0,4 puntos de promedio es un mensaje. Es más duro que el de Haiku (promedio 3,4 a 3,5 en la medición anterior) y también deja la mediana en 3. No hay evidencia de que los perfiles o el proyecto mejoren el cuerpo del mensaje, ni de lo contrario. Un juicio que separe variantes necesita un orden de magnitud más mensajes, y cuesta en proporción: 0,41 USD por 28 juicios en esta corrida.

## Lo que no se hizo

- Cinco repeticiones por variante: se lanzaron, pero la corrida de 5 repeticiones por 4 variantes proyectaba 5,8 USD y se detuvo al 44 %. Los resultados se escribían al terminar y se perdieron 2,65 USD. Se corrió una repetición por variante con escritura por caso. El ruido entre las dos repeticiones del pipeline completo (medición anterior, un solo lector) es de 1 a 5 puntos en cobertura y de 2 a 5 en conjunto exacto.
- La variante con proyecto cubre 24 de 39 casos en el oráculo, y su comparación con las otras se hace sobre esos 24. Faltan los casos u02 a u13 y w01 a w04.
- El juicio de Sonnet cubre 7 puntos por variante, y solo en modo oráculo. No se juzgó el pipeline completo con Sonnet.
- No se midió la frontera entre Error y Nueva funcionalidad del prompt. El área en el oráculo (87 % a 92 %) queda de 3 a 8 puntos bajo el techo de los lectores (95,5 %).
- La plantilla que recibe la descomposición es la que eligió el modelo, no la de la referencia: un error de área puede contaminar la asignación de ese mensaje.

## Gasto

4,96 USD de 5 en este trabajo. Corridas completas con listas 0,43. Corridas interrumpidas de 5 repeticiones 2,65. Oráculo de una repetición, cuatro variantes, 1,20. Juez de Sonnet 0,66, de los cuales 0,26 fueron una prueba. Prueba de humo 0,02. El trabajo anterior de H-77 gastó 2,79 USD.

## Cómo repetirlo

```sh
node bench/run-private.mjs run --oracle --variant o-profiles --team bench/private/team.json
node bench/run-private.mjs run --oracle --variant o-lists --team bench/private/team-lists.json
node bench/run-private.mjs compare --common-cases --reference union <archivos>      # a, b o union; --ceiling con a o b
node bench/judge-usefulness.mjs --pooled --same-points <archivos> --judge-model claude-sonnet-5-5 --project bench/private/project.md
```
