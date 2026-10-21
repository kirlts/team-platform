// PROVISIONAL: relleno para probar que la imagen compila y responde /health.
// El núcleo real lo escribe otro agente. Este archivo se descarta al fusionar.
//
// Muestra el contrato que el empaquetado espera del núcleo:
//   DATA_DIR (volumen), DB_PATH, HOST y PORT por entorno;
//   un paso de inicialización único (WAL y versión) antes de levantar la API;
//   SIGTERM cierra el servidor y la base.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.DATA_DIR ?? './data';
const dbPath = process.env.DB_PATH ?? join(dataDir, 'team.db');
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

// Inicialización: fijar WAL sólo si no lo está (informe 03, medición M7).
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath, { timeout: 5000 });
if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal') {
  db.exec('PRAGMA journal_mode=WAL');
}
db.exec('PRAGMA synchronous=FULL');
db.exec('CREATE TABLE IF NOT EXISTS provisional_ping (at TEXT NOT NULL)');
db.prepare('INSERT INTO provisional_ping (at) VALUES (?)').run(new Date().toISOString());

const server = createServer((req, res) => {
  if (req.url === '/health') {
    const sqlite = db.prepare('SELECT sqlite_version() AS v').get().v;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', provisional: true, sqlite }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

function shutdown() {
  server.closeAllConnections();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(port, host, () => {
  console.log(`provisional: escuchando en ${host}:${port}, base ${dbPath}`);
});
