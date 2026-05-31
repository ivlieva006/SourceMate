(function () {
  const supportButtons = document.querySelectorAll(".cabinet-support:not([data-burger-toggle])");
  if (!supportButtons.length) return;

  const API_ORIGIN_SUPPORT = window.location.port === "5500" ? "http://localhost:3000" : "";
  const history = [];

  const widget = document.createElement("section");
  widget.id = "support-widget";
  widget.className = "support-widget";
  widget.hidden = true;
  widget.setAttribute("role", "dialog");
  widget.setAttribute("aria-modal", "false");
  widget.setAttribute("aria-labelledby", "support-widget-title");
  widget.innerHTML = `
    <header class="support-head">
      <span class="support-brand">
        <span class="support-avatar" aria-hidden="true"></span>
        <span class="support-title">
          <strong id="support-widget-title">ИИ-поддержка SourceMate</strong>
          <small>Онлайн · отвечает в личном кабинете</small>
        </span>
      </span>
      <button class="support-close" type="button" aria-label="Закрыть поддержку">×</button>
    </header>

    <div class="support-body">
      <div class="support-messages" aria-live="polite"></div>
      <div class="support-quick" aria-label="Быстрые вопросы">
        <button class="is-primary" type="button" data-support-prompt="Объяснить отчёт">Объяснить отчёт</button>
        <button type="button" data-support-prompt="Как загрузить работу?">Загрузка работы</button>
        <button type="button" data-support-prompt="Найди источники для моей темы">Найти источники</button>
        <button type="button" data-support-prompt="Помоги с настройками профиля">Настройки</button>
      </div>
    </div>

    <form class="support-form">
      <label class="support-input">
        <span>Сообщение</span>
        <textarea rows="1" maxlength="1200" placeholder="Напишите сообщение..."></textarea>
      </label>
      <button class="support-send" type="submit" aria-label="Отправить сообщение">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 3 3.8 10.5c-.9.4-.9 1.6.1 1.9l6.4 2.1 2.1 6.4c.3 1 1.6 1 1.9.1L21 3Z"></path>
          <path d="m10.4 14.3 4.2-4.2"></path>
        </svg>
      </button>
    </form>
  `;
  document.body.appendChild(widget);

  const closeButton = widget.querySelector(".support-close");
  const messages = widget.querySelector(".support-messages");
  const form = widget.querySelector(".support-form");
  const input = widget.querySelector("textarea");
  const sendButton = widget.querySelector(".support-send");
  const quickButtons = widget.querySelectorAll("[data-support-prompt]");

  function syncModalOpenState() {
    const hasVisibleOverlay = [...document.querySelectorAll(".widget-overlay, .settings-overlay, .support-widget")]
      .some((item) => !item.hidden);
    if (!hasVisibleOverlay) document.body.classList.remove("modal-open");
  }

  function bringSupportToFront() {
    document.querySelectorAll(".widget-overlay, .settings-overlay, .support-widget").forEach((item) => {
      item.classList.toggle("is-top-modal", item === widget);
    });
  }

  function appendMessage(role, text, options = {}) {
    const item = document.createElement("article");
    item.className = `support-message ${role === "user" ? "is-user" : "is-ai"}`;
    if (options.pending) item.classList.add("is-pending");
    item.innerHTML = `
      <strong>${role === "user" ? "Вы" : "AI агент"}</strong>
      <p></p>
    `;
    item.querySelector("p").textContent = text;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  }

  function openSupport() {
    widget.hidden = false;
    bringSupportToFront();
    document.body.classList.add("support-open", "modal-open");
    supportButtons.forEach((button) => button.setAttribute("aria-expanded", "true"));
    if (!history.length) {
      const greeting = "Здравствуйте! Чем помочь сегодня? Могу объяснить отчёт, найти источник или помочь загрузить работу.";
      history.push({ role: "assistant", content: greeting });
      appendMessage("assistant", greeting);
    }
    setTimeout(() => input.focus(), 0);
  }

  function closeSupport() {
    widget.hidden = true;
    widget.classList.remove("is-top-modal");
    document.body.classList.remove("support-open");
    syncModalOpenState();
    supportButtons.forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  async function askSupport(message, previousHistory) {
    const response = await fetch(`${API_ORIGIN_SUPPORT}/api/support/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        message,
        history: previousHistory
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Не удалось получить ответ поддержки");
    return String(data.answer || "").trim();
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 116)}px`;
  }

  supportButtons.forEach((button) => {
    button.type = "button";
    button.setAttribute("aria-controls", "support-widget");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", openSupport);
  });

  closeButton.addEventListener("click", closeSupport);
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    form.requestSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    const previousHistory = history.slice(-8);
    history.push({ role: "user", content: message });
    appendMessage("user", message);
    input.value = "";
    resizeInput();
    input.disabled = true;
    sendButton.disabled = true;
    const pending = appendMessage("assistant", "Печатаю ответ...", { pending: true });

    try {
      const answer = await askSupport(message, previousHistory);
      pending.classList.remove("is-pending");
      pending.querySelector("p").textContent = answer;
      history.push({ role: "assistant", content: answer });
    } catch (error) {
      pending.classList.remove("is-pending");
      pending.querySelector("p").textContent = error.message || "ИИ-поддержка временно недоступна. Попробуйте позже.";
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  });

  quickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.supportPrompt || "";
      resizeInput();
      form.requestSubmit();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !widget.hidden) closeSupport();
  });

  window.addEventListener("pagehide", () => {
    closeSupport();
  });

  window.addEventListener("pageshow", () => {
    syncModalOpenState();
  });
}());
