import { pathOf, watch } from "./live.js";
import { rerenderScreens } from "./screen.js";

const WIDE_COLUMNS = 2;
const NARROW_COLUMNS = 7;
const WIDE_FROM = 1000;
const GAP = 80;
const GROUP_TITLE_H = 120;
const PAD_X = 40;
const PAD_Y = 40;
const MIN_SCALE = 0.08;
const MAX_SCALE = 2;
const FIT_MAX_SCALE = 0.6;
const ACTUAL_SIZE = 1;
const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
const VIEW_KEY = "mockups_view_v2";
document.body.insertAdjacentHTML("afterbegin", '<div id="space"><div id="board"></div></div>');
const space = document.getElementById("space");
const board = document.getElementById("board");
const pending = [];
const readSaved = () => {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null");
  } catch {
    return null;
  }
};
const saved = readSaved();
let scale = saved?.scale ?? MIN_SCALE;
const content = { width: 0, height: 0 };

const apply = () => {
  board.style.transform = `scale(${scale})`;
  board.style.left = `${PAD_X}px`;
  board.style.top = `${PAD_Y}px`;
  space.style.width = `${PAD_X * 2 + content.width * scale}px`;
  space.style.height = `${PAD_Y + PAD_X + content.height * scale}px`;
};
const remember = () => {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ scale, scrollX, scrollY })); } catch {}
};

const fetchScreen = async (file) => {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`${file} не загрузился: сервер ответил ${response.status}`);
  const root = new DOMParser().parseFromString(await response.text(), "text/html").body.firstElementChild;
  if (!root) throw new Error(`В ${file} нет разметки экрана`);
  return root;
};

const loadScreen = async (holder, file) => {
  holder.append(await fetchScreen(file));
};

const loadManifest = async () => {
  const response = await fetch("screens.json");
  if (!response.ok) throw new Error(`screens.json не найден рядом с доской (${response.status})`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`screens.json не читается как JSON: ${error.message}`);
  }
};

let screens = [];
try {
  ({ screens = [] } = await loadManifest());
} catch (error) {
  document.body.insertAdjacentHTML("beforeend", '<div class="error_page board_error"><strong>Доска не загрузилась</strong><p></p></div>');
  document.querySelector(".board_error p").textContent = error.message;
}
const groups = Map.groupBy(screens, (screen) => screen.group);
let top = 0;
for (const [name, list] of groups) {
  const group = document.createElement("div");
  group.className = "group";
  group.style.cssText = `left:0;top:${top}px`;
  group.textContent = name;
  board.append(group);
  top += GROUP_TITLE_H;
  let column = 0, left = 0, rowHeight = 0;
  for (const screen of list) {
    const [width, height] = screen.size;
    if (column === (width > WIDE_FROM ? WIDE_COLUMNS : NARROW_COLUMNS)) { column = 0; left = 0; top += rowHeight + GAP; rowHeight = 0; }
    const holder = document.createElement("div");
    holder.className = "item";
    holder.id = `screen_${screen.file.replace(".html", "")}`;
    holder.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    const caption = document.createElement("a");
    caption.className = "caption";
    caption.href = `${screen.file}?annotate`;
    caption.textContent = screen.title;
    holder.append(caption);
    board.append(holder);
    pending.push(loadScreen(holder, screen.file));
    content.width = Math.max(content.width, left + width);
    left += width + GAP;
    rowHeight = Math.max(rowHeight, height);
    column++;
  }
  top += rowHeight + GAP * 2;
}
content.height = top;
if (!saved) scale = Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, (document.documentElement.clientWidth - PAD_X * 2) / content.width));
apply();
if (saved) scrollTo(saved.scrollX, saved.scrollY);
await Promise.all(pending);
window.WIRE_ANNOTATE = true;
await import(new URL("wire.js", document.baseURI).href);

const zoomTo = (next, clientX = innerWidth / 2, clientY = innerHeight / 2) => {
  const anchorX = (scrollX + clientX - PAD_X) / scale;
  const anchorY = (scrollY + clientY - PAD_Y) / scale;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  apply();
  scrollTo(PAD_X + anchorX * scale - clientX, PAD_Y + anchorY * scale - clientY);
  showScale();
  remember();
};

const zoom = document.createElement("div");
zoom.className = "zoom ui_toolbar";
zoom.innerHTML = '<button type="button" class="ui_icon_button" data-variant="ghost" data-step="-1" aria-label="Уменьшить">−</button><input class="zoom_value" inputmode="numeric" aria-label="Масштаб в процентах" title="Введите масштаб, Shift+0 возвращает 100%"><button type="button" class="ui_icon_button" data-variant="ghost" data-step="1" aria-label="Увеличить">+</button><button type="button" class="ui_button" data-variant="ghost" data-fit>По ширине</button>';
const zoomLabel = zoom.querySelector(".zoom_value");
const showScale = () => { zoomLabel.value = `${Math.round(scale * 100)}%`; };
const applyTyped = () => {
  const percent = Number.parseFloat(zoomLabel.value.replace(",", "."));
  if (Number.isFinite(percent) && percent > 0) zoomTo(percent / 100);
  else showScale();
};
zoomLabel.addEventListener("focus", () => zoomLabel.select());
zoomLabel.addEventListener("keydown", (event) => {
  if (event.key === "Enter") zoomLabel.blur();
  if (event.key === "Escape") {
    showScale();
    zoomLabel.blur();
  }
});
zoomLabel.addEventListener("change", applyTyped);
showScale();
const nextStep = (direction) => (direction > 0
  ? ZOOM_STEPS.find((step) => step > scale + 0.001) ?? MAX_SCALE
  : ZOOM_STEPS.findLast((step) => step < scale - 0.001) ?? MIN_SCALE);
zoom.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.fit !== undefined) {
    zoomTo(Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, (document.documentElement.clientWidth - PAD_X * 2) / content.width)), 0, 0);
    scrollTo(0, 0);
  } else zoomTo(nextStep(Number(button.dataset.step)));
});
document.body.append(zoom);

let spaceHeld = false;
let drag = null;
const typing = (element) => element.closest("input, textarea, [contenteditable]");
addEventListener("keydown", (event) => {
  if (event.code === "Digit0" && event.shiftKey && !typing(event.target)) {
    event.preventDefault();
    zoomTo(ACTUAL_SIZE);
    return;
  }
  if (event.code !== "Space" || typing(event.target)) return;
  event.preventDefault();
  spaceHeld = true;
  document.documentElement.classList.add("panning");
});
addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  spaceHeld = false;
  document.documentElement.classList.remove("panning");
});
addEventListener("mousedown", (event) => {
  if (!(spaceHeld && event.button === 0) && event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
  drag = { x: event.clientX, y: event.clientY };
  document.documentElement.classList.add("dragging");
}, true);
addEventListener("mousemove", (event) => {
  if (!drag) return;
  scrollBy(drag.x - event.clientX, drag.y - event.clientY);
  drag = { x: event.clientX, y: event.clientY };
});
addEventListener("mouseup", () => {
  drag = null;
  document.documentElement.classList.remove("dragging");
});
addEventListener("click", (event) => {
  if (spaceHeld) { event.preventDefault(); event.stopPropagation(); }
}, true);

addEventListener("scroll", remember);
addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  zoomTo(scale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
}, { passive: false });

const BOARD_FILES = new Set(["index.html", "wire.js", "screens.json"]);
const folder = pathOf(location.href).replace(/[^/]*$/, "");
const liveError = document.createElement("div");
liveError.className = "live_error";
liveError.hidden = true;
document.body.append(liveError);

const showLiveError = (message) => {
  liveError.textContent = `${message}. На доске прежняя версия, исправь файл, и она обновится`;
  liveError.hidden = false;
};

const replaceScreen = async (file) => {
  const holder = document.getElementById(`screen_${file.replace(".html", "")}`);
  if (!holder) return false;
  const fresh = await fetchScreen(file);
  holder.querySelector(":scope > :not(.caption)")?.replaceWith(fresh);
  return true;
};

watch(async (paths) => {
  const names = [...paths].filter((path) => path.startsWith(folder)).map((path) => path.slice(folder.length)).filter((name) => !name.includes("/"));
  if (!names.length) return;
  if (names.some((name) => BOARD_FILES.has(name))) {
    if (names.includes("screens.json")) {
      try {
        await loadManifest();
      } catch (error) {
        showLiveError(error.message);
        return;
      }
    }
    remember();
    location.reload();
    return;
  }
  const changed = [];
  for (const name of names.filter((item) => item.endsWith(".html"))) {
    try {
      if (await replaceScreen(name)) changed.push(name);
    } catch (error) {
      showLiveError(error.message);
      return;
    }
  }
  if (!changed.length) return;
  liveError.hidden = true;
  await rerenderScreens();
  dispatchEvent(new CustomEvent("blueprint:screens", { detail: changed }));
});
