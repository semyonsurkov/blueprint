const LOAD_TIMEOUT_MS = 10000;

const sourceUrl = (source) => {
  if (typeof source !== "string" || !/^https?:\/\//i.test(source) || /[\s\\]/.test(source)) {
    throw new Error("Укажи http:// или https:// адрес Storybook в src вкладки Компоненты.");
  }
  const url = new URL(source);
  if (url.username || url.password || url.port === "0") {
    throw new Error("Адрес Storybook должен быть без данных авторизации и с доступным портом.");
  }
  return url.href;
};

const loadingPlaceholder = () => {
  const node = document.createElement("div");
  node.className = "sk_page sk_components";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = '<div class="sk_components_nav"><i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i></div><div class="sk_components_preview"><i class="sk"></i><i class="sk"></i></div>';
  return node;
};

export const renderStorybook = (tab, ready, { view }) => {
  if (!ready.alive()) return () => {};
  const source = sourceUrl(tab.src);
  const root = document.createElement("section");
  root.className = "storybook";
  root.setAttribute("aria-label", "Компоненты проекта в Storybook");
  const toolbar = document.createElement("div");
  toolbar.className = "storybook_toolbar";
  const address = document.createElement("span");
  address.className = "ui_mono storybook_address";
  address.textContent = source;
  address.title = source;
  const retry = document.createElement("button");
  retry.className = "ui_button";
  retry.type = "button";
  retry.textContent = "Перезагрузить";
  const external = document.createElement("a");
  external.className = "ui_button";
  external.href = source;
  external.target = "_blank";
  external.rel = "noopener noreferrer";
  external.textContent = "Открыть отдельно";
  toolbar.append(address, retry, external);
  const hint = document.createElement("p");
  hint.className = "storybook_hint";
  hint.textContent = "Если каталог не открылся, запусти Storybook командой проекта и нажми Перезагрузить. Тема компонентов выбирается внутри Storybook.";
  const stage = document.createElement("div");
  stage.className = "storybook_stage";
  root.append(toolbar, hint, stage);
  let frame;
  let timer;
  let loading;

  const load = () => {
    clearTimeout(timer);
    frame?.remove();
    frame = document.createElement("iframe");
    frame.className = "frame";
    frame.title = "Storybook проекта";
    frame.allow = "clipboard-write";
    frame.referrerPolicy = "no-referrer";
    loading = loadingPlaceholder();
    stage.setAttribute("aria-busy", "true");
    const current = frame;
    frame.addEventListener("load", () => {
      if (current !== frame || !ready.alive()) return;
      clearTimeout(timer);
      loading.remove();
      stage.setAttribute("aria-busy", "false");
    });
    frame.src = source;
    stage.replaceChildren(frame, loading);
    timer = setTimeout(() => {
      if (!ready.alive()) return;
      stage.setAttribute("aria-busy", "false");
      loading.className = "storybook_pending";
      loading.removeAttribute("aria-hidden");
      loading.setAttribute("role", "status");
      loading.textContent = "Загрузка Storybook задерживается. Проверь его запуск и адрес; каталог также можно открыть отдельно кнопкой сверху.";
    }, LOAD_TIMEOUT_MS);
  };

  retry.addEventListener("click", load);
  view.append(root);
  ready();
  load();
  return () => {
    clearTimeout(timer);
    frame?.remove();
    root.remove();
  };
};
