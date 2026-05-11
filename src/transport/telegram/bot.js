const { Telegraf } = require('telegraf');
const { BOT_TOKEN, LLM_ENABLED, LLM_REQUIRED } = require('../../config/config.js');
const { aggregate } = require('../../core/aggregate.js');
const { analyzeAntiplagiarism, formatReportText } = require('../../core/antiplagiarism.js');
const { sendFirstPage, handlePaginationCallback, cleanupSessions } = require('./pagination.js');

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN отсутствует'); process.exit(1); }
if (LLM_REQUIRED && !LLM_ENABLED) { console.error('❌ Включи ИИ (Ollama) в .env'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

bot.start(ctx => ctx.reply(
  'Привет! Пришли тему — я подберу самые релевантные научные источники 📚\n\nЕще можно отправить DOCX/PDF/TXT файл с подписью-темой — я проверю его на совпадения по найденным источникам.\nНапример: <code>технологический PR</code>',
  { parse_mode:'HTML' }
));

async function sendLongText(ctx, text) {
  const limit = 3900;
  for (let i = 0; i < text.length; i += limit) {
    await ctx.reply(text.slice(i, i + limit), { disable_web_page_preview: true });
  }
}

bot.on('document', async (ctx) => {
  const doc = ctx.message?.document;
  if (!doc) return;

  const notice = await ctx.reply('📄 Скачиваю файл и готовлю проверку…');

  try {
    if (doc.file_size > 25 * 1024 * 1024) {
      await ctx.reply('Файл слишком большой. Максимум — 25 МБ.');
      return;
    }

    const link = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(link.href);
    if (!response.ok) throw new Error('Не удалось скачать файл из Telegram');

    const arrayBuffer = await response.arrayBuffer();
    const report = await analyzeAntiplagiarism({
      buffer: Buffer.from(arrayBuffer),
      filename: doc.file_name || 'document',
      mimetype: doc.mime_type || '',
      topic: ctx.message.caption || ''
    });

    await sendLongText(ctx, formatReportText(report));
  } catch (error) {
    console.error('❌ Ошибка проверки файла:', error);
    await ctx.reply(error.message || 'Не удалось проверить файл.');
  } finally {
    try { await ctx.deleteMessage(notice.message_id); } catch {}
  }
});

bot.on('text', async (ctx)=>{
  const q = (ctx.message?.text||'').trim();
  const notice = await ctx.reply('🔎 Ищу источники…');

  try {
    const items = await aggregate(q);
    if (!items.length) return ctx.reply('Ничего релевантного не нашлось. Попробуй уточнить формулировку.');

    await sendFirstPage(ctx, q, items);
  } catch (e) {
    console.error('❌ Ошибка:', e);
    await ctx.reply('Произошла ошибка при поиске.');
  } finally {
    try { await ctx.deleteMessage(notice.message_id); } catch {}
  }
});

bot.on('callback_query', handlePaginationCallback);
bot.launch().then(()=>console.log('✅ Bot is running'));
setInterval(cleanupSessions, 5*60*1000);
