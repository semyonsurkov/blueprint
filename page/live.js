const EVENTS_URL = "/api/events";
const HUB_KEY = "__blueprint_live";
const EVERYTHING = "*";

const createHub = () => {
  const listeners = new Set();
  const emit = (paths) => {
    for (const listener of [...listeners]) {
      try { listener(paths); } catch {}
    }
  };
  const source = new EventSource(EVENTS_URL);
  let lost = false;
  source.addEventListener("message", (event) => {
    try {
      emit(new Set(JSON.parse(event.data).paths));
    } catch {}
  });
  source.addEventListener("error", () => { lost = true; });
  source.addEventListener("open", () => {
    if (!lost) return;
    lost = false;
    emit(new Set([EVERYTHING]));
  });
  return { add: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
};

// Одно соединение на вкладку браузера: доска в iframe слушает поток родителя, иначе два потока
// занимали бы два из шести соединений, которые Chrome держит на один хост.
const findHub = () => {
  try {
    if (window.parent !== window && window.parent[HUB_KEY]) return { hub: window.parent[HUB_KEY], own: false };
  } catch {}
  window[HUB_KEY] ??= createHub();
  return { hub: window[HUB_KEY], own: true };
};

const { hub, own } = location.protocol.startsWith("http") ? findHub() : { hub: { add: () => () => {} }, own: false };

export const watch = (listener) => {
  const stop = hub.add(listener);
  addEventListener("pagehide", stop, { once: true });
  return stop;
};

export const pathOf = (url) => decodeURIComponent(new URL(url, location.href).pathname).slice(1);

const swapStyles = (paths) => {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const url = new URL(link.href);
    if (url.origin !== location.origin || !paths.has(pathOf(url))) continue;
    url.searchParams.set("v", String(Date.now()));
    const next = link.cloneNode();
    next.href = url.href;
    next.addEventListener("load", () => link.remove(), { once: true });
    next.addEventListener("error", () => next.remove(), { once: true });
    link.after(next);
  }
};

watch((paths) => {
  if (own && paths.has(EVERYTHING)) location.reload();
  else swapStyles(paths);
});
