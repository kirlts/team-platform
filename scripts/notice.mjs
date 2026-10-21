#!/usr/bin/env node
// Generates NOTICE: every third-party binary or shared library in the image that is not an npm
// package (UD-020, MASTER-SPEC section 4.10). The committed file is copied into the image at
// /usr/share/licenses/NOTICE and src/static.test.js (HP-011) fails when it is stale.
//
//   node scripts/notice.mjs           writes NOTICE at the repository root
//   node scripts/notice.mjs --check   exits 1 when NOTICE differs from what would be generated
//
// Inputs: the pinned ARGs and the configure block of the `ffmpeg` stage of the Dockerfile, the
// `@img/sharp-libvips-*` version in package-lock.json, and the component table that package ships
// in node_modules (the image prunes its README, so the table is embedded here). Needs `npm ci`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Reads `ARG NAME=value` lines of the Dockerfile. */
export function dockerfileArgs(dockerfile) {
  const args = {};
  for (const m of dockerfile.matchAll(/^ARG ([A-Z0-9_]+)=(\S+)$/gm)) args[m[1]] = m[2];
  return args;
}

/** The flags of the `./configure` call between the configure-begin and configure-end markers. */
export function configureFlags(dockerfile) {
  const block = /# configure-begin\n([\s\S]*?)# configure-end/.exec(dockerfile)?.[1];
  if (!block) throw new Error('Dockerfile has no configure-begin / configure-end block');
  return block
    .replace(/\\\n/g, ' ')
    .split(/\s+/)
    .filter((t) => t.startsWith('--'));
}

function libvipsInfo(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const versions = new Set();
  for (const [location, p] of Object.entries(lock.packages)) {
    if (/^node_modules\/@img\/sharp-libvips-/.test(location)) versions.add(p.version);
  }
  if (versions.size !== 1) throw new Error(`@img/sharp-libvips-* versions in package-lock.json: ${[...versions].join(', ') || 'none'}`);
  const [packageVersion] = versions;
  const img = join(root, 'node_modules', '@img');
  const dir = readdirSync(img).find((d) => d.startsWith('sharp-libvips-'));
  if (!dir) throw new Error('node_modules/@img/sharp-libvips-* is missing: run npm ci first');
  const vips = JSON.parse(readFileSync(join(img, dir, 'versions.json'), 'utf8')).vips;
  const readme = readFileSync(join(img, dir, 'README.md'), 'utf8');
  const table = /(\| Library[\s\S]*?)\n\n/.exec(readme)?.[1] ?? '';
  if (!table) throw new Error('the component table of @img/sharp-libvips-* README.md was not found');
  return { packageVersion, vips, table };
}

export function buildNotice(root = ROOT) {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const a = dockerfileArgs(dockerfile);
  for (const k of ['FFMPEG_VERSION', 'FFMPEG_SHA256', 'DAV1D_VERSION', 'DAV1D_SHA256']) {
    if (!a[k]) throw new Error(`Dockerfile has no ARG ${k}`);
  }
  const flags = configureFlags(dockerfile).join(' ');
  const lv = libvipsInfo(root);
  const lines = `team-platform: third-party notices

team-platform is MIT licensed. Its code and every npm dependency it links are under permissive licences
(MIT, ISC, BSD, Apache-2.0, 0BSD, PSF-2.0, CC0); package-lock.json lists them. This file lists the binaries and
shared libraries of the image that are not npm packages. They are used as separate programs or loaded as
unmodified shared libraries, which the LGPL allows without extending its terms to team-platform (UD-020).
No GPL code is linked into team-platform or built into FFmpeg.

1. FFmpeg ${a.FFMPEG_VERSION}  (/usr/local/bin/ffmpeg and /usr/local/bin/ffprobe)

   Licence:   LGPL-2.1-or-later. Configured without --enable-gpl, --enable-nonfree and --enable-version3.
              Text: /usr/share/licenses/ffmpeg/ffmpeg-COPYING.LGPLv2.1
   Source:    https://ffmpeg.org/releases/ffmpeg-${a.FFMPEG_VERSION}.tar.xz
   SHA-256:   ${a.FFMPEG_SHA256}
   Signature: https://ffmpeg.org/releases/ffmpeg-${a.FFMPEG_VERSION}.tar.xz.asc, key FCF986EA15E6E293A5644F10B4322F04D67658D8
   Build:     unmodified source, built by the \`ffmpeg\` stage of the Dockerfile, which pins the version and the checksum.
              The binaries are static. To use a different FFmpeg, change FFMPEG_VERSION and FFMPEG_SHA256 in the Dockerfile
              (or patch the source in that stage) and run \`docker build\`.
   Configure: ${flags}
   It also contains statically linked:
     dav1d ${a.DAV1D_VERSION}, BSD-2-Clause. Text: /usr/share/licenses/ffmpeg/dav1d-COPYING
     Source: https://downloads.videolan.org/pub/videolan/dav1d/${a.DAV1D_VERSION}/dav1d-${a.DAV1D_VERSION}.tar.xz
     SHA-256: ${a.DAV1D_SHA256}

2. libvips ${lv.vips}, as shipped by @img/sharp-libvips-* ${lv.packageVersion}  (node_modules/@img/sharp-libvips-linuxmusl-*/lib)

   Licence: LGPL-3.0-or-later (https://www.gnu.org/licenses/lgpl-3.0.txt). Loaded by sharp as a shared library,
            unmodified; any other build of libvips ${lv.vips.split('.').slice(0, 2).join('.')} can replace it.
   Source:  https://github.com/libvips/libvips/releases/tag/v${lv.vips}
            https://github.com/lovell/sharp-libvips/releases/tag/v${lv.packageVersion} (build scripts and the exact sources of the bundled libraries)
   The package bundles these libraries, each under the licence in the table:

${lv.table
  .split('\n')
  .map((l) => `   ${l}`)
  .join('\n')}

3. Alpine packages added to the image

   libstdc++ and libgcc 15.2.0-r5 (Alpine 3.24 on 2026-10-20), needed by libvips. Licence declared by Alpine:
   GPL-2.0-or-later AND LGPL-2.1-or-later; the runtime library carries the GCC Runtime Library Exception.
   Source: https://gcc.gnu.org/ and https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.24-stable/main/gcc
   The rest of the base image (musl, busybox, apk) keeps its own licences; \`apk info -a <package>\` prints each one.
`;
  return lines;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = join(ROOT, 'NOTICE');
  const text = buildNotice();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current !== text) {
      console.error('NOTICE is stale: run `node scripts/notice.mjs`');
      process.exit(1);
    }
    console.log('NOTICE is up to date');
  } else {
    writeFileSync(path, text);
    console.log(`NOTICE written (${text.length} bytes)`);
  }
}
