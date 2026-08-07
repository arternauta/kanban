#!/usr/bin/env node
// Uso:
//   node scripts/process-notas.js fetch   → descarga notas pendientes a notas-pending.json
//   node scripts/process-notas.js push    → lee ideas.json y pushea todo a Firestore + Obsidian

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

const PROJECT_ID   = 'kanbarter-a2951';
const OBSIDIAN_DIR = '/Users/arterland/Library/Mobile Documents/iCloud~md~obsidian/Documents/CerebroV2/04_ARCHIVO/PAGINAS MATUTINAS';
const FIRESTORE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Firestore REST helpers ─────────────────────────────────────────────────

async function readDoc(path) {
  const res = await fetch(`${FIRESTORE}/${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function patchDoc(path, fieldsObj) {
  const res = await fetch(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fieldsObj })
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
}

function parseValue(v) {
  if (!v) return undefined;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue'     in v) {
    const obj = {};
    for (const [k, f] of Object.entries(v.mapValue.fields || {})) obj[k] = parseValue(f);
    return obj;
  }
  return undefined;
}

function toFirestoreValue(v) {
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { integerValue: String(v) };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v && typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// ── Obsidian helpers ───────────────────────────────────────────────────────

function safeFilename(nota) {
  const date = nota.createdAt
    ? new Date(nota.createdAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const title = nota.title
    ? nota.title.replace(/[/\\:*?"<>|]/g, '').slice(0, 50).trim()
    : 'pagina-matutina';
  const shortId = (nota.id || '').slice(-4);
  return `${date} ${title} ${shortId}.md`;
}

function toMarkdown(nota) {
  const date = nota.createdAt
    ? new Date(nota.createdAt).toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '';
  const lines = [];
  lines.push(nota.title ? `# ${nota.title}` : `# Página matutina — ${date}`);
  lines.push('');
  if (date) lines.push(`**Fecha:** ${date}  `);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(nota.text || '');
  return lines.join('\n');
}

// ── FETCH ──────────────────────────────────────────────────────────────────

async function cmdFetch() {
  const snap = await readDoc('kanban/notas');
  const raw  = snap?.fields?.data?.arrayValue?.values || [];
  const all  = raw.map(v => parseValue(v)).filter(Boolean);

  const pending = all.filter(n => !n.analyzed && !n.archivedNote);

  if (pending.length === 0) {
    console.log('No hay notas pendientes de analizar.');
    return;
  }

  const outPath = join(__dir, 'notas-pending.json');
  writeFileSync(outPath, JSON.stringify(pending, null, 2), 'utf8');
  console.log(`${pending.length} nota(s) guardadas en scripts/notas-pending.json`);
  console.log('\n── Notas pendientes ─────────────────────────────────────────\n');
  for (const n of pending) {
    const date = n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 10) : '?';
    console.log(`[${n.id.slice(-6)}] ${date} — ${n.title || '(sin título)'}`);
    console.log(n.text?.slice(0, 200) + (n.text?.length > 200 ? '…' : ''));
    console.log('');
  }
  console.log('─────────────────────────────────────────────────────────────');
  console.log('\nCreá scripts/ideas.json con este formato y corré: node scripts/process-notas.js push\n');
  console.log(JSON.stringify([{
    notaId: pending[0].id,
    ideas: [
      { text: 'Ejemplo de idea extraída', brand: 'personal' }
    ]
  }], null, 2));
}

// ── PUSH ───────────────────────────────────────────────────────────────────

async function cmdPush() {
  const ideasPath  = join(__dir, 'ideas.json');
  const notasPath  = join(__dir, 'notas-pending.json');

  if (!existsSync(ideasPath))  throw new Error('No encontré scripts/ideas.json');
  if (!existsSync(notasPath))  throw new Error('No encontré scripts/notas-pending.json — corré fetch primero');

  const ideasMap = JSON.parse(readFileSync(ideasPath, 'utf8')); // array de { notaId, ideas: [{text, brand}] }
  const pending  = JSON.parse(readFileSync(notasPath, 'utf8'));

  // Leer estado actual de semillas y notas en Firestore
  const [semillasSnap, notasSnap] = await Promise.all([
    readDoc('kanban/semillas'),
    readDoc('kanban/notas'),
  ]);

  const allSemillas = (semillasSnap?.fields?.data?.arrayValue?.values || []).map(v => parseValue(v)).filter(Boolean);
  const allNotas    = (notasSnap?.fields?.data?.arrayValue?.values    || []).map(v => parseValue(v)).filter(Boolean);

  // Crear nuevas semillas desde ideas
  const newSemillas = [];
  for (const entry of ideasMap) {
    for (const idea of entry.ideas || []) {
      newSemillas.push({
        id:           uid(),
        text:         idea.text,
        brand:        idea.brand || 'personal',
        createdAt:    new Date().toISOString(),
        sourceNotaId: entry.notaId,
      });
    }
  }

  const updatedSemillas = [...allSemillas, ...newSemillas];

  // Marcar notas procesadas como analyzed + obsidianExported
  const processedIds = new Set(ideasMap.map(e => e.notaId));
  const updatedNotas = allNotas.map(n =>
    processedIds.has(n.id) ? { ...n, analyzed: true, obsidianExported: true } : n
  );

  // Escribir Obsidian
  if (!existsSync(OBSIDIAN_DIR)) mkdirSync(OBSIDIAN_DIR, { recursive: true });
  let obsidianCount = 0;
  for (const nota of pending.filter(n => processedIds.has(n.id))) {
    const filepath = join(OBSIDIAN_DIR, safeFilename(nota));
    writeFileSync(filepath, toMarkdown(nota), 'utf8');
    console.log(`📝 Obsidian: ${safeFilename(nota)}`);
    obsidianCount++;
  }

  // Pushear a Firestore
  await Promise.all([
    patchDoc('kanban/semillas', { data: { arrayValue: { values: updatedSemillas.map(toFirestoreValue) } } }),
    patchDoc('kanban/notas',    { data: { arrayValue: { values: updatedNotas.map(toFirestoreValue)    } } }),
  ]);

  console.log(`\n✓ ${newSemillas.length} semilla(s) → columna semillas`);
  console.log(`✓ ${obsidianCount} nota(s) → Obsidian`);
  console.log(`✓ ${processedIds.size} nota(s) marcadas como analizadas`);
}

// ── Entry point ────────────────────────────────────────────────────────────

const cmd = process.argv[2];
if (cmd === 'fetch') {
  cmdFetch().catch(e => { console.error(e.message); process.exit(1); });
} else if (cmd === 'push') {
  cmdPush().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.log('Uso: node scripts/process-notas.js [fetch|push]');
  process.exit(1);
}
