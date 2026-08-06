#!/usr/bin/env node
// Lee notas de Firestore y las escribe como .md en el vault de Obsidian.
// Uso: node scripts/import-to-obsidian.js [--all]
//   --all  exporta todas (por defecto solo las no exportadas)

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ID   = 'kanbarter-a2951';
const OBSIDIAN_DIR = '/Users/arterland/Library/Mobile Documents/iCloud~md~obsidian/Documents/CerebroV2/04_ARCHIVO/PAGINAS MATUTINAS';
const FIRESTORE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const exportAll = process.argv.includes('--all');

async function readDoc(path) {
  const res = await fetch(`${FIRESTORE}/${path}`);
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
  return res.json();
}

async function writeDoc(path, data) {
  // Usa la REST API para hacer patch del documento
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string')  fields[k] = { stringValue: v };
    if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const res = await fetch(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${res.status}: ${await res.text()}`);
}

function parseValue(v) {
  if (!v) return undefined;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue'     in v) {
    const obj = {};
    for (const [k, f] of Object.entries(v.mapValue.fields || {})) obj[k] = parseValue(f);
    return obj;
  }
  return undefined;
}

function toMarkdown(nota) {
  const date = nota.createdAt
    ? new Date(nota.createdAt).toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '';
  const lines = [];
  if (nota.title) {
    lines.push(`# ${nota.title}`);
  } else {
    lines.push(`# Página matutina — ${date}`);
  }
  lines.push('');
  if (nota.brand && nota.brand !== 'personal') lines.push(`**Marca:** ${nota.brand.toUpperCase()}  `);
  if (date) lines.push(`**Fecha:** ${date}  `);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(nota.text || '');
  return lines.join('\n');
}

function safeFilename(nota) {
  const date = nota.createdAt
    ? new Date(nota.createdAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const title = nota.title
    ? nota.title.replace(/[/\\:*?"<>|]/g, '').slice(0, 50).trim()
    : `pagina-matutina`;
  const shortId = (nota.id || '').slice(-4);
  return `${date} ${title}${shortId ? ` ${shortId}` : ''}.md`;
}

async function main() {
  const snap = await readDoc('kanban/notas');
  const rawNotas = snap?.fields?.data?.arrayValue?.values || [];
  const notas = rawNotas.map(v => parseValue(v)).filter(Boolean);

  const toExport = exportAll
    ? notas
    : notas.filter(n => !n.obsidianExported);

  if (toExport.length === 0) {
    console.log('No hay notas nuevas para exportar.');
    return;
  }

  if (!existsSync(OBSIDIAN_DIR)) {
    mkdirSync(OBSIDIAN_DIR, { recursive: true });
    console.log('Carpeta creada:', OBSIDIAN_DIR);
  }

  let exported = 0;
  for (const nota of toExport) {
    const filename = safeFilename(nota);
    const filepath = join(OBSIDIAN_DIR, filename);
    writeFileSync(filepath, toMarkdown(nota), 'utf8');
    console.log('✓', filename);
    exported++;
  }

  // Marcar como exportadas en Firestore actualizando el doc completo
  if (!exportAll && exported > 0) {
    const updated = notas.map(n =>
      toExport.find(e => e.id === n.id) ? { ...n, obsidianExported: true } : n
    );
    // Actualizar el array completo via REST
    const values = updated.map(n => {
      const fields = {};
      for (const [k, v] of Object.entries(n)) {
        if (typeof v === 'string')  fields[k] = { stringValue: v };
        if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      }
      return { mapValue: { fields } };
    });
    const res = await fetch(`${FIRESTORE}/kanban/notas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { arrayValue: { values } } } })
    });
    if (!res.ok) console.warn('No se pudo marcar como exportadas:', res.status);
  }

  console.log(`\n${exported} nota(s) exportada(s) a Obsidian.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
