# Latencia de Groq y Anthropic por tipo de archivo, 2026-10-21

Resultado: una foto tarda 4,6 s en extraerse (p95 14,9), un audio 1,6 s, un docx 0,7 s y un video de 52 MB en promedio 25,5 s (p95 79,1). El análisis posterior tarda 6 a 12 s salvo en reuniones (20,4 s) y tablas (42 s).

## Método

`bench/latency-private.mjs`: cada adjunto de los casos privados pasa 3 veces por `src/extract/` con los proveedores reales (Anthropic Haiku 5.5 para visión, Groq `whisper-large-v3-turbo` para voz), con cada llamada cronometrada. Después, una vez por caso, el analizador corre con Anthropic sobre el texto extraído; la duración es la de cada llamada. Las corridas son secuenciales. 111 corridas de caso, 31 casos con adjuntos.

## Extracción (segundos)

| Tipo | Archivos | Corridas | Peso medio (MB) | p50 | p95 | Anthropic visión, llamada p50 | Groq voz, llamada p50 | Audio por segundo de Groq |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ogg | 3 | 9 | 0,2 | 1,6 | 2,0 | | 1,2 | 83 |
| docx | 11 | 33 | 2,4 | 0,7 | 2,2 | | | |
| md | 1 | 3 | 0,0 | 0,3 | 0,3 | | | |
| txt | 6 | 18 | 0,0 | 0,3 | 0,8 | | | |
| jpeg | 4 | 12 | 0,2 | 4,6 | 14,9 | 4,6 | | |
| png | 1 | 3 | 0,4 | 4,4 | 4,8 | 4,4 | | |
| mp4 | 11 | 33 | 52,2 | 25,5 | 79,1 | 15,2 | 1,1 | 64 |

## Análisis con Anthropic (segundos)

| Tipo de caso | Análisis | Unidades medias | Total p50 | Total p95 | Llamada p50 | Llamada p95 |
|---|---:|---:|---:|---:|---:|---:|
| audio | 3 | 13 | 6,1 | 7,4 | 1,7 | 3,3 |
| imagen | 5 | 20 | 6,1 | 8,2 | 2,3 | 4,8 |
| video | 11 | 28 | 6,4 | 10,6 | 2,4 | 4,5 |
| docx | 11 | 114 | 11,5 | 21,6 | 2,2 | 3,7 |
| reunión | 6 | 526 | 20,4 | 30,6 | 2,5 | 5,7 |
| tabla | 1 | 115 | 42,1 | 42,1 | 2,5 | 4,8 |

La voz no limita: Groq transcribe 64 a 83 s de audio por segundo. En video el tiempo está en describir fotogramas con Anthropic (15,2 s por llamada) y en ffmpeg. No se midió DeepSeek.

## Gasto

0,39 USD. Registro en `bench/results/latencia/private-spend.jsonl`.

## Cómo repetirlo

```sh
node bench/latency-private.mjs run --repeat 3 --analysis-repeat 1 --budget 1 --results-dir bench/results/latencia --out bench/results/latencia/latencia-real.json
node bench/latency-private.mjs report bench/results/latencia/latencia-real.json
```
