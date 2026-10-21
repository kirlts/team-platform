// The Dockerfile deletes packages that officeparser pulls in but the server never loads
// (docs/investigaciones/mediciones/2026-10-20-imagen-docker.md). These checks fail if the code
// starts to need one of them, so the image never ships without something that is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PRUNED = ['tesseract.js', 'pdfjs-dist', '@napi-rs/canvas'];

function sourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

test('no server module imports a package that the image prunes', () => {
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const pkg of PRUNED) {
      assert.ok(!text.includes(`'${pkg}`) && !text.includes(`"${pkg}`), `${file} imports ${pkg}, which the Dockerfile deletes`);
    }
  }
});

test('officeparser is never asked for OCR and never receives PDFs', () => {
  const core = readFileSync(join(root, 'src/extract/document-core.js'), 'utf8');
  assert.ok(!/\bocr\b/i.test(core), 'document-core.js enables OCR: tesseract.js is pruned from the image');
  // PDFs go to PDFium before any Office parsing.
  assert.ok(core.indexOf("format === 'pdf'") < core.indexOf("format === 'office'"));
});

test('the Dockerfile prune list names every package this guard protects', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  for (const pkg of ['tesseract.js', 'pdfjs-dist', '@napi-rs']) assert.ok(dockerfile.includes(pkg), `Dockerfile no longer prunes ${pkg}`);
});
