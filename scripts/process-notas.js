#!/usr/bin/env node
// Uso:
//   node scripts/process-notas.js fetch   → descarga notas pendientes a notas-pending.json
//   node scripts/process-notas.js push    → lee ideas.json y pushea todo a Firestore + Obsidian

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dir = dirname(fileURLToPath(import.meta.url));

const PROJECT_ID   = 'kanbarter-a2951';
// homedir() en vez de hardcodear el usuario: este script corre en más de
// una compu (misma persona, distinto usuario de sistema en cada una).
const OBSIDIAN_DIR = join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/CerebroV2/04_ARCHIVO/PAGINAS MATUTINAS');
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

// ── Merge de notas partidas por el límite de Telegram ──────────────────────
// Cuando una nota dictada supera ~4096 caracteres, la app la manda como dos
// mensajes seguidos → dos notas separadas con createdAt casi idéntico. Se
// mergean acá (no en la Cloud Function) porque este es el único lugar donde
// se trabajan las notas; la función de Telegram queda simple.
const MERGE_WINDOW_MS = 2 * 60 * 1000; // 2 minutos entre mensajes consecutivos

function mergeSplitNotas(notas) {
  const sorted = [...notas].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const merged = [];
  for (const n of sorted) {
    const last = merged[merged.length - 1];
    const closeEnough = last && n.source === 'telegram' && last.source === 'telegram' &&
      (new Date(n.createdAt) - new Date(last.createdAt)) <= MERGE_WINDOW_MS;
    if (closeEnough) {
      last.text = `${last.text}\n\n${n.text}`;
      last.mergedIds.push(n.id);
    } else {
      merged.push({ ...n, mergedIds: [n.id] });
    }
  }
  return merged;
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

function toMarkdown(nota, summary) {
  const date = nota.createdAt
    ? new Date(nota.createdAt).toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '';
  const lines = [];
  lines.push(nota.title ? `# ${nota.title}` : `# Página matutina — ${date}`);
  lines.push('');
  if (date) lines.push(`**Fecha:** ${date}  `);
  if (summary) {
    lines.push('');
    lines.push(`**Resumen:** ${summary}`);
  }
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

  const rawPending = all.filter(n => !n.analyzed && !n.archivedNote);
  const pending = mergeSplitNotas(rawPending);

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
    const fused = n.mergedIds.length > 1 ? ` (fusionada de ${n.mergedIds.length} mensajes)` : '';
    console.log(`[${n.id.slice(-6)}] ${date} — ${n.title || '(sin título)'}${fused}`);
    console.log(n.text?.slice(0, 200) + (n.text?.length > 200 ? '…' : ''));
    console.log('');
  }
  console.log('─────────────────────────────────────────────────────────────');
  console.log('\nCreá scripts/ideas.json con este formato y corré: node scripts/process-notas.js push\n');
  console.log(JSON.stringify([{
    notaId: pending[0].id,
    summary: 'Resumen de 1-2 líneas de la nota',
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

  // pending viene ya fusionado (fetch): cada entrada trae mergedIds con los
  // ids originales de Firestore que representa (1 si no hubo split, 2+ si sí).
  const summaryByNotaId  = new Map(ideasMap.map(e => [e.notaId, e.summary || '']));
  const primaryIdsDone   = new Set(ideasMap.map(e => e.notaId));
  const allOriginalIdsDone = new Set();
  for (const entry of pending) {
    if (primaryIdsDone.has(entry.id)) {
      for (const oid of entry.mergedIds) allOriginalIdsDone.add(oid);
    }
  }

  // Marcar notas procesadas como analyzed + obsidianExported
  const updatedNotas = allNotas.map(n =>
    allOriginalIdsDone.has(n.id) ? { ...n, analyzed: true, obsidianExported: true } : n
  );

  // Escribir Obsidian (un archivo por entrada fusionada, no por nota original)
  if (!existsSync(OBSIDIAN_DIR)) mkdirSync(OBSIDIAN_DIR, { recursive: true });
  let obsidianCount = 0;
  for (const nota of pending.filter(n => primaryIdsDone.has(n.id))) {
    const filepath = join(OBSIDIAN_DIR, safeFilename(nota));
    writeFileSync(filepath, toMarkdown(nota, summaryByNotaId.get(nota.id)), 'utf8');
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
  console.log(`✓ ${allOriginalIdsDone.size} nota(s) marcadas como analizadas`);
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
