const FOLDER = location.pathname.replace(/^\/|\/[^/]*$/g, "");
const FILE = `${FOLDER}/FEEDBACK.md`;
const ITEM = /^- \[( |x)\] (\d+)\. `([^`]+)` — (.*)$/;
const SCREEN_HEADING = /^## (\S+\.html)/;


let uiTheme = "light";
const themed = (element) => { element.dataset.uiTheme = uiTheme; return element; };
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
      themed(pin);
      pin.textContent = note.id;
      pin.title = note.text;
      if (note.done) pin.dataset.done = "";
      pin.style.setProperty("--pin_x", `${whole ? 16 : (box.right - rootBox.left) / scale}px`);
      pin.style.setProperty("--pin_y", `${whole ? 16 : (box.top - rootBox.top) / scale}px`);
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
panel.className = "fb_panel ui_side_panel";
panel.hidden = true;

const renderPanel = () => {
  panel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Отзывы";
  panel.append(heading);
  if (!notes.length) {
    panel.append(Object.assign(document.createElement("p"), { className: "ui_hint_text", textContent: "Пока пусто. Нажмите C или «Оставить отзыв» и щёлкните по элементу экрана. Щелчок по названию экрана оставляет отзыв на весь экран." }));
  }
  for (const screen of new Set(notes.map((note) => note.screen))) {
    panel.append(Object.assign(document.createElement("h3"), { textContent: titles.get(screen) ?? screen }));
    for (const note of notes.filter((item) => item.screen === screen)) {
      const row = document.createElement("div");
      row.className = "fb_note";
      if (note.done) row.dataset.done = "";
      row.innerHTML = `<span class="fb_num"></span><span class="fb_text"></span><input type="checkbox" aria-label="Выполнено"><button type="button" class="ui_button" data-variant="quiet" aria-label="Удалить">✕</button>`;
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
  box.className = "fb_pop fb_ui ui_popover";
  themed(box);
  box.popover = "auto";
  box.style.setProperty("--popover_x", `${Math.max(8, Math.min(x, innerWidth - 336))}px`);
  box.style.setProperty("--popover_y", `${Math.max(8, Math.min(y, innerHeight - 260))}px`);
  box.addEventListener("toggle", (event) => { if (event.newState === "closed") box.remove(); });
  document.body.append(box);
  box.showPopover();
};

const popup = (screen, selector, x, y) => {
  const box = document.createElement("form");
  const whole = selector === SCREEN;
  box.innerHTML = `<div class="fb_pop_head"></div><textarea class="ui_field" placeholder="Что хочется поменять?"></textarea><div class="ui_mono ui_hint_text"></div><div class="fb_actions"><button type="button" class="ui_button" data-variant="ghost">Отмена</button><button type="submit" class="ui_button" data-variant="primary">Сохранить</button></div>`;
  box.querySelector(".fb_pop_head").textContent = whole ? `Весь экран «${titles.get(screen) ?? screen}»` : (titles.get(screen) ?? screen);
  box.querySelector(".ui_mono").textContent = whole ? screen : `${screen} ${selector}`;
  box.querySelector("button[type=button]").addEventListener("click", () => box.hidePopover());
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.querySelector("textarea").value.replace(/\s+/g, " ").trim();
    if (!text) return;
    notes.push({ screen, selector, text, done: false, id: Math.max(0, ...notes.map((note) => note.id)) + 1 });
    box.hidePopover();
    save();
  });
  placePopup(box, x, y);
  box.querySelector("textarea").focus();
};

const showNote = (note, x, y) => {
  const box = document.createElement("form");
  box.innerHTML = `<div class="fb_pop_head"><span class="fb_num"></span><span></span></div><textarea class="ui_field"></textarea><div class="ui_mono ui_hint_text"></div><div class="fb_actions"><button type="button" class="ui_button" data-variant="quiet" data-delete>Удалить</button><button type="button" class="ui_button" data-done></button><button type="submit" class="ui_button" data-variant="primary">Сохранить</button></div>`;
  box.querySelector(".fb_num").textContent = note.id;
  box.querySelector(".fb_pop_head span:last-child").textContent = titles.get(note.screen) ?? note.screen;
  box.querySelector("textarea").value = note.text;
  box.querySelector(".ui_mono").textContent = `${note.screen} ${note.selector}`;
  const done = box.querySelector("[data-done]");
  done.textContent = note.done ? "Вернуть в работу" : "Выполнено";
  done.addEventListener("click", () => { note.done = !note.done; box.hidePopover(); save(); });
  box.querySelector("[data-delete]").addEventListener("click", () => {
    notes.splice(notes.indexOf(note), 1);
    box.hidePopover();
    save();
  });
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.querySelector("textarea").value.replace(/\s+/g, " ").trim();
    if (text) note.text = text;
    box.hidePopover();
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

const modeHint = document.createElement("div");
modeHint.className = "fb_mode_hint fb_ui";
modeHint.hidden = true;
modeHint.textContent = "Режим отзыва: щёлкните по элементу или названию экрана · Esc — выйти";

const toggleMode = (button) => {
  mode = !mode;
  modeHint.hidden = !mode;
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
  if (event.key === "Escape" && !document.querySelector(".fb_pop") && mode) toggleMode(modeButton); else if (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "с") {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) toggleMode(modeButton);
  }
});
addEventListener("resize", renderPins);

for (const href of ["/blueprint/ui.css", "feedback.css"]) {
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
}
const bar = document.createElement("div");
bar.className = "fb_bar fb_ui ui_toolbar";
panel.classList.add("fb_ui");
try {
  if (window.parent !== window) {
    if (window.frameElement?.dataset.themeMode !== "project") document.documentElement.dataset.framed = "";
    uiTheme = window.parent.document.documentElement.dataset.theme ?? "light";
  }
} catch {}
const modeButton = Object.assign(document.createElement("button"), { type: "button", className: "ui_button", innerHTML: "Оставить отзыв<span class=\"ui_kbd\">C</span>" });
modeButton.dataset.variant = "ghost";
modeButton.setAttribute("aria-pressed", "false");
modeButton.addEventListener("click", () => toggleMode(modeButton));
counter.type = "button";
counter.className = "ui_button";
counter.dataset.variant = "ghost";
counter.addEventListener("click", () => openPanel(panel.hidden));
bar.append(modeButton, counter);
themed(panel);
themed(bar);
themed(modeHint);
document.body.append(panel, bar, modeHint);

const [manifest, feedback] = await Promise.all([
  fetch("screens.json").then((response) => response.json()).catch(() => ({ screens: [] })),
  fetch(`/${FILE}`, { cache: "no-store" }).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
]);
for (const screen of manifest.screens ?? []) titles.set(screen.file, screen.title);
parse(feedback);
render();
openPanel(false);
