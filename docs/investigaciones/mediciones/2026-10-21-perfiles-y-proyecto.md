# Perfiles en prosa y descripción del proyecto, 2026-10-21

Reemplazada por [2026-10-21-perfiles-y-proyecto-corregida.md](2026-10-21-perfiles-y-proyecto-corregida.md) (H-90). Las cifras de abajo mezclan puntos sin mensaje, errores de área y un solo lector, y comparan variantes sobre subconjuntos distintos de la referencia.

Resultado: con perfiles, el analizador asigna bien más a menudo. Sobre los 207 pares que las tres variantes produjeron, el conjunto de destinatarios es exacto en 47,8 % con perfiles. Con solo nombres es 24,2 % y con perfiles y proyecto 26,1 %. La descripción del proyecto no mejora la asignación. Baja el recall (87,7 % a 62,3 %) porque el modelo deja sin destinatario el 20 % de los mensajes. Sí sube la cobertura de los puntos (42,8 %, 50,4 % y 63,3 % en el orden de las variantes). Baja también las marcas de IA por mensaje (0,174 a 0,091). La utilidad del cuerpo, juzgada por el mismo modelo, no distingue las variantes: promedio 3,37, 3,45 y 3,49 sobre 5.

Medición de H-77. La condición de reversión de UD-023 compara la prosa con listas, y la variante de listas ya no existe en main. Contra la línea base de solo nombres, la prosa asigna mejor.

## Qué se midió

39 casos privados, 376 mensajes esperados, tres variantes, dos corridas de cada una (78 corridas por variante). Las dos corridas de cada variante se suman.

| Variante | Equipo que recibe el analizador | Proyecto |
|---|---|---|
| name-only | id y nombre de los cuatro miembros | ninguno |
| profiles | id, nombre y perfil | ninguno |
| profiles+project | id, nombre y perfil | descripción de 200.937 caracteres en markdown |

El paquete se arma como `src/domain/pipeline.js`: `members` con `profile` y `project = { name, description }`. Modelo de análisis y de juicio: claude-haiku-5-5.

La referencia de destinatarios se rotuló de nuevo el 2026-10-21 con cuatro miembros. Son Martín Gil (1), Pablo Valencia (2), Alejandro Depetris (3) y Javiera Hernández (4).

Regla de rotulado:

| Contenido del mensaje | Destinatarios |
|---|---|
| Diseño visual, disposición, tipografía, color, marca, rótulos como diseño, reportes de prueba de pantallas | 4 |
| Síntoma visual cuya causa es un dato o una conducta rota | 1 y 4 |
| Conducta, servidor, datos, integración, conversación de Deva | 1 |
| Negocio, cliente, precio, proceso | 2 |
| Contrato, financiamiento, criterio clínico, visibilidad por rol | 3 |

Donde más de un dueño debe actuar, se conservan varios. Se rotularon 156 de 376 mensajes por el título de cada uno. Conteo de asignaciones por miembro: Martín 321, Pablo 49, Alejandro 32, Javiera 123.

Un mensaje esperado se empareja con el mensaje obtenido que contiene todas sus unidades (el más estrecho si hay varios). Un punto que ningún mensaje cubre no tiene pareja. Una corrida que termina `invalid` se puntúa con su borrador.

## Comparación

| Medida | name-only | profiles | profiles+project |
|---|---:|---:|---:|
| Estado ok | 69/78 | 66/78 | 67/78 |
| Cobertura de puntos | 42,8 % | 50,4 % | 63,3 % |
| Mensajes obtenidos / esperados | 586 / 752 | 536 / 752 | 705 / 752 |
| Clasificación (área y plantilla) | 41,0 % | 46,4 % | 45,0 % |
| Marcas de IA por mensaje | 0,155 | 0,174 | 0,091 |
| Mediana de tiempo por caso (s) | 8,2 | 9,5 | 10,6 |
| Costo del análisis (USD) | 0,339 | 0,417 | 0,935 |
| Utilidad, promedio (1 a 5) | 3,37 | 3,45 | 3,49 |
| Utilidad, mediana de mensajes | 4,0 | 4,0 | 4,0 |
| Utilidad, mediana de las medianas por caso | 3,5 | 4,0 | 4,0 |
| Mensajes juzgados | 573 | 524 | 672 |

## Destinatarios

Sobre los pares comunes a las tres variantes (207 de 322 a 476 según la variante):

| Medida | name-only | profiles | profiles+project |
|---|---:|---:|---:|
| Conjunto exacto | 24,2 % (50/207) | 47,8 % (99/207) | 26,1 % (54/207) |
| Precisión | 43,6 % | 58,0 % | 50,2 % |
| Recall | 31,0 % | 87,7 % | 62,3 % |

Por miembro, sobre los mismos 207 pares. Entre paréntesis, en cuántos pares se esperaba al miembro.

| Miembro | Medida | name-only | profiles | profiles+project |
|---|---|---:|---:|---:|
| Martín Gil (184) | recall | 40,8 % | 96,2 % | 59,2 % |
| Martín Gil (184) | precisión | 91,5 % | 91,7 % | 90,1 % |
| Pablo Valencia (11) | recall | 18,2 % | 36,4 % | 63,6 % |
| Pablo Valencia (11) | precisión | 4,4 % | 5,9 % | 7,6 % |
| Pablo Valencia (11) | conjunto exacto cuando se lo espera | 0,0 % | 18,2 % | 18,2 % |
| Alejandro Depetris (9) | recall | 11,1 % | 88,9 % | 66,7 % |
| Alejandro Depetris (9) | precisión | 3,3 % | 14,0 % | 10,7 % |
| Alejandro Depetris (9) | conjunto exacto cuando se lo espera | 0,0 % | 33,3 % | 22,2 % |
| Javiera Hernández (48) | recall | 0,0 % | 66,7 % | 72,9 % |
| Javiera Hernández (48) | precisión | 0,0 % | 50,8 % | 79,5 % |
| Javiera Hernández (48) | conjunto exacto cuando se lo espera | 0,0 % | 8,3 % | 4,2 % |

Mensajes sin destinatario, sobre los mensajes de las corridas ok: 52 % con solo nombres, 4 % con perfiles, 20 % con perfiles y proyecto. Con solo nombres el modelo no acierta a Javiera en ningún par y deja la mitad de los mensajes sin dueño.

Para Pablo y Alejandro la precisión es baja en las tres variantes (3 % a 14 %). Se les asigna en muchos mensajes donde la referencia no los pide. Su recall con perfiles sube de 18 % a 36 % (Pablo) y de 11 % a 89 % (Alejandro). Con 11 y 9 pares esperados, cada punto porcentual es un par.

## Ruido entre corridas

Cada variante se corrió dos veces con la misma referencia. Diferencias entre la primera y la segunda corrida:

| Medida | name-only | profiles | profiles+project |
|---|---|---|---|
| Cobertura | 41,2 % / 44,4 % | 52,9 % / 47,9 % | 63,8 % / 62,8 % |
| Conjunto exacto (pares propios) | 18,7 % / 16,2 % | 33,2 % / 38,3 % | 17,9 % / 20,8 % |
| Recall (pares propios) | 24,3 % / 47,3 % | 84,3 % / 75,2 % | 48,2 % / 50,9 % |
| Marcas de IA por mensaje | 0,131 / 0,175 | 0,215 / 0,137 | 0,132 / 0,059 |
| Utilidad, promedio | 3,47 / 3,28 | 3,42 / 3,47 | 3,49 / 3,48 |

Las diferencias entre variantes en cobertura y conjunto exacto superan el ruido entre corridas. Las de utilidad, marcas de IA, clasificación y recall de name-only no.

Cada corrida deja entre 6 y 9 casos en `invalid`, y no son los mismos casos entre corridas.

## Qué no concluye

- El juez es el mismo modelo que el analizador. Un juez del mismo modelo tiende a preferir su propia redacción. Por eso 3,37 contra 3,49 no basta para afirmar que el proyecto mejora el cuerpo. La mediana es 4 en las seis corridas.
- La referencia de destinatarios la rotuló una sesión de Claude con la regla de arriba, leyendo el título de cada mensaje, no el texto completo. Martín no la revisó. La exactitud mide acuerdo con esa regla.
- Pablo y Alejandro tienen 11 y 9 pares esperados en la intersección. Es muestra chica para estimar precisión.
- El proyecto cambia cuántos mensajes arma el analizador (705 contra 536 con perfiles solos), y esa diferencia, no la asignación, puede explicar la cobertura. No se aisló la causa.
- No se probó una variante solo con proyecto, ni perfiles recortados, ni una descripción de otro tamaño.

## Gasto

2,79 USD de un tope de 3. Las seis corridas del análisis costaron 1,69 USD y el juez sobre ellas 0,46 USD. Los 0,63 restantes son corridas interrumpidas al cambiar la referencia (sin resultado) y una prueba de humo.

## Cómo repetirlo

```sh
node bench/run-private.mjs run --variant profiles --team bench/private/team.json
node bench/judge-usefulness.mjs bench/results/<archivo>.json --project bench/private/project.md
node bench/run-private.mjs compare --pool <archivos de las variantes y sus repeticiones -b>
```
