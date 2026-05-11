require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const formidable = require('formidable');
const { sendCodeEmail } = require('./mailer.js');
const { analyzeAntiplagiarism } = require('../core/antiplagiarism.js');

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
        settings: {}
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
  return user ? {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified !== false,
    name: user.profile?.name || (user.email ? user.email.split('@')[0] : 'Имя Фамилия'),
    role: user.profile?.role || 'Студент · Московский политех',
    avatarUrl: user.profile?.avatarUrl || '',
    settings: user.settings || {},
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
  if (isProduction() || process.env.MAIL_DEV_FALLBACK !== 'true') return null;
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

  if (req.method === 'POST' && apiPath === '/api/account/profile') {
    const user = getCurrentUser(db, req);
    if (!user) return sendError(res, 401, 'Войдите в аккаунт');

    const name = cleanText(body.name, 80);
    const role = cleanText(body.role, 100);
    const email = normalizeEmail(body.email || user.email);
    if (!name) return sendError(res, 400, 'Введите имя профиля');
    if (!isEmail(email)) return sendError(res, 400, 'Введите корректную почту');
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
      settings: {}
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
      settings: {}
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
