const title = document.querySelector("#auth-title");
const subtitle = document.querySelector("#auth-subtitle");
const card = document.querySelector("#auth-card-content");
const page = document.querySelector(".auth-page");
const copyBlock = document.querySelector(".auth-copy");
const cardBlock = document.querySelector(".auth-card");

const state = {
  view: "login",
  loginEmail: "",
  loginPassword: "",
  registerEmail: "",
  registerPassword: "",
  recoverEmail: "",
  otp: ["", "", "", "", "", ""],
  newPassword: "",
  repeatPassword: "",
  loginError: false,
  recoverCode: "",
  registerCode: "",
  codePurpose: "recovery",
  resetToken: "",
  pending: false,
  message: "",
  passwordVisible: {
    loginPassword: false,
    registerPassword: false,
    newPassword: false,
    repeatPassword: false
  }
};

const copy = {
  login: {
    title: "Вход в личный кабинет",
    subtitle: "Введите почту и пароль, чтобы продолжить работу с вашими темами и источниками"
  },
  filled: {
    title: "Данные введены",
    subtitle: "Почта распознана, пароль введен, кнопка входа активна."
  },
  error: {
    title: "Данные введены\nне верно",
    subtitle: "Проверьте пароль или восстановите доступ через почту."
  },
  register: {
    title: "Регистрация\nи создание аккаунта",
    subtitle: "Введите почту, а также придумайте пароль"
  },
  recover: {
    title: "Восстановление\nдоступа",
    subtitle: "Первый шаг восстановления: введите почту, на которую придет код подтверждения."
  },
  code: {
    title: "Введите из почты",
    subtitle: "Введите код который пришел вам на почту"
  },
  password: {
    title: "Придумай пароль",
    subtitle: "Придумай новый пароль для своего аккаунта"
  }
};

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPassword(value) {
  return value.length >= 8;
}

const API_ORIGIN = window.location.port === "5500" ? "http://localhost:3000" : "";

async function api(path, payload = {}) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function iconSvg(name) {
  const icons = {
    mail: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.75 6.75h14.5v10.5H4.75V6.75Z"></path>
        <path d="m5.25 7.25 6.75 5.5 6.75-5.5"></path>
      </svg>
    `,
    eye: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.75 12s3.25-5.25 9.25-5.25S21.25 12 21.25 12s-3.25 5.25-9.25 5.25S2.75 12 2.75 12Z"></path>
        <path d="M9.75 12a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0Z"></path>
      </svg>
    `,
    eyeClosed: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.25 13.25c1.45-2.45 3.7-3.75 6.75-3.75s5.3 1.3 6.75 3.75"></path>
        <path d="M7.7 15.1 6.45 17"></path>
        <path d="M12 15.65v2.1"></path>
        <path d="m16.3 15.1 1.25 1.9"></path>
      </svg>
    `,
    refresh: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.9 8.2A7.25 7.25 0 1 0 19 15"></path>
        <path d="M18.9 4.75v3.45h-3.45"></path>
      </svg>
    `
  };
  return icons[name] || "";
}

function field({ id, label, value = "", placeholder = "", type = "text", stateClass = "", note = "", icon = "", inputMode = "" }) {
  const isPasswordField = type === "password";
  const visible = Boolean(state.passwordVisible[id]);
  const inputType = isPasswordField && visible ? "text" : type;
  const iconName = isPasswordField ? (visible ? "eye" : "eyeClosed") : icon;

  return `
    <label class="auth-field ${note ? "with-note" : ""} ${stateClass}">
      <span>${label}</span>
      <input
        id="${id}"
        data-field="${id}"
        type="${inputType}"
        value="${esc(value)}"
        placeholder="${esc(placeholder)}"
        ${inputMode ? `inputmode="${inputMode}"` : ""}
        autocomplete="off"
      >
      ${isPasswordField ? `
        <button
          class="field-icon field-toggle ${visible ? "is-visible" : ""}"
          type="button"
          data-toggle-password="${id}"
          aria-label="${visible ? "Скрыть пароль" : "Показать пароль"}"
          aria-pressed="${visible ? "true" : "false"}"
        >
          ${iconSvg(iconName)}
        </button>
      ` : iconName ? `<i class="field-icon field-icon-${iconName}" aria-hidden="true">${iconSvg(iconName)}</i>` : ""}
      ${note ? `<p class="field-note">${note}</p>` : ""}
    </label>
  `;
}

function button(label, { kind = "", action = "", disabled = false } = {}) {
  return `
    <button class="auth-btn ${kind}" type="button" data-action="${action}" ${disabled ? "disabled" : ""}>
      ${label}
    </button>
  `;
}

function heroCard(titleText, text) {
  return `
    <div class="auth-hero-card">
      <h2>${titleText}</h2>
      <p>${text}</p>
    </div>
  `;
}

function actions(items, footnote = "") {
  return `
    <div class="auth-actions">
      ${items.join("")}
      ${state.message ? `<p class="auth-form-message">${state.message}</p>` : ""}
      ${footnote ? `<p class="auth-footnote">${footnote}</p>` : ""}
    </div>
  `;
}

function loginView() {
  const emailOk = isEmail(state.loginEmail);
  const passwordOk = isPassword(state.loginPassword);
  const ready = emailOk && passwordOk;
  const emailClass = emailOk ? "is-valid" : state.loginEmail ? "is-focus" : "";
  const passwordClass = state.loginError ? "is-error" : state.loginPassword ? "is-filled" : "";

  return `
    <div class="auth-stack">
      <div class="auth-fields">
        ${state.loginError ? `
          <div class="auth-alert">
            <span class="auth-alert-icon">!</span>
            <div>
              <strong>Не совпадает пароль</strong>
              <p>Проверьте раскладку или восстановите доступ через почту</p>
            </div>
          </div>
        ` : ""}
        ${field({
          id: "loginEmail",
          label: "Почта",
          value: state.loginEmail,
          placeholder: "email@example.com",
          stateClass: emailClass,
          note: emailOk ? "Почта введена корректно" : "",
          icon: "mail",
          inputMode: "email"
        })}
        ${field({
          id: "loginPassword",
          label: "Пароль",
          value: state.loginPassword,
          placeholder: "Введите пароль",
          type: "password",
          stateClass: passwordClass,
          note: state.loginError ? "Пароль неверный" : "",
          icon: "eye"
        })}
        ${state.loginError ? `
          <div class="auth-hint">
            <div>
              <strong>Быстрое восстановление</strong>
              <p>Код придет на эту же почту, пароль можно сменить за два шага</p>
            </div>
            <span class="auth-hint-icon">${iconSvg("refresh")}</span>
          </div>
        ` : ""}
      </div>
      ${actions([
        button(state.pending ? "Проверяем..." : state.loginError ? "Повторить вход" : "Войти", { kind: ready ? "gradient" : "disabled", action: "login", disabled: !ready || state.pending }),
        button(state.loginError ? "Восстановить пароль" : "Забыли пароль?", { kind: state.loginError ? "primary" : "", action: "recover" }),
        button(state.loginError ? "Вернуться к входу" : "Создать аккаунт", { action: state.loginError ? "clean-login" : "register" })
      ])}
    </div>
  `;
}

function registerView() {
  const emailOk = isEmail(state.registerEmail);
  const passwordOk = isPassword(state.registerPassword);
  const ready = emailOk && passwordOk;

  return `
    <div class="auth-stack">
      <div class="auth-fields compact">
        ${field({
          id: "registerEmail",
          label: "Почта",
          value: state.registerEmail,
          placeholder: "student@mail.ru",
          stateClass: state.registerEmail ? "is-focus" : "",
          note: emailOk ? "На эту почту придет подтверждение" : "",
          icon: "mail",
          inputMode: "email"
        })}
        ${field({
          id: "registerPassword",
          label: "Придумайте пароль",
          value: state.registerPassword,
          placeholder: "Минимум 8 символов",
          type: "password",
          stateClass: state.registerPassword ? "is-filled" : "",
          note: state.registerPassword && !passwordOk ? "Минимум 8 символов" : "",
          icon: "eye"
        })}
      </div>
      ${actions([
        button(state.pending ? "Создаем..." : "Создать аккаунт", { kind: ready ? "primary" : "disabled", action: "register-submit", disabled: !ready || state.pending }),
        button("Уже есть аккаунт", { action: "login-view" }),
        button("Забыли пароль?", { action: "recover" })
      ])}
    </div>
  `;
}

function recoverView() {
  const emailOk = isEmail(state.recoverEmail);
  const email = esc(state.recoverEmail || "student@mail.ru");

  return `
    <div class="auth-stack">
      <div class="auth-fields">
        ${heroCard("Введите код", `Мы отправим письмо на ${email}<br>Проверьте почту и введите код`)}
        ${field({
          id: "recoverEmail",
          label: "Почта",
          value: state.recoverEmail,
          placeholder: "student@mail.ru",
          stateClass: state.recoverEmail ? "is-focus" : "",
          note: emailOk ? "На эту почту придет код" : "",
          icon: "mail",
          inputMode: "email"
        })}
      </div>
      ${actions([
        button(state.pending ? "Отправляем..." : "Отправить код", { kind: emailOk ? "primary" : "disabled", action: "send-code", disabled: !emailOk || state.pending }),
        button("Вернуться ко входу", { action: "login-view" })
      ], "Код действует ограниченное время")}
    </div>
  `;
}

function codeView() {
  const code = state.otp.join("");
  const ready = code.length === 6;
  const isRegistration = state.codePurpose === "registration";
  const targetEmail = isRegistration ? state.registerEmail : state.recoverEmail;
  const devCode = isRegistration ? state.registerCode : state.recoverCode;

  return `
    <div class="auth-stack">
      <div class="auth-fields">
        ${heroCard("Введите код", `Мы отправили письмо на ${esc(targetEmail)}<br>Проверьте почту и введите 6 цифр`)}
        <div>
          <div class="otp-row" aria-label="Код подтверждения">
            ${state.otp.map((digit, index) => `
              <input
                class="otp-cell ${digit ? "" : "focus"}"
                data-otp="${index}"
                inputmode="numeric"
                maxlength="1"
                value="${esc(digit)}"
                aria-label="Цифра ${index + 1}"
              >
            `).join("")}
          </div>
          <p class="code-note">Код действует 10 минут.${devCode ? ` Демо-код: ${esc(devCode)}.` : ""}</p>
        </div>
      </div>
      ${actions([
        button(state.pending ? "Проверяем..." : "Подтвердить код", { kind: ready ? "primary" : "disabled", action: "confirm-code", disabled: !ready || state.pending }),
        button("Отправить код еще раз", { action: isRegistration ? "register-resend" : "recover" })
      ], "Не пришло письмо? Можно запросить код повторно")}
    </div>
  `;
}

function passwordView() {
  const firstOk = isPassword(state.newPassword);
  const bothOk = firstOk && state.repeatPassword === state.newPassword;

  return `
    <div class="auth-stack">
      <div class="auth-fields">
        ${heroCard("Придумайте пароль", "Пароль должен быть надежным и совпадать в двух полях.")}
        ${field({
          id: "newPassword",
          label: "Новый пароль",
          value: state.newPassword,
          placeholder: "Минимум 8 символов",
          type: "password",
          stateClass: state.newPassword ? "is-focus" : "",
          note: firstOk ? "Используйте буквы и цифры" : "",
          icon: "eye"
        })}
        ${field({
          id: "repeatPassword",
          label: "Повторите пароль",
          value: state.repeatPassword,
          placeholder: "Повторите пароль",
          type: "password",
          stateClass: state.repeatPassword && !bothOk ? "is-error" : state.repeatPassword ? "is-valid" : "",
          note: state.repeatPassword && !bothOk ? "Пароли не совпадают" : "",
          icon: "eye"
        })}
      </div>
      ${actions([
        button(state.pending ? "Сохраняем..." : "Сохранить пароль", { kind: bothOk ? "primary" : "disabled", action: "save-password", disabled: !bothOk || state.pending }),
        button("Вернуться ко входу", { action: "login-view" })
      ], "После сохранения можно войти с новым паролем")}
    </div>
  `;
}

function successView() {
  return `
    <div class="success-card">
      <span class="success-mark">✓</span>
      <h1>Авторизация прошла<br>успешно</h1>
      ${button("Перейти в кабинет", { kind: "gradient", action: "cabinet" })}
    </div>
  `;
}

const views = {
  login: loginView,
  register: registerView,
  recover: recoverView,
  code: codeView,
  password: passwordView,
  success: successView
};

function activeCopy() {
  if (state.view === "login") {
    if (state.loginError) return copy.error;
    if (isEmail(state.loginEmail) && isPassword(state.loginPassword)) return copy.filled;
  }
  return copy[state.view] || copy.login;
}

function normalizeView(view) {
  if (view === "filled") {
    state.loginEmail = state.loginEmail || "student@mail.ru";
    state.loginPassword = state.loginPassword || "12345678";
    state.loginError = false;
    return "login";
  }

  if (view === "error") {
    state.loginEmail = state.loginEmail || "student@mail.ru";
    state.loginPassword = state.loginPassword || "wrongpass";
    state.loginError = true;
    return "login";
  }

  return views[view] ? view : "login";
}

function setView(view) {
  state.view = normalizeView(view);
  const isSuccess = state.view === "success";
  const currentCopy = activeCopy();

  page.dataset.view = state.view;
  title.textContent = currentCopy.title || "";
  subtitle.textContent = currentCopy.subtitle || "";
  copyBlock.hidden = isSuccess;
  cardBlock.hidden = isSuccess;
  card.innerHTML = isSuccess ? "" : views[state.view]();

  document.querySelectorAll(".success-card").forEach((node) => node.remove());
  if (isSuccess) page.insertAdjacentHTML("beforeend", successView());

  if (location.hash.slice(1) !== state.view) {
    history.replaceState(null, "", `#${state.view}`);
  }
}

function rerender() {
  setView(state.view);
}

document.addEventListener("input", (event) => {
  const fieldName = event.target.dataset.field;
  if (fieldName && fieldName in state) {
    state[fieldName] = event.target.value;
    if (fieldName === "loginPassword") state.loginError = false;
    rerender();
    const next = document.querySelector(`[data-field="${fieldName}"]`);
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
    return;
  }

  const otpIndex = event.target.dataset.otp;
  if (otpIndex !== undefined) {
    state.otp[Number(otpIndex)] = event.target.value.replace(/\D/g, "").slice(0, 1);
    rerender();
    const nextIndex = state.otp[Number(otpIndex)] ? Math.min(Number(otpIndex) + 1, 5) : Number(otpIndex);
    document.querySelector(`[data-otp="${nextIndex}"]`)?.focus();
  }
});

document.addEventListener("keydown", (event) => {
  const otpIndex = event.target.dataset.otp;
  if (otpIndex === undefined || event.key !== "Backspace" || event.target.value) return;
  const prev = Math.max(Number(otpIndex) - 1, 0);
  state.otp[prev] = "";
  rerender();
  document.querySelector(`[data-otp="${prev}"]`)?.focus();
});

document.addEventListener("click", (event) => {
  const passwordToggle = event.target.closest("[data-toggle-password]");
  if (passwordToggle) {
    event.preventDefault();
    const fieldName = passwordToggle.dataset.togglePassword;
    if (fieldName in state.passwordVisible) {
      state.passwordVisible[fieldName] = !state.passwordVisible[fieldName];
      rerender();
      const input = document.querySelector(`[data-field="${fieldName}"]`);
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    return;
  }

  const trigger = event.target.closest("[data-action]");
  if (!trigger || trigger.disabled) return;

  const action = trigger.dataset.action;
  if (action === "cabinet") {
    window.location.href = "./cabinet.html";
    return;
  }

  if (action === "login") {
    state.pending = true;
    state.message = "";
    rerender();
    api("/api/auth/login", { email: state.loginEmail, password: state.loginPassword })
      .then(() => {
        window.location.href = "./cabinet.html";
      })
      .catch((error) => {
        state.loginError = true;
        state.message = error.message;
        setView("login");
      })
      .finally(() => {
        state.pending = false;
        rerender();
      });
    return;
  }

  if (action === "clean-login" || action === "login-view") {
    state.loginError = false;
    state.message = "";
    setView("login");
    return;
  }

  if (action === "register") {
    state.message = "";
    setView("register");
    return;
  }

  if (action === "register-submit") {
    state.pending = true;
    state.message = "";
    rerender();
    api("/api/auth/register/request", { email: state.registerEmail, password: state.registerPassword })
      .then((data) => {
        state.registerCode = data.devCode || "";
        state.codePurpose = "registration";
        state.otp = ["", "", "", "", "", ""];
        setView("code");
        document.querySelector("[data-otp='0']")?.focus();
      })
      .catch((error) => {
        state.message = error.message;
        setView("register");
      })
      .finally(() => {
        state.pending = false;
        rerender();
      });
    return;
  }

  if (action === "recover") {
    state.recoverEmail ||= state.loginEmail || state.registerEmail;
    state.message = "";
    setView("recover");
    return;
  }

  if (action === "register-resend") {
    state.message = "";
    setView("register");
    return;
  }

  if (action === "send-code") {
    state.pending = true;
    state.message = "";
    rerender();
    api("/api/auth/recover/request", { email: state.recoverEmail })
      .then((data) => {
        state.recoverCode = data.devCode || "";
        state.codePurpose = "recovery";
        state.otp = ["", "", "", "", "", ""];
        setView("code");
        document.querySelector("[data-otp='0']")?.focus();
      })
      .catch((error) => {
        state.message = error.message;
        setView("recover");
      })
      .finally(() => {
        state.pending = false;
        rerender();
      });
    return;
  }

  if (action === "confirm-code") {
    state.pending = true;
    state.message = "";
    rerender();
    const isRegistration = state.codePurpose === "registration";
    const endpoint = isRegistration ? "/api/auth/register/verify" : "/api/auth/recover/verify";
    const payload = isRegistration
      ? { email: state.registerEmail, code: state.otp.join("") }
      : { email: state.recoverEmail, code: state.otp.join("") };
    api(endpoint, payload)
      .then((data) => {
        if (isRegistration) {
          setView("success");
        } else {
          state.resetToken = data.resetToken;
          setView("password");
        }
      })
      .catch((error) => {
        state.message = error.message;
        setView("code");
      })
      .finally(() => {
        state.pending = false;
        rerender();
      });
    return;
  }

  if (action === "save-password") {
    state.pending = true;
    state.message = "";
    rerender();
    api("/api/auth/recover/reset", {
      email: state.recoverEmail,
      resetToken: state.resetToken,
      password: state.newPassword
    })
      .then(() => {
        state.loginEmail = state.recoverEmail;
        state.loginPassword = "";
        setView("success");
      })
      .catch((error) => {
        state.message = error.message;
        setView("password");
      })
      .finally(() => {
        state.pending = false;
        rerender();
      });
    return;
  }

  /*
   * Legacy/demo actions are kept below for direct hash compatibility while the
   * normal UI path above uses real API calls.
   */
  if (action === "demo-login") {
    const demoWrongPassword = state.loginPassword.toLowerCase().includes("wrong") || state.loginPassword.toLowerCase().includes("error");
    if (demoWrongPassword) {
      state.loginError = true;
      setView("login");
    } else {
      setView("success");
    }
  }
});

window.addEventListener("hashchange", () => setView(location.hash.slice(1)));
setView(location.hash.slice(1) || "login");
