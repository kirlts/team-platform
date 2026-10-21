# ffmpeg mínimo, 2026-10-20

Resultado: un ffmpeg 8.1.3 estático con licencia LGPL y solo los códecs que usan los extractores reemplaza al paquete de Alpine. La imagen baja de 466 MB a 306 MB (docker images) y el contenido de 329 MiB a 218 MiB. Las 106 pruebas de `src/extract/` pasan sobre los binarios nuevos. Las salidas decodificadas son idénticas a las del ffmpeg anterior en cinco archivos reales. Cada proceso arranca en 1,3 ms en vez de 44 ms.

## Tamaños

| Medida | Antes (`team-platform:slim`, ffmpeg 8.1.2 de Alpine) | Después (`team-platform:ffmpeg-min`) |
|---|---|---|
| Imagen según `docker images` | 466 MB | 306 MB |
| Contenido (`du -smx /`) | 329 MiB | 218 MiB |
| `/usr/lib` | 130 MiB | 9 MiB |
| `ffmpeg` | paquete dinámico con bibliotecas compartidas | 8.493.792 bytes, estático |
| `ffprobe` | ídem | 8.313.504 bytes, estático |
| Decodificadores | 540 | 22 |

Sin dav1d los binarios miden 6.412.992 y 6.232.704 bytes. AV1 cuesta 4,2 MB en total (1,4 % de la imagen). Se conserva: ese 1,4 % compra el decodificador de AV1.

## Compilación

Etapa `ffmpeg` del `Dockerfile`, sobre `alpine:3.24`, en una máquina de 16 hilos y sin caché:

| Paso | Duración |
|---|---|
| `apk add` de la cadena de compilación | 5,6 s |
| dav1d 1.5.4 (meson, estático) | 33,3 s |
| ffmpeg 8.1.3: descarga, configure, make, strip | 70,3 s |
| `scripts/check-ffmpeg.sh` | 0,7 s |
| Total de la etapa | 110 s |

Con las etapas en caché, `docker build` de la imagen final tarda 23 s.

Verificación de los códigos fuente:

- ffmpeg 8.1.3, SHA-256 `7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3`. ffmpeg.org no publica archivos de suma. La suma se calculó sobre un tarball cuya firma separada (`.asc`, clave `FCF986EA15E6E293A5644F10B4322F04D67658D8`) verificó con gpg, y el `Dockerfile` la comprueba con `sha256sum -c`.
- dav1d 1.5.4, SHA-256 `686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5`, publicada por VideoLAN junto al tarball.

## Configuración

```
--prefix=/opt/ffmpeg --enable-small --enable-static --disable-shared --pkg-config-flags=--static
--extra-ldflags=-static --disable-everything --disable-autodetect --disable-network --disable-doc
--disable-debug --disable-ffplay --disable-avdevice --enable-ffmpeg --enable-ffprobe --enable-libdav1d
--enable-demuxer=mov,matroska,ogg,mp3,wav,aac,flac
--enable-parser=aac,flac,h264,hevc,vp8,vp9,av1,opus,vorbis,mpegaudio
--enable-decoder=h264,hevc,vp8,vp9,libdav1d,aac,alac,opus,vorbis,flac,mp3,mp3float,pcm_s16le,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,pcm_alaw,pcm_mulaw
--enable-encoder=flac,mjpeg --enable-muxer=flac,image2,null
--enable-filter=scale,fps,aresample,aformat,format,null,anull --enable-protocol=file,pipe --enable-x86asm
```

Se agregaron a la lista pedida `flac` como demuxer y decodificador, porque el producto acepta `audio/flac`. También `alac`, de las notas de voz de iPhone sin pérdida, y los PCM `alaw`, `mulaw`, `u8`, `f32le` y `s32le`. Faltan a propósito zlib, libopus, libvorbis y todo codificador distinto de FLAC y MJPEG. Sin zlib no se leen un `moov` comprimido ni un encabezado Matroska comprimido. Los decodificadores propios de ffmpeg cubren Opus y Vorbis.

## Licencia

- Configuración sin `--enable-gpl`, `--enable-nonfree`, `--enable-version3`, x264 ni x265: LGPL-2.1-or-later. `ffmpeg -version` lo confirma y `scripts/check-ffmpeg.sh` lo comprueba.
- Se distribuye solo el binario, sin modificar el código fuente. Código fuente: https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz. dav1d, enlazado de forma estática, es BSD-2-Clause.
- La imagen lleva `/usr/share/licenses/NOTICE` (generado por `scripts/notice.mjs`, con copia en la raíz del repositorio) y, en `/usr/share/licenses/ffmpeg/`, el texto de la LGPL 2.1 y el de dav1d.
- Quien quiera otro ffmpeg cambia `FFMPEG_VERSION` y `FFMPEG_SHA256` y reconstruye la imagen. Es la forma de recombinar que exige la LGPL para un enlace estático.

## Equivalencia

Las pruebas corrieron en contenedores de la misma imagen. `/usr/bin/ffmpeg` es el paquete completo de Alpine 8.1.2 (el anterior) y `/usr/local/bin/ffmpeg` es el mínimo 8.1.3.

| Comprobación | Resultado |
|---|---|
| `node --test src/extract/*.test.js src/extract/lib/*.test.js` sobre el ffmpeg de Alpine | 106 de 106, 14,0 s |
| Lo mismo sobre el mínimo (target `extract-test`, 133 pruebas con las nuevas) | 130 pasan, 3 se omiten (pruebas que leen el `Dockerfile`, que no está en la imagen), 0 fallan, 4,4 s las 106 de antes |
| `src/extract/test/bench.js`: video de 20 min | 1200 muestreados, 300 tras dHash, 48 enviados, igual en ambos |
| `bench.js`: audio de 20 min | 3 trozos, 1210 s facturables, igual en ambos |
| `bench.js`: tiempo del video, mediana de 3 | 14,6 s con el anterior y 11,3 s con el mínimo |
| `bench.js`: tiempo del audio | 793 ms y 622 ms |
| Cinco archivos reales (tres notas de voz Opus, dos videos H.264 + AAC de 2880x1800), PCM del trozo FLAC | MD5 idéntico en los cinco |
| Los dos videos reales, fotogramas JPEG a 720 px | 103 y 83 fotogramas en ambos; píxeles decodificados idénticos. Los JPEG difieren en bytes solo por la etiqueta de versión |
| `extract()` con Groq real y visión doble sobre los cinco archivos | Mismas unidades: 9, 20 y 9 líneas de voz en las notas, 8 y 6 en los videos; 2 y 26 fotogramas finales; mismo largo de texto |
| Tiempo de fotogramas de los videos reales | 6,19 s y 4,75 s con el anterior; 6,90 s y 4,60 s con el mínimo |
| Arranque de `ffprobe -version`, 200 llamadas | 44 ms cada una con Alpine; 1,3 ms con el estático |

La tercera nota de voz es `UltraSprint/WhatsApp Ptt 2026-10-13 at 23.31.20.ogg`, porque `workSprint/` solo tiene dos. Son las mismas tres de la medición de unidades de audio (51, 118 y 107 s). La visión de los videos fue doble: no se gastó en Anthropic. Los archivos privados no salieron del equipo ni se copiaron; aquí solo hay conteos y tiempos.

La matriz de `src/extract/ffmpeg-image.test.js` genera entradas con el ffmpeg completo (`FIXTURE_FFMPEG`). Las pasa por `extract()` con el binario de la imagen. Son 15 audios: Opus en Ogg, Vorbis, AAC en m4a, ALAC, AAC ADTS, MP3, seis variantes de PCM, FLAC y Opus en WebM. Son 7 videos: H.264, HEVC en mov, VP8, VP9, AV1 en mkv, H.264 con MP3 y H.264 sin audio. Las 22 pasan sobre los binarios de la imagen. Dentro de la imagen un codificador de prueba ausente falla la prueba en vez de omitirla.

Una prueba negativa del script: con un `ffmpeg` que oculta el decodificador `hevc`, `scripts/check-ffmpeg.sh` sale con 1 y dice `missing decoder 'hevc'`. Con `--enable-gpl` agregado al `Dockerfile`, dos pruebas de `src/static.test.js` fallan.

## Audio sin pasar por ffmpeg

Se midió enviar la nota original (Ogg Opus) a Groq en vez del trozo FLAC 16 kHz mono, dos corridas por camino y por nota.

| Nota | Peso FLAC | Peso original | WER directo contra FLAC | Unidades FLAC | Unidades directo | Latencia de Groq (FLAC / directo) |
|---|---|---|---|---|---|---|
| 51 s | 1,68 MB | 0,13 MB | 0,00 % | 9 | 9 | 1,17 s / 0,68 s |
| 118 s | 3,92 MB | 0,24 MB | 0,91 % | 20 | 17 | 1,26 s / 1,04 s |
| 107 s | 3,66 MB | 0,28 MB | 0,40 % | 9 | 9 | 1,40 s / 1,00 s |

El texto de cada camino es idéntico entre sus dos corridas (WER 0,00 %), así que la diferencia es del formato y no del azar.

Decisión: se mantiene FLAC para todo. El texto casi no cambia (hasta 0,91 %), pero la segmentación sí. La nota de 118 s pasa de 37 a 33 segmentos y de 20 a 17 unidades. Las unidades se afinaron sobre el camino FLAC. La ganancia es de 0,2 a 0,5 s por nota. ffprobe se necesita igual para la duración y para los videos, y un segundo camino agrega condiciones (formato, tamaño, largo) sin quitar el binario.

## Archivos

- `Dockerfile`: etapas `ffmpeg`, `base`, `test-deps` y `extract-test` nuevas. `docker build --target extract-test -t team-platform:extract-test .` y `docker run --rm team-platform:extract-test` corren las pruebas de los extractores sobre los binarios de la imagen.
- `scripts/check-ffmpeg.sh`: compara `ffmpeg -decoders`, `-demuxers`, `-encoders`, `-muxers`, `-filters` y `-protocols` con las listas de arriba. Corre al construir la etapa y al probar.
- `scripts/notice.mjs` y `NOTICE`.
- `src/extract/ffmpeg-image.test.js` y las comprobaciones de licencia en `src/static.test.js` (HP-011).

## Sin hacer

- No se construyó para arm64. El `Dockerfile` instala nasm solo en x86_64 y pasa `--disable-x86asm` en otras arquitecturas, pero esa rama no se ejecutó.
