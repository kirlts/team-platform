# Video y audio a texto

Fecha de consulta: 2026-10-20. Las mediciones se corrieron el mismo día en un equipo de 16 hilos con ffmpeg 8.1.2, Node 24.20.0, sharp 0.35.5 y Docker 29.8.1. Cada fuente lleva su URL. Lo marcado «sin verificar» no tiene fuente primaria o no se pudo ejecutar aquí. El entorno no tenía claves de Groq, Anthropic, DeepSeek ni Gemini: ninguna cifra sale de una llamada a un modelo. Las cifras de modelos son documentación del proveedor o mediciones de terceros con fecha.

## Resultado

1. Para el servidor Node conviene el binario `ffmpeg` invocado con `child_process.spawn`. `fluent-ffmpeg` está archivado y `@ffmpeg/ffmpeg` (WASM) se niega a correr en Node (error medido). El paquete `ffmpeg-static` agrega 80 MB a la imagen y no depende de la versión de Debian; el paquete `apt` de Debian 12 agrega 471 MB.
2. El cambio de escena no sirve como muestreo principal para una grabación de pantalla. En una grabación sintética de 16 pantallas, `scene>0,2` capturó 8 de 16. Un aviso emergente pequeño puntuó 0,06 y el cambio completo entre dos listas claras, 0,03 a 0,05. Un fotograma por segundo con deduplicación por dHash de 64 bits y distancia 6 dejó 18 de 128 fotogramas y cubrió las 16 pantallas.
3. La pista de un video de teléfono ya viene en AAC. Pasada a FLAC de 16 kHz mono pesa 1,83 MB por minuto, así que el tope de 25 MB de Groq se alcanza a los 13 minutos. Con Opus a 32 kbps pesa 0,21 MB por minuto y 100 minutos caben en un archivo. Trozos de 10 minutos con 5 segundos de solapamiento resuelven el caso FLAC.
4. El límite que más condiciona el producto está en Groq: 7.200 segundos de audio por hora en el plan Developer. Equivale a seis videos de 20 minutos por hora para todo el equipo.
5. El video nativo de Gemini cuesta del mismo orden que el camino propio: 0,001 a 0,005 USD por minuto de entrada según modelo y resolución, contra 0,0019. No lo desplaza por costo. Lo justifica el no necesitar ffmpeg ni código de alineación, a cambio del muestreo determinista de UD-001.

## 1. ffmpeg dentro del contenedor

### 1.1 Estado de las librerías Node

| Opción | Estado verificado | Fuente, fecha |
|---|---|---|
| `fluent-ffmpeg` | Repositorio archivado por el propietario el 2025-05-22; README: «ya no funciona correctamente con versiones recientes de ffmpeg»; npm: 2.1.3 del 2024-05-19, marcado deprecado | github.com/fluent-ffmpeg/node-fluent-ffmpeg y registry.npmjs.org/fluent-ffmpeg, 2026-10-20 |
| `ffmpeg-static` 5.3.0 | Publicado el 2025-11-14; paquete de 48 KB que descarga el binario en `install` (`node install.js`); licencia GPL-3.0-or-later; el README declara ffmpeg 6.1.1 y el binario instalado en la prueba informa `7.0.2-static` de johnvansickle.com | github.com/eugeneware/ffmpeg-static y registry.npmjs.org/ffmpeg-static, 2026-10-20; medición propia |
| `@ffmpeg/ffmpeg` 0.12.15 | Última versión del 2025-01-07 (más de 12 meses); en Node lanza `ffmpeg.wasm does not support nodejs` al construir `new FFmpeg()` (medido); el núcleo ocupa 62 MB | registry.npmjs.org/@ffmpeg/ffmpeg y medición propia, 2026-10-20 |
| `@ffmpeg-installer/ffmpeg` | Sin versión desde 2021-07-15 | registry.npmjs.org, 2026-10-20 |
| `fluent-ffmpeg-simplified` 0.6.0 | Reimplementación con otra API, publicada el 2026-09-26; mantenedor y adopción sin verificar | registry.npmjs.org, 2026-10-20 |
| Binario del sistema | `spawn('ffmpeg', args)` sin dependencia npm; es lo que ya usan todas las mediciones de abajo | medición propia |

Licencia: el binario de `ffmpeg-static` es GPL. Se invoca como proceso externo y no se enlaza. Una imagen Docker que lo incluye distribuye un binario GPL y debe llevar su aviso (interpretación propia, sin verificar con un abogado).

### 1.2 Tamaño de imagen medido

Se construyeron cuatro imágenes con `docker build` y se leyó `docker image inspect`.

| Imagen | Tamaño total | Capa de ffmpeg | ffmpeg | Observación |
|---|---|---|---|---|
| `node:24-alpine` + `apk add ffmpeg` | 426 MB | 183 MB sobre la base de 243 MB | 8.1.2 | musl; compilación del repositorio de Alpine, dependencias incluidas |
| `node:24-slim` + `ffmpeg-static` | 517 MB | 127 MB (binario 79,8 MB; el resto es caché de npm, eliminable) | 7.0.2 estático | glibc; sin `apt` |
| `node:24-slim` + `@ffmpeg/ffmpeg` + `@ffmpeg/core` | 459 MB | 62 MB de núcleo | 5.1.4 en WASM | inutilizable en Node |
| `node:24-slim` + `apt install --no-install-recommends ffmpeg` | 974 MB | 471 MB | 5.1.9 (Debian 12) | arrastra decenas de bibliotecas de códecs |

El tiempo de construcción en caliente fue de 108 s para `apt`, 22 s para `apk`, 15 s para `ffmpeg-static`. Alpine entrega ffmpeg 8.1.2 y Debian 12 entrega 5.1.9. Los filtros usados aquí (`select`, `fps`, `scale`, `mpdecimate`) existen en ambas. Las imágenes publicadas que arrojó la búsqueda son de 2022 a 2024 (por ejemplo 69 MB comprimidos para Alpine con ffmpeg 6.1) y ninguna mide `node:24-slim` más `apt` en 2026; la tabla de arriba lo mide.

La elección por tamaño es Alpine con `apk`. La elección por independencia de la distribución es `ffmpeg-static`, que añade 80 MB y fija la versión por npm. La API usa `node:sqlite` y no compila módulos nativos (MASTER-SPEC §3), de modo que la imagen puede ser Alpine. El único módulo nativo que entra con este trabajo es `sharp`, que distribuye binarios precompilados para musl (sin probar aquí en Alpine).

## 2. Muestreo de fotogramas

### 2.1 Material de prueba

Se generó con `ffmpeg -f lavfi` una grabación vertical de 1080 por 2340 píxeles, 30 cuadros por segundo y 128 segundos. Tiene 16 pantallas de 8 segundos, cada una con encabezado de color y nueve filas de texto; una de cada cuatro es de tema oscuro. Un aviso emergente («Guardado») aparece entre el segundo 3 y el 5 de cada pantalla. Un punto rojo se desplaza y un reloj cambia cada segundo. El audio es una narración en español de 128 s generada con `espeak-ng`. Limitación principal: es una grabación sintética, sin transiciones animadas, desplazamientos suaves ni video incrustado. Los resultados de cambio de escena describen este caso y no una distribución. Un segundo video de 20 minutos repite el primero diez veces sin recodificar. Un tercero aplica a la grabación una sacudida de ±14 px y una rotación de ±0,7 grados por cuadro, como proxy de una pantalla filmada con la cámara en la mano.

### 2.2 Qué umbral de cambio de escena usan otros

| Fuente | Valor | Razón declarada | Fecha |
|---|---|---|---|
| Resumen de `bradautomates/claude-video` | 0,20, con `select='eq(n\,0)+gt(scene\,T)'` para conservar el primer fotograma; 0,10 a 0,15 para contenido rápido | sin verificar contra el repositorio (es una página generada) | 2026-08-13 |
| Guía de hosting ffmpeg | 0,3 a 0,4 como punto de partida; calibrar con los primeros minutos | cine y televisión | sin fecha, 2020s |
| Lista ffmpeg-user | 0,3 a 0,5 para cortes de cine; 0,7 produce pocas miniaturas | cine | 2012 y 2016 |

Ninguna de estas fuentes trata grabaciones de pantalla. Los tres valores son umbrales de montaje de video, donde un corte cambia casi todos los píxeles.

### 2.3 Medición de `scene` sobre una grabación de pantalla

La puntuación `scene` de ffmpeg es una diferencia media de píxeles normalizada entre cuadros consecutivos. En la grabación de prueba:

| Evento | Puntuación `scene` |
|---|---|
| Cambio a una pantalla oscura o desde una oscura | 0,81 a 1,0 |
| Cambio entre dos pantallas claras (cambia toda la lista de texto) | 0,03 a 0,08 |
| El aviso emergente desaparece | 0,060 |
| Reloj (cada segundo) y punto móvil | menor de 0,01 |

El aviso emergente puntúa más que el cambio completo de una pantalla clara a otra. Con ese perfil, el umbral controla qué tipo de cambio se detecta y no cuánta información nueva hay.

| Umbral | Fotogramas seleccionados | Pantallas distintas cubiertas de 16 |
|---|---|---|
| 0,02 | 43 | 16 |
| 0,03 | 42 | 15 |
| 0,05 | 40 | 13 |
| 0,08 | 12 | 9 |
| 0,10 | 10 | 8 |
| 0,20 | 8 | 8 |
| 0,30 | 8 | 8 |

Con 0,20, el valor más citado, quedan fuera la mitad de las pantallas. Con 0,02 se cubren todas. En la grabación sacudida, ese umbral selecciona 2.452 de 3.840 cuadros; 0,10 selecciona 24, 0,20 selecciona 10 y 0,30 selecciona 7.

### 2.4 Intervalo fijo, fotogramas clave y `mpdecimate`

| Estrategia | Fotogramas (grabación de 128 s) | Pantallas cubiertas | Tiempo de ffmpeg (128 s, 16 hilos) |
|---|---|---|---|
| `fps=1` | 128 | 16/16 | 1,41 a 1,85 s |
| `fps=0.5` | 64 | 16/16 | 1,50 a 2,19 s |
| `select scene>0,05` | 40 | 13/16 | 1,62 a 1,96 s |
| `select scene>0,20` | 8 | 8/16 | 1,71 a 1,91 s |
| Fotogramas clave (`-skip_frame nokey`) | 16 | no se midió el contenido | 0,42 a 0,67 s |
| `fps=1,mpdecimate` (tres ajustes) | 67 a 128 | 16/16 | 1,5 a 1,9 s |

Los fotogramas clave los fija el codificador. Aquí x264, con su intervalo de 250 cuadros, dejó 16, uno cada 8 s, sin relación con el contenido. En un teléfono el intervalo lo fija la aplicación de grabación y no hay fuente primaria sobre Android ni iOS: el camino queda descartado. `mpdecimate` descarta cuadros con poca diferencia por bloques. Con reloj y puntero conservó entre 67 y 128 de 128 fotogramas y no reemplaza la deduplicación posterior.

Forasoft (2026-05-31) dice que el valor por omisión de la industria es 1 fotograma por segundo y que la tasa debe igualar «el evento más corto que importa». Para una prueba de aplicación eso favorece 1 s, porque un aviso dura unos segundos (duración sin verificar).

### 2.5 Deduplicación por hash perceptual

Se hashearon los 128 fotogramas de 720 píxeles de ancho. Un fotograma se conserva si su distancia de Hamming con el último conservado supera D.

| Algoritmo | Costo por fotograma | Conservados con D=6 (cobertura) | Con D=8 | Con D=10 |
|---|---|---|---|---|
| dHash 8×8 de 64 bits con `sharp` (propio, 12 líneas) | 5,1 ms (7,4 a 11,5 en repeticiones con carga) | 18 (16/16) | 17 (15/16) | 13 (13/16) |
| `sharp-phash` 2.2.0 (DCT) | 8,8 ms | 47 (16/16) | 46 | 43 |
| `imghash` 1.1.5 | 17,2 ms | 32 (16/16) | 32 | 32 |
| `blockhash-core` 0.1.0 | no se midió; sin versión desde 2019-12-07 | | | |

`sharp-phash` e `imghash` conservan más fotogramas porque cambian de hash con el reloj y el puntero. Con D entre 2 y 6 el dHash conserva de 40 a 18 fotogramas y cubre las 16 pantallas. Con D=8 se pierde una. El valor 6 es el último sin pérdida.

La deduplicación quita 86 % de los fotogramas (110 de 128). El video de 20 minutos, hecho de 10 repeticiones, dejó 180 fotogramas con D=6, 18 por repetición. La comparación es contra el último conservado y no reconoce pantallas de una vuelta anterior; en un video real sin repeticiones literales eso no ocurre.

Dos resultados negativos. En la grabación sacudida el dHash conservó 122 de 128 fotogramas con D=6 y 104 con D=10: la deduplicación no funciona cuando el cuadro se mueve. Desenfocar antes de hashear tampoco lo corrige y destruye la distinción en el caso estable (con desenfoque 25 queda 1 de 16 pantallas). Para video de cámara, la deduplicación necesita un tope de cantidad.

### 2.6 Costo medido de extraer fotogramas

| Video | Hilos | Tiempo de pared | CPU de usuario | Memoria máxima |
|---|---|---|---|---|
| 20 min, 0,17 Mbps, `fps=1` a 720 px | 16 | 12,2 s | 100 s | 364 MB |
| 20 min, `scene>0,05` | 16 | 15,3 s | 111 s | 368 MB |
| 20 min, `fps=1` | 1 | 60,4 s | 65 s | 119 MB |
| 20 min, `scene>0,05` | 1 | 55,0 s | 74 s | 120 MB |
| 20 min, fotogramas clave | 16 | 2,6 s | | 134 MB |
| 128 s, 13,4 Mbps (ruido añadido), `fps=1` | 1 | 27,4 s | 27,9 s | 120 MB |
| 128 s, 13,4 Mbps, `scene>0,05` | 1 | 24,7 s | 27,0 s | |

La velocidad depende del bitrate. A 0,17 Mbps un núcleo procesa un minuto de video en 3 s; a 13,4 Mbps, en 12,8 s. Un video de 20 minutos a 13,4 Mbps tardaría unos 4,3 minutos en un núcleo (extrapolación lineal, no medida). El hash costó 7 ms por fotograma, 1.280 fotogramas en 9,0 s: menos de 1 s por minuto de video.

### 2.7 Límites de imágenes por llamada

| Proveedor | Imágenes por solicitud | Tamaño | Costo por fotograma de 720×1560 | Fuente, fecha |
|---|---|---|---|---|
| Anthropic (API) | 600 (100 en modelos de 200K); sobre 20 imágenes, cada una debe medir 2000 px o menos por lado | 10 MB por imagen; 32 MB por solicitud | ⌈720/28⌉×⌈1560/28⌉ = 1.456 tokens; modelos 4.7 y posteriores admiten 2576 px de lado largo y 4.784 tokens máximo | platform.claude.com/docs/en/build-with-claude/vision, 2026-10-20 |
| DeepSeek | 600 | 32 MiB por imagen; 64 MiB por solicitud; 48 MiB de cuerpo; 4096 px por lado con 15 o más imágenes | hasta 1.024 tokens por imagen (se reescala a unos 1300 px) | api-docs.deepseek.com/guides/vision, 2026-10-20 |
| Gemini | 3.600 | 20 MB por solicitud en línea; más allá, Files API | 258 tokens si ambos lados miden 384 px o menos; en otro caso, mosaicos de 768 px de 258 tokens cada uno (el redondeo de mosaicos no está especificado: de 1.300 a 2.100 tokens para este tamaño) | ai.google.dev/gemini-api/docs/image-understanding, 2026-10-20 |

Cada fotograma JPEG de 720 px de ancho (calidad `-q:v 4`) pesó 60 KB; en base64 son 80 KB. Con 32 MB de solicitud caben unos 400, un número que no limita antes que el de tokens. Limita antes el escalón de precio de Haiku 5.5: la entrada sube de 0,10 a 0,50 USD por MTok sobre 100.000 tokens de prompt (investigación 01, §3). Con 1.456 tokens por fotograma, 48 fotogramas son 69.888 tokens. Con unos 5.000 de transcripción de 20 minutos y unos 10.000 de instrucciones (supuestos propios) el total es 85.000. Con 58 fotogramas se llegaría a 100.000; 48 deja 15 % de margen.

## 3. La pista de audio

### 3.1 Extracción y tamaño

El comando recomendado por Groq es `ffmpeg -i <entrada> -ar 16000 -ac 1 -map 0:a -c:a flac <salida>.flac`. La documentación indica que Groq convierte todo a 16 kHz mono antes de transcribir. Extraer la pista de un video de 20 minutos tardó 0,9 s a FLAC, 0,8 s a WAV y 8,2 s a Opus.

| Formato (16 kHz, mono) | Voz sintética limpia | Voz con ruido rosa añadido | Pista extraída del video (AAC decodificado) | Minutos por 25 MB (valor más grande de cada fila) |
|---|---|---|---|---|
| WAV PCM 16 bits | 1,92 MB/min | 1,92 | 1,92 | 13,0 |
| FLAC | 1,00 | 1,26 | 1,83 | 24,9 |
| Opus 16 kbps | 0,114 | 0,122 | | 219 |
| Opus 24 kbps | 0,160 | 0,183 | | 156 |
| Opus 32 kbps | 0,205 | 0,244 | 0,21 | 122 |
| MP3 64 kbps | 0,481 | 0,481 | | 52 |
| AAC 48 kbps | 0,391 | 0,399 | | 64 |

La voz es sintética y no representa la compresibilidad de una voz real. La columna de pista extraída es la que cuenta: viene de un video codificado en AAC de 96 kbps y vuelto a decodificar. Su FLAC pesó 39,1 MB para 21,3 minutos, 1,83 MB por minuto, casi el WAV. Una pista de teléfono ya viene en AAC, así que este tamaño vale y el de laboratorio no. Con 1,83 MB por minuto, 13,6 minutos de FLAC llegan a 25 MB. La misma pista en Opus 32 kbps pesó 4,4 MB. Opus a 64 kbps con VBR salió sobre el nominal (0,71 MB/min contra 0,48) porque el codificador gastó bits de más en la voz sintética; con `-vbr off` salió el nominal.

Efecto de la compresión en la precisión: las fuentes son débiles. Soniox (guía, sin fecha) dice que FLAC es seguro y que Opus a un bitrate razonable casi no cuesta. Un comparador de 2026 (team-connect.co.uk) pone Opus de 24 a 32 kbps entre 0,5 y 1,5 puntos de WER sobre WAV, sin citar medición. Nadie aporta un WER de Whisper en español contra Opus. La prueba consiste en transcribir diez minutos de voz humana en español, en FLAC y en Opus 32 kbps, y comparar; requiere una clave de Groq que este entorno no tenía.

### 3.2 Groq `whisper-large-v3-turbo`

| Dato | Valor | Fuente, fecha |
|---|---|---|
| Tamaño máximo de archivo | 25 MB en el plan gratuito, 100 MB en el Developer; sobre eso, parámetro `url` | console.groq.com/docs/speech-to-text, 2026-10-20 |
| Formatos | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm; sólo se transcribe la primera pista de audio | ídem |
| Largo mínimo facturado | 10 s por solicitud | ídem |
| Precio y velocidad | 0,04 USD por hora; factor 216; WER declarado 12 % (`whisper-large-v3`: 0,111 USD/h, factor 189, WER 10,3 %) | ídem |
| Parámetros | `language` (ISO-639-1), `prompt` hasta 224 tokens, `response_format=verbose_json`, `timestamp_granularities[]` = `segment` o `word`, `temperature` 0 | ídem |
| Límites de tasa (plan Developer) | 20 solicitudes por minuto, 2.000 por día, 7.200 s de audio por hora, 28.800 s por día | console.groq.com/docs/rate-limits, 2026-10-20 |
| Latencia medida por terceros | 30 s: 0,8 s; 2 min: 1,9 s; 5 min: 3,4 s (mediana de 10 corridas, MP3 de 128 kbps, inglés de oficina, incluye subida, máquina en Nueva York) | nwos.com/daily/whisper-transcription-api-vs-self-hosted-vs-groq, 2026-06-10 |

La tasa de audio es el límite operativo: 7.200 s por hora son 120 minutos, seis videos de 20 minutos por hora para todo el equipo, más los solapamientos. Los 28.800 s diarios son ocho horas. Los valores del plan gratuito no figuran en la documentación (sin verificar); el artículo del 2026-06-10 dice haber agotado el cupo diario varias veces. Con el factor de velocidad 216, 20 minutos tardarían 5,6 s de cómputo (cálculo propio). Con la latencia de terceros, unos 14 s (extrapolación lineal desde 3,4 s por 5 min, sin medir).

Grano de tiempo: `segment` entrega inicio y fin por segmento. No hay informe de deriva de marcas de tiempo en Groq (búsqueda sin resultados, 2026-10-20). Los segmentos de Whisper se producen por ventanas de 30 s y pueden ser largos; para alinear con fotogramas bastan.

Idioma y vocabulario: `language=es` mejora precisión y latencia según Groq. El `prompt` guía estilo y ortografía, con tope de 224 tokens. Una guía de 2026 (spheron.network) advierte que un prompt puede empeorar las alucinaciones en silencio, porque el decodificador repite su texto. Por eso el `prompt` lleva sólo vocabulario (áreas, productos y personas del equipo) y nunca instrucciones.

### 3.3 Segmentación en trozos

Con FLAC, un trozo de 10 minutos pesó 18,5 MB en la medición (1,83 MB/min), un 26 % por debajo de 25 MB. Cortar el archivo de 21,3 minutos en tres trozos con `ffmpeg -ss … -t 605` tardó 1,06 s en total. Cada trozo comienza 5 s antes del corte anterior.

Qué dicen las fuentes sobre cortes y alucinaciones. El tutorial de chunking de Groq (post de community.groq.com, hoy redirigido a groq.com, sin fecha legible) describe preprocesar, cortar con solapamiento, transcribir y fusionar. Sus valores de trozo y solapamiento no se pudieron leer. Un artículo de arXiv (2501.11378, enero de 2025, más de 12 meses; PDF ilegible, dato por resumen de búsqueda) reporta más alucinaciones en audio sin voz y pasados los 30 s. Propone una lista de alucinaciones conocidas y detección de voz (Silero VAD, py-webrtcvad). Un reporte de GitHub (inference4j, sin fecha verificada) dice que un corte en mitad de palabra provoca alucinación en el borde y propone cortar en la pausa más larga. Otro reporte describe una entrevista de 74,9 minutos en la que `large-v3-turbo` agregó un segmento final inexistente; la solución fue no dejar trozos finales menores de 35 s.

Regla de fusión propuesta (propia, no medida en Groq). El corte entre los trozos k y k+1 está en el punto medio del solapamiento. Se conservan los segmentos del trozo k que empiezan antes del corte y los del trozo k+1 que empiezan en el corte o después. Los tiempos se suman al desfase de cada trozo. Un último trozo de menos de 10 s no se emite y se absorbe en el anterior, porque 10 s es la facturación mínima de Groq.

## 4. Alinear transcripción y fotogramas

### 4.1 Formato

La alineación la hace el sistema, no el modelo: cada fotograma lleva su tiempo, y cada segmento de voz se asigna al fotograma anterior más cercano. Con `fps=1` y `-frame_pts 1`, el nombre del archivo es el segundo exacto del fotograma (medido: archivos `00008.jpg`, `00016.jpg`). El tiempo viaja en el nombre y el sistema no necesita analizar la salida de ffmpeg.

Formato propuesto, en orden cronológico y con cada imagen antes del texto que la acompaña. Anthropic recomienda imagen antes que texto y rotular cada una («Image 1:», «Image 2:»). Gemini pide `MM:SS`.

```
[00:00] Fotograma 1
<imagen>
Voz 00:00-00:07: «Hola, voy a probar la aplicación. Primero abro la pantalla de inicio.»
[00:08] Fotograma 2
<imagen>
Voz 00:08-00:15: «Ahora escribo mi correo y la contraseña.»
```

Un bloque de texto por segmento de voz, uno por fotograma y una imagen por fotograma. Un segmento largo que cruza varios fotogramas se asigna al primero y los siguientes llevan «(sigue la voz anterior)». El formato SRT no aporta nada que este orden intercalado no dé; sólo tendría sentido para exportar subtítulos.

### 4.2 Si el modelo entiende mejor con marcas de tiempo en el texto

No hay un estudio que compare, para modelos de visión de Anthropic, imágenes intercaladas con y sin marcas de tiempo. Lo que existe:

| Fuente | Qué muestra | Alcance | Fecha |
|---|---|---|---|
| TimeMarker (arXiv 2411.18211) | Inserta texto «Second{n}» antes de los tokens visuales de cada fotograma; la reseña advierte que el benchmark de localización está contaminado | modelo entrenado para esto | noviembre de 2024 (más de 12 meses) |
| UniTime (NeurIPS 2025) | Tokens de tiempo intercalados con tokens de video | modelo entrenado | 2025 |
| TimeLens (CVPR 2026) | Codificación intercalada de texto y tiempo con aprendizaje por refuerzo | modelo entrenado | 2026 |
| Documentación de Gemini | Pide `MM:SS` en el prompt para referirse a momentos | uso, no medición | 2026-10-20 |
| Documentación de Anthropic | Rotular imágenes y ponerlas antes del texto mejora el resultado | recomendación, sin cifra | 2026-10-20 |

Los tres artículos reportan mejoras en modelos entrenados con ese formato; no se transfieren a un modelo que no fue entrenado así. Conclusión: las marcas de tiempo en texto son barata y consistente con la documentación de los proveedores, pero su efecto en este analizador está sin verificar. El banco de referencia (MASTER-SPEC §7.11) debe incluir un caso con y sin marcas, con tres videos de prueba y la métrica de «mensajes correctamente atribuidos al momento de la pantalla».

## 5. Video nativo con Gemini Flash-Lite

### 5.1 Datos de la documentación (consultada el 2026-10-20)

| Dato | Valor |
|---|---|
| Muestreo | 1 fotograma por segundo por omisión; `fps` configurable en `processing`, junto con `start_offset` y `end_offset` (sólo modo estático) |
| Tokens | La página de video dice que por omisión se usan ~100 tokens/s (66 por fotograma + 32 de audio por segundo) y ~300 tokens/s con resolución alta (258 por fotograma). Un artículo de terceros (forasoft.com, 2026-05-31) sitúa la omisión en 258 por fotograma. Contradicción declarada abajo |
| Duración | Con contexto de 1 M tokens: 3 horas a resolución baja, 1 hora a alta |
| Tamaño | En línea, menos de 20 MB por solicitud; Files API 2 GB (gratuito) o 20 GB (de pago) por archivo |
| Formatos | mp4, mpeg, mov, avi, x-flv, mpg, webm, wmv, 3gpp |
| Modo nuevo | `processing: "agentic"` (2026-09-01) para Gemini 3.7 Flash, 3.6 Flash y 3.5 Flash-Lite; promete hasta 66 % menos costo y 88 % menos tokens; cifras del proveedor, sin reproducción independiente |

### 5.2 Precio por minuto de video de video

Precios del 2026-10-19 (ai.google.dev/gemini-api/docs/pricing), en USD por MTok. `gemini-2.5-flash-lite`: 0,10 de texto, imagen o video, 0,30 de audio, 0,40 de salida. `gemini-3.1-flash-lite`: 0,25, 0,50 y 1,50. `gemini-3.5-flash-lite`: 0,30, 0,30 y 2,50. Cálculo propio con 60 s de video más 60 s de audio.

| Modelo | Resolución baja (3.960 tokens de video + 1.920 de audio) | Resolución alta (15.480 + 1.920) | 20 min en baja |
|---|---|---|---|
| `gemini-2.5-flash-lite` | 0,00097 USD/min | 0,00212 | 0,019 |
| `gemini-3.1-flash-lite` | 0,00195 | 0,00483 | 0,039 |
| `gemini-3.5-flash-lite` | 0,00176 | 0,00522 | 0,035 |

La salida se suma aparte. Con un supuesto propio de 600 tokens por minuto (transcripción y descripción) son 0,00024 USD/min en 2.5, 0,00090 en 3.1 y 0,0015 en 3.5. No hay fecha de retiro verificada para `gemini-2.5-flash-lite`.

### 5.3 Camino propio, mismo cálculo

Groq cuesta 0,04 USD/h, es decir 0,00067 USD/min. Con 8,4 fotogramas por minuto (18 en 128 s tras la deduplicación), 1.456 tokens cada uno y Haiku 5.5 a 0,10 USD/MTok, los fotogramas cuestan 0,00123 USD/min. La entrada suma 0,0019 USD/min, sin salida. En el peor caso, 20 minutos con tope de 48 fotogramas, son 0,0133 de Groq y 0,0070 de fotogramas: 0,020 USD.

### 5.4 Cuándo el video nativo supera al camino propio

El costo es del mismo orden, así que no decide. Decide esto:

| Criterio | Camino propio | Gemini nativo |
|---|---|---|
| Dependencias en el contenedor | ffmpeg (80 a 183 MB) y `sharp` | ninguna; sube el archivo |
| Determinismo (UD-001: «el mismo video da los mismos fotogramas») | sí, con parámetros fijos | no verificado: el muestreo es del proveedor y el modo `agentic` selecciona por consulta |
| Español hablado | Whisper con `prompt` de vocabulario y `language=es` | Sin verificar; no se midió WER |
| Legibilidad de texto en pantalla | el producto fija el ancho del fotograma (720 px = 1.456 tokens) | por omisión 66 tokens por fotograma; es muy poco para texto de interfaz, y la resolución alta cuesta 4 veces más |
| Qué se ve | los fotogramas conservados se pueden mostrar y auditar | el modelo ve fotogramas que el sistema no conserva |
| Alineación voz y pantalla | código propio (sección 4) | la hace el proveedor |
| Proveedores | Groq más cualquier visión | Google; rompe «un proveedor por modalidad» sólo si se agrega como cuarta ranura |
| Tope de duración | el que fije el producto | 3 h en baja |

El video nativo gana cuando el video dura más de 20 minutos, cuando no hay ffmpeg disponible en el anfitrión, o cuando la prioridad sea cero código de alineación. El camino propio gana donde el producto exige repetibilidad y una vista auditable de lo que el modelo recibió. Un caso de comparación para el banco: los mismos tres videos por ambos caminos, con la métrica de la sección 4.2.

## 6. Grabación y captura desde el navegador

### 6.1 Micrófono con `MediaRecorder`

| Dato | Valor | Fuente, fecha |
|---|---|---|
| Chrome, Firefox | `audio/webm;codecs=opus` | MDN `isTypeSupported`; crrev.com (código de Chromium), 2026-10-20 |
| Bitrate de Opus en Chrome | El código fija un piso de 6 kbps y un techo de 128 kbps para la asignación automática; el valor por omisión no figura en lo leído | crrev.com media_recorder.cc, 2026-10-20 |
| Tamaño por minuto | 0,24 MB a 32 kbps; 0,96 MB a 128 kbps (aritmética; Opus a 32 kbps medido con ffmpeg: 0,21 a 0,24) | cálculo y medición propios |
| Safari | WebKit anuncia en Safari 18.4 (2025-03-31) la grabación WebM con Opus y VP8 o VP9, y MP4 fragmentado con Opus (`video/mp4; codecs=avc1.42000a,opus`) | webkit.org/blog/16574/webkit-features-in-safari-18-4, 2026-10-20 |

Contradicción: un issue de GitHub (anirudhlath/alfred #100, abierto el 2026-07-18) afirma que WebM/Opus falla en Safari de escritorio y en WKWebView de iOS porque el constructor lanza. Propone `audio/mp4` (macOS 14.4 o posterior) y `audio/aac`. El comentario del 2026-10-03 admite que no se verificó en un Safari real. WebKit es la fuente primaria, de marzo de 2025; el issue es indirecto. La divergencia no cambia el diseño. El navegador sondea con `MediaRecorder.isTypeSupported` una lista ordenada (`audio/webm;codecs=opus`, `audio/mp4`, `audio/aac`), usa el primer tipo admitido y envía el tipo real del `Blob`. El servidor convierte cualquier contenedor a 16 kHz mono con `ffmpeg`, de modo que el formato no importa a la API. La ruta Ogg Opus no sirve en Safari para grabar (`isTypeSupported('audio/ogg; codecs=opus')` devuelve `false`, fuente secundaria).

### 6.2 Foto con la cámara

`<input type="file" accept="image/*" capture="environment">` funciona sólo en móvil y sólo con un `accept` que coincida; MDN lo marca como disponibilidad limitada. En escritorio abre el selector de archivos normal. El servidor valida tipo y tamaño sin importar el origen.

Hallazgo medido: `sharp` 0.35.5 con sus binarios precompilados lista el formato `heif` con un solo sufijo, `.avif`, y no decodifica el HEIC de iPhone (HEVC). Su documentación de instalación enumera JPEG, PNG, Ultra HDR, WebP, AVIF, TIFF, GIF y SVG. Anthropic y DeepSeek aceptan JPEG, PNG, GIF y WebP; Gemini acepta además HEIC y HEIF. No se pudo verificar si iOS convierte la foto a JPEG antes de subirla con `accept="image/*"`. Si entrega HEIC, el extractor necesita una conversión previa o un rechazo con mensaje claro. El banco debe incluir una foto HEIC real de iPhone.

## 7. Contradicciones y fuentes débiles

| Tema | Fuente A | Fuente B | Resolución para este contexto |
|---|---|---|---|
| Versión de ffmpeg en `ffmpeg-static` 5.3.0 | README: 6.1.1 | El binario instalado informa 7.0.2-static | Se usa lo medido (7.0.2); ninguna opción de ffmpeg usada aquí depende de ello |
| Tokens por fotograma por omisión en Gemini | Documentación de Google: baja resolución, ~100 tokens/s | forasoft.com (2026-05-31): 258 por fotograma, ~300 tokens/s | Se tabulan ambas columnas; manda la documentación de Google |
| Tamaño máximo de archivo en Groq | Documentación: 25 MB gratis, 100 MB Developer | Un hilo de la comunidad reporta «entity too large» con 37 MB en Developer; un artículo (nwos, 2026-06-10) no es consistente | Diseñar para 25 MB |
| WebM/Opus en Safari | WebKit: soportado desde 18.4 | Issue de julio de 2026: no funciona | Sondear en tiempo de ejecución |
| Umbral de cambio de escena | 0,20 (claude-video), 0,3 a 0,5 (ffmpeg-user) | Medición propia: 0,20 cubre 8 de 16 pantallas | No usarlo como muestreo principal en grabación de pantalla |
| Duración del trozo | Groq: sin cifra legible | Terceros: 10 s de solapamiento (mer.vin, 2024) | 10 min con 5 s, medido contra el tope de 25 MB |

Fuentes descartadas por antigüedad o falta de fecha: ffmpeg-user (2012, 2016), guías de hosting sin fecha, tablas de tamaño de iPhone de la época de iOS 11 (60 MB por minuto en 1080p30 en una lista, 130 MB en otra; sin cifra oficial vigente verificada) y el bitrate de `screenrecord` de Android (4 Mbps, de una copia de documentación de AOSP). Para el tamaño máximo de video se usa la medición propia de 13,4 Mbps (100 MB por minuto) como límite superior.

## 8. Recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Invocar el binario con `spawn`, sin `fluent-ffmpeg` ni WASM | `fluent-ffmpeg` archivado 2025-05-22; WASM falla en Node | github.com/fluent-ffmpeg/node-fluent-ffmpeg; prueba propia, 2026-10-20 |
| Imagen `node:24-alpine` con `apk add ffmpeg`; `ffmpeg-static` como alternativa si se quiere independencia de la distribución | 426 MB contra 517 MB (estático) y 974 MB (apt) | medición propia, 2026-10-20 |
| Muestreo base de 1 fotograma por segundo con deduplicación dHash, distancia 6, y no `scene` | `scene>0,2`: 8 de 16 pantallas; `fps=1` + dHash6: 18 fotogramas, 16 de 16 | medición propia, 2026-10-20; forasoft.com, 2026-05-31 |
| Tope duro de 48 fotogramas, elegidos por orden de cambio y reordenados en el tiempo | Escalón de 100.000 tokens de Haiku 5.5; 1.456 tokens por fotograma de 720 px | platform.claude.com vision y pricing, 2026-10-20 |
| Fotogramas de 720 px de ancho, JPEG `-q:v 4` | 60 KB; 1.456 tokens; imágenes de más de 20 por solicitud deben medir 2000 px o menos | medición propia; platform.claude.com, 2026-10-20 |
| Audio a FLAC 16 kHz mono en trozos de 600 s con 5 s de solapamiento; Opus 32 kbps como opción tras probar WER | FLAC de pista de video: 1,83 MB/min, 18,5 MB por 10 min; Opus: 0,21 MB/min | medición propia; console.groq.com/docs/speech-to-text, 2026-10-20 |
| `verbose_json`, `timestamp_granularities=segment`, `language=es`, `prompt` sólo de vocabulario | Parámetros documentados; el `prompt` puede agravar alucinaciones en silencio | console.groq.com/docs/speech-to-text, 2026-10-20; spheron.network, 2026 |
| Cola con presupuesto de audio: 7.200 s por hora | Límite del plan Developer | console.groq.com/docs/rate-limits, 2026-10-20 |
| Intercalar marca de tiempo, fotograma y voz por orden cronológico | Recomendación de los proveedores; sin benchmark para Anthropic | platform.claude.com y ai.google.dev, 2026-10-20 |
| Video nativo de Gemini como alternativa configurable, no por omisión | Costo del mismo orden; pierde determinismo y vista auditable | ai.google.dev/gemini-api/docs/pricing y video-understanding, 2026-10-19 y 2026-10-20 |
| Grabación del navegador: sondear `isTypeSupported` y enviar el tipo real | WebKit 18.4 contra issue de 2026-07-18 | webkit.org, 2025-03-31; github.com/anirudhlath/alfred/issues/100 |
| Rechazo explícito o conversión de HEIC en fotos | `sharp` 0.35.5 sólo lee `.avif` en `heif` | medición propia, 2026-10-20 |

### Perillas y valores por omisión

| Perilla | Valor por omisión | Justificación |
|---|---|---|
| `frameSampleSeconds` | 1 | Valor por omisión de la industria y de Gemini; menos de 1 s pierde avisos breves; `fps=0.5` no se probó con avisos de 1 s |
| `frameHashDistance` | 6 (dHash 64 bits) | Último valor sin pérdida de pantallas: D=6 conserva 18/128 y cubre 16/16; D=8 cubre 15/16 |
| `sceneThreshold` | desactivado (`null`); si se activa, 0,02 en grabaciones de pantalla | 0,02 cubre 16/16 pero falla con cámara en mano (2.452 fotogramas); 0,20 cubre 8/16 |
| `maxFrames` | 48 | 48 × 1.456 = 69.888 tokens, más transcripción (~5.000) e instrucciones (~10.000), bajo el escalón de 100.000 tokens de Haiku 5.5 |
| `frameWidth` | 720 px (JPEG calidad 4) | 1.456 tokens y 60 KB por fotograma medidos; legibilidad de texto pequeño: sin verificar con un modelo |
| `audioChunkSeconds` | 600 | 18,5 MB medidos con FLAC de pista de teléfono, bajo el tope de 25 MB |
| `audioChunkOverlapSeconds` | 5 | Debe ser menor que el trozo y mayor que una frase corta; 10 s es el mínimo facturable de Groq; el valor del tutorial de Groq no se leyó |
| `audioCodec` | `flac` | Lo recomienda la documentación de Groq; `opus32` queda como opción tras medir WER |
| `audioBudgetSecondsPerHour` | 7.200 | Límite del plan Developer de Groq; el equipo comparte la cifra |
| `maxVideoMinutes` | 20 | Alcance del producto (MASTER-SPEC §3 y §7.4: 1 a 20 minutos) |
| `maxVideoMegabytes` | 2.048 | 20 min × 100 MB/min medidos a 13,4 Mbps; coincide con el tope de 2 GB de la Files API gratuita de Gemini |
| `timestampFormat` | `mm:ss` | Formato que pide la documentación de Gemini |

## 9. Cambios que esto produce en el MASTER-SPEC

La fila «Video» de §3 y la de §7.4 dicen «fotogramas por cambio de escena (umbral y máximo de fotogramas: perillas con valor medido)». Con lo medido, el muestreo pasa a intervalo fijo más deduplicación por dHash, y el umbral de escena queda opcional y apagado. §7.4 debe agregar los trozos de audio con solapamiento y su regla de fusión, el presupuesto de audio por hora, la conversión previa de HEIC y el sondeo de formato en el navegador. El banco de §7.11 debe incluir Opus contra FLAC en español, marcas de tiempo contra sin marcas, legibilidad de texto a 540, 720 y 1080 px, una foto HEIC de iPhone y una grabación real de teléfono que reemplace las sintéticas de este informe.

Sin verificar al cierre: WER de Whisper en español con Opus; efecto de las marcas de tiempo en modelos de Anthropic; conversión de HEIC por iOS al subir con `accept="image/*"`; bitrate por omisión de Opus en `MediaRecorder` de Chrome; deriva de marcas de tiempo de Groq; intervalo de fotogramas clave de los teléfonos; latencia de Groq con audio en español.

## Fuentes

Todas consultadas el 2026-10-20 salvo que se indique otra fecha. Las cifras de `registry.npmjs.org` y `api.github.com` se leyeron por consulta directa.

| Fuente | URL | Fecha del contenido |
|---|---|---|
| Groq, Speech to Text | https://console.groq.com/docs/speech-to-text | vigente |
| Groq, Rate limits | https://console.groq.com/docs/rate-limits | vigente |
| nwos, latencia de Whisper | https://www.nwos.com/daily/whisper-transcription-api-vs-self-hosted-vs-groq | 2026-06-10 |
| Google, Video understanding | https://ai.google.dev/gemini-api/docs/video-understanding | vigente |
| Google, Image understanding | https://ai.google.dev/gemini-api/docs/image-understanding | vigente |
| Google, Pricing | https://ai.google.dev/gemini-api/docs/pricing | 2026-10-19 |
| Google, video agéntico | https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-agentic-video-in-gemini/ | 2026-09-01 |
| Anthropic, Vision | https://platform.claude.com/docs/en/build-with-claude/vision | vigente |
| DeepSeek, Vision | https://api-docs.deepseek.com/guides/vision | vigente |
| fluent-ffmpeg | https://github.com/fluent-ffmpeg/node-fluent-ffmpeg | archivado 2025-05-22 |
| ffmpeg-static | https://github.com/eugeneware/ffmpeg-static y https://registry.npmjs.org/ffmpeg-static | 5.3.0, 2025-11-14 |
| ffmpeg.wasm | https://registry.npmjs.org/@ffmpeg/ffmpeg | 0.12.15, 2025-01-07 |
| Registro npm de sharp, sharp-phash, imghash, blockhash-core | https://registry.npmjs.org/ | sharp 2026-09-27; imghash 2026-10-14; sharp-phash 2024-10-31; blockhash-core 2019-12-07 |
| sharp, instalación | https://sharp.pixelplumbing.com/install | vigente |
| WebKit, Safari 18.4 | https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ | 2025-03-31 |
| Issue de MediaRecorder en Safari | https://github.com/anirudhlath/alfred/issues/100 | 2026-07-18 a 2026-10-03 |
| MDN, `isTypeSupported` | https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static | vigente |
| MDN, atributo `capture` | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture | vigente |
| Chromium, `media_recorder.cc` | https://crrev.com/5bf98137c3126d2787a12a5881eb404fa5147e72/third_party/blink/renderer/modules/mediarecorder/media_recorder.cc | sin fecha |
| forasoft, muestreo de video | https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/video-vlms-frame-sampling-token-streaming-2026 | 2026-05-31 |
| Resumen de `claude-video` | https://instagit.com/bradautomates/claude-video/claude-video-scene-threshold-constant-usage.md | 2026-08-13 |
| Whisper y alucinaciones en no-voz | https://arxiv.org/pdf/2501.11378 | 2025-01 (más de 12 meses; PDF ilegible, dato por resumen) |
| Soniox, formatos de audio | https://soniox.com/wiki/audio-formats-speech-recognition | sin fecha |
| Marcas de tiempo en modelos de video | https://pith.science/paper/2411.18211 (TimeMarker, 2024-11); https://papers.neurips.cc/paper_files/paper/2025/file/5d2e24df9cfaad3189833b819c40b392-Paper-Conference.pdf (UniTime); https://en.papernotes.org/CVPR2026/multimodal_vlm/timelens_rethinking_video_temporal_grounding_with_multimodal_llms/ (TimeLens) | 2024 a 2026 |
| Investigación 01 de este repositorio, §3 | docs/investigaciones/01 - Motor de análisis y adjuntos.md | 2026-10-20 |
