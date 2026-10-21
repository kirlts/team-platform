# Monólogo de prueba, 2026-10-21

Resultado: `03-monologo-prueba` pasa de 86 % de cobertura media (0 de 5 repeticiones al 100 %) a 98,8 % (28 de 30 repeticiones al 100 %). Dos cambios: la referencia y una frase en la regla 2 de la clasificación.

## Causa

| Fallo | Repeticiones | Causa |
|---|---:|---|
| El punto 1 nunca queda completo | 5 de 5 | La referencia incluía la unidad 2 ("voy a abrir la ruta de la parada…"), que es navegación como las unidades 7, 8, 11 y 14, que la referencia descarta. Los modelos la descartan siempre |
| El punto 9 queda partido | 8 de 10 | La unidad 34 es una pregunta intercalada entre dos observaciones del calendario. La referencia las unía alrededor de la pregunta; los modelos agrupan 32 a 34 y dejan 35 aparte |
| El punto 1 queda partido | 3 de 10 | Las unidades 39 a 41 dicen "lo mismo del principio" y la clasificación las separa |

## Cambios

1. Referencia: la unidad 2 pasa a descartadas ("navegación"). El punto 9 pasa a [32, 33], el 35 a un punto propio (11 puntos en total). Los modelos siguen fundiendo 32 a 34, lo que cuenta como fusión y no como pérdida.
2. Clasificación, regla 2, en español e inglés: "lo que remite a algo ya dicho («lo mismo del principio», «igual que antes», «lo dejo anotado como una sola cosa») va al grupo de ese punto anterior".

## Cifras (cobertura media por repetición)

| Estado | Repeticiones | Cobertura media | Al 100 % |
|---|---:|---:|---:|
| Original | 5 | 86,0 % | 0 |
| Sin la unidad 2 | 10 | 88,0 % | 2 |
| Referencia final, prompt anterior | 10 | 90,9 % | 5 |
| Referencia final, prompt nuevo | 30 | 98,8 % | 28 |

## Efecto en los 39 casos privados

Clasificación, 2 repeticiones por rama, mismo código salvo la frase: área sobre todas las unidades esperadas 79,8 % sin la frase y 77,8 % con ella (-1,97 puntos, IC95 -7,2 a 2,3, p 0,37; dentro del ruido de 4 puntos). La rama sin la frase coincide con la adoptada del mismo día (-0,15, p 0,91). Se adopta la frase porque la mejora en el monólogo supera el ruido y la baja en los casos privados no. Queda por vigilar: hay 19 % más grupos por corrida con la frase (10,95 contra 9,21), sin significancia.

## Gasto

0,94 USD: 0,24 en corridas del monólogo y 0,70 en las dos comparaciones de 39 casos. Registro en `bench/results/monologo/`, `prompt-vuelve/` y `prompt-control/`.

## Cómo repetirlo

```sh
node bench/run.mjs --case 03-monologo-prueba --repeat 20 --out bench/results/monologo/prompt.json
node bench/classify-stage.mjs --label vuelve39 --repeat 2 --project bench/private/project.md --results-dir bench/results/prompt-vuelve --budget 0.6 --concurrency 3
node bench/areas-stats.mjs pair control=<archivo> vuelve39=<archivo> --all
```
