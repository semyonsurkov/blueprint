const FOLDER = location.pathname.replace(/^\/|\/[^/]*$/g, "");
const FILE = `${FOLDER}/FEEDBACK.md`;
const ITEM = /^- \[( |x)\] (\d+)\. `([^`]+)` — (.*)$/;
const SCREEN_HEADING = /^## (\S+\.html)/;

const STYLE = `
.fb_bar { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: flex; gap: 8px; font: 14px system-ui; }
.fb_bar button, .fb_pop button { border: 1px solid #1a1a1a; border-radius: 8px; background: #fff; color: #1a1a1a; padding: 8px 12px; font: inherit; cursor: pointer; }
.fb_bar button[aria-pressed="true"] { background: #1a1a1a; color: #fff; }
.fb_mode .screen * { cursor: crosshair; }
.fb_hover { outline: 2px solid #e8590c !important; outline-offset: 1px; }
.fb_flash { outline: 3px solid #e8590c !important; outline-offset: 2px; }
.fb_layer { position: absolute; inset: 0; pointer-events: none; z-index: 50; }
.fb_pin { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: #e8590c; color: #fff; font: 600 12px/22px system-ui; text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: auto; cursor: pointer; }
.fb_pin[data-done] { background: #868e96; }
.fb_pop { position: fixed; z-index: 1001; width: 320px; padding: 12px; border: 1px solid #1a1a1a; border-radius: 10px; background: #fff; display: flex; flex-direction: column; gap: 8px; font: 14px system-ui; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.fb_pop textarea { min-height: 80px; resize: vertical; font: inherit; padding: 8px; border: 1px solid #c9c9c9; border-radius: 6px; }
.fb_pop .fb_path { color: #5c5c5c; font: 12px ui-monospace, monospace; word-break: break-all; }
.fb_panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 999; width: 380px; overflow: auto; padding: 16px 16px 72px; background: #fff; border-left: 1px solid #c9c9c9; font: 14px system-ui; color: #1a1a1a; box-shadow: -8px 0 24px rgba(0,0,0,.08); }
.fb_panel[hidden] { display: none; }
.fb_panel h3 { margin: 16px 0 8px; font-size: 14px; }
.fb_note { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-radius: 8px; cursor: pointer; }
.fb_note:hover { background: #f1f3f5; }
.fb_note[data-done] .fb_text { color: #868e96; text-decoration: line-through; }
.fb_num { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #e8590c; color: #fff; font: 600 12px/22px system-ui; text-align: center; }
.fb_note[data-done] .fb_num { background: #868e96; }
.fb_text { flex: 1; min-width: 0; }
.fb_note button { border: 0; background: none; cursor: pointer; color: #5c5c5c; font: inherit; }
`;

const notes = [];
const titles = new Map();
let mode = false;
let hovered = null;

const screenRoots = () => {
  const roots = new Map();
  const holders = document.querySelectorAll("[id^='screen_']");
  if (holders.length) {
    for (const holder of holders) {
      const root = holder.querySelector(".screen");
      if (root) roots.set(`${holder.id.slice(7)}.html`, root);
    }
  } else {
    const root = document.querySelector(".screen");
    if (root) roots.set(location.pathname.split("/").at(-1), root);
  }
  return roots;
};

const selectorOf = (element, root) => {
  const parts = [];
  for (let node = element; node && node !== root; node = node.parentElement) {
    const classes = [...node.classList].filter((name) => !name.startsWith("fb_")).slice(0, 2);
    let part = node.tagName.toLowerCase() + classes.map((name) => `.${name}`).join("");
    const twins = [...node.parentElement.children].filter((sibling) => sibling.tagName === node.tagName);
    if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return `:scope > ${parts.join(" > ")}`;
};

const parse = (text) => {
  let screen = null;
  for (const line of text.split("\n")) {
    const heading = line.match(SCREEN_HEADING);
    if (heading) screen = heading[1];
    const item = line.match(ITEM);
    if (item && screen) notes.push({ screen, done: item[1] === "x", id: Number(item[2]), selector: item[3], text: item[4] });
  }
};

const serialize = () => {
  const screens = [...new Set(notes.map((note) => note.screen))];
  const blocks = screens.map((screen) => {
    const title = titles.get(screen);
    const items = notes.filter((note) => note.screen === screen)
      .map((note) => `- [${note.done ? "x" : " "}] ${note.id}. \`${note.selector}\` — ${note.text}`);
    return [`## ${screen}${title ? ` — ${title}` : ""}`, "", ...items].join("\n");
  });
  return ["# Отзывы по макетам", "", "Открытые пункты `- [ ]` ждут правки, путь в обратных кавычках ведёт к элементу от `.screen` экрана.", "", ...blocks.flatMap((block) => [block, ""])].join("\n");
};

const save = async () => {
  await fetch(`/api/save?path=${encodeURIComponent(FILE)}`, { method: "POST", body: serialize() });
  render();
};

const target = (note) => screenRoots().get(note.screen)?.querySelector(note.selector) ?? null;

const flash = (element) => {
  element.classList.add("fb_flash");
  setTimeout(() => element.classList.remove("fb_flash"), 1600);
};

const renderPins = () => {
  for (const layer of document.querySelectorAll(".fb_layer")) layer.remove();
  for (const [screen, root] of screenRoots()) {
    root.style.position ||= "relative";
    const layer = document.createElement("div");
    layer.className = "fb_layer";
    root.append(layer);
    const rootBox = root.getBoundingClientRect();
    const scale = rootBox.width / root.offsetWidth || 1;
    for (const note of notes.filter((item) => item.screen === screen)) {
      const element = root.querySelector(note.selector);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const pin = document.createElement("div");
      pin.className = "fb_pin";
      pin.textContent = note.id;
      pin.title = note.text;
      if (note.done) pin.dataset.done = "";
      pin.style.left = `${(box.right - rootBox.left) / scale}px`;
      pin.style.top = `${(box.top - rootBox.top) / scale}px`;
      pin.addEventListener("click", () => { openPanel(true); flash(element); });
      layer.append(pin);
    }
  }
};

const panel = document.createElement("aside");
panel.className = "fb_panel";
panel.hidden = true;

const renderPanel = () => {
  panel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Отзывы";
  heading.style.margin = "0";
  panel.append(heading);
  if (!notes.length) {
    panel.append(Object.assign(document.createElement("p"), { textContent: "Пока пусто. Включите «Оставить отзыв» и щёлкните по элементу экрана." }));
  }
  for (const screen of new Set(notes.map((note) => note.screen))) {
    panel.append(Object.assign(document.createElement("h3"), { textContent: titles.get(screen) ?? screen }));
    for (const note of notes.filter((item) => item.screen === screen)) {
      const row = document.createElement("div");
      row.className = "fb_note";
      if (note.done) row.dataset.done = "";
      row.innerHTML = `<span class="fb_num"></span><span class="fb_text"></span><input type="checkbox" aria-label="Выполнено"><button type="button" aria-label="Удалить">✕</button>`;
      row.querySelector(".fb_num").textContent = note.id;
      row.querySelector(".fb_text").textContent = note.text;
      const done = row.querySelector("input");
      done.checked = note.done;
      done.addEventListener("click", (event) => { event.stopPropagation(); note.done = done.checked; save(); });
      row.querySelector("button").addEventListener("click", (event) => {
        event.stopPropagation();
        notes.splice(notes.indexOf(note), 1);
        save();
      });
      row.addEventListener("click", () => {
        const element = target(note);
        if (!element) return;
        element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        flash(element);
      });
      panel.append(row);
    }
  }
};

const counter = document.createElement("button");
const render = () => {
  counter.textContent = `Отзывы (${notes.filter((note) => !note.done).length})`;
  renderPanel();
  renderPins();
};

const openPanel = (open) => {
  panel.hidden = !open;
  counter.setAttribute("aria-pressed", String(open));
};

const popup = (element, screen, root, x, y) => {
  document.querySelector(".fb_pop")?.remove();
  const box = document.createElement("form");
  box.className = "fb_pop";
  box.style.left = `${Math.min(x, innerWidth - 340)}px`;
  box.style.top = `${Math.min(y, innerHeight - 200)}px`;
  const selector = selectorOf(element, root);
  box.innerHTML = `<div class="fb_path"></div><textarea placeholder="Что не так с этим элементом?"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button">Отмена</button><button type="submit">Сохранить</button></div>`;
  box.querySelector(".fb_path").textContent = `${screen} ${selector}`;
  box.querySelector("button[type=button]").addEventListener("click", () => box.remove());
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.querySelector("textarea").value.replace(/\s+/g, " ").trim();
    if (!text) return;
    notes.push({ screen, selector, text, done: false, id: Math.max(0, ...notes.map((note) => note.id)) + 1 });
    box.remove();
    save();
  });
  document.body.append(box);
  box.querySelector("textarea").focus();
};

const locate = (element) => {
  for (const [screen, root] of screenRoots()) if (root.contains(element) && element !== root) return { screen, root };
  return null;
};

const toggleMode = (button) => {
  mode = !mode;
  button.setAttribute("aria-pressed", String(mode));
  document.documentElement.classList.toggle("fb_mode", mode);
  hovered?.classList.remove("fb_hover");
};

addEventListener("mouseover", (event) => {
  if (!mode) return;
  hovered?.classList.remove("fb_hover");
  hovered = locate(event.target) ? event.target : null;
  hovered?.classList.add("fb_hover");
});

addEventListener("click", (event) => {
  if (!mode || event.target.closest(".fb_pop, .fb_bar, .fb_panel, .fb_pin")) return;
  const found = locate(event.target);
  if (!found) return;
  event.preventDefault();
  event.stopPropagation();
  event.target.classList.remove("fb_hover");
  popup(event.target, found.screen, found.root, event.clientX + 12, event.clientY + 12);
}, true);

addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelector(".fb_pop")?.remove(); });
addEventListener("resize", renderPins);

document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
const bar = document.createElement("div");
bar.className = "fb_bar";
const modeButton = Object.assign(document.createElement("button"), { type: "button", textContent: "Оставить отзыв" });
modeButton.setAttribute("aria-pressed", "false");
modeButton.addEventListener("click", () => toggleMode(modeButton));
counter.type = "button";
counter.addEventListener("click", () => openPanel(panel.hidden));
bar.append(modeButton, counter);
document.body.append(panel, bar);

const [manifest, feedback] = await Promise.all([
  fetch("screens.json").then((response) => response.json()).catch(() => ({ screens: [] })),
  fetch(`/${FILE}`, { cache: "no-store" }).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
]);
for (const screen of manifest.screens ?? []) titles.set(screen.file, screen.title);
parse(feedback);
render();
openPanel(false);
