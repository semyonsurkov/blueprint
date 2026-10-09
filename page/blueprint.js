import { coversPath, normalizeDir, renderAdrTab, renderDocsTab } from "./docs.js";
import { decodeHref, fetchText, fileUrl, renderDocs } from "./markdown.js";

const THEME_KEY = "blueprint_theme";
const SHELL_KEY = "blueprint_shell";
const CONFIG_PATH = "blueprint/blueprint.json";
const view = document.getElementById("view");
const status = document.getElementById("status");
const themeToggle = document.getElementById("theme_toggle");
const TEXT_TABS = new Set(["markdown", "docs", "adr"]);
let unmount = () => {};
let generation = 0;
let activeTab = null;
let pendingAnchor = null;
let config = null;

const theme = () => document.documentElement.dataset.theme;

const skeleton = (kind) => {
  const node = document.createElement("div");
  node.className = `sk_page sk_${kind}`;
  node.innerHTML = kind === "canvas"
    ? '<i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i>'
    : '<i class="sk sk_heading"></i><i class="sk"></i><i class="sk"></i><i class="sk sk_short"></i><i class="sk"></i><i class="sk"></i><i class="sk sk_short"></i>';
  return node;
};

const showError = (title, details) => {
  const box = document.createElement("div");
  box.className = "error_page";
  box.append(
    Object.assign(document.createElement("strong"), { textContent: title }),
    Object.assign(document.createElement("p"), { textContent: details }),
  );
  view.replaceChildren(box);
};

const headerButton = (label) => {
  const button = document.createElement("button");
  button.id = "docs_toggle";
  button.className = "ui_button";
  button.textContent = label;
  const slot = document.getElementById("docs_slot");
  if (slot) slot.replaceWith(button);
  else themeToggle.after(button);
  return button;
};

const tabHash = (id, path) => `#${encodeURIComponent(id)}/${path.split("/").map(encodeURIComponent).join("/")}`;

const parseHash = () => {
  const [id, ...rest] = location.hash.slice(1).split("/");
  return { id: decodeHref(id), path: rest.map(decodeHref).join("/") };
};

const openDocument = (path, anchor) => {
  if (activeTab?.has(path)) {
    history.replaceState(null, "", tabHash(activeTab.id, path));
    activeTab.show(path, anchor);
    return;
  }
  const owner = config.tabs
    .filter((tab) => coversPath(tab, path))
    .sort((left, right) => normalizeDir(right.dir).length - normalizeDir(left.dir).length)[0];
  if (!owner) {
    window.open(fileUrl(path), "_blank", "noopener");
    return;
  }
  pendingAnchor = anchor ?? null;
  location.hash = tabHash(owner.id, path);
};

const ctx = {
  view,
  status,
  theme,
  skeleton,
  headerButton,
  openDocument,
  tabHash,
  setActiveTab: (tab) => { activeTab = tab; },
  releaseActiveTab: (tab) => { if (activeTab === tab) activeTab = null; },
  takeAnchor: () => {
    const anchor = pendingAnchor;
    pendingAnchor = null;
    return anchor;
  },
};

const renderFrame = (tab, ready) => {
  const frame = document.createElement("iframe");
  frame.className = "frame";
  frame.allow = "clipboard-write";
  frame.addEventListener("load", () => {
    try { frame.contentDocument.documentElement.dataset.theme = theme(); } catch {}
    ready();
  });
  frame.src = fileUrl(tab.src);
  view.append(frame);
  return () => {};
};

const renderMarkdownTab = async (tab, ready) => {
  const documents = document.createElement("div");
  documents.className = "doc_stack";
  await renderDocs(tab.docs ?? [], documents, ctx);
  if (ready.alive()) {
    view.append(documents);
    ready();
  }
  return () => {};
};

const renderSchemaTab = async (...args) => (await import("./schema.js")).renderSchema(...args);

const renderers = {
  excalidraw: renderSchemaTab,
  frame: renderFrame,
  markdown: renderMarkdownTab,
  docs: renderDocsTab,
  adr: renderAdrTab,
};

const markCurrent = (tab) => {
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.id === tab.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
};

const open = async (id, path) => {
  const tab = config.tabs.find((item) => item.id === id) ?? config.tabs[0];
  unmount();
  unmount = () => {};
  document.getElementById("docs_toggle")?.remove();
  if (!tab.docs?.length || tab.type !== "excalidraw") document.getElementById("docs_slot")?.remove();
  const mine = ++generation;
  const ready = () => { if (mine === generation) view.querySelector(".sk_page")?.remove(); };
  ready.alive = () => mine === generation;
  view.replaceChildren(skeleton(TEXT_TABS.has(tab.type) ? "text" : "canvas"));
  status.textContent = "";
  markCurrent(tab);
  const render = renderers[tab.type];
  if (!render) {
    showError(`Неизвестный тип вкладки «${tab.type}»`, `Вкладка «${tab.title}» в ${CONFIG_PATH}: допустимые типы ${Object.keys(renderers).join(", ")}.`);
    return;
  }
  try {
    const cleanup = await render(tab, ready, ctx, path);
    if (mine === generation) unmount = cleanup;
    else cleanup();
  } catch (error) {
    if (mine === generation) showError(`Вкладка «${tab.title}» не открылась`, error.message || String(error));
  }
};

const rememberShell = () => {
  try {
    localStorage.setItem(SHELL_KEY, JSON.stringify({
      title: config.title,
      tabs: config.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        kind: tab.type,
        docsLabel: tab.type === "excalidraw" && tab.docs?.length ? (tab.docs_label ?? "Документы") : null,
      })),
    }));
  } catch {}
};

const drawShell = () => {
  document.title = config.title;
  document.getElementById("title").textContent = config.title;
  document.getElementById("tabs").replaceChildren(...config.tabs.map((tab) => {
    const link = document.createElement("a");
    link.href = `#${encodeURIComponent(tab.id)}`;
    link.dataset.id = tab.id;
    link.textContent = tab.title;
    return link;
  }));
};

const loadConfig = async () => {
  const text = await fetchText(CONFIG_PATH);
  if (text === null) throw new Error(`Нет файла ${CONFIG_PATH}: запусти blueprint init в корне проекта`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${CONFIG_PATH} не читается как JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
    throw new Error(`В ${CONFIG_PATH} нет ни одной вкладки: добавь их или пересобери конфиг через blueprint init --reconfigure`);
  }
  return parsed;
};

try {
  config = await loadConfig();
} catch (error) {
  document.getElementById("docs_slot")?.remove();
  document.getElementById("title").textContent = "Проект";
  document.getElementById("tabs").replaceChildren();
  showError("Страница проекта не загрузилась", error.message);
}

if (config) {
  drawShell();
  rememberShell();
  addEventListener("hashchange", () => {
    const { id, path } = parseHash();
    if (activeTab && activeTab.id === id && path && activeTab.has(path)) activeTab.show(path, ctx.takeAnchor());
    else open(id, path);
  });
  const { id, path } = parseHash();
  open(id, path);
}

themeToggle.addEventListener("click", () => {
  const next = theme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  if (config) open(parseHash().id, parseHash().path);
});
