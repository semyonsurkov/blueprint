const FOLDER = location.pathname.replace(/^\/|\/[^/]*$/g, "");
const FILE = `${FOLDER}/FEEDBACK.md`;
const ITEM = /^- \[( |x)\] (\d+)\. `([^`]+)` — (.*)$/;
const SCREEN_HEADING = /^## (\S+\.html)/;

const STYLE = `
.fb_ui, .fb_pin { --fb_ink: #1a1a1a; --fb_mute: #6b6b6b; --fb_line: #e2e2e2; --fb_bg: #ffffff; --fb_soft: #f6f6f4; }
:root[data-fb-dark] .fb_ui, :root[data-fb-dark] .fb_pin {
  --fb_ink: #ececec; --fb_mute: #9a9a9a; --fb_line: #333333; --fb_bg: #161616; --fb_soft: #232323;
  filter: invert(1) hue-rotate(180deg);
}
.fb_ui { font: 14px/1.4 system-ui, -apple-system, sans-serif; color: var(--fb_ink); }
.fb_bar { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: flex; gap: 6px; padding: 4px; border: 1px solid var(--fb_line); border-radius: 10px; background: var(--fb_bg); box-shadow: 0 4px 16px rgba(0,0,0,.12); }
.fb_ui button { border: 1px solid transparent; border-radius: 8px; background: none; color: var(--fb_ink); padding: 6px 12px; font: inherit; cursor: pointer; }
.fb_ui button:hover { background: var(--fb_soft); }
.fb_bar button[aria-pressed="true"] { background: var(--fb_soft); border-color: var(--fb_line); font-weight: 600; }
.fb_ui kbd { margin-left: 6px; padding: 0 5px; border: 1px solid var(--fb_line); border-radius: 4px; color: var(--fb_mute); font: 11px ui-monospace, monospace; }
.fb_mode .screen *, .fb_mode .caption { cursor: crosshair !important; }
.fb_hover { outline: 2px dashed #1a1a1a !important; outline-offset: 2px; }
.fb_flash { outline: 2px solid #1a1a1a !important; outline-offset: 3px; }
.fb_layer { position: absolute; inset: 0; pointer-events: none; z-index: 50; }
.fb_pin { position: absolute; width: 24px; height: 24px; margin: -12px 0 0 -12px; border: 2px solid var(--fb_bg); border-radius: 50% 50% 50% 0; background: var(--fb_ink); color: var(--fb_bg); font: 600 12px/20px system-ui; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,.25); pointer-events: auto; cursor: pointer; }
.fb_pin[data-done] { background: var(--fb_mute); }
.fb_pop { position: fixed; z-index: 1001; width: 320px; padding: 12px; border: 1px solid var(--fb_line); border-radius: 10px; background: var(--fb_bg); display: flex; flex-direction: column; gap: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.2); }
.fb_pop_head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.fb_pop textarea { min-height: 84px; resize: vertical; font: inherit; color: var(--fb_ink); background: var(--fb_bg); padding: 8px 10px; border: 1px solid var(--fb_line); border-radius: 8px; outline: none; }
.fb_pop textarea:focus { border-color: var(--fb_mute); }
.fb_pop textarea::placeholder { color: var(--fb_mute); }
.fb_pop .fb_path { color: var(--fb_mute); font: 11px ui-monospace, monospace; word-break: break-all; }
.fb_actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.fb_actions .fb_grow { margin-right: auto; }
.fb_ui button.fb_primary { background: var(--fb_ink); color: var(--fb_bg); }
.fb_ui button.fb_primary:hover { opacity: .85; background: var(--fb_ink); }
.fb_ui button.fb_danger { color: var(--fb_mute); }
.fb_panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 999; width: 380px; overflow: auto; padding: 16px 16px 80px; background: var(--fb_bg); border-left: 1px solid var(--fb_line); box-shadow: -8px 0 24px rgba(0,0,0,.1); }
.fb_panel[hidden] { display: none; }
.fb_panel h2 { margin: 0 0 4px; font-size: 16px; }
.fb_panel h3 { margin: 16px 0 6px; font-size: 13px; color: var(--fb_mute); }
.fb_note { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-radius: 8px; cursor: pointer; }
.fb_note:hover { background: var(--fb_soft); }
.fb_note[data-done] .fb_text { color: var(--fb_mute); text-decoration: line-through; }
.fb_num { flex: none; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: var(--fb_ink); color: var(--fb_bg); font: 600 12px/22px system-ui; text-align: center; }
.fb_note[data-done] .fb_num { background: var(--fb_mute); }
.fb_text { flex: 1; min-width: 0; }
.fb_hint { color: var(--fb_mute); font-size: 13px; }
.fb_note input { accent-color: var(--fb_ink); }
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

const SCREEN = ":scope";
const resolve = (root, selector) => (selector === SCREEN ? root : root.querySelector(selector));
const target = (note) => {
  const root = screenRoots().get(note.screen);
  return root ? resolve(root, note.selector) : null;
};

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
      const element = resolve(root, note.selector);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const whole = element === root;
      const pin = document.createElement("div");
      pin.className = "fb_pin";
      pin.textContent = note.id;
      pin.title = note.text;
      if (note.done) pin.dataset.done = "";
      pin.style.left = `${whole ? 16 : (box.right - rootBox.left) / scale}px`;
      pin.style.top = `${whole ? 16 : (box.top - rootBox.top) / scale}px`;
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        flash(element);
        showNote(note, event.clientX + 12, event.clientY + 12);
      });
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
    panel.append(Object.assign(document.createElement("p"), { className: "fb_hint", textContent: "Пока пусто. Нажмите C или «Оставить отзыв» и щёлкните по элементу экрана. Щелчок по названию экрана оставляет отзыв на весь экран." }));
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
      row.addEventListener("dblclick", () => {
        const box = row.getBoundingClientRect();
        showNote(note, box.left - 340, box.top);
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

const placePopup = (box, x, y) => {
  document.querySelector(".fb_pop")?.remove();
  box.className = "fb_pop fb_ui";
  box.style.left = `${Math.max(8, Math.min(x, innerWidth - 336))}px`;
  box.style.top = `${Math.max(8, Math.min(y, innerHeight - 260))}px`;
  document.body.append(box);
};

const popup = (screen, selector, x, y) => {
  const box = document.createElement("form");
  const whole = selector === SCREEN;
  box.innerHTML = `<div class="fb_pop_head"></div><textarea placeholder="Что хочется поменять?"></textarea><div class="fb_path"></div><div class="fb_actions"><button type="button">Отмена</button><button type="submit" class="fb_primary">Сохранить</button></div>`;
  box.querySelector(".fb_pop_head").textContent = whole ? `Весь экран «${titles.get(screen) ?? screen}»` : (titles.get(screen) ?? screen);
  box.querySelector(".fb_path").textContent = whole ? screen : `${screen} ${selector}`;
  box.querySelector("button[type=button]").addEventListener("click", () => box.remove());
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.querySelector("textarea").value.replace(/\s+/g, " ").trim();
    if (!text) return;
    notes.push({ screen, selector, text, done: false, id: Math.max(0, ...notes.map((note) => note.id)) + 1 });
    box.remove();
    save();
  });
  placePopup(box, x, y);
  box.querySelector("textarea").focus();
};

const showNote = (note, x, y) => {
  const box = document.createElement("form");
  box.innerHTML = `<div class="fb_pop_head"><span class="fb_num"></span><span></span></div><textarea></textarea><div class="fb_path"></div><div class="fb_actions"><button type="button" class="fb_danger fb_grow">Удалить</button><button type="button" data-done></button><button type="submit" class="fb_primary">Сохранить</button></div>`;
  box.querySelector(".fb_num").textContent = note.id;
  box.querySelector(".fb_pop_head span:last-child").textContent = titles.get(note.screen) ?? note.screen;
  box.querySelector("textarea").value = note.text;
  box.querySelector(".fb_path").textContent = `${note.screen} ${note.selector}`;
  const done = box.querySelector("[data-done]");
  done.textContent = note.done ? "Вернуть в работу" : "Выполнено";
  done.addEventListener("click", () => { note.done = !note.done; box.remove(); save(); });
  box.querySelector(".fb_danger").addEventListener("click", () => {
    notes.splice(notes.indexOf(note), 1);
    box.remove();
    save();
  });
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.querySelector("textarea").value.replace(/\s+/g, " ").trim();
    if (text) note.text = text;
    box.remove();
    save();
  });
  placePopup(box, x, y);
};

const locate = (element) => {
  for (const [screen, root] of screenRoots()) if (root.contains(element) && element !== root) return { screen, root };
  return null;
};

const captionScreen = (element) => {
  const caption = element.closest(".caption");
  const holder = caption?.parentElement;
  return holder?.id?.startsWith("screen_") ? `${holder.id.slice(7)}.html` : null;
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
  if (!mode || event.target.closest(".fb_ui, .fb_pin")) return;
  const whole = captionScreen(event.target);
  const found = whole ? null : locate(event.target);
  if (!whole && !found) return;
  event.preventDefault();
  event.stopPropagation();
  event.target.classList.remove("fb_hover");
  if (whole) popup(whole, SCREEN, event.clientX + 12, event.clientY + 12);
  else popup(found.screen, selectorOf(event.target, found.root), event.clientX + 12, event.clientY + 12);
}, true);

addEventListener("keydown", (event) => {
  if (event.target.closest?.("input, textarea, [contenteditable]")) return;
  if (event.key === "Escape") {
    if (document.querySelector(".fb_pop")) document.querySelector(".fb_pop").remove();
    else if (mode) toggleMode(modeButton);
  } else if (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "с") {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) toggleMode(modeButton);
  }
});
addEventListener("resize", renderPins);

document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
const bar = document.createElement("div");
bar.className = "fb_bar fb_ui";
panel.classList.add("fb_ui");
try {
  if (window.parent !== window && window.parent.document.documentElement.dataset.theme === "dark") {
    document.documentElement.dataset.fbDark = "";
  }
} catch {}
const modeButton = Object.assign(document.createElement("button"), { type: "button" });
modeButton.innerHTML = "Оставить отзыв<kbd>C</kbd>";
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
