import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements, serializeAsJSON } from "@excalidraw/excalidraw";
import { marked } from "marked";

const SAVE_DELAY_MS = 800;
const THEME_KEY = "blueprint_theme";
const view = document.getElementById("view");
const status = document.getElementById("status");
let unmount = () => {};
let generation = 0;
let activeTab = null;
let mermaidCounter = 0;

const currentTheme = () => document.documentElement.dataset.theme;

const themeToggle = document.getElementById("theme_toggle");

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

const renderMermaid = async (container) => {
  const blocks = container.querySelectorAll("pre > code.language-mermaid");
  if (blocks.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: currentTheme() === "dark" ? "dark" : "default" });
  for (const code of blocks) {
    const figure = document.createElement("div");
    figure.className = "diagram";
    try {
      const { svg } = await mermaid.render(`mermaid_${++mermaidCounter}`, code.textContent);
      figure.innerHTML = svg;
      code.parentElement.replaceWith(figure);
    } catch {
      code.parentElement.classList.add("diagram_error");
    }
  }
};

const resolvePath = (from, href) => {
  const parts = from.split("/").slice(0, -1);
  for (const part of href.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
};

const showDocument = async (article, path, onNavigate) => {
  const text = await fetchText(path);
  article.innerHTML = `<div class="source">${path}</div>${text ? marked.parse(text) : "Файл не найден"}`;
  for (const link of article.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (/^([a-z]+:|#|\/)/i.test(href)) continue;
    const [file, anchor] = href.split("#");
    if (!file.endsWith(".md")) continue;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      onNavigate(resolvePath(path, file), anchor);
    });
  }
  await renderMermaid(article);
};

const fetchTree = async (dir) => {
  const response = await fetch(`/api/tree?dir=${encodeURIComponent(dir)}`);
  return response.ok ? response.json() : [];
};

const buildTree = (files, dir) => {
  const root = { folders: new Map(), files: [] };
  for (const path of files) {
    const parts = path.slice(dir.length + 1).split("/");
    let node = root;
    for (const folder of parts.slice(0, -1)) {
      if (!node.folders.has(folder)) node.folders.set(folder, { folders: new Map(), files: [] });
      node = node.folders.get(folder);
    }
    node.files.push({ name: parts.at(-1), path });
  }
  return root;
};

const openFolders = (tabId) => {
  try {
    return new Set(JSON.parse(localStorage.getItem(`blueprint_tree_${tabId}`) ?? "[]"));
  } catch {
    return new Set();
  }
};

const rememberFolders = (tabId, nav) => {
  const open = [...nav.querySelectorAll("details[open]")].map((folder) => folder.dataset.folder);
  try { localStorage.setItem(`blueprint_tree_${tabId}`, JSON.stringify(open)); } catch {}
};

const treeNodes = (node, open, prefix = "") => {
  const list = document.createElement("ul");
  for (const [name, child] of node.folders) {
    const item = document.createElement("li");
    const folder = document.createElement("details");
    const path = `${prefix}${name}/`;
    folder.dataset.folder = path;
    folder.open = open.has(path);
    folder.innerHTML = `<summary>${name}</summary>`;
    folder.append(treeNodes(child, open, path));
    item.append(folder);
    list.append(item);
  }
  for (const file of node.files) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.dataset.path = file.path;
    link.textContent = file.name.replace(/\.md$/, "");
    item.append(link);
    list.append(item);
  }
  return list;
};

const adrEntry = async (path) => {
  const text = (await fetchText(path)) ?? "";
  const title = text.match(/^#\s+(.+)$/m)?.[1] ?? path.split("/").at(-1);
  const status = text.match(/^\s*(?:[-*]\s+)?(?:\*\*)?(?:Статус|Status)(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+?)\s*$/im)?.[1]
    ?? text.match(/^status:\s*(.+)$/im)?.[1] ?? "";
  return { path, title, status: status.split(/[;.]/)[0] };
};

const adrNodes = (entries) => {
  const list = document.createElement("ul");
  for (const entry of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.dataset.path = entry.path;
    link.innerHTML = `<span class="adr_title"></span><span class="adr_status"></span>`;
    link.querySelector(".adr_title").textContent = entry.title;
    link.querySelector(".adr_status").textContent = entry.status;
    item.append(link);
    list.append(item);
  }
  return list;
};

const renderLibrary = (buildNav) => async (tab, ready, initialPath) => {
  const layout = document.createElement("div");
  layout.className = "library";
  const nav = document.createElement("nav");
  nav.className = "tree";
  const article = document.createElement("article");
  article.className = "doc";
  layout.append(nav, article);
  view.append(layout);
  const files = await fetchTree(tab.dir);
  const { node, fallback } = await buildNav(tab, files);
  nav.append(node);
  const show = async (path, anchor) => {
    for (const link of nav.querySelectorAll("a[data-path]")) {
      if (link.dataset.path === path) {
        link.setAttribute("aria-current", "page");
        for (let folder = link.closest("details"); folder; folder = folder.parentElement.closest("details")) folder.open = true;
      } else link.removeAttribute("aria-current");
    }
    rememberFolders(tab.id, nav);
    await showDocument(article, path, (next, nextAnchor) => {
      history.replaceState(null, "", `#${tab.id}/${next}`);
      show(next, nextAnchor);
    });
    if (anchor) article.querySelector(`[id="${CSS.escape(anchor)}"]`)?.scrollIntoView();
    else article.scrollTop = 0;
  };
  nav.addEventListener("toggle", () => rememberFolders(tab.id, nav), true);
  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-path]");
    if (!link) return;
    event.preventDefault();
    history.replaceState(null, "", `#${tab.id}/${link.dataset.path}`);
    show(link.dataset.path);
  });
  const first = initialPath && files.includes(initialPath) ? initialPath : fallback;
  if (first) await show(first);
  else article.textContent = "В папке нет markdown-файлов";
  ready();
  activeTab = { id: tab.id, show };
  return () => { activeTab = null; };
};

const renderDocsTab = renderLibrary(async (tab, files) => {
  const readme = files.find((path) => path === `${tab.dir}/README.md`);
  return { node: treeNodes(buildTree(files, tab.dir), openFolders(tab.id)), fallback: readme ?? files[0] };
});

const renderAdrTab = renderLibrary(async (tab, files) => {
  const decisions = files.filter((path) => !path.endsWith("/README.md"));
  const entries = await Promise.all(decisions.map(adrEntry));
  return { node: adrNodes(entries), fallback: decisions[0] };
});

const seedScene = async (path) => {
  const text = await fetchText(path);
  const definition = text?.match(/```mermaid\n([\s\S]*?)```/)?.[1];
  if (!definition) return null;
  try {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { elements, files } = await parseMermaidToExcalidraw(definition);
    return { elements: convertToExcalidrawElements(elements), files: files ?? {} };
  } catch {
    return null;
  }
};

const loadScene = async (tab) => {
  const saved = await fetchText(tab.file);
  if (saved) return { ...JSON.parse(saved), seeded: false };
  const seeded = tab.seed ? await seedScene(tab.seed) : null;
  return seeded ? { ...seeded, seeded: true } : { elements: [], seeded: false };
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
  const slot = document.getElementById("docs_slot");
  if (slot) slot.replaceWith(button);
  else themeToggle.after(button);
  return button;
};

const renderExcalidraw = async (tab, ready) => {
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  view.append(canvas);
  const toggle = tab.docs?.length ? docsButton(tab) : null;
  const scene = await loadScene(tab);
  if (scene.seeded) status.textContent = `Схема собрана из ${tab.seed}, после правки сохранится в ${tab.file}`;
  let timer;
  let lastSaved = JSON.stringify(scene.elements);
  let pristine = scene.seeded;
  const onChange = (elements, appState, files) => {
    const snapshot = JSON.stringify(elements);
    if (pristine) {
      pristine = false;
      lastSaved = snapshot;
      return;
    }
    if (snapshot === lastSaved) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastSaved = snapshot;
      save(tab, elements, appState, files);
    }, SAVE_DELAY_MS);
  };
  const root = createRoot(canvas);
  root.render(React.createElement(Excalidraw, {
    initialData: { elements: scene.elements, files: scene.files, appState: { viewBackgroundColor: "#ffffff" }, scrollToContent: true },
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
  drawer.append(skeleton("text"));
  view.append(drawer);
  renderDocs(tab.docs, drawer).then(() => drawer.querySelector(".sk_page")?.remove());
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
  frame.allow = "clipboard-write";
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

const renderers = { excalidraw: renderExcalidraw, frame: renderFrame, markdown: renderMarkdown, docs: renderDocsTab, adr: renderAdrTab };
const textTabs = new Set(["markdown", "docs", "adr"]);

const parseHash = () => {
  const [id, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { id, path: rest.join("/") };
};

const open = async (config, id, path) => {
  const tab = config.tabs.find((item) => item.id === id) ?? config.tabs[0];
  unmount();
  document.getElementById("docs_toggle")?.remove();
  if (!tab.docs?.length || tab.type !== "excalidraw") document.getElementById("docs_slot")?.remove();
  const mine = ++generation;
  const ready = () => { if (mine === generation) view.querySelector(".sk_page")?.remove(); };
  view.replaceChildren(skeleton(textTabs.has(tab.type) ? "text" : "canvas"));
  status.textContent = "";
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.id === tab.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const cleanup = await renderers[tab.type](tab, ready, path);
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
try {
  localStorage.setItem("blueprint_shell", JSON.stringify({
    title: config.title,
    tabs: config.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      kind: tab.type,
      docsLabel: tab.type === "excalidraw" && tab.docs?.length ? (tab.docs_label ?? "Документы") : null,
    })),
  }));
} catch {}
addEventListener("hashchange", () => {
  const { id, path } = parseHash();
  if (activeTab && activeTab.id === id && path) activeTab.show(path);
  else open(config, id, path);
});
open(config, parseHash().id, parseHash().path);

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  open(config, parseHash().id, parseHash().path);
});
