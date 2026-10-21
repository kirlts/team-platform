# team-platform

Bandeja de entrada para equipos de 3 a 10 personas. Cada miembro envía lo que tiene, como lo tiene: texto, capturas, video, audio, documentos o enlaces. La plataforma extrae el contenido de cada adjunto. Luego lo descompone en el mínimo conjunto de mensajes accionables. Cada mensaje queda en su área, con su plantilla, su destinatario y los adjuntos que lo contextualizan.

Quien envía revisa la propuesta y la confirma. Quien recibe responde, y cualquier miembro cierra el mensaje. Un modelo de lenguaje lee y propone; el sistema valida cada campo contra la base y decide. Corre en un contenedor con un volumen, sobre SQLite, y toda función del panel está disponible por una API REST con contrato OpenAPI 3.1.

## Instalación

Requiere Docker 25 o superior con el plugin `compose`. Tres comandos:

```sh
git clone <URL-DEL-REPOSITORIO> /opt/team-platform
cd /opt/team-platform
scripts/install.sh
```

El instalador pide el correo del primer Editor y las llaves de proveedor, crea `.env` y levanta el servicio en `127.0.0.1:3000`. El inicio de sesión necesita HTTPS salvo en `localhost`. [docs/INSTALACION.md](docs/INSTALACION.md) describe tres formas de exponerlo: en un VPS con Caddy, dentro del compose de otro proyecto y detrás de `tailscale serve`. Ahí también están el respaldo y la actualización.

## Llaves de proveedor

Las llaves viven en variables de entorno y nunca en el repositorio ni en la base. Para guardar una en el equipo local, probada contra el proveedor y fuera del árbol (`~/.config/team-platform/env`, modo 600):

```sh
node scripts/llave.mjs                  # ANTHROPIC_API_KEY: texto, imágenes y PDF
node scripts/llave.mjs GROQ_API_KEY     # transcripción de audio y video
node scripts/llave.mjs DEEPSEEK_API_KEY # proveedor de respaldo, opcional
```

El script imprime dónde se crea cada llave, no muestra lo que se pega y no guarda nada si el proveedor la rechaza. Para usarlas en una terminal: `set -a; . ~/.config/team-platform/env; set +a`. Los nombres de todas las variables están en [.env.example](.env.example).

## Pruebas y banco de referencia

Con Node 24.15 o superior:

```sh
npm ci
npm test                             # servidor: base SQLite efímera, sin red ni llaves
npm run test:bench                   # el banco con proveedores falsos
node bench/run.mjs --fake perfect    # reporte del banco sin red
node bench/run.mjs --repeat 3        # siete casos con el proveedor real, tres repeticiones
```

El banco mide si un input se descompone en los mensajes correctos y cuánto tarda. Reporta cobertura, repetición, mensajes de más, partidos y fusionados, exactitud de la clasificación, tiempo por paso, tokens y costo. Los casos y el puntaje están en [bench/README.md](bench/README.md). Para analizar un texto suelto: `node scripts/analizar.mjs "texto del input"`.

## Documentación

- [docs/MASTER-SPEC.md](docs/MASTER-SPEC.md): especificación completa, desde la arquitectura hasta cada módulo y sus dependencias.
- [docs/USER-DECISIONS.md](docs/USER-DECISIONS.md): decisiones del autor, con sus razones y alternativas descartadas.
- [docs/TEST.md](docs/TEST.md): estrategia de pruebas y las veinte prohibiciones que protegen las restricciones.
- [docs/investigaciones/](docs/investigaciones/): informes con fuentes fechadas y mediciones.
- [docs/TODO.md](docs/TODO.md) y [docs/TECHNICAL-DEBT.md](docs/TECHNICAL-DEBT.md): qué falta.

Licencia MIT.
