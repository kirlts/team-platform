# Umbral de repetición contra el libro de hallazgos

Medido el 2026-10-21 con `node scripts/juicios.mjs calibrar`. Repetir el comando da la misma tabla mientras `docs/HALLAZGOS.md` no cambie.

Qué se mide: con qué similitud de títulos (Jaccard sobre raíces de cinco letras, sin acentos ni palabras de función) se distingue un hallazgo repetido de uno distinto. La verdad es el propio libro: dos filas son la misma cuando comparten un identificador de origen (una fila «Reaparece J1-A-11» comparte ese identificador con la fila original). Los pares son todos los de una misma pantalla.

Resultado: el mejor F1 es 0,46 con umbral 0,35. Con ese umbral el 67 % de los pares señalados son repeticiones reales y se encuentra el 35 % de las repeticiones. Los títulos solos no alcanzan para descartar automáticamente: el consolidador marca el candidato y muestra la fila parecida.

```
Libro: 363 filas; 1636 pares de una misma pantalla; 23 repeticiones que el propio libro declara.
umbral  señalados  precisión  exhaustividad  F1
0.05       923      0.02        1.00        0.05
0.10       447      0.04        0.87        0.09
0.15       149      0.11        0.74        0.20
0.20        76      0.20        0.65        0.30
0.25        40      0.28        0.48        0.35
0.30        22      0.45        0.43        0.44
0.35        12      0.67        0.35        0.46
0.40        11      0.64        0.30        0.41
0.45         7      0.71        0.22        0.33
0.50         7      0.71        0.22        0.33
0.55         5      0.60        0.13        0.21
0.60         4      0.50        0.09        0.15
0.65         3      0.33        0.04        0.08
0.70         2      0.50        0.04        0.08
0.75         2      0.50        0.04        0.08
0.80         1      1.00        0.04        0.08
0.85         1      1.00        0.04        0.08
0.90         1      1.00        0.04        0.08
0.95         1      1.00        0.04        0.08
Mejor F1: umbral 0.35 (precisión 0.67, exhaustividad 0.35). En el código: 0.35.
```
