# HEIC de iPhone decodificado con el ffmpeg de la imagen (H-21, UD-040)

Fecha de consulta de las fuentes: 2026-10-21. Equipo de medición: 16 núcleos x86-64, Docker 29.8.1, `ffmpeg` 8.1.3 compilado por la etapa `ffmpeg` del `Dockerfile`.

## Fuentes

| Fuente | Dato | Fecha |
|---|---|---|
| Registro de npm, `libheif-js` 1.23.5 | licencia LGPL-3.0; 9,0 MB desempaquetados (WASM de libheif y libde265 dentro del paquete) | modificado 2026-10-04 |
| Registro de npm, `heic-decode` 2.1.0 y `heic-convert` 2.1.0 | licencia ISC; dependen de `libheif-js` | 2025-07-04 y 2023-11-30 |
| Registro de npm, `sharp` 0.35.5 | Apache-2.0; su `libvips` precompilado trae `libheif` sin decodificador HEVC (error «Support for this compression format has not been built in: HEVC», medición 2026-10-21 anterior) | 2026-09-27 |
| Página de FFmpeg y su `Changelog` de 8.0 | 8.0 (2025-08-22): «Support for HEIF/AVIF still images and tiled still images»; 8.1 (2026-03-16) | consultada 2026-10-21 |
| `apk search libheif` en Alpine 3.24 | `heif-enc` con el complemento x265 existe sólo como herramienta de prueba; no se instala en la imagen | 2026-10-21 |

## Qué se probó

Se decodificó con el `ffmpeg` mínimo de la imagen (el de la etapa `ffmpeg`, con los filtros `xstack`, `transpose`, `hflip` y `vflip` añadidos) cada archivo de esta tabla.

| Archivo | Origen | Resultado |
|---|---|---|
| 3 fotos de teléfono de 1,1 a 3 MB (`github.com/tigranbs/test-heic-images`, 3992x2992, 3464x2130 y 4242x2828) | descargadas 2026-10-21, no versionadas | decodifican, dimensiones exactas, rejilla de 48 teselas compuesta con `xstack` |
| `libheif.heic`, 320x240 | fixture existente | decodifica |
| `rotated-6.heic` (300x100 con `irot` de 270° antihorario) | `heif-enc` 1.23.4 de Alpine 3.24 a partir de un JPEG con orientación EXIF 6 | sale de 100x300 |
| `rotated-3.heic` (`irot` de 180°) | igual, orientación EXIF 3 | 300x100, el bloque rojo del ángulo superior izquierdo queda abajo a la derecha |
| `tiled-rotated.heic` (1030x770, teselas de 256, `irot` 270°) | `heif-enc --cut-tiles 256` | 770x1030 |
| `two-images.heic` (dos imágenes en un archivo) | `heif-enc` con dos entradas | sale sólo la principal (100x300) |
| 48,8 MP (8064x6048, 192 teselas) y 96 MP (12000x8000) | `heif-enc --cut-tiles 512` sobre imágenes sintéticas | decodifican |

Cómo se obtuvieron los fixtures versionados: `docker run --rm -v $PWD:/w -w /w alpine:3.24 sh -c 'apk add libheif-tools libheif-x265 && heif-enc -q 80 entrada.jpg -o salida.heic'`, con JPEG de entrada generados con `sharp` y `withMetadata({ orientation: N })`. `heif-enc` traduce la orientación EXIF a la propiedad `irot` del contenedor, que es lo que escribe un iPhone.

## Memoria y tiempo del decodificado (pico, `time -f %M`)

| Tamaño | Pico de memoria | Tiempo |
|---|---|---|
| 12 MP (foto de teléfono) | 281 MB | 2,1 s |
| 48,8 MP | 476 MB | 0,9 s |
| 96 MP | 932 MB | 7,4 s |

De ahí sale `image.heicMaxPixels` = 50.000.000: cubre la foto más grande de un iPhone (48 MP) y deja el pico bajo los 700 MiB que `document.memoryMb` ya declara. Un HEIC de más píxeles se rechaza con `image_too_many_pixels` leyendo sólo las cabeceras con `ffprobe`, antes de decodificar nada. El límite de tiempo (30 s) es una cortesía declarada; lo medido fue 0,9 s a 7,4 s.

## Imagen Docker

| | Antes | Después |
|---|---|---|
| `docker images`, etapa final | 306,96 MB | 307,48 MB |
| `ffmpeg` | 8.493.792 bytes | 8.506.080 bytes |
| `ffprobe` | 8.313.504 bytes | 8.317.600 bytes |

El aumento es de 0,5 MB. No se añade ninguna dependencia de npm ni ninguna biblioteca. `ffmpeg` se compila dentro del `Dockerfile` para la arquitectura de la construcción (x86-64 o arm64), así que no hay binario nativo por arquitectura que elegir: el decodificador HEVC es el nativo de `libavcodec`, que ya estaba habilitado para video.

## Límites

- No se reconstruyó la imagen para ARM ni en el VPS. La etapa `ffmpeg` ya compilaba en ARM antes (sólo añade cuatro filtros de la propia `libavfilter`, sin dependencias de arquitectura).
- No se probó un HEIC de 10 bits ni un HEIC de un iPhone con mapa de ganancia (HDR): `heif-enc` de Alpine sólo escribe 8 bits y no hay un iPhone a mano. Las tres fotos de teléfono descargadas son 8 bits.
- Una Live Photo viaja como un HEIC y un archivo MOV aparte; sólo el HEIC entra por este camino.
- Las fotos de teléfono no se versionan por su tamaño y su licencia no está declarada. `TEAM_HEIC_SAMPLES=<carpeta>` las usa en `src/extract/image.test.js`.
