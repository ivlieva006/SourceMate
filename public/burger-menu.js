(function () {
  const isIndex = /(?:^|\/)index\.html$/.test(window.location.pathname) || window.location.pathname === "/";
  if (isIndex) return;

  const isMobile = window.matchMedia("(max-width: 680px)").matches;
  const authPage = document.querySelector(".auth-page");
  const API_ORIGIN = window.location.port === "5500" ? "http://localhost:3000" : "";
  let toggle = document.querySelector("[data-burger-toggle]");

  if (authPage) return;

  if (!toggle && isMobile) {
    toggle = document.querySelector(".cabinet-support");
  }

  if (!toggle) return;

  function clearBodyBurgerLock() {
    document.body.classList.remove("burger-open");
    document.documentElement.classList.remove("burger-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    delete document.body.dataset.burgerScrollY;
  }

  function cabinetSettingsHref() {
    const params = new URLSearchParams({
      settings: "1",
      return: `${window.location.pathname}${window.location.search}${window.location.hash}`
    });
    return `./cabinet.html?${params.toString()}`;
  }

  toggle.type = "button";
  toggle.dataset.burgerToggle = "true";
  toggle.setAttribute("aria-label", "Открыть меню");
  toggle.setAttribute("aria-expanded", "false");

  let drawer = document.querySelector("[data-burger-drawer]");
  if (!drawer) {
    drawer = document.createElement("aside");
    drawer.className = "burger-drawer";
    drawer.dataset.burgerDrawer = "true";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "Меню SourceMate");
    drawer.innerHTML = `
      <a class="burger-profile" href="./cabinet.html">
        <span class="burger-avatar" data-burger-avatar data-account-avatar>SM</span>
        <span class="burger-profile-text">
          <strong data-burger-name>SourceMate</strong>
          <small data-burger-plan>Free · новый кабинет</small>
        </span>
        <span class="burger-arrow">›</span>
      </a>
      <span class="burger-divider" aria-hidden="true"></span>
      <a class="burger-item" href="${cabinetSettingsHref()}">
        <span class="burger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.75 1.75 0 0 0 .35 1.94l.05.05a2.1 2.1 0 1 1-2.97 2.97l-.05-.05a1.75 1.75 0 0 0-1.94-.35 1.75 1.75 0 0 0-1.06 1.6v.14a2.1 2.1 0 1 1-4.2 0v-.14a1.75 1.75 0 0 0-1.06-1.6 1.75 1.75 0 0 0-1.94.35l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05A1.75 1.75 0 0 0 4.02 15a1.75 1.75 0 0 0-1.6-1.06h-.14a2.1 2.1 0 1 1 0-4.2h.14a1.75 1.75 0 0 0 1.6-1.06 1.75 1.75 0 0 0-.35-1.94l-.05-.05A2.1 2.1 0 1 1 6.59 3.7l.05.05a1.75 1.75 0 0 0 1.94.35 1.75 1.75 0 0 0 1.06-1.6v-.14a2.1 2.1 0 1 1 4.2 0v.14a1.75 1.75 0 0 0 1.06 1.6 1.75 1.75 0 0 0 1.94-.35l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.75 1.75 0 0 0-.35 1.94 1.75 1.75 0 0 0 1.6 1.06h.14a2.1 2.1 0 1 1 0 4.2h-.14A1.75 1.75 0 0 0 19.4 15Z"></path>
          </svg>
        </span>
        <span class="burger-copy">
          <strong>Настройки</strong>
          <small>Профиль, безопасность, уведомления</small>
        </span>
        <span class="burger-arrow">›</span>
      </a>
      <button class="burger-item" type="button" data-burger-support>
        <span class="burger-icon">?</span>
        <span class="burger-copy">
          <strong>Поддержка</strong>
          <small>Помощь по отчетам и загрузке</small>
        </span>
        <span class="burger-arrow">›</span>
      </button>
      <a class="burger-item" href="./subscription.html">
        <span class="burger-icon">★</span>
        <span class="burger-copy">
          <strong>Подписка</strong>
          <small>Free, Student, Pro и Team</small>
        </span>
        <span class="burger-arrow">›</span>
      </a>
    `;
    document.body.appendChild(drawer);
  } else if (drawer.parentElement !== document.body) {
    document.body.appendChild(drawer);
  }

  function initialsFrom(name, email) {
    const source = String(name || email || "SourceMate").trim();
    const parts = source.includes("@") ? [source.split("@")[0]] : source.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase();
  }

  function applyBurgerUser(user) {
    if (!user) return;
    const name = user.name || (user.email ? user.email.split("@")[0] : "SourceMate");
    const plan = user.subscription?.planName || "Free";
    const initials = initialsFrom(name, user.email);
    const avatar = drawer.querySelector("[data-burger-avatar]");
    const nameNode = drawer.querySelector("[data-burger-name]");
    const planNode = drawer.querySelector("[data-burger-plan]");

    if (nameNode) nameNode.textContent = name;
    if (planNode) planNode.textContent = `${plan} · личный кабинет`;
    if (!avatar) return;

    avatar.dataset.initials = initials;
    if (user.avatarUrl) {
      avatar.style.backgroundImage = `url("${user.avatarUrl}")`;
      avatar.classList.add("has-image");
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-image");
      avatar.textContent = initials;
    }
  }

  function hydrateBurgerUserFromStorage() {
    const keys = ["sourcemate.selectedReport.v1", "sourcemate.selectedSource.v1"];
    for (const key of keys) {
      try {
        const value = sessionStorage.getItem(key);
        const data = value ? JSON.parse(value) : null;
        if (data?.user) {
          applyBurgerUser(data.user);
          return;
        }
      } catch {
        // Try the next stored payload.
      }
    }
  }

  async function hydrateBurgerUser() {
    hydrateBurgerUserFromStorage();
    try {
      const response = await fetch(`${API_ORIGIN}/api/auth/me`, { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      applyBurgerUser(data.user);
    } catch {
      // The drawer remains usable with fallback copy if the session request fails.
    }
  }

  hydrateBurgerUser();

  let supportLauncher = document.querySelector("[data-support-launcher]");
  if (!supportLauncher && !authPage) {
    supportLauncher = document.createElement("button");
    supportLauncher.className = "cabinet-support support-launcher";
    supportLauncher.type = "button";
    supportLauncher.dataset.supportLauncher = "true";
    supportLauncher.hidden = true;
    supportLauncher.textContent = "Поддержка";
    document.body.appendChild(supportLauncher);
  }

  function setOpen(open) {
    if (open && window.matchMedia("(min-width: 681px)").matches) {
      drawer.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      clearBodyBurgerLock();
      return;
    }
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("burger-open", open);
    document.documentElement.classList.toggle("burger-open", open);

    if (open) {
      document.body.dataset.burgerScrollY = String(window.scrollY || 0);
      document.body.style.position = "fixed";
      document.body.style.top = `-${window.scrollY || 0}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      return;
    }

    const scrollY = Number(document.body.dataset.burgerScrollY || 0);
    clearBodyBurgerLock();
    if (Number.isFinite(scrollY)) window.scrollTo(0, scrollY);
  }

  // Defensive cleanup for stale lock state after navigation/back-forward cache restores.
  if (drawer.hidden) clearBodyBurgerLock();

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(drawer.hidden);
  });

  document.addEventListener("click", (event) => {
    if (drawer.hidden) return;
    if (event.target.closest("[data-burger-drawer], [data-burger-toggle]")) return;
    setOpen(false);
  });

  document.addEventListener("click", (event) => {
    const supportButton = event.target.closest("[data-burger-support]");
    if (!supportButton) return;
    setOpen(false);
    if (supportLauncher) {
      supportLauncher.click();
      return;
    }
    window.location.href = "mailto:sourcemate.help@gmail.com";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (drawer.hidden) return;
    if (window.matchMedia("(min-width: 681px)").matches) setOpen(false);
  });

  window.addEventListener("pagehide", () => {
    if (!drawer.hidden) setOpen(false);
    else clearBodyBurgerLock();
  });

  window.addEventListener("pageshow", () => {
    if (drawer.hidden) clearBodyBurgerLock();
  });
}());
