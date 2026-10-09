const STORAGE_KEY = "blueprint_sidebar_width";
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const MAX_SHARE = 0.6;
const KEY_STEP = 16;

const savedWidth = () => {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

const saveWidth = (width) => {
  try { localStorage.setItem(STORAGE_KEY, String(width)); } catch {}
};

export const resizableSidebar = (layout) => {
  const handle = document.createElement("div");
  handle.className = "sidebar_handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Ширина списка, двойной щелчок возвращает исходную");
  handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(MAX_WIDTH));

  const apply = (width) => {
    const limit = Math.min(MAX_WIDTH, layout.clientWidth * MAX_SHARE || MAX_WIDTH);
    const clamped = Math.round(Math.max(MIN_WIDTH, Math.min(width, limit)));
    layout.style.setProperty("--sidebar_width", `${clamped}px`);
    handle.setAttribute("aria-valuenow", String(clamped));
    return clamped;
  };

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const left = layout.getBoundingClientRect().left;
    layout.dataset.resizing = "";
    const move = (moveEvent) => apply(moveEvent.clientX - left);
    const stop = () => {
      delete layout.dataset.resizing;
      handle.removeEventListener("pointermove", move);
      saveWidth(Number(handle.getAttribute("aria-valuenow")));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop, { once: true });
    handle.addEventListener("pointercancel", stop, { once: true });
  });

  handle.addEventListener("dblclick", () => saveWidth(apply(DEFAULT_WIDTH)));

  handle.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
    if (!step) return;
    event.preventDefault();
    saveWidth(apply(Number(handle.getAttribute("aria-valuenow")) + step));
  });

  layout.append(handle);
  apply(savedWidth());
};
