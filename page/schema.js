import { fileUrl, renderDocs } from "./markdown.js";

const SAVE_DELAY_MS = 800;
const EXCALIDRAW_CSS = "https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/index.css";
const LIGHT_CANVAS = "#ffffff";

const loadExcalidraw = () => {
  if (!document.querySelector(`link[href="${EXCALIDRAW_CSS}"]`)) {
    document.head.insertAdjacentHTML("afterbegin", `<link rel="stylesheet" href="${EXCALIDRAW_CSS}">`);
  }
  return Promise.all([import("react"), import("react-dom/client"), import("@excalidraw/excalidraw")]);
};

const NOT_FOUND = 404;

const loadScene = async (tab) => {
  const response = await fetch(fileUrl(tab.file));
  if (response.status === NOT_FOUND) return { elements: [] };
  if (!response.ok) throw new Error(`${tab.file} не прочитался: сервер ответил ${response.status}`);
  const saved = await response.text();
  try {
    return JSON.parse(saved);
  } catch {
    throw new Error(`${tab.file} не читается как схема Excalidraw: файл повреждён`);
  }
};

const saveScene = async (serializeAsJSON, tab, elements, appState, files) => {
  const body = serializeAsJSON(elements, appState, files, "local");
  const response = await fetch(`/api/save?path=${encodeURIComponent(tab.file)}`, { method: "POST", body }).catch(() => null);
  return Boolean(response?.ok);
};

const docsDrawer = (tab, ctx) => {
  const toggle = ctx.headerButton(tab.docs_label ?? "Документы");
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.hidden = true;
  drawer.append(ctx.skeleton("text"));
  ctx.view.append(drawer);
  renderDocs(tab.docs, drawer, ctx)
    .catch((error) => drawer.append(Object.assign(document.createElement("p"), { className: "doc", textContent: error.message })))
    .finally(() => drawer.querySelector(".sk_page")?.remove());
  const setOpen = (open) => {
    drawer.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
  };
  toggle.addEventListener("click", () => setOpen(drawer.hidden));
  const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
  addEventListener("keydown", onKey);
  return () => removeEventListener("keydown", onKey);
};

export const renderSchema = async (tab, ready, ctx) => {
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  ctx.view.append(canvas);
  const closeDrawer = tab.docs?.length ? docsDrawer(tab, ctx) : () => {};
  let loaded;
  try {
    loaded = await Promise.all([loadExcalidraw(), loadScene(tab)]);
  } catch (error) {
    closeDrawer();
    throw error;
  }
  const [[react, dom, { Excalidraw, serializeAsJSON }], scene] = loaded;
  const React = react.default ?? react;
  let timer;
  let pending = null;
  let saving = Promise.resolve();
  let disposed = false;
  let lastSaved = JSON.stringify(scene.elements);
  const flush = async () => {
    clearTimeout(timer);
    if (!pending) return;
    const { snapshot, args } = pending;
    pending = null;
    saving = saving.then(async () => {
      const saved = await saveScene(serializeAsJSON, tab, ...args).catch(() => false);
      if (saved) lastSaved = snapshot;
      if (!disposed) ctx.status.textContent = saved ? `Сохранено в ${tab.file}` : `Не удалось сохранить ${tab.file}, повторю при следующей правке`;
    });
    await saving;
  };
  const onChange = (elements, appState, files) => {
    const snapshot = JSON.stringify(elements);
    if (snapshot === lastSaved) return;
    pending = { snapshot, args: [elements, appState, files] };
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  };
  const root = dom.createRoot(canvas);
  root.render(React.createElement(Excalidraw, {
    initialData: { elements: scene.elements, files: scene.files, appState: { viewBackgroundColor: LIGHT_CANVAS }, scrollToContent: true },
    langCode: "ru-RU",
    theme: ctx.theme(),
    excalidrawAPI: (api) => setTimeout(() => {
      api.scrollToContent(undefined, { fitToContent: true });
      ready();
    }, 0),
    onChange,
  }));
  return () => {
    flush();
    disposed = true;
    closeDrawer();
    root.unmount();
  };
};
