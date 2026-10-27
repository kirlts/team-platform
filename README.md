# team-platform

Bandeja de entrada para equipos de 3 a 10 personas. Cada miembro envía lo que tiene, como lo tiene: texto, capturas, video, audio, documentos o enlaces. La plataforma extrae el contenido de cada adjunto. Luego lo descompone en el mínimo conjunto de mensajes accionables. Cada mensaje queda en su área, con su plantilla, su destinatario y los adjuntos que lo contextualizan.

Quien envía revisa la propuesta y la confirma. Quien recibe responde, y cualquier miembro cierra el mensaje. Un modelo de lenguaje lee y propone; el sistema valida cada campo contra la base y decide. Corre en un contenedor con un volumen, sobre SQLite, y toda función del panel está disponible por una API REST con contrato OpenAPI 3.1.

## Tres niveles de uso

Cada nivel se prueba con un comando que sale 0 sólo si funciona. Los detalles de cada forma de instalar, el respaldo y la actualización están en [docs/INSTALACION.md](docs/INSTALACION.md).

### Nivel 1: instalar

Requiere Docker 25 o superior con el plugin `compose`.

```sh
git clone https://github.com/kirlts/team-platform /opt/team-platform
cd /opt/team-platform
scripts/install.sh
```

El instalador pide el correo del primer Editor y las llaves de proveedor, crea `.env` (modo 600) y levanta el servicio en `127.0.0.1:3000`. El inicio de sesión necesita HTTPS salvo en `localhost`; `docs/INSTALACION.md` describe tres formas de exponerlo: en un VPS con Caddy, dentro del compose de otro proyecto y detrás de `tailscale serve`.

Prueba:

```sh
curl -fsS http://127.0.0.1:3000/health
```

Responde `"status":"ok"`. La contraseña del primer Editor aparece una vez en el registro: `docker compose logs team-platform | grep 'First editor'`. Para llenar la bandeja con el juego de `ejemplos/`: «Sembrar ejemplos» en Configuración, sección Datos, o `scripts/sembrar.mjs --ejemplo`.

### Nivel 2: conectar un driver

Un mensaje asignado a un miembro agente lo trabaja una sesión desatendida de Claude Code en una máquina que el anfitrión pone. Esa máquina la crea un driver: cinco guiones que cumplen [docs/CONTRATO-DE-ANFITRION.md](docs/CONTRATO-DE-ANFITRION.md). El repositorio trae dos, `drivers/docker-local` (contenedores en la misma máquina) y `drivers/fly-machines` (máquinas bajo demanda de Fly); `drivers/README.md` explica cómo escribir otro.

La imagen lleva los drivers en `/app/drivers`. Los programas que un driver pide junto al trabajador (`bash` y `git` para Fly) los agrega `compose.driver.example.yml`:

```sh
COMPOSE_FILE=compose.yml:compose.driver.example.yml scripts/install.sh
```

Las líneas de `.env` que conectan cada driver están en `drivers/README.md` y en `drivers/fly-machines/README.md`. La sección «Un driver dentro del contenedor» de `docs/INSTALACION.md` da el recorrido completo.

Prueba del driver, sin instancia y sin llamar a Anthropic:

```sh
TMPDIR=$HOME/.cache node scripts/host-conformance.mjs --driver drivers/docker-local
```

Termina con `contract_version: 1 met`. Prueba de la instancia con el driver conectado, una sesión real de punta a punta (gasta unos centavos):

```sh
docker compose exec -T team-platform sh -c 'TEAM_URL="http://127.0.0.1:$PORT" TEAM_EMAIL="$ADMIN_EMAIL" TEAM_PASSWORD="$ADMIN_PASSWORD" CANARY_AREA=Canario CANARY_CREATE=1 CANARY_AGENT=agente@ejemplo.invalid node scripts/canary.mjs'
```

Sale 0 cuando el agente responde «OK» en el hilo; sale 3 y nombra el tramo donde se quedó si algo falla.

### Nivel 3: poner piel

El color, la tipografía y el radio del panel se cambian con una hoja de tokens, sin recompilar. La hoja va en el volumen de datos y `THEME_CSS` la nombra:

```sh
printf ':root[data-theme="light"], :root[data-theme="dark"] { --color-accent: #0a7d55; }\n:root { --radius-md: 4px; }\n' > tema.css
docker compose cp tema.css team-platform:/data/tema.css
echo 'THEME_CSS=/data/tema.css' >> .env
docker compose up -d --wait
```

Las variables que acepta están en `docs/MASTER-SPEC.md` §7.8, «Contrato del tema». Un sitio que quiere sus propias vistas, y no sólo sus colores, usa el paquete `packages/client` contra la API.

Prueba:

```sh
curl -fsS http://127.0.0.1:3000/theme.css | grep -- '--color-accent'
```

La hoja se lee en cada petición: editarla no exige reiniciar.

## Llaves de proveedor

Hay dos orígenes. Las variables de entorno nunca van en el repositorio y son el valor con que arranca una instalación nueva. El Editor también puede agregar, reemplazar, retirar y diagnosticar llaves en Configuración, sección Proveedores. Cada cambio se prueba antes de aplicarse y las llaves se guardan cifradas con AES-256-GCM. Ninguna ruta de la API devuelve una llave, sólo sus últimos 4 caracteres. La clave maestra se crea en el primer arranque (`<DATA_DIR>/secrets.key`, modo 600) o viene de `SECRETS_KEY`. La rotación está en `scripts/rotate-secrets-key.mjs` y en [docs/INSTALACION.md](docs/INSTALACION.md).

Para guardar una llave en el equipo local, probada contra el proveedor y fuera del árbol (`~/.config/team-platform/env`, modo 600):

```sh
node scripts/llave.mjs                  # ANTHROPIC_API_KEY: texto, imágenes y PDF
node scripts/llave.mjs GROQ_API_KEY     # transcripción de audio y video
node scripts/llave.mjs DEEPSEEK_API_KEY # proveedor de respaldo, opcional
```

El script imprime dónde se crea cada llave, no muestra lo que se pega y no guarda nada si el proveedor la rechaza. Para usarlas en una terminal: `set -a; . ~/.config/team-platform/env; set +a`. Los nombres de todas las variables están en [.env.example](.env.example).

## Ramas

Dos ramas permanentes. Todo trabajo se fusiona a `desarrollo`. `main` es lo que sirve producción: sólo avanza al commit de `desarrollo` que el despliegue puso en producción, por avance rápido, y lo empuja el despliegue (el guion de despliegue del repositorio que despliega). Activar el gancho: `git config core.hooksPath .githooks`. El gancho `pre-push` rechaza cualquier otro empujón a `main`; `.github/workflows/main-solo-desde-desarrollo.yml` lo mide en el servidor y, si algo entra por otro camino, abre un issue con la etiqueta `alerta` y devuelve `main` al último commit válido. Prueba: `bash scripts/main-solo-desde-desarrollo.test.sh`.

## Pruebas y banco de referencia

Con Node 24.15 o superior:

```sh
npm ci
npm test                             # servidor: base SQLite efímera, sin red ni llaves
npm run test:bench                   # el banco con proveedores falsos
cd panel && npm ci && npm test       # panel: vitest, catálogos y guardia de lenguaje
npm --prefix panel run test:browser        # panel en navegador sin ventana, en paralelo con un solo build; BROWSER=firefox para Firefox
npm run contraste && npm run ui-detectors  # contraste de cada par de texto y detectores de interfaz
npm run e2e:contrato                 # contrato de punta a punta (e2e/contrato): servidor real, panel compilado y Chromium sin ventana en un proceso, filas E2, M, V y A
node bench/run.mjs --fake perfect    # reporte del banco sin red
node bench/run.mjs --repeat 3        # siete casos con el proveedor real, tres repeticiones
```

Cifras del 2026-10-21: 920 pruebas del servidor (7 omitidas), 74 del banco y 188 del panel. Los comandos de `panel` se corren desde `panel/`.

El banco mide si un input se descompone en los mensajes correctos y cuánto tarda. Reporta cobertura, repetición, mensajes de más, partidos y fusionados, exactitud de la clasificación, tiempo por paso, tokens y costo. Los casos y el puntaje están en [bench/README.md](bench/README.md). Para analizar un texto suelto: `node scripts/analizar.mjs "texto del input"`.

## Documentación

- [docs/MASTER-SPEC.md](docs/MASTER-SPEC.md): especificación completa, desde la arquitectura hasta cada módulo y sus dependencias.
- [docs/USER-DECISIONS.md](docs/USER-DECISIONS.md): decisiones del autor, con sus razones y alternativas descartadas.
- [docs/TEST.md](docs/TEST.md): estrategia de pruebas y las veintinueve prohibiciones que protegen las restricciones.
- [docs/INSTALACION.md](docs/INSTALACION.md): instalación, respaldo, restauración y segunda instancia.
- [docs/JUICIOS.md](docs/JUICIOS.md): jueces acotados que evalúan la interfaz con `scripts/juicios.mjs`. `scripts/ui-report.mjs` lee la telemetría de uso del panel.
- [docs/REPOMAP.md](docs/REPOMAP.md): qué directorio consultar para cada tarea.
- [docs/investigaciones/](docs/investigaciones/): informes con fuentes fechadas y mediciones.
- [docs/TODO.md](docs/TODO.md) y [docs/TECHNICAL-DEBT.md](docs/TECHNICAL-DEBT.md): qué falta.

Licencia MIT.
