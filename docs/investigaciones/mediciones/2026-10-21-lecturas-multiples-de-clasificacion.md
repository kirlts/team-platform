# Clasificación con varias lecturas, 2026-10-21

Resultado: `classifyDraws` con 3 lecturas no se adopta. El área sobre todas las unidades esperadas sube 1,15 puntos (IC95 -1,36 a 3,21, p 0,37), menos que el ruido de 4 puntos entre corridas. El costo por repetición sube 2,6 veces (0,170 contra 0,066 USD) y el tiempo por caso 53 % (21,7 contra 14,2 s).

## Método

Cinco transcripciones (r09, r10, r12, u12, u13), 10 repeticiones, Haiku 5.5, proyecto de 200.000 caracteres, cobertura y contexto de 40 unidades en ambas ramas. Base: la corrida de contexto 40 del mismo día (`2026-10-21-reuniones-cobertura-y-estabilidad.md`). Variante: `classifyDraws: 3`. La corrida terminó 47 de 50 con 3 corridas `invalid` en la clasificación (base: 0 de 50).

## Cifras

| Medida | Base | 3 lecturas |
|---|---:|---:|
| Área sobre todas las unidades esperadas | 70,6 % (sd 3,6) | 70,5 % (sd 3,8) |
| Diferencia por casos | | +1,15 [-1,36; 3,21], p 0,374 |
| Acuerdo entre repeticiones (ARI) | 0,78 | 0,81 (+0,03, p 0,31) |
| Unidades sin grupo | 2,35 % | 1,76 % (p 0,54) |
| USD por repetición | 0,066 | 0,170 |
| Segundos por caso | 14,2 | 21,7 |

## Gasto

1,88 USD (1,70 en corridas completas y 0,18 en las 3 corridas `invalid`). Registro en `bench/results/draws/private-spend.jsonl`.

## Cómo repetirlo

```sh
node bench/classify-stage.mjs --label draws3 --cases r09-txt-reunion-plan-de-accion,r10-txt-reunion-infraestructura,r12-txt-consulta-con-el-doctor,u12-reunion-parte-1,u13-reunion-parte-2 --repeat 10 --project bench/private/project.md --results-dir bench/results/draws --budget 2.4 --concurrency 3 --config '{"coveragePasses":1,"classifyContextUnits":40,"classifyDraws":3}'
node bench/areas-stats.mjs pair base=<archivo base> draws3=<archivo> --all
```
