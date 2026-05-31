require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const formidable = require('formidable');
const PDFDocument = require('pdfkit');
const { sendCodeEmail } = require('./mailer.js');
const { analyzeAntiplagiarism } = require('../core/antiplagiarism.js');
const { llmChat } = require('../llm/llm.js');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const AVATAR_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
const PORT = Number(process.env.WEB_PORT || process.env.PORT || 3000);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function now() {
  return Date.now();
}

function id() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanText(value, maxLength = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function defaultSubscription() {
  return {
    planId: 'free',
    period: 'forever',
    status: 'active',
    teamRequest: false,
    updatedAt: now()
  };
}

function normalizeSubscription(subscription = {}) {
  const base = defaultSubscription();
  const planId = ['free', 'deadline', 'student', 'pro', 'team'].includes(subscription.planId)
    ? subscription.planId
    : base.planId;
  const period = ['forever', 'week', 'month', 'year', 'custom'].includes(subscription.period)
    ? subscription.period
    : base.period;
  const status = ['active', 'team_requested'].includes(subscription.status)
    ? subscription.status
    : base.status;
  return {
    ...base,
    ...subscription,
    planId,
    period,
    status,
    teamRequest: Boolean(subscription.teamRequest),
    updatedAt: Number(subscription.updatedAt) || base.updatedAt
  };
}

function publicSubscription(subscription) {
  const normalized = normalizeSubscription(subscription);
  return {
    planId: normalized.planId,
    period: normalized.period,
    status: normalized.status,
    teamRequest: normalized.teamRequest,
    updatedAt: normalized.updatedAt
  };
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const { hash } = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

async function readDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    db.users ||= [];
    db.sessions ||= [];
    db.emailCodes ||= db.resetCodes || [];
    db.checks ||= [];
    db.users.forEach((user) => {
      user.profile ||= {};
      user.settings ||= {};
      user.subscription = normalizeSubscription(user.subscription);
      if (!user.profile.name) user.profile.name = user.email ? user.email.split('@')[0] : 'Имя Фамилия';
      if (!user.profile.role) user.profile.role = 'Студент · Московский политех';
      user.emailVerified = user.emailVerified !== false;
      user.passwordUpdatedAt ||= user.updatedAt || user.createdAt || now();
    });
    delete db.resetCodes;
    return db;
  } catch {
    const demoPassword = hashPassword('12345678');
    const db = {
      users: [{
        id: id(),
        email: 'student@mail.ru',
        password: demoPassword,
        createdAt: now(),
        updatedAt: now(),
        passwordUpdatedAt: now(),
        emailVerified: true,
        profile: { name: 'Анатолий Чикинда', role: 'Студент · Московский политех', avatarUrl: '' },
        settings: {},
        subscription: defaultSubscription()
      }],
      sessions: [],
      emailCodes: [],
      checks: []
    };
    await writeDb(db);
    return db;
  }
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  const profile = {
    name: user?.profile?.name || (user?.email ? user.email.split('@')[0] : 'Имя Фамилия'),
    role: user?.profile?.role || 'Студент · Московский политех',
    avatarUrl: user?.profile?.avatarUrl || ''
  };
  return user ? {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified !== false,
    name: profile.name,
    role: profile.role,
    avatarUrl: profile.avatarUrl,
    profile,
    settings: user.settings || {},
    subscription: publicSubscription(user.subscription),
    passwordUpdatedAt: user.passwordUpdatedAt || user.updatedAt || user.createdAt,
    createdAt: user.createdAt
  } : null;
}

function publicCheck(check) {
  return {
    id: check.id,
    userId: check.userId,
    report: check.report,
    createdAt: check.createdAt
  };
}

function userChecks(db, user) {
  if (!user) return [];
  return (db.checks || [])
    .filter(check => check.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicCheck);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key) out[key] = decodeURIComponent(value.join('=') || '');
  }
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function parseMultipart(req) {
  const form = formidable.formidable({
    multiples: false,
    maxFileSize: 25 * 1024 * 1024,
    maxTotalFileSize: 28 * 1024 * 1024,
    keepExtensions: true
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) reject(error);
      else resolve({ fields, files });
    });
  });
}

function parseImageUpload(req) {
  const form = formidable.formidable({
    multiples: false,
    maxFileSize: 5 * 1024 * 1024,
    maxTotalFileSize: 6 * 1024 * 1024,
    keepExtensions: true,
    filter: ({ mimetype }) => /^image\/(png|jpe?g|webp|gif)$/i.test(mimetype || '')
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) reject(error);
      else resolve({ fields, files });
    });
  });
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function smtpFallback(code, email, purpose, error) {
  if (isProduction()) return null;
  const reason = error && (error.code || error.message);
  console.log(`[SourceMate] SMTP недоступен (${reason}). Демо-код для ${email}: ${code}`);
  return {
    sent: false,
    devCode: code,
    message: purpose === 'registration'
      ? 'SMTP недоступен, демо-код показан на экране.'
      : 'SMTP недоступен, демо-код восстановления показан на экране.'
  };
}

function normalizeSupportHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-8)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim().replace(/\s+/g, ' ').slice(0, 900)
    }))
    .filter(item => item.content);
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^http:\/\/(localhost|127\.0\.0\.1):5500$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function cleanExpired(db) {
  const t = now();
  db.users ||= [];
  db.sessions = (db.sessions || []).filter(s => s.expiresAt > t);
  db.emailCodes = (db.emailCodes || db.resetCodes || []).filter(c => c.expiresAt > t);
  db.checks ||= [];
  delete db.resetCodes;
}

function getCurrentUser(db, req) {
  const token = parseCookies(req).sm_session;
  if (!token) return null;
  const session = (db.sessions || []).find(s => s.token === token && s.expiresAt > now());
  if (!session) return null;
  return db.users.find(u => u.id === session.userId) || null;
}

function getCurrentSession(db, req) {
  const token = parseCookies(req).sm_session;
  if (!token) return null;
  return (db.sessions || []).find(s => s.token === token && s.expiresAt > now()) || null;
}

function reportTitle(report = {}) {
  return cleanText(report.topic || report.filename || 'Отчет SourceMate', 120) || 'Отчет SourceMate';
}

function formatReportDate(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(timestamp || now()));
}

function pdfFontPath(name) {
  const candidates = [
    `/System/Library/Fonts/Supplemental/${name}`,
    `/Library/Fonts/${name}`,
    path.join(ROOT, 'public', 'assets', name)
  ];
  return candidates.find((file) => {
    try {
      require('fs').accessSync(file);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

function safePdfText(value, maxLength = 1200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function wrapLongPdfText(value, maxLength = 1200) {
  return safePdfText(value, maxLength).replace(/([^\s]{42})/g, '$1 ');
}

function collectPdf(doc) {
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

async function buildReportPdf({ report, createdAt, user }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 52, right: 52, bottom: 58, left: 52 },
    info: {
      Title: reportTitle(report),
      Author: 'SourceMate',
      Subject: 'Отчет проверки оригинальности'
    }
  });
  const done = collectPdf(doc);
  const regularFont = pdfFontPath('Arial.ttf');
  const boldFont = pdfFontPath('Arial Bold.ttf') || regularFont;
  if (regularFont) doc.registerFont('SourceMateRegular', regularFont);
  if (boldFont) doc.registerFont('SourceMateBold', boldFont);
  const fontRegular = regularFont ? 'SourceMateRegular' : 'Helvetica';
  const fontBold = boldFont ? 'SourceMateBold' : 'Helvetica-Bold';
  const title = reportTitle(report);
  const originality = Math.round(Number(report.originality) || 0);
  const similarity = Math.round(Number(report.similarity) || 0);
  const sources = report.sourcesChecked || report.sourceItems?.length || report.matches?.length || 0;
  const contentX = 52;
  const contentWidth = doc.page.width - 104;
  const bottomLimit = doc.page.height - 70;

  const ensureSpace = (height) => {
    if (doc.y + height <= bottomLimit) return;
    doc.addPage();
    doc.y = 52;
  };

  const drawLogo = (x, y, dark = false) => {
    const gradient = doc.linearGradient(x, y, x + 28, y + 28);
    gradient.stop(0, '#235dff').stop(1, '#7e48ff');
    doc.circle(x + 14, y + 14, 14).fill(gradient);
    doc.fillColor(dark ? '#111827' : '#ffffff').font(fontBold).fontSize(20).text('SourceMate', x + 38, y + 2);
  };

  const drawHeader = () => {
    doc.rect(0, 0, doc.page.width, 132).fill('#0b1633');
    drawLogo(contentX, 38);
    doc.fillColor('#ffffff').font(fontBold).fontSize(18).text('Экспорт отчета', contentX, 78);
    doc.font(fontRegular).fontSize(10).fillColor('#cbd6ff').text(`Сформировано: ${formatReportDate(now())}`, contentX, 104);
    doc.y = 164;
  };

  const drawSectionTitle = (text) => {
    ensureSpace(34);
    doc.fillColor('#0f172a').font(fontBold).fontSize(17).text(text, contentX, doc.y, { width: contentWidth });
    doc.y += 8;
  };

  const drawTextCard = ({ title: cardTitle, body, accent = false }) => {
    const bodyText = wrapLongPdfText(body, 1800);
    const bodyHeight = doc.heightOfString(bodyText, {
      width: contentWidth - 36,
      lineGap: 4
    });
    const cardHeight = 52 + bodyHeight;
    ensureSpace(cardHeight + 12);
    const y = doc.y;
    doc.roundedRect(contentX, y, contentWidth, cardHeight, 14)
      .fillAndStroke(accent ? '#eef4ff' : '#f8fafc', accent ? '#bfd0ff' : '#e5e7eb');
    doc.fillColor(accent ? '#1f3e9c' : '#111827').font(fontBold).fontSize(13)
      .text(cardTitle, contentX + 18, y + 15, { width: contentWidth - 36 });
    doc.fillColor('#374151').font(fontRegular).fontSize(10.5)
      .text(bodyText, contentX + 18, y + 35, { width: contentWidth - 36, lineGap: 4 });
    doc.y = y + cardHeight + 16;
  };

  drawHeader();

  doc.fillColor('#0f172a').font(fontBold).fontSize(24)
    .text(wrapLongPdfText(title, 220), contentX, doc.y, {
      width: contentWidth,
      lineGap: 2
    });
  doc.moveDown(0.55);
  doc.font(fontRegular).fontSize(11).fillColor('#475569')
    .text(`Проверка: ${formatReportDate(createdAt || report.createdAt || report.generatedAt)}`, { width: contentWidth })
    .text(`Пользователь: ${user?.email || 'локальный экспорт'}`, { width: contentWidth })
    .text(`Файл: ${wrapLongPdfText(report.filename || 'документ', 180)}`, { width: contentWidth });

  const metricGap = 14;
  const metricWidth = (contentWidth - metricGap * 2) / 3;
  ensureSpace(108);
  const metricTop = doc.y + 22;
  [
    ['Оригинальность', `${originality}%`],
    ['Совпадения', `${similarity}%`],
    ['Источников', String(sources)]
  ].forEach(([label, value], index) => {
    const x = contentX + index * (metricWidth + metricGap);
    doc.roundedRect(x, metricTop, metricWidth, 78, 14).fillAndStroke('#f1f5ff', '#d5e0ff');
    doc.fillColor('#1f3e9c').font(fontBold).fontSize(24).text(value, x + 14, metricTop + 15, {
      width: metricWidth - 28
    });
    doc.fillColor('#475569').font(fontRegular).fontSize(10.5).text(label, x + 14, metricTop + 50, {
      width: metricWidth - 28
    });
  });
  doc.y = metricTop + 104;

  const summary = report.summary || (
    similarity > 25
      ? 'В отчете есть заметные совпадения. Рекомендуется проверить проблемные источники и переработать близкие фрагменты.'
      : 'Критичных совпадений не обнаружено. Рекомендуется сохранить список источников и перепроверить финальную версию перед сдачей.'
  );
  drawSectionTitle('Вывод SourceMate');
  drawTextCard({ title: 'Краткий результат проверки', body: summary });

  const matches = Array.isArray(report.matches) ? report.matches : [];
  const sourceItems = Array.isArray(report.sourceItems) ? report.sourceItems : [];
  const rows = matches.length
    ? matches.slice(0, 8).map(match => ({
        title: match.title,
        meta: `${Math.round(Number(match.score) || 0)}% совпадения${match.url ? ` · ${match.url}` : ''}`
      }))
    : sourceItems.slice(0, 8).map(source => ({
        title: source.title,
        meta: [source.source, source.year, source.url].filter(Boolean).join(' · ')
      }));
  if (rows.length) {
    doc.addPage();
    doc.y = 52;
  }
  drawSectionTitle('Источники и совпадения');

  if (rows.length) {
    rows.forEach((row, index) => {
      const sourceTitle = `${index + 1}. ${wrapLongPdfText(row.title || 'Источник', 240)}`;
      const sourceMeta = wrapLongPdfText(row.meta || 'Источник без дополнительных данных', 360);
      const titleHeight = doc.heightOfString(sourceTitle, { width: contentWidth - 32 });
      const metaHeight = doc.heightOfString(sourceMeta, { width: contentWidth - 32, lineGap: 2 });
      const rowHeight = Math.max(58, titleHeight + metaHeight + 28);
      ensureSpace(rowHeight + 8);
      const y = doc.y;
      doc.roundedRect(contentX, y, contentWidth, rowHeight, 12).fillAndStroke('#ffffff', '#e5e7eb');
      doc.fillColor('#111827').font(fontBold).fontSize(10.5).text(sourceTitle, contentX + 16, y + 12, {
        width: contentWidth - 32,
        lineGap: 2
      });
      doc.fillColor('#64748b').font(fontRegular).fontSize(9).text(sourceMeta, contentX + 16, doc.y + 3, {
        width: contentWidth - 32,
        lineGap: 2
      });
      doc.y = y + rowHeight + 8;
    });
  } else {
    drawTextCard({
      title: 'Источники не обнаружены',
      body: 'Заметных совпадений и сохраненных источников в отчете нет.'
    });
  }

  drawTextCard({
    title: 'Заверено SourceMate',
    body: 'PDF сформирован автоматически на основе сохраненного результата проверки. Используйте отчет как вспомогательный аналитический материал.',
    accent: true
  });

  doc.font(fontRegular).fontSize(8).fillColor('#94a3b8')
    .text('SourceMate · автоматический экспорт отчета', contentX, doc.page.height - 36, {
      width: contentWidth,
      align: 'center'
    });

  doc.end();
  return done;
}

async function handleApi(req, res) {
  const apiPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && apiPath === '/api/antiplagiarism/check') {
    try {
      const db = await readDb();
      cleanExpired(db);
      const user = getCurrentUser(db, req);

      const { fields, files } = await parseMultipart(req);
      const uploaded = firstValue(files.file);
      if (!uploaded) return sendError(res, 400, 'Загрузите файл для проверки');

      const buffer = await fs.readFile(uploaded.filepath);
      const report = await analyzeAntiplagiarism({
        buffer,
        filename: uploaded.originalFilename || uploaded.newFilename || 'document',
        mimetype: uploaded.mimetype || '',
        topic: firstValue(fields.topic)
      });

      let savedCheck = null;
      if (user) {
        savedCheck = {
          id: id(),
          userId: user.id,
          report,
          createdAt: now()
        };
        db.checks ||= [];
        db.checks.push(savedCheck);
        await writeDb(db);
      }

      return sendJson(res, 200, { ok: true, report, check: savedCheck ? publicCheck(savedCheck) : null });
    } catch (error) {
      console.error('[SourceMate] Ошибка антиплагиата:', error);
      return sendError(res, 400, error.message || 'Не удалось проверить файл');
    }
  }

  const db = await readDb();
  cleanExpired(db);

  if (req.method === 'POST' && apiPath === '/api/account/avatar') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    try {
      const { files } = await parseImageUpload(req);
      const avatar = firstValue(files.avatar || files.file);
      if (!avatar) return sendError(res, 400, 'Загрузите изображение PNG, JPG, WEBP или GIF до 5 МБ');

      const extByType = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif'
      };
      const ext = extByType[String(avatar.mimetype || '').toLowerCase()] || path.extname(avatar.originalFilename || '') || '.png';
      const filename = `${user.id}${ext}`;
      await fs.mkdir(AVATAR_DIR, { recursive: true });
      await fs.copyFile(avatar.filepath, path.join(AVATAR_DIR, filename));

      user.profile ||= {};
      user.profile.avatarUrl = `/uploads/avatars/${filename}?v=${now()}`;
      user.updatedAt = now();
      await writeDb(db);
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    } catch (error) {
      return sendError(res, 400, error.message || 'Не удалось загрузить фото');
    }
  }

  const body = req.method === 'POST' ? await readJson(req) : {};
  if (body === null) return sendError(res, 400, 'Некорректный JSON');

  if (req.method === 'GET' && apiPath === '/api/auth/me') {
    await writeDb(db);
    return sendJson(res, 200, { ok: true, user: publicUser(getCurrentUser(db, req)) });
  }

  if (req.method === 'GET' && apiPath === '/api/cabinet/state') {
    const user = getCurrentUser(db, req);
    const session = getCurrentSession(db, req);
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      sessions: user ? (db.sessions || [])
        .filter(item => item.userId === user.id)
        .map(item => ({
          id: item.token === session?.token ? 'current' : item.token.slice(0, 12),
          current: item.token === session?.token,
          createdAt: item.createdAt,
          expiresAt: item.expiresAt
        })) : [],
      checks: userChecks(db, user)
    });
  }

  if (req.method === 'GET' && apiPath === '/api/subscription/state') {
    const user = getCurrentUser(db, req);
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      subscription: publicSubscription(user?.subscription)
    });
  }

  if (req.method === 'POST' && apiPath === '/api/subscription/checkout') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт, чтобы оформить подписку');

    const planId = String(body.planId || '').trim();
    const requestedPeriod = String(body.period || '').trim();
    const paidPlans = ['deadline', 'student', 'pro'];
    if (!paidPlans.includes(planId)) return sendError(res, 400, 'Выберите доступный тариф');

    const period = planId === 'deadline' ? 'week' : requestedPeriod;
    if (planId !== 'deadline' && !['month', 'year'].includes(period)) {
      return sendError(res, 400, 'Выберите период оплаты');
    }

    user.subscription = normalizeSubscription({
      planId,
      period,
      status: 'active',
      teamRequest: Boolean(user.subscription?.teamRequest),
      updatedAt: now()
    });
    user.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      subscription: publicSubscription(user.subscription),
      message: 'Подписка обновлена'
    });
  }

  if (req.method === 'POST' && apiPath === '/api/subscription/team-request') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт, чтобы отправить заявку');

    user.subscription = normalizeSubscription({
      ...(user.subscription || {}),
      status: 'team_requested',
      teamRequest: true,
      updatedAt: now()
    });
    user.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      subscription: publicSubscription(user.subscription),
      message: 'Заявка на командный доступ отправлена'
    });
  }

  if (req.method === 'POST' && apiPath === '/api/support/chat') {
    const message = String(body.message || '').trim().slice(0, 1200);
    if (!message) return sendError(res, 400, 'Напишите вопрос для поддержки');

    const user = getCurrentUser(db, req);
    const history = normalizeSupportHistory(body.history);
    const systemPrompt = `Ты ИИ-поддержка SourceMate.
Отвечай на русском, кратко и дружелюбно.
Помогай с личным кабинетом, загрузкой DOCX/PDF/TXT, поиском научных источников, отчетом оригинальности, авторизацией и настройками.
Если вопрос требует действий команды или доступа к аккаунту, объясни безопасный следующий шаг и предложи написать на sourcemate.help@gmail.com.
Не обещай ручную проверку, оплату или изменение аккаунта без подтверждения команды.`;

    try {
      const reply = await Promise.race([
        llmChat([
          { role: 'system', content: systemPrompt },
          { role: 'system', content: `Пользователь: ${user?.email || 'гость'}` },
          ...history,
          { role: 'user', content: message }
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('support-timeout')), 25000))
      ]);

      const answer = String(reply || '').trim();
      if (!answer) throw new Error('empty-support-reply');
      return sendJson(res, 200, { ok: true, answer });
    } catch (error) {
      console.error('[SourceMate] Ошибка ИИ-поддержки:', error && (error.code || error.message));
      return sendError(res, 503, 'ИИ-поддержка временно недоступна. Проверьте, что Ollama запущена, и попробуйте еще раз.');
    }
  }

  if (req.method === 'POST' && apiPath === '/api/reports/export') {
    const user = getCurrentUser(db, req);
    const checkId = cleanText(body.checkId, 120);
    let check = null;

    if (user && checkId) {
      check = (db.checks || []).find(item => item.id === checkId && item.userId === user.id) || null;
    }

    const report = check?.report || body.report;
    if (!report || typeof report !== 'object') return sendError(res, 400, 'Выберите отчет для экспорта');

    try {
      const pdf = await buildReportPdf({
        report,
        createdAt: check?.createdAt || Number(body.createdAt) || report.createdAt,
        user
      });
      const filename = encodeURIComponent(`${reportTitle(report)}.pdf`);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
      });
      res.end(pdf);
      return;
    } catch (error) {
      console.error('[SourceMate] Ошибка экспорта PDF:', error);
      return sendError(res, 500, 'Не удалось подготовить PDF');
    }
  }

  if (req.method === 'POST' && apiPath === '/api/account/profile') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasRole = Object.prototype.hasOwnProperty.call(body, 'role');
    const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
    const name = cleanText(hasName ? body.name : user.profile?.name, 80);
    const role = cleanText(hasRole ? body.role : user.profile?.role, 100);
    const email = normalizeEmail(body.email || user.email);
    if (!name) return sendError(res, 400, 'Введите имя профиля');
    if (hasEmail && !isEmail(email)) return sendError(res, 400, 'Введите корректную почту');
    if (email !== user.email && db.users.some(item => item.email === email && item.id !== user.id)) {
      return sendError(res, 409, 'Аккаунт с такой почтой уже существует');
    }

    user.profile ||= {};
    user.profile.name = name;
    user.profile.role = role || 'Студент · Московский политех';
    if (email !== user.email) {
      user.email = email;
      user.emailVerified = false;
    }
    user.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  if (req.method === 'POST' && apiPath === '/api/account/password') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifyPassword(currentPassword, user.password)) return sendError(res, 403, 'Текущий пароль неверный');
    if (newPassword.length < 8) return sendError(res, 400, 'Новый пароль должен быть не короче 8 символов');

    user.password = hashPassword(newPassword);
    user.passwordUpdatedAt = now();
    user.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  if (req.method === 'POST' && apiPath === '/api/account/settings') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    const allowed = ['appearance', 'contrast', 'accentColor', 'language', 'voiceInput', 'quietMode', 'notificationChannels', 'notificationEvents'];
    user.settings ||= {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) user.settings[key] = body[key];
    }
    user.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, user: publicUser(user), message: 'Настройки сохранены' });
  }

  if (req.method === 'POST' && apiPath === '/api/account/sessions/revoke-other') {
    const user = getCurrentUser(db, req);
    const session = getCurrentSession(db, req);
    if (!user || !session) return sendError(res, 401, 'Войдите в аккаунт');

    db.sessions = (db.sessions || []).filter(item => item.userId !== user.id || item.token === session.token);
    await writeDb(db);
    return sendJson(res, 200, { ok: true, revoked: true });
  }

  if (req.method === 'POST' && apiPath === '/api/account/delete') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');
    const password = String(body.password || '');
    if (!verifyPassword(password, user.password)) return sendError(res, 403, 'Пароль неверный');

    db.users = (db.users || []).filter(item => item.id !== user.id);
    db.sessions = (db.sessions || []).filter(item => item.userId !== user.id);
    db.checks = (db.checks || []).filter(item => item.userId !== user.id);
    await writeDb(db);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && apiPath === '/api/account/mfa/request') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');
    return sendJson(res, 202, {
      ok: true,
      implemented: false,
      message: 'MFA пока в демо-режиме: серверная интеграция с приложением-аутентификатором не подключена.'
    });
  }

  if (req.method === 'POST' && apiPath === '/api/cabinet/check/delete') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    const checkId = String(body.checkId || '').trim();
    if (!checkId) return sendError(res, 400, 'Не передан ID проверки');

    const before = (db.checks || []).length;
    db.checks = (db.checks || []).filter(check => !(check.id === checkId && check.userId === user.id));
    if (db.checks.length === before) return sendError(res, 404, 'Проверка не найдена');

    await writeDb(db);
    return sendJson(res, 200, { ok: true, checks: userChecks(db, user) });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/register') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!isEmail(email)) return sendError(res, 400, 'Введите корректную почту');
    if (password.length < 8) return sendError(res, 400, 'Пароль должен быть не короче 8 символов');
    if (db.users.some(u => u.email === email)) return sendError(res, 409, 'Аккаунт с такой почтой уже существует');

    const user = {
      id: id(),
      email,
      password: hashPassword(password),
      createdAt: now(),
      updatedAt: now(),
      passwordUpdatedAt: now(),
      emailVerified: true,
      profile: { name: email.split('@')[0], role: 'Студент · Московский политех', avatarUrl: '' },
      settings: {},
      subscription: defaultSubscription()
    };
    const token = id();
    db.users.push(user);
    db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt: now() + SESSION_TTL_MS });
    await writeDb(db);
    setSessionCookie(res, token);
    return sendJson(res, 201, { ok: true, user: publicUser(user) });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/register/request') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!isEmail(email)) return sendError(res, 400, 'Введите корректную почту');
    if (password.length < 8) return sendError(res, 400, 'Пароль должен быть не короче 8 символов');
    if (db.users.some(u => u.email === email)) return sendError(res, 409, 'Аккаунт с такой почтой уже существует');

    const code = String(crypto.randomInt(100000, 999999));
    db.emailCodes = (db.emailCodes || []).filter(c => !(c.email === email && c.purpose === 'registration'));
    db.emailCodes.push({
      email,
      purpose: 'registration',
      code,
      password: hashPassword(password),
      verified: false,
      token: null,
      createdAt: now(),
      expiresAt: now() + CODE_TTL_MS
    });
    await writeDb(db);

    let mail;
    try {
      mail = await sendCodeEmail({ to: email, code, purpose: 'registration' });
    } catch (error) {
      console.error('[SourceMate] Не удалось отправить код регистрации:', error && (error.code || error.message));
      mail = smtpFallback(code, email, 'registration', error);
      if (mail) {
        return sendJson(res, 200, {
          ok: true,
          message: mail.message,
          devCode: mail.devCode
        });
      }
      return sendError(res, 502, 'Не удалось отправить письмо. Настройте Brevo API или рабочий SMTP-провайдер.');
    }
    return sendJson(res, 200, {
      ok: true,
      message: mail.sent ? 'Код подтверждения отправлен на почту.' : 'SMTP не настроен, код выведен в консоль.',
      devCode: isProduction() ? undefined : mail.devCode
    });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/register/verify') {
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const entry = (db.emailCodes || []).find(c => c.email === email && c.purpose === 'registration' && c.code === code && c.expiresAt > now());
    if (!entry) return sendError(res, 400, 'Код неверный или устарел');
    if (db.users.some(u => u.email === email)) return sendError(res, 409, 'Аккаунт с такой почтой уже существует');

    const user = {
      id: id(),
      email,
      password: entry.password,
      createdAt: now(),
      updatedAt: now(),
      passwordUpdatedAt: now(),
      emailVerified: true,
      profile: { name: email.split('@')[0], role: 'Студент · Московский политех', avatarUrl: '' },
      settings: {},
      subscription: defaultSubscription()
    };
    const token = id();
    db.users.push(user);
    db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt: now() + SESSION_TTL_MS });
    db.emailCodes = db.emailCodes.filter(c => c !== entry);
    await writeDb(db);
    setSessionCookie(res, token);
    return sendJson(res, 201, { ok: true, user: publicUser(user) });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/login') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const user = db.users.find(u => u.email === email);
    if (!user || !verifyPassword(password, user.password)) return sendError(res, 401, 'Неверная почта или пароль');

    const token = id();
    db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt: now() + SESSION_TTL_MS });
    await writeDb(db);
    setSessionCookie(res, token);
    return sendJson(res, 200, { ok: true, user: publicUser(user) });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/logout') {
    const token = parseCookies(req).sm_session;
    db.sessions = (db.sessions || []).filter(s => s.token !== token);
    await writeDb(db);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/recover/request') {
    const email = normalizeEmail(body.email);
    const user = db.users.find(u => u.email === email);
    if (!isEmail(email)) return sendError(res, 400, 'Введите корректную почту');

    const code = String(crypto.randomInt(100000, 999999));
    db.emailCodes = (db.emailCodes || []).filter(c => !(c.email === email && c.purpose === 'recovery'));
    let mail = { sent: false, devCode: undefined };
    if (user) {
      db.emailCodes.push({ email, purpose: 'recovery', code, verified: false, token: null, createdAt: now(), expiresAt: now() + CODE_TTL_MS });
      try {
        mail = await sendCodeEmail({ to: email, code, purpose: 'recovery' });
      } catch (error) {
        console.error('[SourceMate] Не удалось отправить код восстановления:', error && (error.code || error.message));
        mail = smtpFallback(code, email, 'recovery', error);
        if (mail) {
          await writeDb(db);
          return sendJson(res, 200, {
            ok: true,
            message: mail.message,
            devCode: mail.devCode
          });
        }
        return sendError(res, 502, 'Не удалось отправить письмо. Настройте Brevo API или рабочий SMTP-провайдер.');
      }
    }
    await writeDb(db);
    return sendJson(res, 200, {
      ok: true,
      message: user && mail.sent ? 'Код восстановления отправлен на почту.' : 'Если аккаунт существует, код восстановления создан.',
      devCode: isProduction() || !user ? undefined : mail.devCode
    });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/recover/verify') {
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const entry = (db.emailCodes || []).find(c => c.email === email && c.purpose === 'recovery' && c.code === code && c.expiresAt > now());
    if (!entry) return sendError(res, 400, 'Код неверный или устарел');

    entry.verified = true;
    entry.token = id();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, resetToken: entry.token });
  }

  if (req.method === 'POST' && apiPath === '/api/auth/recover/reset') {
    const email = normalizeEmail(body.email);
    const resetToken = String(body.resetToken || '');
    const password = String(body.password || '');
    if (password.length < 8) return sendError(res, 400, 'Пароль должен быть не короче 8 символов');

    const entry = (db.emailCodes || []).find(c => c.email === email && c.purpose === 'recovery' && c.token === resetToken && c.verified && c.expiresAt > now());
    const user = db.users.find(u => u.email === email);
    if (!entry || !user) return sendError(res, 400, 'Сессия восстановления устарела');

    user.password = hashPassword(password);
    user.updatedAt = now();
    db.emailCodes = db.emailCodes.filter(c => c !== entry);
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  await writeDb(db);
  return sendError(res, 404, 'API endpoint не найден');
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';

  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!fullPath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden');

  try {
    const data = await fs.readFile(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end('<h1>404</h1>');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method not allowed');
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'Внутренняя ошибка сервера');
  }
});

server.listen(PORT, () => {
  console.log(`SourceMate web is running: http://localhost:${PORT}`);
  console.log('Demo account: student@mail.ru / 12345678');
});
