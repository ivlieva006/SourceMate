const detailView = document.querySelector("[data-source-detail]");
const API_ORIGIN = window.location.port === "5500" ? "http://localhost:3000" : "";
const CHECKS_STORAGE_KEY = "sourcemate.cabinet.checks.v1";
const SELECTED_SOURCE_STORAGE_KEY = "sourcemate.selectedSource.v1";

let currentUser = null;

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function storageScope(user = currentUser) {
  return user?.email ? user.email.toLowerCase() : "guest";
}

function checksStorageKey(user = currentUser) {
  return `${CHECKS_STORAGE_KEY}.${storageScope(user)}`;
}

function readCachedChecks(user = currentUser) {
  try {
    const scoped = localStorage.getItem(checksStorageKey(user));
    const checks = scoped ? JSON.parse(scoped) : [];
    if (Array.isArray(checks) && checks.length) return checks;
  } catch {}

  try {
    const legacy = localStorage.getItem(CHECKS_STORAGE_KEY);
    const checks = legacy ? JSON.parse(legacy) : [];
    return Array.isArray(checks) ? checks : [];
  } catch {
    return [];
  }
}

function mergeChecks(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter((check) => {
    const key = [check.id, check.report?.filename, check.report?.topic, check.createdAt].filter(Boolean).join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLabel(item) {
  return [item.source, item.title || item.url || "Источник"].filter(Boolean).join(" · ");
}

function cleanSourceValue(value) {
  const text = String(value || '').trim();
  if (!text || text === 'undefined' || text === 'null') return '';
  return text;
}

function doiFrom(source) {
  const raw = [source.doi, source.url, source.title, source.description].filter(Boolean).join(" ");
  const match = raw.match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  return source.doi || match?.[0]?.replace(/[.,;)]$/, "") || "";
}

function yearLabel(source) {
  const year = cleanSourceValue(source.year).match(/\d{4}/)?.[0] || '';
  return year || "—";
}

function citationCount(source) {
  const value = Number(source.citations || source.citationCount || 0);
  return Number.isFinite(value) && value > 0 ? String(value) : "—";
}

function authorList(source) {
  if (Array.isArray(source.authors)) return source.authors.filter(Boolean);
  return String(source.authors || '').split(/,\s*/).map(item => item.trim()).filter(Boolean);
}

function relevanceScore(source) {
  return Math.max(0, Math.min(100, Math.round(Number(source.score) || 0)));
}

function gostCitation(source) {
  const authors = authorList(source);
  const authorPrefix = authors.length ? `${authors.slice(0, 3).join(', ')}. ` : '';
  const year = yearLabel(source) !== "—" ? yearLabel(source) : '';
  const doi = doiFrom(source);
  return [
    `${authorPrefix}${source.title || "Источник без названия"}`,
    source.source ? `// ${source.source}` : "",
    year,
    doi ? `DOI: ${doi}` : "",
    source.url || ""
  ].filter(Boolean).join(" ");
}

function bibtexKey(source) {
  const year = yearLabel(source) !== "—" ? yearLabel(source) : "source";
  const word = String(source.title || source.source || "source").toLowerCase().match(/[a-zа-я0-9]+/i)?.[0] || "source";
  return `${word}${year}`.replace(/[^a-zа-я0-9]/gi, "");
}

function bibtexCitation(source) {
  const authors = authorList(source);
  const authorsField = authors.length ? `, author={${authors.join(' and ')}}` : '';
  const doi = doiFrom(source);
  return `@misc{${bibtexKey(source)}, title={${source.title || "Источник без названия"}}, year={${yearLabel(source)}}${authorsField}${doi ? `, doi={${doi}}` : ''}, url={${source.url || ""}}}`;
}

function sourceFragments(source) {
  return (source.matchedFragments || []).slice(0, 2);
}

function usageTips(source) {
  const tips = [];
  if (source.matchedFragments?.length) tips.push("Проверьте совпавший фрагмент и добавьте ссылку на источник, если используете близкую формулировку.");
  if (source.description) tips.push("Используйте аннотацию источника как ориентир для теоретического обоснования, но перескажите мысль своими словами.");
  if (doiFrom(source) || source.url) tips.push("Добавьте DOI или URL в список литературы и проверьте формат по требованиям кафедры.");
  tips.push("Сопоставьте выводы источника с вашей темой и добавьте собственный комментарий.");
  return tips.slice(0, 4);
}

function showNotFound() {
  detailView.innerHTML = `
    <section class="empty-history report-loading">
      <h3>Источник не найден</h3>
      <p>Вернитесь в кабинет и откройте источник из сохраненного отчета.</p>
      <button class="upload-button" type="button" data-source-back>Вернуться в кабинет</button>
    </section>
  `;
}

function readSelectedSource() {
  try {
    const value = sessionStorage.getItem(SELECTED_SOURCE_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function findSourceInChecks(checks, checkId, sourceIndex) {
  const check = checks.find(item => item.id === checkId) || checks[0];
  if (!check?.report) return null;
  const sourceItems = check.report.sourceItems || [];
  const matches = check.report.matches || [];
  const list = sourceItems.length ? sourceItems : matches;
  const source = list[Number(sourceIndex)];
  if (!source) return null;
  return {
    item: {
      checkId: check.id,
      index: Number(sourceIndex),
      source,
      reportTopic: check.report.topic || '',
      reportFilename: check.report.filename || '',
      reportGeneratedAt: check.report.generatedAt || ''
    },
    check
  };
}

function renderSource(payload) {
  const source = payload.item.source || {};
  const profileName = currentUser?.email ? currentUser.email.split("@")[0] : "Имя Фамилия";
  const relevance = relevanceScore(source);
  const doi = doiFrom(source);
  const year = yearLabel(source);
  const citations = citationCount(source);
  const fragments = sourceFragments(source);
  const tips = usageTips(source);
  const identifierLabel = doi || (source.url ? "URL" : "—");
  const sourceType = cleanSourceValue(source.type) || "—";
  const venueLabel = cleanSourceValue(source.venue) || cleanSourceValue(source.source) || "Издание не указано";
  const authors = authorList(source).length ? authorList(source).join(", ") : "не указаны";
  const publisher = cleanSourceValue(source.publisher);
  const hasRichMeta = Boolean(source.description || source.doi || source.citations || authorList(source).length || source.venue || source.publisher);

  detailView.innerHTML = `
    <section class="detail-hero" data-source-hero>
      <div>
        <h1>Карточка источника</h1>
        <p>Полная информация по публикации: релевантность теме, совпадения и готовые форматы ссылки</p>
        <div class="hero-chips">
          <span class="chip blue">${relevance}% релевантность</span>
          <span class="chip violet">${citations === "—" ? "цитирования нет" : `${citations} цитирований`}</span>
        </div>
      </div>
      <button class="detail-close" type="button" data-close-source-hero aria-label="Закрыть аннотацию">×</button>
    </section>

    <section class="detail-stats" aria-label="Метрики источника">
      <article><strong>${esc(year)}</strong><span>Год публикации</span><small>${year === "—" ? "нет данных" : "найден в источнике"}</small></article>
      <article><strong>${esc(sourceType).slice(0, 8)}</strong><span>Тип публикации</span><small>${esc(venueLabel)}</small></article>
      <article><strong>${esc(citations)}</strong><span>Цитирований</span><small>${citations === "—" ? "нет данных" : "метрика источника"}</small></article>
      <article><strong>${doi ? "DOI" : "URL"}</strong><span>Идентификатор</span><small class="warn">${esc(identifierLabel)}</small></article>
    </section>

    <section class="detail-main-row">
      <article class="matches-panel source-passport">
        <div class="detail-heading">
          <h2>Паспорт источника</h2>
          <p>Ключевые сведения о публикации</p>
        </div>

        <div class="passport-card">
          <h3>${esc(source.title || "Источник без названия")}</h3>
          ${hasRichMeta ? "" : "<p>Часть метаданных недоступна: этот источник был сохранен старой версией проверки или API не вернул подробности.</p>"}
          <p>Авторы: ${esc(authors)}</p>
          <p>Площадка: ${esc(venueLabel)}</p>
          ${publisher ? `<p>Издатель: ${esc(publisher)}</p>` : ""}
          <p>Год: ${esc(year)}</p>
          <p>${doi ? `DOI: ${esc(doi)}` : `URL: ${source.url ? esc(source.url) : "не указан"}`}</p>
          <p>Тема отчета: ${esc(payload.item.reportTopic || "не указана")}</p>
        </div>

        <div class="passport-card">
          <h3>Аннотация</h3>
          <p>${esc(source.description || "Аннотация недоступна. Используйте ссылку на источник для ручной проверки содержания.")}</p>
        </div>

        <div class="passport-card">
          <h3>Ключевые фрагменты</h3>
          ${fragments.length ? fragments.map(fragment => `
            <div class="quote-row"><span></span><p>${esc(fragment)}</p></div>
          `).join("") : `
            <div class="quote-row"><span></span><p>Совпавшие фрагменты не сохранены для этого источника.</p></div>
          `}
        </div>
      </article>

      <aside class="detail-side">
        <article class="detail-profile">
          <div class="profile-row">
            <span class="avatar" aria-hidden="true"></span>
            <div>
              <h2>${esc(profileName)}</h2>
              <p>Студент · Московский политех</p>
            </div>
          </div>
          <button class="cabinet-btn primary wide" type="button" data-source-back>Вернуться к проверкам</button>
        </article>

        <article class="sources-match-panel citation-panel">
          <div class="detail-heading compact">
            <h2>Быстрое цитирование</h2>
            <p>Скопируйте формат под требования вуза</p>
          </div>
          <div class="citation-list">
            <article class="citation-card">
              <div><strong>ГОСТ</strong><button type="button" data-copy-citation="${esc(gostCitation(source))}">Копировать</button></div>
              <p>${esc(gostCitation(source))}</p>
            </article>
            <article class="citation-card">
              <div><strong>BibTeX</strong><button type="button" data-copy-citation="${esc(bibtexCitation(source))}">Копировать</button></div>
              <p>${esc(bibtexCitation(source))}</p>
            </article>
          </div>
          <button class="cabinet-btn primary wide" type="button" data-copy-citation="${esc(`${gostCitation(source)}\n\n${bibtexCitation(source)}`)}">Скопировать все</button>
        </article>
      </aside>
    </section>

    <section class="recommendations-panel" data-source-usage>
      <div class="detail-heading">
        <h2>Как использовать источник</h2>
        <p>Практические шаги для включения публикации в вашу работу</p>
      </div>
      <button class="detail-close small" type="button" data-close-source-usage aria-label="Закрыть рекомендации">×</button>
      <div class="recommendation-list">
        ${tips.map(item => `<div class="recommendation-row"><span></span><p>${esc(item)}</p></div>`).join("")}
      </div>
    </section>
  `;
}

function goBack() {
  if (document.referrer && /\/(cabinet|report)\.html/.test(new URL(document.referrer).pathname)) {
    history.back();
    return;
  }
  window.location.href = "./cabinet.html";
}

async function loadSource() {
  const params = new URLSearchParams(window.location.search);
  const checkId = params.get("checkId") || "";
  const sourceIndex = params.get("source") || "0";
  const selected = readSelectedSource();
  if (selected?.item && (!checkId || selected.item.checkId === checkId) && String(selected.item.index) === String(sourceIndex)) {
    currentUser = selected.user || null;
    renderSource(selected);
    return;
  }

  let serverChecks = [];
  try {
    const response = await fetch(`${API_ORIGIN}/api/cabinet/state`, { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    currentUser = data.user || null;
    serverChecks = data.checks || [];
  } catch {
    serverChecks = [];
  }

  const checks = mergeChecks(serverChecks, readCachedChecks(currentUser));
  const restored = findSourceInChecks(checks, checkId, sourceIndex);
  if (!restored) {
    showNotFound();
    return;
  }
  renderSource(restored);
}

document.addEventListener("click", async (event) => {
  const heroClose = event.target.closest("[data-close-source-hero]");
  if (heroClose) {
    heroClose.closest("[data-source-hero]")?.remove();
    return;
  }

  const usageClose = event.target.closest("[data-close-source-usage]");
  if (usageClose) {
    usageClose.closest("[data-source-usage]")?.remove();
    return;
  }

  const copyButton = event.target.closest("[data-copy-citation]");
  if (copyButton) {
    await navigator.clipboard?.writeText(copyButton.dataset.copyCitation || "");
    copyButton.textContent = "Скопировано";
    return;
  }

  if (event.target.closest("[data-source-back]")) goBack();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") goBack();
});

loadSource();
