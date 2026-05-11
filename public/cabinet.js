const fileInput = document.querySelector("#work-file");
const page = document.querySelector(".cabinet-page");
const dropzone = document.querySelector("[data-dropzone]");
const historyContent = document.querySelector("[data-history-content]");
const uploadTitle = document.querySelector("[data-upload-title]");
const uploadMeta = document.querySelector("[data-upload-meta]");
const welcome = document.querySelector("[data-welcome]");
const closeWelcome = document.querySelector("[data-close-welcome]");
const topicInput = document.querySelector("#check-topic");
const widget = document.querySelector("[data-upload-widget]");
const widgetTopicInput = document.querySelector("#widget-topic");
const widgetDropzone = document.querySelector("[data-widget-dropzone]");
const widgetUploadTitle = document.querySelector("[data-widget-upload-title]");
const widgetUploadMeta = document.querySelector("[data-widget-upload-meta]");
const checkButton = document.querySelector("[data-check-trigger]");
const resultBox = document.querySelector("[data-check-result]");
const successWidget = document.querySelector("[data-success-widget]");
const deleteWidget = document.querySelector("[data-delete-widget]");
const settingsWidget = document.querySelector("[data-settings-widget]");
const settingsNameInput = document.querySelector("[data-settings-name]");
const settingsRole = document.querySelector("[data-settings-role]");
const settingsEmail = document.querySelector("[data-settings-email]");
const settingsPasswordUpdated = document.querySelector("[data-settings-password-updated]");
const accountAvatars = document.querySelectorAll("[data-account-avatar]");
const cancelDeleteButton = document.querySelector("[data-cancel-delete]");
const confirmDeleteButton = document.querySelector("[data-confirm-delete]");
const sourcesPanel = document.querySelector("[data-sources-panel]");
const sourcesSubtitle = document.querySelector("[data-sources-subtitle]");
const sourceRows = document.querySelector("[data-source-rows]");
const API_ORIGIN = window.location.port === "5500" ? "http://localhost:3000" : "";
const CHECKS_STORAGE_KEY = "sourcemate.cabinet.checks.v1";
const STATE_STORAGE_KEY = "sourcemate.cabinet.state.v1";
const SELECTED_REPORT_STORAGE_KEY = "sourcemate.selectedReport.v1";
const SELECTED_SOURCE_STORAGE_KEY = "sourcemate.selectedSource.v1";
let selectedFile = null;
let checkType = "full";
let pendingUpload = null;
let currentUser = null;
let currentChecks = [];
let deleteTargetId = "";
let pendingCheck = null;
let currentSourceItems = [];

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

function writeCachedChecks(checks, user = currentUser) {
  try {
    localStorage.setItem(checksStorageKey(user), JSON.stringify(checks.slice(0, 20)));
  } catch {
    // Local storage can be unavailable in private mode; server storage still works.
  }
}

function readCabinetState(user = currentUser) {
  try {
    const value = localStorage.getItem(`${STATE_STORAGE_KEY}.${storageScope(user)}`);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function writeCabinetState(patch, user = currentUser) {
  try {
    const state = { ...readCabinetState(user), ...patch };
    localStorage.setItem(`${STATE_STORAGE_KEY}.${storageScope(user)}`, JSON.stringify(state));
  } catch {
    // Non-critical UI state.
  }
}

async function postJson(path, payload = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || "Ошибка запроса");
  return data;
}

async function postForm(path, form) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    credentials: "include",
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || "Ошибка запроса");
  return data;
}

function cacheCheck(check) {
  if (!check?.report) return null;
  const normalized = {
    ...check,
    createdAt: check.createdAt || Date.now(),
    report: {
      ...check.report,
      createdAt: check.report.createdAt || check.createdAt || Date.now()
    }
  };
  const existing = readCachedChecks().filter(item => item.id !== normalized.id);
  writeCachedChecks([normalized, ...existing]);
  localStorage.removeItem(CHECKS_STORAGE_KEY);
  return normalized;
}

function cacheReport(report) {
  const createdAt = Date.now();
  return cacheCheck({
    id: `local-${createdAt}`,
    report: { ...report, createdAt },
    createdAt
  });
}

function removeCachedCheck(checkId) {
  if (!checkId) return;
  writeCachedChecks(readCachedChecks().filter(check => check.id !== checkId));
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

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function selectFile(file) {
  if (!file) return;
  selectedFile = file;
  uploadTitle.textContent = file.name;
  uploadMeta.textContent = `Файл выбран, размер ${formatSize(file.size)}. Нажмите кнопку, чтобы запустить проверку.`;
  widgetUploadTitle.textContent = file.name;
  widgetUploadMeta.textContent = `Файл выбран, размер ${formatSize(file.size)}`;
  dropzone.classList.remove("is-drag");
  widgetDropzone.classList.remove("is-drag");
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResult(report) {
  const matches = report.matches?.length
    ? `<ul class="result-list">${report.matches.slice(0, 5).map((match) => `
        <li>
          <strong>${esc(match.title)}</strong> — ${Math.round(match.score)}%
          ${match.url ? `<br><a href="${esc(match.url)}" target="_blank" rel="noreferrer">Открыть источник</a>` : ""}
        </li>
      `).join("")}</ul>`
    : `<ul class="result-list"><li>Заметных совпадений с найденными источниками не обнаружено.</li></ul>`;

  resultBox.hidden = false;
  resultBox.classList.remove("is-error");
  resultBox.innerHTML = `
    <h3>Отчет готов</h3>
    <div class="result-metrics">
      <div><strong>${Math.round(report.originality)}%</strong><span>Оригинальность</span></div>
      <div><strong>${Math.round(report.similarity)}%</strong><span>Совпадения</span></div>
      <div><strong>${report.sourcesChecked}</strong><span>Источников</span></div>
    </div>
    ${matches}
  `;
}

function renderError(message) {
  resultBox.hidden = false;
  resultBox.classList.add("is-error");
  resultBox.innerHTML = `<h3>Не удалось проверить файл</h3><ul class="result-list"><li>${esc(message)}</li></ul>`;
}

function trashIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 6.5h15"></path>
      <path d="M9 6.5V4.75h6V6.5"></path>
      <path d="M7 6.5 8 19h8l1-12.5"></path>
      <path d="M10.25 10.25v5"></path>
      <path d="M13.75 10.25v5"></path>
    </svg>
  `;
}

function scoreClass(score) {
  if (score >= 88) return "good";
  if (score >= 78) return "warn";
  return "mid";
}

function currentTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function rowTemplate({ id = "", title, meta, score, url = "", pending = false, createdAt = Date.now(), deletable = false, openable = false }) {
  const scoreValue = Math.max(0, Math.min(100, Math.round(score || 0)));
  const time = currentTimeLabel(new Date(createdAt));
  const deleteButton = deletable
    ? `<button class="row-delete" type="button" data-delete-check="${esc(id)}" aria-label="Удалить запись">${trashIcon()}</button>`
    : "";
  const openAttrs = openable ? ` data-open-check="${esc(id)}" role="button" tabindex="0"` : "";
  const content = `
    <div class="row-main">
      <strong>${esc(title)}</strong>
      <span>${esc(meta)}</span>
    </div>
    <div class="row-meta">
      <time>Сегодня, ${time}</time>
      <span class="score-badge ${pending ? "pending" : scoreClass(scoreValue)}">${pending ? "проверка" : `${scoreValue}%`}</span>
      ${deleteButton}
    </div>
  `;
  return url
    ? `<a class="cabinet-row" href="${esc(url)}" target="_blank" rel="noreferrer">${content}</a>`
    : `<div class="cabinet-row${openable ? " is-openable" : ""}"${openAttrs}>${content}</div>`;
}

function sourceRowTemplate({ index, title, meta, score }) {
  const scoreValue = Math.max(0, Math.min(100, Math.round(score || 0)));
  return `
    <div class="cabinet-row is-openable" data-open-source="${index}" role="button" tabindex="0">
      <div class="row-main">
        <strong>${esc(title)}</strong>
        <span>${esc(meta)}</span>
      </div>
      <div class="row-meta">
        <span class="score-badge ${scoreClass(scoreValue)}">${scoreValue}%</span>
      </div>
    </div>
  `;
}

function applyStat(name, value, note, extraClass = "") {
  const card = document.querySelector(`[data-stat-card="${name}"]`);
  if (!card) return;
  card.querySelector("[data-stat-value]").textContent = value;
  const noteNode = card.querySelector("[data-stat-note]");
  noteNode.textContent = note;
  noteNode.className = extraClass;
}

function reportRow(check) {
  const report = check.report || {};
  return rowTemplate({
    id: check.id,
    title: report.topic || report.filename || "Загруженная работа",
    meta: `${report.filename || "документ"} · ${report.words || 0} слов`,
    score: report.originality,
    createdAt: check.createdAt,
    deletable: Boolean(check.id),
    openable: Boolean(check.id)
  });
}

function pendingRow(check) {
  return rowTemplate({
    id: check.id,
    title: check.title,
    meta: check.meta,
    score: 0,
    pending: true,
    createdAt: check.createdAt
  });
}

function renderHistory(checks = currentChecks) {
  const rows = [
    pendingCheck ? pendingRow(pendingCheck) : "",
    ...checks.map(reportRow)
  ].filter(Boolean).join("");

  historyContent.innerHTML = `
    <div class="history-list">
      <div class="history-items">
        ${rows}
      </div>
    </div>
  `;
}

function applyPendingState() {
  const title = widgetTopicInput.value.trim() || topicInput.value.trim() || selectedFile?.name?.replace(/\.[^.]+$/, "") || "Загруженная работа";
  const meta = selectedFile ? `${selectedFile.name} · ${formatSize(selectedFile.size)}` : "Файл загружен";

  pendingUpload = { title, meta };
  pendingCheck = { id: `pending-${Date.now()}`, title, meta, createdAt: Date.now() };
  page.classList.add("is-used");
  welcome.classList.add("is-hidden");
  fileInput.remove();
  document.body.appendChild(fileInput);
  sourcesPanel.hidden = !currentChecks.length;

  applyStat("originality", "—", "идет проверка", "");
  applyStat("sources", "—", "ищем источники", "");
  applyStat("checks", String(currentChecks.length + 1), "проверка запущена", "");
  applyStat("projects", "1", "проверяется", "warning");

  updateProfileName();
  renderHistory();
}

function updateProfileName() {
  const name = currentUser?.name || (currentUser?.email ? currentUser.email.split("@")[0] : "Имя Фамилия");
  const role = currentUser?.role || "Студент · Московский политех";
  document.querySelector("[data-profile-name]").textContent = name;
  if (settingsNameInput) {
    if ("value" in settingsNameInput) settingsNameInput.value = name;
    else settingsNameInput.textContent = name;
  }
  if (settingsRole) settingsRole.textContent = role;
  if (settingsEmail) settingsEmail.textContent = currentUser?.email || "student@mail.ru";
  if (settingsPasswordUpdated) settingsPasswordUpdated.textContent = formatPasswordUpdated(currentUser?.passwordUpdatedAt);
  accountAvatars.forEach((avatar) => {
    if (currentUser?.avatarUrl) {
      avatar.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
      avatar.classList.add("has-image");
    } else {
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-image");
    }
  });
  applyAccountSettings();
}

function formatPasswordUpdated(timestamp) {
  if (!timestamp) return "Обновлен недавно";
  const diffDays = Math.max(0, Math.round((Date.now() - Number(timestamp)) / (24 * 60 * 60 * 1000)));
  if (diffDays === 0) return "Обновлен сегодня";
  if (diffDays === 1) return "Обновлен вчера";
  return `Обновлен ${diffDays} дней назад`;
}

function applyAccountSettings() {
  const settings = currentUser?.settings || {};
  document.querySelectorAll("[data-setting-select]").forEach((button) => {
    const key = button.dataset.settingSelect;
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    button.dataset.settingValue = settings[key];
    const label = button.querySelector("strong");
    if (label) label.textContent = settings[key];
  });
  document.querySelectorAll("[data-setting-toggle]").forEach((input) => {
    const key = input.dataset.settingToggle;
    if (Object.prototype.hasOwnProperty.call(settings, key)) input.checked = Boolean(settings[key]);
  });
}

function applyWelcomeState() {
  if (readCabinetState().welcomeHidden) {
    welcome.classList.add("is-hidden");
  }
}

function renderReports(checks) {
  currentChecks = Array.isArray(checks) ? checks : [];
  document.querySelector(".stats-grid").hidden = false;
  document.querySelector(".cabinet-main").hidden = false;
  const reports = checks.map(check => ({ ...check.report, checkId: check.id, createdAt: check.createdAt }));
  if (!reports.length) {
    updateProfileName();
    applyWelcomeState();
    return;
  }

  const latest = reports[0];
  const originalityValues = reports.map(report => Number(report.originality) || 0);
  const avgOriginality = Math.round(originalityValues.reduce((sum, value) => sum + value, 0) / originalityValues.length);
  const sourcesCount = latest.sourcesChecked || latest.sourceItems?.length || 0;
  const activeProjects = reports.length;

  page.classList.add("is-used");
  welcome.classList.add("is-hidden");
  sourcesPanel.hidden = false;
  updateProfileName();

  applyStat("originality", `${avgOriginality}%`, `последняя ${Math.round(latest.originality || 0)}%`, "");
  applyStat("sources", String(sourcesCount), latest.sourcesFetched ? `${latest.sourcesFetched} текстов загружено` : "по последней теме", "");
  applyStat("checks", String(reports.length), "сохранено в кабинете", "");
  applyStat("projects", String(activeProjects), activeProjects === 1 ? "проект в работе" : "проектов в работе", activeProjects ? "warning" : "");

  renderHistory(currentChecks);

  renderSources(latest);
}

function renderDetail(checkId) {
  if (!checkId) return;
  const check = currentChecks.find(item => item.id === checkId);
  if (check) {
    try {
      sessionStorage.setItem(SELECTED_REPORT_STORAGE_KEY, JSON.stringify({ check, user: currentUser }));
    } catch {
      // The report page can still load from API/localStorage.
    }
  }
  window.location.href = `./report.html?id=${encodeURIComponent(checkId)}`;
}

function renderSources(report) {
  const title = report.topic || report.filename || "Загруженная работа";
  const sourceItems = report.sourceItems || [];
  const matches = report.matches || [];
  const check = currentChecks.find(item => item.report === report || item.report?.generatedAt === report.generatedAt || item.report?.topic === report.topic);

  sourcesPanel.hidden = false;
  sourcesSubtitle.textContent = `Подборка по последней теме: «${title}»`;
  currentSourceItems = (sourceItems.length ? sourceItems : matches).map((source, index) => ({
    checkId: check?.id || currentChecks[0]?.id || '',
    index,
    source,
    reportTopic: title,
    reportFilename: report.filename || '',
    reportGeneratedAt: report.generatedAt || ''
  }));
  const sourceData = sourceItems.length
    ? sourceItems.map((source, index) => ({
        index,
        title: source.title,
        meta: [source.source, source.year].filter(Boolean).join(" · ") || "Рекомендованный источник",
        score: source.score || 0,
        createdAt: report.createdAt
      }))
    : matches.map((match, index) => ({
        index,
        title: match.title,
        meta: [match.source, match.fetched ? "текст загружен" : ""].filter(Boolean).join(" · ") || "Рекомендованный источник",
        score: Math.max(70, 100 - Math.round(match.score || 0)),
        createdAt: report.createdAt
      }));
  sourceRows.innerHTML = sourceData.length
    ? sourceData.map(sourceRowTemplate).join("")
    : `<div class="cabinet-row"><div class="row-main"><strong>Источники не найдены</strong><span>Попробуйте уточнить тему работы</span></div></div>`;
}

function openSource(index) {
  const item = currentSourceItems[Number(index)];
  if (!item) return;
  try {
    sessionStorage.setItem(SELECTED_SOURCE_STORAGE_KEY, JSON.stringify({ item, user: currentUser }));
  } catch {
    // Source page can try to restore from saved checks.
  }
  const params = new URLSearchParams({
    checkId: item.checkId || '',
    source: String(item.index)
  });
  window.location.href = `./source.html?${params.toString()}`;
}

function applyReadyState(report) {
  document.querySelector(".stats-grid").hidden = false;
  document.querySelector(".cabinet-main").hidden = false;
  const originality = Math.round(report.originality || 0);
  const sourceCount = report.sourcesChecked || report.sourceItems?.length || report.matches?.length || 0;
  const title = pendingUpload?.title || report.topic || report.filename || "Загруженная работа";

  page.classList.add("is-used");
  welcome.classList.add("is-hidden");

  applyStat("originality", `${originality}%`, `совпадения ${Math.round(report.similarity || 0)}%`, "");
  applyStat("sources", String(sourceCount), report.sourcesFetched ? `${report.sourcesFetched} текстов загружено` : "найдено по теме", "");
  applyStat("checks", String(currentChecks.length || 1), "готово", "");
  applyStat("projects", String(currentChecks.length || 1), "отчет готов", "warning");

  updateProfileName();

  renderSources({ ...report, topic: title });
}

function applyFailedState(message) {
  if (!pendingUpload) {
    renderError(message);
    return;
  }

  applyStat("originality", "—", "ошибка проверки", "warning");
  applyStat("sources", "0", "не удалось получить", "warning");
  applyStat("checks", String(currentChecks.length + 1), "нужно повторить", "warning");
  applyStat("projects", "1", "требует внимания", "warning");
  pendingCheck = pendingCheck ? { ...pendingCheck, meta: message } : null;
  renderHistory();
  renderError(message);
}

function showSuccessWidget() {
  successWidget.hidden = false;
  document.body.classList.add("modal-open");
}

function openDeleteWidget(checkId) {
  deleteTargetId = checkId;
  deleteWidget.hidden = false;
  document.body.classList.add("modal-open");
  cancelDeleteButton.focus();
}

function closeDeleteWidget() {
  deleteTargetId = "";
  deleteWidget.hidden = true;
  confirmDeleteButton.disabled = false;
  confirmDeleteButton.textContent = "Удалить";
  document.body.classList.remove("modal-open");
}

function renderEmptyCabinet() {
  currentChecks = [];
  document.querySelector(".stats-grid").hidden = false;
  document.querySelector(".cabinet-main").hidden = false;
  page.classList.remove("is-used");
  sourcesPanel.hidden = true;
  applyStat("originality", "0", "появится после проверок", "");
  applyStat("sources", "0", "появятся после темы", "");
  applyStat("checks", "0", "стартовая статистика", "");
  applyStat("projects", "Нет", "добавьте тему", "warning");
  historyContent.innerHTML = `
    <div class="empty-history">
      <h3>Вы еще ничего не загружали</h3>
      <p>Добавьте работу, чтобы SourceMate собрал отчет и источники.</p>
      <button class="upload-button" type="button" data-open-upload-widget>Загрузить и проверить</button>
    </div>
  `;
}

async function deleteCheck(checkId) {
  if (!checkId) return;
  confirmDeleteButton.disabled = true;
  confirmDeleteButton.textContent = "Удаляем...";

  if (checkId.startsWith("local-") || !currentUser) {
    removeCachedCheck(checkId);
    const nextChecks = currentChecks.filter(check => check.id !== checkId);
    writeCachedChecks(nextChecks);
    closeDeleteWidget();
    if (nextChecks.length) renderReports(nextChecks);
    else renderEmptyCabinet();
    return;
  }

  try {
    const response = await fetch(`${API_ORIGIN}/api/cabinet/check/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ checkId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Не удалось удалить запись");
    removeCachedCheck(checkId);
    const nextChecks = data.checks || currentChecks.filter(check => check.id !== checkId);
    writeCachedChecks(nextChecks);
    closeDeleteWidget();
    if (nextChecks.length) renderReports(nextChecks);
    else renderEmptyCabinet();
  } catch (error) {
    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "Повторить";
  }
}

async function checkInBackground(form) {
  try {
    const response = await fetch(`${API_ORIGIN}/api/antiplagiarism/check`, {
      method: "POST",
      body: form,
      credentials: "include"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Ошибка проверки");
    const cachedCheck = data.check ? cacheCheck(data.check) : cacheReport(data.report);
    pendingCheck = null;
    currentChecks = mergeChecks([cachedCheck], currentChecks);
    renderReports(currentChecks);
    applyReadyState({ ...cachedCheck.report, createdAt: cachedCheck.createdAt });
    loadCabinetState();
  } catch (error) {
    applyFailedState(error.message);
  } finally {
    checkButton.disabled = false;
    checkButton.textContent = "Загрузить и проверить";
  }
}

async function loadCabinetState() {
  try {
    const response = await fetch(`${API_ORIGIN}/api/cabinet/state`, {
      credentials: "include"
    });
    const data = await response.json().catch(() => ({}));
    currentUser = data.user || null;
    const cachedChecks = readCachedChecks(currentUser);
    if (!response.ok || data.ok === false) {
      renderReports(cachedChecks);
      return;
    }
    updateProfileName();
    const serverChecks = data.checks || [];
    const checks = mergeChecks(serverChecks, cachedChecks);
    if (checks.length) {
      writeCachedChecks(checks);
      renderReports(checks);
    } else {
      renderReports([]);
    }
  } catch {
    const cachedChecks = readCachedChecks(currentUser);
    updateProfileName();
    renderReports(cachedChecks);
  }
}

async function runCheck() {
  if (!selectedFile) {
    fileInput.click();
    return;
  }

  if (widgetTopicInput.value.trim()) {
    topicInput.value = widgetTopicInput.value.trim();
  }

  const form = new FormData();
  form.append("file", selectedFile);
  form.append("topic", topicInput.value.trim());
  form.append("checkType", checkType);

  checkButton.disabled = true;
  checkButton.textContent = "Проверяем...";
  widget.hidden = true;
  resultBox.hidden = true;
  resultBox.classList.remove("is-error");
  applyPendingState();
  showSuccessWidget();
  checkInBackground(form);
}

document.querySelectorAll("[data-upload-trigger]").forEach((button) => {
  button.addEventListener("click", () => fileInput.click());
});

function openWidget() {
  widgetTopicInput.value = topicInput.value;
  widget.hidden = false;
  document.body.classList.add("modal-open");
  widgetTopicInput.focus();
}

function closeWidget() {
  widget.hidden = true;
  if (settingsWidget.hidden && successWidget.hidden && deleteWidget.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function openSettings() {
  settingsWidget.hidden = false;
  document.body.classList.add("modal-open");
  settingsWidget.querySelector("[data-close-settings]").focus();
}

function closeSettings() {
  settingsWidget.hidden = true;
  if (widget.hidden && successWidget.hidden && deleteWidget.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function setSettingsTab(tab) {
  document.querySelectorAll("[data-settings-tab]").forEach((item) => {
    item.classList.toggle("active", item.dataset.settingsTab === tab);
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  });
}

function applyUserFromResponse(data) {
  if (data?.user) {
    currentUser = data.user;
    updateProfileName();
  }
}

async function saveProfile(patch) {
  const data = await postJson("/api/account/profile", {
    name: currentUser?.name || settingsNameInput?.textContent || "",
    role: currentUser?.role || settingsRole?.textContent || "",
    email: currentUser?.email || settingsEmail?.textContent || "",
    ...patch
  });
  applyUserFromResponse(data);
  return data;
}

async function uploadAvatar() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.style.display = "none";
  document.body.appendChild(input);
  input.click();
  await new Promise((resolve) => input.addEventListener("change", resolve, { once: true }));
  const file = input.files?.[0];
  input.remove();
  if (!file) return;
  const form = new FormData();
  form.append("avatar", file);
  const data = await postForm("/api/account/avatar", form);
  applyUserFromResponse(data);
  alert("Фото профиля обновлено");
}

async function changePassword() {
  const currentInput = document.querySelector("[data-password-current]");
  const newInput = document.querySelector("[data-password-new]");
  const currentPassword = currentInput?.value || prompt("Введите текущий пароль") || "";
  const newPassword = newInput?.value || prompt("Введите новый пароль, минимум 8 символов") || "";
  if (!currentPassword || !newPassword) return;
  const data = await postJson("/api/account/password", { currentPassword, newPassword });
  applyUserFromResponse(data);
  if (currentInput) currentInput.value = "";
  if (newInput) newInput.value = "";
  alert("Пароль обновлен");
}

async function saveSettings(patch) {
  const data = await postJson("/api/account/settings", patch);
  applyUserFromResponse(data);
  return data;
}

async function handleAccountAction(action) {
  try {
    if (action === "profile") {
      const name = prompt("Имя профиля", currentUser?.name || settingsNameInput?.textContent || "");
      if (name === null) return;
      const role = prompt("Роль", currentUser?.role || settingsRole?.textContent || "");
      if (role === null) return;
      await saveProfile({ name, role });
      alert("Профиль сохранен");
      return;
    }

    if (action === "email") {
      const email = prompt("Новая почта", currentUser?.email || settingsEmail?.textContent || "");
      if (email === null) return;
      await saveProfile({ email });
      alert("Почта обновлена. Для новой почты потребуется подтверждение.");
      return;
    }

    if (action === "avatar") {
      await uploadAvatar();
      return;
    }

    if (action === "password" || action === "password-tab") {
      if (action === "password-tab") setSettingsTab("security");
      await changePassword();
      return;
    }

    if (action === "revoke-other") {
      if (!confirm("Завершить все другие сессии аккаунта?")) return;
      await postJson("/api/account/sessions/revoke-other");
      alert("Другие сессии завершены");
      return;
    }

    if (action === "logout") {
      await postJson("/api/auth/logout");
      window.location.href = "./auth.html";
      return;
    }

    if (action === "delete") {
      if (!confirm("Удалить аккаунт, проверки и все данные? Это действие нельзя отменить.")) return;
      const password = prompt("Введите пароль для удаления аккаунта");
      if (!password) return;
      await postJson("/api/account/delete", { password });
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = "./auth.html";
      return;
    }

    if (action === "mfa") {
      const data = await postJson("/api/account/mfa/request");
      alert(data.message || "MFA пока недоступна");
      return;
    }

    if (action === "quiet-save") {
      const quietMode = Boolean(document.querySelector("[data-setting-toggle='quietMode']")?.checked);
      await saveSettings({ quietMode });
      alert("Тихий режим сохранен");
      return;
    }

    if (action === "security-log") {
      alert("Журнал безопасности пока доступен как заглушка. Полный аудит событий будет подключен позже.");
    }
  } catch (error) {
    alert(error.message || "Не удалось выполнить действие");
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-upload-widget]");
  if (!button) return;
  openWidget();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-settings]");
  if (!button) return;
  openSettings();
});

document.querySelectorAll("[data-close-upload-widget]").forEach((button) => {
  button.addEventListener("click", closeWidget);
});

document.querySelectorAll("[data-close-success-widget]").forEach((button) => {
  button.addEventListener("click", () => {
    successWidget.hidden = true;
    document.body.classList.remove("modal-open");
  });
});

widget.addEventListener("click", (event) => {
  if (event.target === widget) closeWidget();
});

deleteWidget.addEventListener("click", (event) => {
  if (event.target === deleteWidget) closeDeleteWidget();
});

settingsWidget.addEventListener("click", (event) => {
  if (event.target === settingsWidget) closeSettings();
});

document.querySelectorAll("[data-close-settings]").forEach((button) => {
  button.addEventListener("click", closeSettings);
});

document.querySelectorAll("[data-settings-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setSettingsTab(button.dataset.settingsTab);
  });
});

settingsWidget.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-account-action]");
  if (actionButton) {
    await handleAccountAction(actionButton.dataset.accountAction);
    return;
  }

  const selectButton = event.target.closest("[data-setting-select]");
  if (selectButton) {
    const key = selectButton.dataset.settingSelect;
    const currentValue = selectButton.dataset.settingValue || selectButton.querySelector("strong")?.textContent || "";
    const value = prompt("Новое значение", currentValue);
    if (value === null) return;
    selectButton.dataset.settingValue = value;
    const label = selectButton.querySelector("strong");
    if (label) label.textContent = value;
    try {
      await saveSettings({ [key]: value });
    } catch (error) {
      alert(error.message || "Не удалось сохранить настройку");
    }
  }
});

settingsWidget.addEventListener("change", async (event) => {
  const toggle = event.target.closest("[data-setting-toggle]");
  if (!toggle) return;
  try {
    await saveSettings({ [toggle.dataset.settingToggle]: Boolean(toggle.checked) });
  } catch (error) {
    toggle.checked = !toggle.checked;
    alert(error.message || "Не удалось сохранить настройку");
  }
});

document.querySelectorAll(".banner-dismiss").forEach((button) => {
  button.addEventListener("click", () => {
    button.closest(".settings-banner").hidden = true;
  });
});

cancelDeleteButton.addEventListener("click", closeDeleteWidget);
confirmDeleteButton.addEventListener("click", () => deleteCheck(deleteTargetId));

historyContent.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-check]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    openDeleteWidget(deleteButton.dataset.deleteCheck);
    return;
  }

  const row = event.target.closest("[data-open-check]");
  if (!row) return;
  renderDetail(row.dataset.openCheck);
});

historyContent.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("[data-delete-check]")) return;
  const row = event.target.closest("[data-open-check]");
  if (!row) return;
  event.preventDefault();
  renderDetail(row.dataset.openCheck);
});

sourceRows.addEventListener("click", (event) => {
  const row = event.target.closest("[data-open-source]");
  if (!row) return;
  openSource(row.dataset.openSource);
});

sourceRows.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-open-source]");
  if (!row) return;
  event.preventDefault();
  openSource(row.dataset.openSource);
});

closeWelcome.addEventListener("click", () => {
  welcome.classList.add("is-hidden");
  writeCabinetState({ welcomeHidden: true });
});

checkButton.addEventListener("click", runCheck);

document.querySelectorAll("[data-check-type]").forEach((button) => {
  button.addEventListener("click", () => {
    checkType = button.dataset.checkType;
    document.querySelectorAll("[data-check-type]").forEach((item) => item.classList.toggle("active", item === button));
  });
});

fileInput.addEventListener("change", () => {
  selectFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-drag");
  });
});

dropzone.addEventListener("drop", (event) => {
  selectFile(event.dataTransfer.files[0]);
});

widgetDropzone.addEventListener("click", () => fileInput.click());

["dragenter", "dragover"].forEach((eventName) => {
  widgetDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    widgetDropzone.classList.add("is-drag");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  widgetDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    widgetDropzone.classList.remove("is-drag");
  });
});

widgetDropzone.addEventListener("drop", (event) => {
  selectFile(event.dataTransfer.files[0]);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !widget.hidden) closeWidget();
  if (event.key === "Escape" && !settingsWidget.hidden) closeSettings();
  if (event.key === "Escape" && !successWidget.hidden) {
    successWidget.hidden = true;
    document.body.classList.remove("modal-open");
  }
  if (event.key === "Escape" && !deleteWidget.hidden) closeDeleteWidget();
});

applyWelcomeState();
loadCabinetState();
