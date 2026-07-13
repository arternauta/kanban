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
