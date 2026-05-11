const nodemailer = require('nodemailer');

function describeMailError(error) {
  return [
    error && error.code,
    error && error.command,
    error && error.responseCode,
    error && error.response,
    error && error.message
  ].filter(Boolean).join(' | ');
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function brevoConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

function parseSender(value) {
  const sender = String(value || '').trim();
  const match = sender.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim() || undefined, email: match[2].trim() };
  }
  return { email: sender };
}

function createTransport() {
  if (!smtpConfigured()) return null;

  const password = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    auth: {
      user: process.env.SMTP_USER,
      pass: password
    }
  });
}

async function sendWithBrevo({ to, subject, text, html }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: parseSender(process.env.MAIL_FROM),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Brevo API error ${response.status}: ${detail}`);
    error.code = 'BREVO_API';
    error.responseCode = response.status;
    error.response = detail;
    throw error;
  }

  return { sent: true, provider: 'brevo' };
}

async function sendCodeEmail({ to, code, purpose }) {
  const subject = purpose === 'registration'
    ? 'Код подтверждения SourceMate'
    : 'Код восстановления SourceMate';

  const title = purpose === 'registration'
    ? 'Подтверждение регистрации'
    : 'Восстановление доступа';

  const text = `${title}\n\nВаш код: ${code}\n\nКод действует 10 минут. Если вы не запрашивали письмо, просто игнорируйте его.`;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#070811;color:#f4f6ff;padding:28px;border-radius:18px">
      <h1 style="margin:0 0 12px;font-size:24px">${title}</h1>
      <p style="color:#aab2cc;margin:0 0 20px">Код действует 10 минут.</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#15161d;border:1px solid #34384c;border-radius:14px;padding:18px 22px;display:inline-block">${code}</div>
      <p style="color:#aab2cc;margin:22px 0 0">Если вы не запрашивали письмо, просто игнорируйте его.</p>
    </div>
  `;

  if (brevoConfigured()) {
    return sendWithBrevo({ to, subject, text, html });
  }

  const transport = createTransport();
  if (!transport) {
    throw Object.assign(new Error('Почтовый провайдер не настроен'), { code: 'MAIL_NOT_CONFIGURED' });
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });

  return { sent: true, provider: 'smtp' };
}

module.exports = { sendCodeEmail, smtpConfigured, brevoConfigured, describeMailError };
