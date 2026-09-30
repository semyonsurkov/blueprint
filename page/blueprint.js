import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { marked } from "marked";

const SAVE_DELAY_MS = 800;
const THEME_KEY = "blueprint_theme";
const view = document.getElementById("view");
const status = document.getElementById("status");
let unmount = () => {};
let generation = 0;

const currentTheme = () => document.documentElement.dataset.theme;

const themeToggle = document.getElementById("theme_toggle");
const ICON_ATTRS = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
  sun: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg ${ICON_ATTRS}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
};
const showTheme = () => { themeToggle.innerHTML = currentTheme() === "dark" ? ICONS.sun : ICONS.moon; };

const fetchText = async (path) => {
  const response = await fetch(`/${path}`);
  return response.ok ? response.text() : null;
};

const renderDocs = async (docs, container) => {
  for (const item of docs) {
    const { path, collapsed } = typeof item === "string" ? { path: item } : item;
    const foldable = collapsed !== undefined;
    const text = await fetchText(path);
    const body = text ? marked.parse(text) : "Файл не найден";
    const section = document.createElement(foldable ? "details" : "section");
    section.className = "doc";
    section.open = collapsed === false;
    section.innerHTML = foldable
      ? `<summary class="source">${path}</summary>${body}`
      : `<div class="source">${path}</div>${body}`;
    container.append(section);
  }
};

const loadScene = async (tab) => {
  const saved = await fetchText(tab.file);
  return saved ? JSON.parse(saved) : { elements: [] };
};

const save = async (tab, elements, appState, files) => {
  const body = serializeAsJSON(elements, appState, files, "local");
  const response = await fetch(`/api/save?path=${encodeURIComponent(tab.file)}`, { method: "POST", body });
  status.textContent = response.ok ? `Сохранено в ${tab.file}` : "Не удалось сохранить";
};

const skeleton = (kind) => {
  const node = document.createElement("div");
  node.className = `sk_page sk_${kind}`;
  node.innerHTML = kind === "canvas"
    ? '<i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i>'
    : '<i class="sk sk_heading"></i><i class="sk"></i><i class="sk"></i><i class="sk sk_short"></i><i class="sk"></i><i class="sk"></i><i class="sk sk_short"></i>';
  return node;
};

const docsButton = (tab) => {
  const button = document.createElement("button");
  button.id = "docs_toggle";
  button.textContent = tab.docs_label ?? "Документы";
  button.disabled = true;
  themeToggle.after(button);
  return button;
};

const renderExcalidraw = async (tab, ready) => {
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  view.append(canvas);
  const toggle = tab.docs?.length ? docsButton(tab) : null;
  const scene = await loadScene(tab);
  let timer;
  let lastSaved = JSON.stringify(scene.elements);
  const onChange = (elements, appState, files) => {
    const snapshot = JSON.stringify(elements);
    if (snapshot === lastSaved) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastSaved = snapshot;
      save(tab, elements, appState, files);
    }, SAVE_DELAY_MS);
  };
  const root = createRoot(canvas);
  root.render(React.createElement(Excalidraw, {
    initialData: { elements: scene.elements, appState: { viewBackgroundColor: "#ffffff" }, scrollToContent: true },
    langCode: "ru-RU",
    theme: currentTheme(),
    excalidrawAPI: (api) => setTimeout(() => {
      api.scrollToContent(undefined, { fitToContent: true });
      ready();
    }, 0),
    onChange,
  }));
  if (!toggle) return () => root.unmount();
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.hidden = true;
  view.append(drawer);
  await renderDocs(tab.docs, drawer);
  toggle.disabled = false;
  const setOpen = (open) => {
    drawer.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
  };
  toggle.addEventListener("click", () => setOpen(drawer.hidden));
  const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
  addEventListener("keydown", onKey);
  return () => {
    removeEventListener("keydown", onKey);
    root.unmount();
  };
};

const renderFrame = (tab, ready) => {
  const frame = document.createElement("iframe");
  frame.className = "frame";
  frame.addEventListener("load", ready);
  frame.src = `/${tab.src}`;
  view.append(frame);
  return () => {};
};

const renderMarkdown = async (tab, ready) => {
  await renderDocs(tab.docs, view);
  ready();
  return () => {};
};

const renderers = { excalidraw: renderExcalidraw, frame: renderFrame, markdown: renderMarkdown };

const open = async (config, id) => {
  const tab = config.tabs.find((item) => item.id === id) ?? config.tabs[0];
  unmount();
  document.getElementById("docs_toggle")?.remove();
  const mine = ++generation;
  const ready = () => { if (mine === generation) view.querySelector(".sk_page")?.remove(); };
  view.replaceChildren(skeleton(tab.type === "markdown" ? "text" : "canvas"));
  status.textContent = "";
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.id === tab.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const cleanup = await renderers[tab.type](tab, ready);
  unmount = mine === generation ? cleanup : (cleanup(), unmount);
};

const config = JSON.parse(await fetchText("blueprint/blueprint.json"));
document.title = config.title;
document.getElementById("title").textContent = config.title;
document.getElementById("tabs").replaceChildren(...config.tabs.map((tab) => {
  const link = document.createElement("a");
  link.href = `#${tab.id}`;
  link.dataset.id = tab.id;
  link.textContent = tab.title;
  return link;
}));
addEventListener("hashchange", () => open(config, location.hash.slice(1)));
open(config, location.hash.slice(1));

showTheme();
themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  showTheme();
  open(config, location.hash.slice(1));
});
