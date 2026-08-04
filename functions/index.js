const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1' });

const TELEGRAM_TOKEN = defineSecret('TELEGRAM_TOKEN');
const TASKS_REF = db.collection('kanban').doc('tasks');

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function tgSend(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

exports.flush = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const data = body?.data;
    if (!Array.isArray(data)) { res.status(400).end(); return; }
    await TASKS_REF.set({ data });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

function matchMeta(html, prop) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

// Instagram (y otros sitios) devuelven el content de las meta tags con
// entidades HTML sin decodificar (ej. "Panam&#xe1;", "&quot;Ahora...&quot;").
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// El CDN de Instagram (scontent.cdninstagram.com) bloquea el hotlink directo
// desde otro origen — bajamos la imagen acá y la re-subimos a Storage, igual
// que las imágenes que sube el usuario a mano.
async function cacheImage(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').split(';')[0];
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = contentType.split('/')[1].split('+')[0].slice(0, 5) || 'jpg';
    const filename = `link-thumbs/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(filename);
    await file.save(buf, { contentType, public: true });
    return `https://storage.googleapis.com/${bucket.name}/${filename}`;
  } catch (e) {
    console.error('cacheImage error', e);
    return null;
  }
}

// Trae og:title / og:image del lado del servidor para links que no tienen
// oEmbed público (ej. Instagram) — evita el bloqueo de CORS del browser.
exports.linkPreview = onRequest({ cors: true }, async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') { res.status(400).json({ error: 'missing url' }); return; }
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        // UA de crawler de Facebook: Instagram le sirve las meta tags og:*
        // completas a este UA (es lo que usan las previews de WhatsApp/FB).
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
      }
    });
    const html = await resp.text();
    const title = decodeEntities(matchMeta(html, 'og:title') || (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '');
    const ogImage = matchMeta(html, 'og:image') || '';
    const image = ogImage ? (await cacheImage(ogImage)) || '' : '';
    res.status(200).json({ title, image });
  } catch (e) {
    console.error(e);
    res.status(200).json({ title: '', image: '' });
  }
});

exports.telegram = onRequest({ secrets: [TELEGRAM_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const message = req.body?.message;
  if (!message?.text) { res.status(200).end(); return; }

  const chatId = message.chat.id;
  const text   = message.text.trim();
  const token  = TELEGRAM_TOKEN.value();

  if (text.startsWith('/')) {
    await tgSend(token, chatId, '✏️ Mandame una idea o tarea y la agrego al kanban.');
    res.status(200).end(); return;
  }

  try {
    const snap  = await TASKS_REF.get();
    const tasks = snap.exists ? (snap.data().data || []) : [];

    tasks.unshift({
      id:        uid(),
      col:       'inbox',
      text,
      brand:     '',
      priority:  '',
      date:      '',
      assignee:  '',
      archived:  false,
      deleted:   false,
      timeLog:   [],
      timeSpent: 0,
      createdAt: new Date().toISOString(),
      source:    'telegram'
    });

    await TASKS_REF.set({ data: tasks });
    await tgSend(token, chatId, `✅ <b>${text}</b>\n\nAgregada a <i>Por hacer</i> en el kanban.`);
  } catch (e) {
    console.error(e);
    await tgSend(token, chatId, '❌ Hubo un error al guardar la tarea. Intentá de nuevo.');
  }

  res.status(200).end();
});
