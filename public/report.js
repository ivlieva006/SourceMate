const detailView = document.querySelector("[data-report-detail]");
const API_ORIGIN = window.location.port === "5500" ? "http://localhost:3000" : "";
const CHECKS_STORAGE_KEY = "sourcemate.cabinet.checks.v1";
const SELECTED_REPORT_STORAGE_KEY = "sourcemate.selectedReport.v1";
const SELECTED_SOURCE_STORAGE_KEY = "sourcemate.selectedSource.v1";

let currentUser = null;
let currentCheck = null;
let currentSources = [];

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

function readLegacyChecks() {
  try {
    const value = localStorage.getItem(CHECKS_STORAGE_KEY);
    const checks = value ? JSON.parse(value) : [];
    return Array.isArray(checks) ? checks : [];
  } catch {
    return [];
  }
}

function readCachedChecks(user = currentUser) {
  try {
    const scoped = localStorage.getItem(checksStorageKey(user));
    const checks = scoped ? JSON.parse(scoped) : [];
    if (Array.isArray(checks) && checks.length) return checks;
  } catch {
    // Fall back to legacy cache below.
  }

  return readLegacyChecks();
}

function mergeChecks(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter((check) => {
    const key = [
      check.id,
      check.report?.filename,
      check.report?.topic,
      check.createdAt
    ].filter(Boolean).join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function riskInfo(report) {
  const similarity = Number(report.similarity) || 0;
  if (similarity <= 10) return { grade: "A", label: "Низкий риск", className: "good" };
  if (similarity <= 25) return { grade: "B", label: "Средний риск", className: "warn" };
  return { grade: "C", label: "Высокий риск", className: "bad" };
}

function sourceLabel(item) {
  return [item.source, item.title || item.url || "Источник"].filter(Boolean).join(" · ");
}

function problemFragments(report) {
  const out = [];
  (report.matches || []).forEach((match) => {
    (match.matchedFragments || []).forEach((fragment) => {
      if (out.length < 8) {
        out.push({
          text: fragment,
          score: Math.max(1, Math.round(match.score || report.similarity || 0)),
          advice: match.advice?.[0] || ""
        });
      }
    });
  });

  if (!out.length && (report.matches || []).length) {
    (report.matches || []).slice(0, 5).forEach((match) => {
      out.push({
        text: `Совпадение найдено в источнике «${match.title || "Источник без названия"}». Проверьте формулировку и добавьте ссылку, если используется чужая мысль.`,
        score: Math.max(1, Math.round(match.score || report.similarity || 0)),
        advice: match.advice?.[0] || ""
      });
    });
  }

  return out;
}

function reportRecommendations(report, fragments) {
  const similarity = Number(report.similarity) || 0;
  const recommendations = [];
  if (fragments.some(item => item.score >= 60)) {
    recommendations.push("Перепишите фрагменты с совпадением выше 60%, сохранив авторскую аргументацию.");
  }
  if ((report.matches || []).length) {
    recommendations.push("Добавьте ссылки на первоисточники в местах, где используется точная формулировка.");
  }
  if (similarity > 15) {
    recommendations.push("Усилите аналитическую часть: добавьте собственные выводы после каждого цитируемого блока.");
  }
  recommendations.push("Повторно проверьте текст после правок и сравните динамику метрик.");
  return recommendations.slice(0, 4);
}

function showNotFound() {
  detailView.innerHTML = `
    <section class="empty-history report-loading">
      <h3>Отчет не найден</h3>
      <p>Проверка могла быть удалена или еще не сохранилась в кабинете.</p>
      <button class="upload-button" type="button" data-detail-back>Вернуться к проверкам</button>
    </section>
  `;
}

function readSelectedReport(checkId) {
  try {
    const value = sessionStorage.getItem(SELECTED_REPORT_STORAGE_KEY);
    const data = value ? JSON.parse(value) : null;
    if (data?.check?.id !== checkId) return null;
    currentUser = data.user || currentUser;
    return data.check;
  } catch {
    return null;
  }
}

function renderReport(check) {
  currentCheck = check;
  const report = { ...check.report, createdAt: check.createdAt };
  const originality = Math.round(Number(report.originality) || 0);
  const similarity = Math.round(Number(report.similarity) || 0);
  const fragments = problemFragments(report);
  const riskySources = (report.matches || []).filter(match => Number(match.score) >= 20).length;
  const risk = riskInfo(report);
  const profileName = currentUser?.email ? currentUser.email.split("@")[0] : "Имя Фамилия";
  const sources = (report.matches || []).length
    ? report.matches
    : (report.sourceItems || []).map(source => ({
        title: source.title,
        source: source.source,
        url: source.url,
        description: source.description,
        year: source.year,
        type: source.type,
        doi: source.doi,
        citations: source.citations,
        authors: source.authors,
        venue: source.venue,
        publisher: source.publisher,
        fetched: source.fetched,
        score: Math.max(1, Math.round(source.score || 0))
      }));
  currentSources = sources.map((source, index) => ({
    checkId: check.id,
    index,
    source,
    reportTopic: report.topic || '',
    reportFilename: report.filename || '',
    reportGeneratedAt: report.generatedAt || ''
  }));
  const recommendations = reportRecommendations(report, fragments);

  detailView.innerHTML = `
    <section class="detail-hero" data-detail-hero>
      <div>
        <h1>Детальный отчет проверки</h1>
        <p>Подсветка совпадений, источники заимствований и персональные рекомендации для повышения оригинальности</p>
        <div class="hero-chips">
          <span class="chip blue">${originality}% оригинальность</span>
          <span class="chip violet">${similarity}% совпадений</span>
        </div>
      </div>
      <button class="detail-close" type="button" data-close-detail-hero aria-label="Закрыть аннотацию">×</button>
    </section>

    <section class="detail-stats" aria-label="Метрики отчета">
      <article><strong>${originality}%</strong><span>Итоговая уникальность</span></article>
      <article><strong>${similarity}%</strong><span>Сумма совпадений</span><small>${riskySources} источника &gt; 20%</small></article>
      <article><strong>${fragments.length}</strong><span>Проблемных абзаца</span><small>${report.sourcesFetched || 0} текстов источников загружено</small></article>
      <article><strong>${risk.grade}</strong><span>Оценка риска</span><small class="${risk.className}">${risk.label}</small></article>
    </section>

    <section class="detail-main-row">
      <article class="matches-panel">
        <div class="detail-heading">
          <h2>Проблемные фрагменты текста</h2>
          <p>Сегменты с высоким совпадением и рекомендации по перефразированию</p>
        </div>
        <div class="snippet-list">
          ${fragments.length ? fragments.map((fragment, index) => `
            <article class="snippet-card">
              <div class="snippet-top">
                <strong>Абзац ${index + 1}</strong>
                <span>${fragment.score}% совпадений</span>
              </div>
              <p>${esc(fragment.text)}</p>
              <small>${esc(fragment.advice || "Рекомендация: добавьте цитирование и перефразируйте ключевую мысль")}</small>
            </article>
          `).join("") : `
            <article class="snippet-card">
              <div class="snippet-top"><strong>Совпадения не найдены</strong><span>0%</span></div>
              <p>В сохраненном отчете нет проблемных фрагментов. Текст выглядит достаточно оригинальным по найденным источникам.</p>
              <small>Рекомендация: сохраните список источников и проверьте цитирование вручную</small>
            </article>
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
          <button class="cabinet-btn primary wide" type="button" data-detail-back>Вернуться к проверкам</button>
        </article>

        <article class="sources-match-panel">
          <div class="detail-heading compact">
            <h2>Источники совпадений</h2>
            <p>Список материалов с наибольшим совпадением</p>
          </div>
          <div class="match-source-list">
            ${sources.length ? sources.slice(0, 8).map((source, index) => `
              <div class="match-source-row is-openable" data-open-source="${index}" role="button" tabindex="0">
                <span>${esc(sourceLabel(source))}${source.fetched ? " · текст загружен" : ""}</span>
                <strong>${Math.round(source.score || 0)}%</strong>
              </div>
            `).join("") : `
              <div class="match-source-row"><span>Источники совпадений не найдены</span><strong>0%</strong></div>
            `}
          </div>
          <button class="cabinet-btn primary wide" type="button" data-detail-back>Вернуться к проверкам</button>
        </article>
      </aside>
    </section>

    <section class="recommendations-panel">
      <div class="detail-heading">
        <h2>Рекомендации по улучшению текста</h2>
        <p>Что исправить перед повторной проверкой</p>
      </div>
      <button class="detail-close small" type="button" data-close-recommendations aria-label="Закрыть рекомендации">×</button>
      <div class="recommendation-list">
        ${recommendations.map(item => `<div class="recommendation-row"><span></span><p>${esc(item)}</p></div>`).join("")}
      </div>
    </section>
  `;
}

function openSource(index) {
  const item = currentSources[Number(index)];
  if (!item) return;
  try {
    sessionStorage.setItem(SELECTED_SOURCE_STORAGE_KEY, JSON.stringify({ item, user: currentUser, check: currentCheck }));
  } catch {
    // Source page can restore from saved checks.
  }
  const params = new URLSearchParams({
    checkId: item.checkId || '',
    source: String(item.index)
  });
  window.location.href = `./source.html?${params.toString()}`;
}

function closeReport() {
  if (document.referrer && new URL(document.referrer).pathname.endsWith("/cabinet.html")) {
    history.back();
    return;
  }

  window.location.href = "./cabinet.html";
}

async function loadReport() {
  window.scrollTo(0, 0);
  const checkId = new URLSearchParams(window.location.search).get("id");
  if (!checkId) {
    showNotFound();
    return;
  }

  const selectedCheck = readSelectedReport(checkId);
  if (selectedCheck) {
    renderReport(selectedCheck);
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
  const check = checks.find(item => item.id === checkId);
  if (!check) {
    showNotFound();
    return;
  }

  renderReport(check);
}

document.addEventListener("click", (event) => {
  const sourceRow = event.target.closest("[data-open-source]");
  if (sourceRow) {
    openSource(sourceRow.dataset.openSource);
    return;
  }

  const heroClose = event.target.closest("[data-close-detail-hero]");
  if (heroClose) {
    heroClose.closest("[data-detail-hero]")?.remove();
    return;
  }

  const recommendationsClose = event.target.closest("[data-close-recommendations]");
  if (recommendationsClose) {
    recommendationsClose.closest(".recommendations-panel")?.remove();
    return;
  }

  if (!event.target.closest("[data-detail-back]")) return;
  closeReport();
});

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-open-source]")) {
    event.preventDefault();
    openSource(event.target.closest("[data-open-source]").dataset.openSource);
    return;
  }
  if (event.key === "Escape") closeReport();
});

loadReport();
