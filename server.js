// server.js — Ghost Remote Key Store v2
// Render deploy: Build=npm install | Start=node server.js
// Env vars: ADMIN_TOKEN (obrigatório), PORT (opcional)

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── variável de ambiente — define no Render dashboard ──────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'troca-isso-agora';

// ── banco em memória ───────────────────────────────────────────
const DB = [
  {
    key:       'GHOST-DEMO-0000-TEST',
    status:    'active',
    expiresAt: 9999999999999,
    hwid:      null,
    createdAt: Date.now(),
  },
];

// links dos APKs — troca pelas URLs reais
const APK_LINKS = {
  global: process.env.APK_GLOBAL || 'https://seu-storage.com/ghost-global.apk',
  ap:     process.env.APK_AP     || 'https://seu-storage.com/ghost-ap.apk',
};

// ── middlewares ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ────────────────────────────────────────────────────
function findKey(keyStr) {
  return DB.find(k => k.key.toUpperCase() === keyStr.trim().toUpperCase());
}

function isActive(record) {
  return record && record.status === 'active' && Date.now() <= record.expiresAt;
}

function generateKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `GHOST-${seg()}-${seg()}-${seg()}`;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.adminToken;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: 'não autorizado' });
  }
  next();
}

// ── POST /api/validate ─────────────────────────────────────────
app.post('/api/validate', (req, res) => {
  const { key, hwid } = req.body;

  if (!key || typeof key !== 'string')
    return res.status(400).json({ success: false, error: 'key ausente' });

  const record = findKey(key);

  if (!record)
    return res.json({ success: false, error: 'key inválida' });

  if (!isActive(record))
    return res.json({ success: false, error: 'key inativa ou expirada' });

  // bind de hwid na primeira validação
  if (record.hwid === null && hwid) {
    record.hwid = hwid;
  } else if (record.hwid && hwid && record.hwid !== hwid) {
    return res.json({ success: false, error: 'hwid não corresponde' });
  }

  return res.json({
    success:   true,
    status:    record.status,
    expiresAt: record.expiresAt,
  });
});

// --- ROTAS FALSAS PRA ENGANAR O REMOTE ANDROID ---

// 1. O app pede o device.php
app.all('/remote-android/device.php', (req, res) => {
    console.log("Bateu no device.php");
    res.json({ 
        success: true, 
        status: 'active', 
        message: 'OK',
        sessionToken: 'fake_token_123',
        key: req.body.key || 'GHOST-DEMO-0000-TEST',
        expiresAt: 9999999999999
    });
});

// 2. O app pede o sid_issue
app.all('/api/android/sid_issue', (req, res) => {
    console.log("Bateu no sid_issue");
    res.json({ 
        success: true, 
        sid: 'fake_sid_999',
        message: 'SID Gerado',
        expiresAt: 9999999999999
    });
});

// 3. O app pede o remote_blob (o injetor)
app.all('/remote_blob', (req, res) => {
    console.log("Bateu no remote_blob");
    res.send("{}"); 
});

// ── POST /api/download ─────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { key } = req.body;

  if (!key || typeof key !== 'string')
    return res.status(400).json({ success: false, error: 'key ausente' });

  const record = findKey(key);

  if (!isActive(record))
    return res.json({ success: false, error: 'key inválida ou expirada' });

  return res.json({ success: true, links: APK_LINKS });
});

// ── POST /api/generate (admin) ─────────────────────────────────
app.post('/api/generate', requireAdmin, (req, res) => {
  const { expiresInDays } = req.body;

  const days = parseInt(expiresInDays) || 30;
  const expiresAt = days > 0
    ? Date.now() + days * 24 * 60 * 60 * 1000
    : 9999999999999;

  let newKey;
  do { newKey = generateKey(); } while (findKey(newKey));

  const record = {
    key:       newKey,
    status:    'active',
    expiresAt,
    hwid:      null,
    createdAt: Date.now(),
  };
  DB.push(record);

  return res.json({ success: true, key: newKey, expiresAt });
});

// ── GET /api/admin/keys (admin) ────────────────────────────────
app.get('/api/admin/keys', requireAdmin, (_req, res) => {
  return res.json({ success: true, keys: DB });
});

// ── POST /api/admin/revoke (admin) ────────────────────────────
app.post('/api/admin/revoke', requireAdmin, (req, res) => {
  const { key } = req.body;
  const record = findKey(key);
  if (!record)
    return res.status(404).json({ success: false, error: 'key não encontrada' });

  record.status = 'revoked';
  return res.json({ success: true, message: `key ${key} revogada` });
});

// ── health check ───────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── SPA fallback ───────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ghost Remote Key Store v2 — porta ${PORT}`);
  console.log(`Admin token: ${ADMIN_TOKEN === 'troca-isso-agora' ? '⚠️  PADRÃO — defina ADMIN_TOKEN no Render' : '✅ configurado'}`);
});
