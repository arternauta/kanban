const fs = require('fs');
const FILE = require('path').join(__dirname, '..', 'index.html');
let s = fs.readFileSync(FILE, 'utf8');
const must = (cond, msg) => { if (!cond) { console.error('FALLA:', msg); process.exit(1); } };
const rep = (str, from, to, label) => { must(str.includes(from), 'no encontré: ' + (label || from.slice(0, 60))); return str.replace(from, to); };

const ss = s.indexOf('<style>') + 7, se = s.indexOf('</style>');
let head = s.slice(0, ss), css = s.slice(ss, se), rest = s.slice(se);

// ── 1. tokens: valores nuevos (papel + tinta) y copia oscura para el visor ──
const m = css.match(/:root \{\n([\s\S]*?)\n\}\n/); must(m, 'root');
const oldVals = Object.fromEntries([...m[1].matchAll(/(--[\w-]+): (#[0-9a-fA-F]+);/g)].map(x => [x[1], x[2]]));

const LIGHT = {
  '--n-960':'#0a1028','--n-958':'#0c1330','--n-950':'#101836','--n-945':'#121a3a','--n-940':'#141d40',
  '--n-935':'#19234a','--n-930':'#1b254d','--n-920':'#202b57','--n-910':'#27345f','--n-900':'#2b3866',
  '--n-870':'#31406f','--n-850':'#364575','--n-800':'#3f4e80','--n-780':'#4a5a8e','--n-750':'#5a6a9c',
  '--n-650':'#7a7fa6','--n-600':'#8e90b2','--n-550':'#9a9bb9','--n-520':'#a4a6c0','--n-500':'#b0b2c8',
  '--n-400':'#c0c3d8','--n-200':'#e8e4d6','--n-150':'#efe9da','--n-100':'#f5efe0','--n-50':'#fbf6ea',
};
const lines = [];
for (const [k, v] of Object.entries(oldVals)) lines.push(`  ${k}: ${LIGHT[k] || v};`);
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.07'/></svg>")`;
const newRoot = `:root {
  /* identidad Arternauta */
  --paper: #f0e6d3;
  --navy: #1f2b57;
  --navy-900: #141c3d;
  --lavender: #7f7f9d;
  --coral: #e9978a;
  --coral-ink: #f0a99d;
  --ink: #f1ebdc;
  --lilac: #c8ccf3;
  --coral-rgb: 233 151 138;
  --lilac-rgb: 200 204 243;
  --ov: 214 216 240; /* lila claro para líneas y superposiciones */
  --font-body: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-display: 'Freudian', 'Montserrat', sans-serif;
  --star: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
  --grain: ${GRAIN};
  /* neutros y estados */
${lines.join('\n')}
}

@font-face { font-family: 'Freudian'; src: url('fonts/FreudianOne.woff') format('woff'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Freudian'; src: url('fonts/FreudianTwo.woff') format('woff'); font-weight: 700; font-display: swap; }
`;
css = css.replace(m[0], '@@ROOT@@');

// ── 2. fuentes ──
css = css.split("'IBM Plex Mono', monospace").join('var(--font-body)');
css = css.split("-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif").join('var(--font-body)');

// ── 3. texto sobre fichas de color: tinta fija, no depende del tema ──
css = css.replace(/color: var\(--n-960\)/g, 'color: var(--navy-900)');
// verde brillante como texto no se lee sobre papel
css = css.replace(/([;{\s])color: var\(--green-400\)/g, '$1color: var(--green-500)');

// ── 4. acento: coral en lugar de verde (el verde queda para "hecho") ──
css = rep(css, '.hbtn.on { color: var(--green-100); border-color: var(--green-500); background: var(--green-950); }', '');
css = rep(css, '.nav-item.active { color: var(--green-100); border-left-color: var(--green-500); background: rgba(29,158,117,0.06); }', '');
css = rep(css, '.compras-btn-add:hover { color: var(--green-100); border-color: var(--green-500); }', '.compras-btn-add:hover { color: var(--coral-ink); border-color: var(--coral); }');
css = rep(css, '.receta-add-btn:hover { color: var(--green-100); }', '.receta-add-btn:hover { color: var(--coral-ink); }');
css = rep(css, '.rfbtn.active { color: var(--green-100); border-color: #1D9E7540; background: var(--green-950); }', '.rfbtn.active { color: var(--navy); border-color: var(--coral); background: rgb(var(--coral-rgb) / 0.28); }');
css = rep(css, '.rp-link-btn:hover { background: rgba(255,255,255,0.12); color: var(--white); }', '.rp-link-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }');

// ── 5. superposiciones blancas -> tinta (solo fondos y bordes, no texto) ──
let nWhite = 0;
css = css.replace(/\b(background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?)(\s*:\s*)([^;{}]*)/g, (all, p, sep, val) => {
  const v2 = val.replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/g, (_, a) => { nWhite++; return `rgb(var(--ov) / ${a})`; });
  return p + sep + v2;
});
// sobre foto de portada deben seguir siendo blancas
css = css.replace(/(\.card-ref-link \{[^}]*)rgb\(var\(--ov\) \/ 0\.20\)/, '$1rgba(255,255,255,0.20)');
css = css.replace(/(\.card-ref-link:hover \{ background: )rgb\(var\(--ov\) \/ 0\.10\)/, '$1rgba(255,255,255,0.10)');
// el visor oscuro ya hereda --ov blanco, pero estas reglas son del overlay de pantalla completa
css = css.replace('.em-cover-badge {\n  position: absolute; bottom: 2px; left: 2px; font-size: 8px;\n  background: rgba(0,0,0,0.7); color: var(--green-100);', '.em-cover-badge {\n  position: absolute; bottom: 2px; left: 2px; font-size: 8px;\n  background: rgba(0,0,0,0.7); color: #9fe1cb;');

// ── 6. capa de personalidad ──
const LAYER = fs.readFileSync(process.argv[2] || require('path').join(__dirname, 'capa2.css'), 'utf8');
css = css.replace('@@ROOT@@', newRoot) + '\n' + LAYER + '\n';

// ── 7. HTML estático: tokens y superposiciones ──
const bodyStart = rest.indexOf('<script>'); must(bodyStart > 0, 'script');
let htmlPart = rest.slice(0, bodyStart), jsPart = rest.slice(bodyStart);
const inv = {}; for (const [k, v] of Object.entries(oldVals)) inv[v.toLowerCase()] = k;
let nHex = 0;
htmlPart = htmlPart.replace(/#[0-9a-fA-F]{3,6}\b/g, h => { const t = inv[h.toLowerCase()]; if (!t) return h; nHex++; return `var(${t})`; });
htmlPart = htmlPart.replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/g, (_, a) => `rgb(var(--ov) / ${a})`);
htmlPart = htmlPart.split("'IBM Plex Mono', monospace").join('var(--font-body)').split("'IBM Plex Mono',monospace").join('var(--font-body)');
// ojo: los #ids de selectores no existen en HTML estático; los atributos id="..." no empiezan con #

// ── 8. JS: solo dos líneas de interfaz (no se toca el exportador) ──
jsPart = rep(jsPart, `<span style="font-size:10px;color:#5f5e5a">`, `<span style="font-size:10px;color:var(--n-600)">`, 'fecha nota');
jsPart = rep(jsPart, `font-size:11px;color:#333331;padding:8px 10px">vacío`, `font-size:11px;color:var(--n-750);padding:8px 10px">vacío`, 'compras vacio');

// ── 9. cabecera: fuentes y color de tema ──
head = rep(head, 'content="#111110"', 'content="#141d40"', 'theme-color');
head = rep(head, 'family=Special+Elite&family=IBM+Plex+Mono:wght@400;500;600&display=swap', 'family=Montserrat:wght@300;400;500;600;700&display=swap', 'google fonts');

fs.writeFileSync(FILE, head + css + htmlPart + jsPart);
console.log('OK. rgba blanco→tinta en CSS:', nWhite, '| hex→token en HTML estático:', nHex);
