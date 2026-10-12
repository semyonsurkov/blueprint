export const THEME_EVENT = "blueprint:theme-change";
export const THEME_MESSAGE = "blueprint:storybook-theme";
export const READY_MESSAGE = "blueprint:storybook-ready";
const CHANNEL_THEME = "blueprint/storybook/theme";
const CHANNEL_REQUEST = "blueprint/storybook/request-theme";
const isTheme = (value) => value === "dark" || value === "light";
const systemTheme = () => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const storybookUrl = (source, theme) => {
  const url = new URL(source);
  url.searchParams.set("blueprintTheme", theme);
  url.searchParams.set("blueprintOrigin", window.location.origin);
  return url.href;
};

export const connectStorybookFrame = (frame, origin, theme) => {
  const send = () => frame.contentWindow?.postMessage({ type: THEME_MESSAGE, theme: theme() }, origin);
  const onMessage = (event) => {
    if (event.source === frame.contentWindow && event.origin === origin && event.data?.type === READY_MESSAGE) send();
  };
  window.addEventListener(THEME_EVENT, send);
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", send);
  return () => {
    window.removeEventListener(THEME_EVENT, send);
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("load", send);
  };
};

export const connectStorybookManager = (channel, applyTheme) => {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get("blueprintTheme");
  let current = isTheme(initial) ? initial : systemTheme();
  let parentOrigin;
  try {
    const url = new URL(params.get("blueprintOrigin"));
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password && url.href === `${url.origin}/`) parentOrigin = url.origin;
  } catch {}
  const broadcast = () => channel.emit(CHANNEL_THEME, current);
  const setTheme = (value) => {
    current = value;
    document.documentElement.dataset.blueprintTheme = value;
    applyTheme(value);
    broadcast();
  };
  const onMessage = (event) => {
    if (parentOrigin && window.parent !== window && event.source === window.parent && event.origin === parentOrigin && event.data?.type === THEME_MESSAGE && isTheme(event.data.theme)) setTheme(event.data.theme);
  };
  channel.on(CHANNEL_REQUEST, broadcast);
  window.addEventListener("message", onMessage);
  setTheme(current);
  if (parentOrigin && window.parent !== window) window.parent.postMessage({ type: READY_MESSAGE }, parentOrigin);
  return () => {
    channel.removeListener(CHANNEL_REQUEST, broadcast);
    window.removeEventListener("message", onMessage);
  };
};

export const connectStorybookPreview = (channel) => {
  let current = systemTheme();
  try {
    const inherited = window.parent.document.documentElement.dataset.blueprintTheme;
    if (isTheme(inherited)) current = inherited;
  } catch {}
  const listeners = new Set();
  const onTheme = (value) => {
    if (!isTheme(value)) return;
    current = value;
    document.documentElement.dataset.theme = value;
    for (const listener of listeners) listener();
  };
  channel.on(CHANNEL_THEME, onTheme);
  onTheme(current);
  channel.emit(CHANNEL_REQUEST);
  return {
    getTheme: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      channel.removeListener(CHANNEL_THEME, onTheme);
      listeners.clear();
    },
  };
};
