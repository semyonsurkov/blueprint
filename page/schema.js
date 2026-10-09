import { watch } from "./live.js";
import { fetchText, fileUrl, renderDocs } from "./markdown.js";

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
  return response?.ok ? body : null;
};

const docsDrawer = (tab, ctx) => {
  const toggle = ctx.headerButton(tab.docs_label ?? "Документы");
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.hidden = true;
  drawer.append(ctx.skeleton("text"));
  ctx.view.append(drawer);
  const fill = async () => {
    const content = document.createElement("div");
    await renderDocs(tab.docs, content, ctx)
      .catch((error) => content.append(Object.assign(document.createElement("p"), { className: "doc", textContent: error.message })));
    const scroll = drawer.scrollTop;
    drawer.replaceChildren(...content.childNodes);
    drawer.scrollTop = scroll;
  };
  fill();
  const stopWatching = watch((paths) => {
    if (tab.docs.some((item) => paths.has(typeof item === "string" ? item : item.path))) fill();
  });
  const setOpen = (open) => {
    drawer.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
  };
  toggle.addEventListener("click", () => setOpen(drawer.hidden));
  const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
  addEventListener("keydown", onKey);
  return () => {
    stopWatching();
    removeEventListener("keydown", onKey);
  };
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
  const [[react, dom, { CaptureUpdateAction, Excalidraw, restoreElements, serializeAsJSON }], scene] = loaded;
  const React = react.default ?? react;
  let timer;
  let pending = null;
  let saving = Promise.resolve();
  let disposed = false;
  let lastSaved = JSON.stringify(scene.elements);
  let lastWritten = null;
  let api = null;
  const flush = async () => {
    clearTimeout(timer);
    if (!pending) return;
    const { snapshot, args } = pending;
    pending = null;
    saving = saving.then(async () => {
      const written = await saveScene(serializeAsJSON, tab, ...args).catch(() => null);
      const saved = written !== null;
      if (saved) {
        lastSaved = snapshot;
        lastWritten = written;
      }
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
    excalidrawAPI: (instance) => setTimeout(() => {
      api = instance;
      instance.scrollToContent(undefined, { fitToContent: true });
      ready();
    }, 0),
    onChange,
  }));
  const reloadFromDisk = async () => {
    const text = await fetchText(tab.file);
    if (text === null || text === lastWritten || !api || disposed) return;
    if (pending) {
      ctx.status.textContent = `${tab.file} изменён на диске, но на холсте есть несохранённые правки: они запишутся поверх`;
      return;
    }
    let fresh;
    try {
      fresh = JSON.parse(text);
    } catch {
      ctx.status.textContent = `${tab.file} на диске не читается как схема, на холсте прежняя версия`;
      return;
    }
    if (fresh.files) api.addFiles(Object.values(fresh.files));
    // NEVER держит подмену вне истории: иначе Ctrl+Z вернул бы старую сцену и сохранил её поверх файла
    api.updateScene({ elements: restoreElements(fresh.elements ?? [], null), captureUpdate: CaptureUpdateAction.NEVER });
    lastSaved = JSON.stringify(api.getSceneElementsIncludingDeleted());
    ctx.status.textContent = `Схема обновлена из ${tab.file}`;
  };
  const stopWatching = watch((paths) => {
    if (paths.has(tab.file)) saving.then(reloadFromDisk);
  });
  return () => {
    stopWatching();
    flush();
    disposed = true;
    closeDrawer();
    root.unmount();
  };
};
