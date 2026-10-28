#!/usr/bin/env node
// Genera los tres bocetos estáticos de la ficha de mensaje (#109) con los tokens de cada dirección de PROPUESTA.md.
// No toca el panel: cada archivo lleva su CSS y referencia las dos fuentes empaquetadas del panel.
//   node generar.mjs
import { writeFileSync } from 'node:fs'

const FONTS = `
@font-face{font-family:'Orbitron';font-weight:400 900;src:url('../../../../panel/src/assets/fonts/orbitron-latin-wght-normal.woff2') format('woff2-variations')}
@font-face{font-family:'Source Sans 3';font-weight:200 900;src:url('../../../../panel/src/assets/fonts/source-sans-3-latin-wght-normal.woff2') format('woff2-variations')}`

const BASE = `
*{box-sizing:border-box;margin:0}
html{font-size:15px}
body{font-family:'Source Sans 3','Segoe UI',Arial,sans-serif;color:var(--fg);line-height:1.45;min-height:100vh;overflow-x:hidden}
button{font:inherit;color:inherit}
.app{display:grid;grid-template-columns:256px 1fr;grid-template-rows:56px 1fr;height:100vh}
.top{grid-column:1/3;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 20px;position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:10px;font-family:'Orbitron',sans-serif;font-weight:600;font-size:15px;letter-spacing:.1em}
.orb{width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 32% 26%,#fff 0 11%,transparent 34%),radial-gradient(circle at 50% 120%,var(--aqua),transparent 62%),linear-gradient(160deg,var(--gel1),var(--gel2));box-shadow:inset 0 -2px 3px rgb(0 0 40/.35),0 1px 2px rgb(0 0 60/.4)}
.status{display:flex;gap:6px;align-items:center}
.led{display:inline-block;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0 14%,transparent 40%),var(--c);box-shadow:0 0 0 1px rgb(0 0 0/.35),0 0 7px 1px var(--c)}
[data-t=red]{--c:var(--led-red)}[data-t=amber]{--c:var(--led-amber)}[data-t=blue]{--c:var(--led-blue)}
.side{padding:12px 8px;overflow:hidden;display:flex;flex-direction:column;gap:2px;font-size:15px}
.me{display:flex;gap:10px;align-items:center;padding:4px 8px 10px}
.av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;background:radial-gradient(circle at 32% 26%,rgb(255 255 255/.9) 0 10%,transparent 32%),linear-gradient(160deg,var(--gel1),var(--gel2));flex:none}
.me b{display:block;font-weight:600;line-height:1.1}.me small{font-size:12px;letter-spacing:.08em;font-weight:700;color:var(--muted)}
.nav{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:4px;color:var(--fg)}
.nav.sub{margin-left:18px;padding:6px 10px;font-size:14px}
.sw{width:9px;height:9px;border-radius:2px;background:var(--a);flex:none}
.cnt{margin-left:auto;font-size:12px;font-weight:700;color:var(--led-red-ink)}
.nav .ico{width:16px;height:16px;border:1.5px solid currentColor;border-radius:3px;flex:none;opacity:.8}
main{padding:20px 28px 0 28px;overflow:hidden;display:flex;flex-direction:column;gap:14px;min-width:0}
.back{font-size:12px;color:var(--muted)}
h1{font-size:23px;line-height:1.28;font-weight:700;letter-spacing:.005em;max-width:62rem}
h1 .num{font-weight:400;color:var(--muted);margin-right:8px;font-size:15px}
.cols{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:20px;min-height:0;flex:1}
.col{display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0}
.metaline{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;font-size:13px;color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px;border-radius:3px;font-size:12px;font-weight:700;background:var(--a);color:#fff}
.state{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:13px;color:var(--fg)}
.who{display:inline-flex;align-items:center;gap:6px}.who .av{width:20px;height:20px;font-size:9px}
.shot{height:196px;display:grid;place-items:center;background:var(--shot-bg);border:1px solid var(--line);position:relative}
.shot i{display:block;width:300px;height:170px;background:#e9edf4;border-top:16px solid #2f4468;position:relative}
.shot i:before{content:'';position:absolute;inset:10px;background:linear-gradient(90deg,#cfd6e3 0 32%,transparent 32% 36%,#d6dce8 36%)}
.thumbs{display:flex;gap:8px}.thumbs span{width:46px;height:40px;border:1px solid var(--line);background:var(--shot-bg);border-radius:3px}
.thumbs span:first-child{outline:2px solid var(--accent);outline-offset:1px}
.txt{font-size:17px;line-height:1.6}
.lab{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.actions{margin-left:auto;display:flex;gap:6px}
.btn{height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--edge);background:var(--btn2);font-weight:600;font-size:14px}
.btn.pri{background:linear-gradient(180deg,rgb(255 255 255/.16),transparent 50%),linear-gradient(180deg,var(--gel1),var(--gel2));color:#fff;border-color:var(--gel-edge);box-shadow:var(--sh-gel)}
.thread{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden}
.post{display:block}
.post-author{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}
.post-author small{font-weight:400;color:var(--muted);font-size:12px}
.post-body{font-size:15px}
.file{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--muted);margin-top:8px}.file i{width:34px;height:34px;border:1px solid var(--line);background:var(--shot-bg);border-radius:3px}
.reply{margin-top:auto;padding:0 0 18px;display:flex;flex-direction:column;gap:8px}
.reply .field{height:64px;padding:8px 12px;font-size:15px;color:var(--faint);background:var(--field);border:1px solid var(--edge);box-shadow:var(--sh-well)}
.reply .row{display:flex;justify-content:flex-end;gap:10px;align-items:center}
`

const nav = (cls, label, extra = '') => `<div class="nav ${cls}">${extra}${label}</div>`
const AREAS = [['Idea', '#7c3aed', 2], ['Error', '#92501a', 2], ['Nueva funcionalidad', '#15803d', 0], ['Retroalimentación', '#0f766e', 0], ['Pregunta', '#a21caf', 2]]

function markup({ winTitles = true } = {}) {
  const win = (title, body, cls = '') => `<section class="win ${cls}">${winTitles ? `<div class="win-title"><span>${title}</span></div>` : ''}<div class="win-body">${body}</div></section>`
  return `<div class="app">
<header class="top chrome"><div class="brand"><i class="orb"></i><span>DESARROLLO TEAM</span></div>
<div class="status"><span class="cell" data-t="red"><i class="led"></i><b>4</b><em>Abiertos</em></span><span class="cell" data-t="amber"><i class="led"></i><b>5</b><em>Respondidos</em></span><span class="cell" data-t="blue"><i class="led"></i><b>0</b><em>Cerrados</em></span><span class="bellwrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5zM10 20h4"/></svg></span></div></header>
<nav class="side panel">
<div class="me"><span class="av">AP</span><div><b>Ana Prueba</b><small>EDITOR</small></div></div>
${nav('', 'Inicio', '<i class="ico"></i>')}${nav('on', 'Mensajes', '<i class="ico"></i>')}${nav('', 'Áreas', '<i class="ico"></i>')}
${AREAS.map(([n, c, k]) => `<div class="nav sub" style="--a:${c}"><i class="sw"></i>${n}${k ? `<span class="cnt">▲ ${k}</span>` : ''}</div>`).join('')}
${nav('', 'Equipo', '<i class="ico"></i>')}${nav('', 'Conexiones', '<i class="ico"></i>')}
</nav>
<main>
<div class="back">← Mensajes</div>
<h1><span class="num">#109</span>Revisar la lectura del panel en teléfonos pequeños con el tamaño de letra del sistema al máximo y el tema oscuro activado</h1>
<div class="cols">
<div class="col">
${win('Mensaje', `<div class="metaline"><span class="chip" style="--a:#15803d">Accesibilidad y experiencia de uso en dispositivos móviles</span><span class="state" data-t="amber"><i class="led"></i>Respondido</span><span class="who"><span class="av">C</span>Carla Prueba</span><span>hoy 20:00</span><span>para <span class="who"><span class="av">A</span>Ana Prueba</span> <span class="who"><span class="av">B</span>Bruno Prueba</span> y 4 más</span><span class="actions"><button class="btn">Reenviar</button><button class="btn">Borrar</button></span></div>`, 'meta')}
${win('Adjuntos · 5', `<div class="shot"><i></i></div><div class="thumbs" style="margin-top:10px"><span></span><span></span><span></span><span></span><span></span></div>`, 'att')}
${win('Texto', `<p class="txt">En un teléfono de 360 píxeles de ancho con la letra del sistema al máximo, varias filas se desbordan. Adjunto una captura, la grabación, una nota de voz, el documento con el detalle y el caso en GitHub.</p><p class="lab" style="margin-top:10px">Resumen</p><p>La fila de mensajes se desborda con la letra del sistema al máximo.</p>`, 'body')}
</div>
<div class="col">
${win('Respuestas · 2', `<div class="thread">
<article class="post"><div class="post-author"><span class="av">MD</span><div>María de los Ángeles Fernández-Larraín<br><small>hoy 20:04 · Documentación</small></div></div><div class="post-body">Cuando dices tamaño máximo, ¿hablas del ajuste de accesibilidad de Android o del zoom del navegador? Cambia dónde se arregla.<div class="file"><i></i>nota-de-voz.wav · 47 KB</div></div></article>
<article class="post alt"><div class="post-author"><span class="av">AP</span><div>Ana Prueba<br><small>hoy 20:07 · Editor</small></div></div><div class="post-body">Del ajuste de Android. Dejo la grabación del caso.</div></article>
</div>
<div class="reply"><div class="field">Texto</div><div class="row"><button class="btn">Cerrar mensaje</button><button class="btn pri">Responder</button></div></div>`, 'replies')}
</div>
</div>
</main>
</div>`
}

const page = (title, css, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${FONTS}${BASE}${css}</style></head><body>${body}<script>const t=new URLSearchParams(location.search).get('tema');if(t)document.documentElement.dataset.theme=t</script></body></html>`

// ---------------------------------------------------------------------------------------------------------------------
// A. Centralita: consola de operador. Ventanas con barra de título, panel LCD de estado, luces LED.
const A = `
:root{--fg:oklch(.25 .05 265);--muted:oklch(.45 .04 260);--faint:oklch(.5 .03 255);--accent:oklch(.5 .2 250);--aqua:oklch(.78 .13 205);--gel1:oklch(.46 .2 248);--gel2:oklch(.36 .18 256);--gel-edge:oklch(.3 .1 255/.55);
--edge:oklch(.52 .07 252);--line:oklch(.78 .03 250);--field:oklch(.995 .004 240);--shot-bg:oklch(.96 .01 240);--btn2:linear-gradient(180deg,#fff,oklch(.94 .015 245));
--led-red:oklch(.62 .24 25);--led-amber:oklch(.82 .17 85);--led-blue:oklch(.6 .2 250);--led-red-ink:oklch(.45 .19 25);
--sh-gel:inset 0 1px 0 rgb(255 255 255/.5),0 1px 2px rgb(0 0 60/.4);--sh-well:inset 0 2px 3px rgb(0 20 60/.18);
--page-a:oklch(.93 .022 245);--page-b:oklch(.87 .035 250);--panel:oklch(.985 .006 240);--panel-edge:oklch(.52 .06 252);
--tb1:oklch(.44 .15 250);--tb2:oklch(.30 .15 255);--tb-ink:#fff;--rowb:oklch(.955 .014 245);
--lcd-bg:oklch(.24 .045 255);--lcd-edge:oklch(.14 .04 255);--lcd-g:oklch(.88 .17 150);--lcd-a:oklch(.86 .15 85);--lcd-b:oklch(.8 .12 235);--lcd-label:oklch(.72 .05 250)}
:root[data-theme=dark]{--fg:oklch(.95 .015 245);--muted:oklch(.77 .03 250);--faint:oklch(.7 .03 252);--accent:oklch(.76 .15 240);--gel1:oklch(.8 .14 235);--gel2:oklch(.66 .18 245);--gel-edge:oklch(.85 .1 240/.6);
--edge:oklch(.64 .08 255);--line:oklch(.4 .05 255);--field:oklch(.2 .04 258);--shot-bg:oklch(.27 .035 255);--btn2:linear-gradient(180deg,oklch(.34 .05 258),oklch(.27 .05 258));
--led-red:oklch(.7 .21 25);--led-amber:oklch(.85 .16 85);--led-blue:oklch(.72 .16 240);--led-red-ink:oklch(.78 .15 25);--sh-well:inset 0 2px 3px rgb(0 0 0/.5);
--page-a:oklch(.2 .05 255);--page-b:oklch(.15 .04 262);--panel:oklch(.23 .04 257);--panel-edge:oklch(.5 .07 255);--tb1:oklch(.40 .13 250);--tb2:oklch(.26 .10 255);--rowb:oklch(.26 .04 257);
--lcd-bg:oklch(.14 .03 255);--lcd-edge:oklch(.08 .02 255)}
body{background:linear-gradient(180deg,var(--page-a),var(--page-b));background-attachment:fixed;position:relative}
body:before{content:'';position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgb(255 255 255/.18) 0 1px,transparent 1px 4px);opacity:.35}
:root[data-theme=dark] body:before{background:repeating-linear-gradient(180deg,rgb(255 255 255/.04) 0 1px,transparent 1px 4px);opacity:1}
.chrome{background:linear-gradient(180deg,oklch(.995 .004 240) 0,oklch(.92 .018 245) 48%,oklch(.82 .028 250) 52%,oklch(.93 .014 245) 100%);border-bottom:1px solid oklch(.45 .06 255);box-shadow:0 8px 20px -12px oklch(.35 .14 255/.5)}
:root[data-theme=dark] .chrome{background:linear-gradient(180deg,oklch(.42 .03 255) 0,oklch(.3 .03 255) 48%,oklch(.2 .03 258) 52%,oklch(.27 .03 255) 100%);border-bottom-color:oklch(.5 .06 255)}
.status{padding:4px;background:var(--lcd-bg);border:1px solid var(--lcd-edge);border-radius:4px;box-shadow:inset 0 2px 4px rgb(0 0 0/.6),0 1px 0 rgb(255 255 255/.7);gap:2px}
.cell{display:flex;align-items:center;gap:8px;padding:2px 12px 2px 10px;height:40px;position:relative;background:repeating-linear-gradient(180deg,rgb(255 255 255/.05) 0 1px,transparent 1px 3px)}
.cell+.cell{border-left:1px solid rgb(255 255 255/.12)}
.cell b{font-weight:700;font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:.02em;line-height:1;min-width:1.1ch;text-shadow:0 0 8px currentColor}
.cell[data-t=red] b{color:var(--lcd-g)}.cell[data-t=amber] b{color:var(--lcd-a)}.cell[data-t=blue] b{color:var(--lcd-b)}
.cell[data-t=red] b{color:oklch(.8 .19 28)}
.cell em{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--lcd-label);writing-mode:horizontal-tb}
.bellwrap{margin-left:6px;color:var(--lcd-label);display:grid;place-items:center;width:34px}
.side{margin:12px 0 12px 12px;border:1px solid var(--panel-edge);background:var(--panel);box-shadow:0 1px 0 #fff inset,0 6px 16px -10px oklch(.3 .12 255/.6);padding:0 0 8px;border-radius:3px 10px 3px 10px;overflow:hidden}
.side:before{content:'Navegación';display:block;margin-bottom:6px;padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tb-ink);background:linear-gradient(180deg,rgb(255 255 255/.22) 0 50%,transparent 50%),linear-gradient(180deg,var(--tb1),var(--tb2));border-bottom:1px solid oklch(.3 .1 255)}
.nav.on{background:linear-gradient(180deg,rgb(255 255 255/.18),transparent 50%),linear-gradient(180deg,oklch(.44 .2 250),oklch(.34 .18 256));color:#fff;font-weight:600;box-shadow:inset 0 1px 0 rgb(255 255 255/.4)}
:root[data-theme=dark] .nav.on{color:oklch(.16 .04 260);background:linear-gradient(180deg,rgb(255 255 255/.18),transparent 50%),linear-gradient(180deg,var(--gel1),var(--gel2))}
.win{border:1px solid var(--panel-edge);background:var(--panel);border-radius:3px 10px 3px 10px;box-shadow:inset 0 1px 0 rgb(255 255 255/.7),0 6px 16px -10px oklch(.3 .12 255/.55);overflow:hidden;display:flex;flex-direction:column;min-height:0}
.win-title{display:flex;align-items:center;gap:8px;padding:0 12px;height:26px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tb-ink);background:linear-gradient(180deg,rgb(255 255 255/.22) 0 50%,transparent 50%),linear-gradient(180deg,var(--tb1),var(--tb2));border-bottom:1px solid oklch(.3 .1 255)}
:root[data-theme=dark] .win-title{color:oklch(.97 .01 245);background:linear-gradient(180deg,rgb(255 255 255/.18) 0 50%,transparent 50%),linear-gradient(180deg,var(--tb1),var(--tb2))}
.win-title:before{content:'';width:8px;height:8px;border-radius:50%;background:var(--lcd-g);box-shadow:0 0 6px var(--lcd-g)}
.win-body{padding:12px 14px;min-height:0}
.thread{gap:0}.post{padding:10px 0;border-top:1px solid var(--line)}.post:first-child{border-top:0;padding-top:0}
.post.alt{background:var(--rowb);margin:0 -14px;padding:10px 14px}
.replies .win-body{display:flex;flex-direction:column;min-height:0;flex:1}
.reply .field{border-radius:3px}
`

// ---------------------------------------------------------------------------------------------------------------------
// B. Foro 2003: estructura de subSilver: barras de categoría, celdas en rejilla de 1 px, filas alternas, mensaje como entrada de foro.
const B = `
:root{--fg:oklch(.24 .03 250);--muted:oklch(.44 .03 250);--faint:oklch(.5 .02 250);--accent:oklch(.42 .12 240);--aqua:oklch(.78 .1 215);--gel1:oklch(.5 .13 240);--gel2:oklch(.4 .11 245);--gel-edge:oklch(.3 .08 245);
--edge:oklch(.52 .04 245);--line:oklch(.8 .01 240);--field:#fff;--shot-bg:oklch(.95 .005 240);--btn2:linear-gradient(180deg,#fff,oklch(.92 .008 240));
--led-red:oklch(.58 .22 27);--led-amber:oklch(.8 .16 85);--led-blue:oklch(.55 .17 245);--led-red-ink:oklch(.45 .19 25);
--sh-gel:inset 0 1px 0 rgb(255 255 255/.4);--sh-well:inset 1px 1px 0 oklch(.7 .01 240);
--page:oklch(.93 .008 240);--cell-1:oklch(.965 0 0);--cell-2:oklch(.925 .01 240);--cat:oklch(.86 .014 235);--cat-ink:oklch(.36 .1 245);--th:oklch(.46 .1 235);--th-ink:#fff;--grid:oklch(.7 .02 240);--bevel-hi:#fff;--bevel-lo:oklch(.6 .02 240)}
:root[data-theme=dark]{--fg:oklch(.93 .01 245);--muted:oklch(.75 .02 248);--faint:oklch(.68 .02 250);--accent:oklch(.78 .12 235);--gel1:oklch(.78 .12 235);--gel2:oklch(.66 .14 240);--gel-edge:oklch(.85 .08 238/.6);
--edge:oklch(.62 .05 250);--line:oklch(.36 .02 250);--field:oklch(.19 .02 255);--shot-bg:oklch(.27 .02 252);--btn2:linear-gradient(180deg,oklch(.33 .03 255),oklch(.26 .03 255));
--led-red:oklch(.7 .2 27);--led-amber:oklch(.84 .15 85);--led-blue:oklch(.72 .15 240);--led-red-ink:oklch(.78 .14 25);--sh-well:inset 1px 1px 0 oklch(.1 .02 255);
--page:oklch(.17 .015 255);--cell-1:oklch(.23 .015 255);--cell-2:oklch(.205 .02 255);--cat:oklch(.3 .04 250);--cat-ink:oklch(.88 .06 235);--th:oklch(.38 .09 240);--grid:oklch(.1 .01 255);--bevel-hi:oklch(.42 .03 250);--bevel-lo:oklch(.08 .01 255)}
body{background:var(--page)}
.chrome{background:linear-gradient(180deg,oklch(.5 .11 240),oklch(.34 .1 245));border-bottom:3px solid oklch(.78 .16 70);color:#fff}
:root[data-theme=dark] .chrome{background:linear-gradient(180deg,oklch(.34 .08 245),oklch(.24 .07 250));border-bottom-color:oklch(.75 .14 70)}
.status{gap:0;font-size:12px}
.cell{display:flex;align-items:center;gap:6px;padding:4px 12px;background:rgb(255 255 255/.12);border:1px solid rgb(255 255 255/.3);border-right-width:0;color:#fff;height:30px}
.cell:nth-child(3){border-right-width:1px}
.cell b{font-size:15px;font-weight:700}.cell em{font-style:normal;font-size:12px;opacity:.95}
.bellwrap{margin-left:10px;color:#fff;display:grid}
.side{margin:0;padding:0;background:var(--cell-1);border-right:1px solid var(--grid)}
.side:before{content:'Navegación';display:block;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--th-ink);background:var(--th);border-bottom:1px solid var(--grid)}
.me{border-bottom:1px solid var(--grid);background:var(--cell-2);padding:10px 12px}
.nav{border-radius:0;border-bottom:1px solid var(--line);padding:7px 12px}
.nav.sub{margin-left:0;padding-left:28px}
.nav:nth-of-type(even){background:var(--cell-2)}
.nav.on{background:var(--cat);color:var(--cat-ink);font-weight:700;box-shadow:inset 4px 0 0 var(--accent)}
.av,.orb{box-shadow:none}
.chip{border-radius:0}
main{background:var(--page)}
.win{border:1px solid var(--grid);background:var(--grid);display:flex;flex-direction:column;gap:1px;box-shadow:0 1px 0 var(--bevel-hi) inset}
.win-title{padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--th-ink);background:var(--th)}
.win-body{padding:12px 14px;background:var(--cell-1)}
.win.meta .win-body{background:var(--cell-2)}
.btn{border-radius:2px;box-shadow:inset 1px 1px 0 var(--bevel-hi),inset -1px -1px 0 var(--bevel-lo)}
.btn.pri{border-radius:2px}
.thread{gap:1px;background:var(--grid);margin:-12px -14px}
.post{display:grid;grid-template-columns:104px 1fr;background:var(--cell-1)}
.post.alt{background:var(--cell-2)}
.post-author{flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;gap:4px;padding:10px 6px;background:var(--cat);font-size:12px;border-right:1px solid var(--grid)}
.post-author .av{width:32px;height:32px}
.post-author div{font-size:12px;line-height:1.25}.post-author small{display:block}
.post-body{padding:10px 12px;position:relative}
.replies .win-body{display:flex;flex-direction:column;flex:1;min-height:0}
.reply{padding-top:14px}
.reply .field{border-radius:0}
`

// ---------------------------------------------------------------------------------------------------------------------
// C. Aero telefónico: cielo y vidrio más brillantes, reflejo con horizonte en cada cabecera, esferas, curva de operadora.
const C = `
:root{--fg:oklch(.25 .05 265);--muted:oklch(.45 .04 260);--faint:oklch(.5 .03 255);--accent:oklch(.5 .2 250);--aqua:oklch(.8 .14 200);--gel1:oklch(.46 .2 248);--gel2:oklch(.36 .18 256);--gel-edge:oklch(.3 .1 255/.55);
--edge:oklch(.55 .07 250);--line:oklch(.82 .03 235);--field:#fff;--shot-bg:oklch(.96 .01 235);--btn2:linear-gradient(180deg,#fff,oklch(.93 .02 235));
--led-red:oklch(.62 .24 25);--led-amber:oklch(.84 .17 88);--led-blue:oklch(.62 .2 250);--led-red-ink:oklch(.45 .19 25);
--sh-gel:inset 0 1px 0 rgb(255 255 255/.55),0 1px 2px rgb(0 0 60/.4),0 6px 14px -6px oklch(.5 .2 245/.6);--sh-well:inset 0 2px 3px rgb(0 20 60/.16);
--sky-a:oklch(.9 .08 205);--sky-b:oklch(.93 .05 235);--sky-c:oklch(.96 .06 150);--glass:rgb(255 255 255/.62);--glass-edge:rgb(255 255 255/.9);--hd1:oklch(.75 .12 215);--hd2:oklch(.55 .17 245)}
:root[data-theme=dark]{--fg:oklch(.95 .015 245);--muted:oklch(.78 .03 250);--faint:oklch(.7 .03 252);--accent:oklch(.76 .15 240);--aqua:oklch(.78 .12 205);--gel1:oklch(.8 .14 235);--gel2:oklch(.66 .18 245);--gel-edge:oklch(.85 .1 240/.6);
--edge:oklch(.65 .08 255);--line:oklch(.42 .06 255);--field:oklch(.2 .045 258);--shot-bg:oklch(.27 .04 255);--btn2:linear-gradient(180deg,oklch(.36 .06 258),oklch(.28 .05 258));
--led-red:oklch(.7 .21 25);--led-amber:oklch(.86 .16 88);--led-blue:oklch(.72 .16 240);--led-red-ink:oklch(.78 .15 25);--sh-well:inset 0 2px 3px rgb(0 0 0/.5);
--sky-a:oklch(.22 .07 235);--sky-b:oklch(.16 .05 268);--sky-c:oklch(.2 .06 215);--glass:oklch(.3 .05 260/.62);--glass-edge:oklch(.7 .06 250/.5);--hd1:oklch(.5 .13 235);--hd2:oklch(.32 .1 255)}
body{background:radial-gradient(70rem 40rem at 0% -10%,oklch(.88 .12 200/.7),transparent 62%),radial-gradient(50rem 30rem at 100% 110%,oklch(.9 .1 145/.45),transparent 64%),linear-gradient(160deg,var(--sky-a),var(--sky-b) 55%,var(--sky-c));background-attachment:fixed}
:root[data-theme=dark] body{background:radial-gradient(70rem 40rem at 0% -10%,oklch(.4 .12 215/.6),transparent 62%),radial-gradient(50rem 30rem at 100% 110%,oklch(.35 .1 160/.35),transparent 64%),linear-gradient(160deg,var(--sky-a),var(--sky-b) 55%,var(--sky-c))}
.swoosh{position:fixed;left:0;right:0;top:0;height:56px;pointer-events:none;z-index:1;opacity:.9}
.top{z-index:3}.chrome{background:linear-gradient(180deg,rgb(255 255 255/.7) 0 50%,transparent 50%),linear-gradient(180deg,oklch(.82 .09 215),oklch(.6 .15 240));border-bottom:1px solid oklch(.4 .12 250);box-shadow:0 8px 24px -12px oklch(.35 .14 255/.55)}
:root[data-theme=dark] .chrome{background:linear-gradient(180deg,rgb(255 255 255/.16) 0 50%,transparent 50%),linear-gradient(180deg,oklch(.42 .1 235),oklch(.26 .08 255))}
.brand{text-shadow:0 1px 0 rgb(255 255 255/.7);color:oklch(.25 .08 255)}
:root[data-theme=dark] .brand{color:#fff;text-shadow:0 1px 2px rgb(0 0 0/.5)}
.orb{width:26px;height:26px}
.status{gap:6px}
.cell{display:flex;align-items:center;gap:7px;height:34px;padding:0 14px 0 11px;border-radius:999px;border:1px solid var(--edge);background:linear-gradient(180deg,rgb(255 255 255/.9) 0 50%,rgb(255 255 255/.55) 50%);box-shadow:inset 0 1px 0 #fff,0 1px 3px rgb(0 40 100/.25);color:var(--fg)}
:root[data-theme=dark] .cell{background:linear-gradient(180deg,rgb(255 255 255/.16) 0 50%,rgb(255 255 255/.05) 50%);box-shadow:inset 0 1px 0 rgb(255 255 255/.3)}
.cell b{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}.cell em{font-style:normal;font-size:12px;font-weight:700;color:var(--muted)}
.bellwrap{margin-left:4px;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:linear-gradient(180deg,#fff,oklch(.9 .03 235));border:1px solid var(--edge);color:var(--fg)}
:root[data-theme=dark] .bellwrap{background:linear-gradient(180deg,oklch(.4 .05 258),oklch(.28 .05 258))}
.side{margin:12px 0 12px 12px;background:var(--glass);border:1px solid var(--glass-edge);border-radius:6px 16px 6px 16px;box-shadow:inset 0 1px 0 #fff,0 12px 28px -14px oklch(.3 .14 255/.6);backdrop-filter:blur(14px) saturate(1.5);padding-top:8px;position:relative;z-index:2}
:root[data-theme=dark] .side{box-shadow:inset 0 1px 0 rgb(255 255 255/.2),0 12px 28px -14px #000}
.nav{border-radius:999px}
.nav.on{background:linear-gradient(180deg,rgb(255 255 255/.35) 0 50%,transparent 50%),linear-gradient(180deg,var(--hd1),var(--hd2));color:oklch(.2 .08 255);font-weight:600;box-shadow:inset 0 1px 0 rgb(255 255 255/.5),0 2px 6px -2px oklch(.4 .2 250/.6)}
:root[data-theme=dark] .nav.on{color:#fff;background:linear-gradient(180deg,rgb(255 255 255/.12) 0 50%,transparent 50%),linear-gradient(180deg,oklch(.40 .12 235),oklch(.28 .10 255))}
main{position:relative;z-index:2}
.win{background:var(--glass);border:1px solid var(--glass-edge);border-radius:6px 16px 6px 16px;box-shadow:inset 0 1px 0 #fff,0 12px 28px -14px oklch(.3 .14 255/.55);backdrop-filter:blur(14px) saturate(1.5);overflow:hidden;display:flex;flex-direction:column;min-height:0}
:root[data-theme=dark] .win{box-shadow:inset 0 1px 0 rgb(255 255 255/.2),0 12px 28px -14px #000}
.win-title{display:flex;align-items:center;gap:8px;height:28px;padding:0 14px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:oklch(.22 .08 255);background:linear-gradient(180deg,rgb(255 255 255/.75) 0 50%,transparent 50%),linear-gradient(180deg,oklch(.84 .08 215),oklch(.72 .12 235));border-bottom:1px solid oklch(.55 .1 245)}
:root[data-theme=dark] .win-title{color:#fff;background:linear-gradient(180deg,rgb(255 255 255/.16) 0 50%,transparent 50%),linear-gradient(180deg,oklch(.42 .1 235),oklch(.3 .09 255));border-bottom-color:oklch(.55 .08 250)}
.win-body{padding:12px 14px;min-height:0}
.thread{gap:0}.post{padding:10px 0;border-top:1px solid var(--line)}.post:first-child{border-top:0;padding-top:0}
.replies .win-body{display:flex;flex-direction:column;flex:1;min-height:0}
.reply .field{border-radius:6px}
.chip{border-radius:999px}
`

const SWOOSH = `<svg class="swoosh" viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true"><path d="M0 34C320 10 640 44 960 26C1180 14 1320 16 1440 6V0H0Z" fill="rgb(255 255 255/.22)"/><path d="M0 44C360 22 700 52 1020 36C1200 27 1340 30 1440 18" fill="none" stroke="rgb(255 255 255/.7)" stroke-width="1.5"/></svg>`

writeFileSync('a-centralita.html', page('Boceto A: Centralita', A, markup()))
writeFileSync('b-foro.html', page('Boceto B: Foro', B, markup()))
writeFileSync('c-aero.html', page('Boceto C: Aero telefónico', C, SWOOSH + markup()))
console.log('3 bocetos escritos')
