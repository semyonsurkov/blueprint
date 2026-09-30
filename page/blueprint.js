import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { marked } from "marked";

const SAVE_DELAY_MS = 800;
const view = document.getElementById("view");
const status = document.getElementById("status");
let unmount = () => {};

const fetchText = async (path) => {
  const response = await fetch(`/${path}`);
  return response.ok ? response.text() : null;
};

const renderDocs = async (paths, container) => {
  for (const path of paths) {
    const text = await fetchText(path);
    const section = document.createElement("section");
    section.className = "doc";
    section.innerHTML = `<div class="source">${path}</div>${text ? marked.parse(text) : "Файл не найден"}`;
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

const renderExcalidraw = async (tab) => {
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  view.append(canvas);
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
    excalidrawAPI: (api) => setTimeout(() => api.scrollToContent(undefined, { fitToContent: true }), 0),
    onChange,
  }));
  await renderDocs(tab.docs ?? [], view);
  return () => root.unmount();
};

const renderFrame = (tab) => {
  const frame = document.createElement("iframe");
  frame.className = "frame";
  frame.src = `/${tab.src}`;
  view.append(frame);
  return () => {};
};

const renderMarkdown = async (tab) => {
  await renderDocs(tab.docs, view);
  return () => {};
};

const renderers = { excalidraw: renderExcalidraw, frame: renderFrame, markdown: renderMarkdown };

const open = async (config, id) => {
  const tab = config.tabs.find((item) => item.id === id) ?? config.tabs[0];
  unmount();
  view.replaceChildren();
  status.textContent = "";
  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.id === tab.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  unmount = await renderers[tab.type](tab);
};

const config = JSON.parse(await fetchText("blueprint/blueprint.json"));
document.title = config.title;
document.getElementById("title").textContent = config.title;
document.getElementById("tabs").append(...config.tabs.map((tab) => {
  const link = document.createElement("a");
  link.href = `#${tab.id}`;
  link.dataset.id = tab.id;
  link.textContent = tab.title;
  return link;
}));
addEventListener("hashchange", () => open(config, location.hash.slice(1)));
open(config, location.hash.slice(1));
