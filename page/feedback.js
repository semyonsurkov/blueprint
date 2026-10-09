import { icon } from "./icons.js";
import { watch } from "./live.js";

const FOLDER = decodeURIComponent(location.pathname).replace(/^\/|\/?[^/]*$/g, "");
const FILE = FOLDER ? `${FOLDER}/FEEDBACK.md` : "FEEDBACK.md";
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

const CONTINUATION = "  ";

const parse = (text) => {
  const list = [];
  let screen = null;
  let last = null;
  for (const line of text.split("\n")) {
    const heading = line.match(SCREEN_HEADING);
    if (heading) screen = heading[1];
    const item = line.match(ITEM);
    if (item && screen) {
      last = { screen, done: item[1] === "x", id: Number(item[2]), selector: item[3], text: item[4] };
      list.push(last);
    } else if (last && line.startsWith(CONTINUATION) && line.trim()) {
      last.text += `\n${line.trim()}`;
    } else if (line.trim()) {
      last = null;
    }
  }
  return list;
};

const cleanText = (value) => value.split("\n")
  .map((line) => line.replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("\n");

const itemLines = (note) => {
  const [first, ...rest] = note.text.split("\n");
  return [`- [${note.done ? "x" : " "}] ${note.id}. \`${note.selector}\` — ${first}`, ...rest.map((line) => CONTINUATION + line)];
};

const serialize = () => {
  const screens = [...new Set(notes.map((note) => note.screen))];
  const blocks = screens.map((screen) => {
    const title = titles.get(screen);
    const items = notes.filter((note) => note.screen === screen)
      .flatMap(itemLines);
    return [`## ${screen}${title ? ` — ${title}` : ""}`, "", ...items].join("\n");
  });
  return ["# Комментарии к макетам", "", "Открытые пункты `- [ ]` ждут правки, путь в обратных кавычках ведёт к элементу от `.screen` экрана.", "", ...blocks.flatMap((block) => [block, ""])].join("\n");
};

const NOTICE_MS = 4000;

const fileUrl = (path) => `/${path.split("/").map(encodeURIComponent).join("/")}`;

const NOT_FOUND = 404;

const readFeedback = async () => {
  const response = await fetch(fileUrl(FILE), { cache: "no-store" });
  if (response.status === NOT_FOUND) return "";
  if (!response.ok) throw new Error(`FEEDBACK.md не прочитался: ${response.status}`);
  return response.text();
};

const save = async () => {
  const response = await fetch(`/api/save?path=${encodeURIComponent(FILE)}`, { method: "POST", body: serialize() })
    .catch(() => null);
  if (!response?.ok) {
    const onDisk = await readFeedback().catch(() => null);
    if (onDisk !== null) notes.splice(0, notes.length, ...parse(onDisk));
    notice(onDisk !== null
      ? "Не удалось сохранить комментарий, показано то, что лежит в FEEDBACK.md"
      : "Не удалось ни сохранить комментарий, ни прочитать FEEDBACK.md: изменения только на странице");
  }
  render();
};

const byId = (list, id) => list.find((item) => item.id === id);
const withoutId = (list, id) => {
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) list.splice(index, 1);
};

let queue = Promise.resolve();

const change = (apply) => {
  queue = queue.then(async () => {
    let fresh;
    try {
      fresh = parse(await readFeedback());
    } catch (error) {
      notice(`${error.message}, комментарий не сохранён`);
      return;
    }
    apply(fresh);
    notes.splice(0, notes.length, ...fresh);
    await save();
  }).catch((error) => notice(`Комментарий не сохранён: ${error.message}`));
  return queue;
};

const SCREEN = ":scope";
const resolve = (root, selector) => {
  if (selector === SCREEN) return root;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
};
const target = (note) => {
  const root = screenRoots().get(note.screen);
  return root ? resolve(root, note.selector) : null;
};

const flash = (element) => {
  element.classList.add("fb_flash");
  setTimeout(() => element.classList.remove("fb_flash"), 1600);
};

const WHOLE_PIN_OFFSET = 16;
const WHOLE_PIN_STEP = 28;

const renderPins = () => {
  for (const layer of document.querySelectorAll(".fb_layer")) layer.remove();
  for (const [screen, root] of screenRoots()) {
    root.style.position ||= "relative";
    const layer = document.createElement("div");
    layer.className = "fb_layer";
    root.append(layer);
    const rootBox = root.getBoundingClientRect();
    const scale = rootBox.width / root.offsetWidth || 1;
    let wholeIndex = 0;
    for (const note of notes.filter((item) => item.screen === screen)) {
      const element = resolve(root, note.selector);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const whole = element === root;
      const wholeX = WHOLE_PIN_OFFSET + (whole ? wholeIndex++ : 0) * WHOLE_PIN_STEP;
      const pin = document.createElement("div");
      pin.className = "fb_pin";
      themed(pin);
      pin.textContent = note.id;
      pin.title = note.text;
      if (note.done) pin.dataset.done = "";
      pin.style.setProperty("--pin_x", `${whole ? wholeX : (box.right - rootBox.left) / scale}px`);
      pin.style.setProperty("--pin_y", `${whole ? WHOLE_PIN_OFFSET : (box.top - rootBox.top) / scale}px`);
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        flash(element);
        showNote(note, event.clientX + 12, event.clientY + 12);
      });
      layer.append(pin);
    }
  }
};

const openText = () => {
  const open = notes.filter((note) => !note.done);
  const blocks = [...new Set(open.map((note) => note.screen))].map((screen) => {
    const title = titles.get(screen);
    return [`## ${screen}${title ? ` — ${title}` : ""}`, ...open.filter((note) => note.screen === screen).flatMap(itemLines)].join("\n");
  });
  return [`Комментарии к макетам из ${FILE}, путь в обратных кавычках ведёт к элементу от .screen экрана:`, ...blocks].join("\n\n");
};

const copyOpen = async () => {
  const count = notes.filter((note) => !note.done).length;
  try {
    await navigator.clipboard.writeText(openText());
    notice(`Скопировано комментариев: ${count}`);
  } catch {
    notice("Браузер не дал доступ к буферу обмена");
  }
};

const editInline = (row, note) => {
  if (row.querySelector("form")) return;
  const form = document.createElement("form");
  form.className = "fb_edit";
  form.innerHTML = `<textarea class="ui_field" aria-label="Текст комментария"></textarea><div class="ui_hint_text">Enter сохраняет, Shift+Enter перенос, Esc отмена</div>`;
  const field = form.querySelector("textarea");
  field.value = note.text;
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    renderPanel();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = cleanText(field.value);
    if (!text || text === note.text) { renderPanel(); return; }
    change((list) => { const item = byId(list, note.id); if (item) item.text = text; });
  });
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("dblclick", (event) => event.stopPropagation());
  row.querySelector(".fb_text").replaceWith(form);
  row.querySelector(".fb_note_actions").hidden = true;
  enterSubmits(form);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
};

const panel = document.createElement("aside");
panel.className = "fb_panel ui_side_panel";
panel.hidden = true;

const renderPanel = () => {
  panel.replaceChildren();
  const head = document.createElement("div");
  head.className = "fb_panel_head";
  head.innerHTML = `<h2>Комментарии</h2><button type="button" class="ui_button" data-variant="ghost">${icon("copy")}Скопировать открытые</button>`;
  const copy = head.querySelector("button");
  copy.disabled = !notes.some((note) => !note.done);
  copy.addEventListener("click", copyOpen);
  panel.append(head);
  if (!notes.length) {
    panel.append(Object.assign(document.createElement("p"), { className: "ui_hint_text", textContent: "Пока пусто. Нажмите C или «Оставить комментарий» и щёлкните по элементу экрана. Щелчок по названию экрана оставляет комментарий на весь экран." }));
  }
  for (const screen of new Set(notes.map((note) => note.screen))) {
    panel.append(Object.assign(document.createElement("h3"), { textContent: titles.get(screen) ?? screen }));
    for (const note of notes.filter((item) => item.screen === screen)) {
      const row = document.createElement("div");
      row.className = "fb_note";
      if (note.done) row.dataset.done = "";
      row.innerHTML = `<span class="fb_num"></span><span class="fb_text"></span><span class="fb_note_actions"><button type="button" class="ui_icon_button" data-variant="ghost" data-done>${icon("check")}</button><button type="button" class="ui_icon_button" data-variant="ghost" data-edit aria-label="Изменить" title="Изменить">${icon("edit")}</button><button type="button" class="ui_icon_button" data-variant="ghost" data-delete aria-label="Удалить" title="Удалить">${icon("remove")}</button></span>`;
      row.querySelector(".fb_num").textContent = note.id;
      row.querySelector(".fb_text").textContent = note.text;
      const done = row.querySelector("[data-done]");
      const doneLabel = note.done ? "Вернуть в работу" : "Выполнено";
      done.setAttribute("aria-label", doneLabel);
      done.title = doneLabel;
      done.setAttribute("aria-pressed", String(note.done));
      done.addEventListener("click", (event) => {
        event.stopPropagation();
        change((list) => { const item = byId(list, note.id); if (item) item.done = !note.done; });
      });
      row.querySelector("[data-edit]").addEventListener("click", (event) => {
        event.stopPropagation();
        editInline(row, note);
      });
      row.querySelector("[data-delete]").addEventListener("click", (event) => {
        event.stopPropagation();
        change((list) => withoutId(list, note.id));
      });
      row.addEventListener("click", () => {
        if (row.querySelector("form")) return;
        const element = target(note);
        if (!element) return;
        element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        flash(element);
      });
      row.addEventListener("dblclick", () => editInline(row, note));
      panel.append(row);
    }
  }
};

const counter = document.createElement("button");
const render = () => {
  counter.textContent = `Комментарии (${notes.filter((note) => !note.done).length})`;
  renderPanel();
  renderPins();
};

const openPanel = (open) => {
  panel.hidden = !open;
  counter.setAttribute("aria-pressed", String(open));
};

const FIELD_MAX_HEIGHT = 160;

const growField = (field) => {
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, FIELD_MAX_HEIGHT)}px`;
};

const enterSubmits = (box) => {
  const field = box.querySelector("textarea");
  field.rows = 1;
  field.addEventListener("input", () => growField(field));
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    box.requestSubmit();
  });
  requestAnimationFrame(() => growField(field));
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
  enterSubmits(box);
  box.showPopover();
};

const popup = (screen, selector, x, y) => {
  const box = document.createElement("form");
  const whole = selector === SCREEN;
  box.innerHTML = `<div class="fb_pop_head"></div><textarea class="ui_field" placeholder="Что поменять? Enter сохраняет, Shift+Enter перенос строки"></textarea><div class="ui_mono ui_hint_text"></div><div class="fb_actions"><button type="button" class="ui_button" data-variant="ghost">Отмена</button><button type="submit" class="ui_button" data-variant="primary">Сохранить</button></div>`;
  box.querySelector(".fb_pop_head").textContent = whole ? `Весь экран «${titles.get(screen) ?? screen}»` : (titles.get(screen) ?? screen);
  box.querySelector(".ui_mono").textContent = whole ? screen : `${screen} ${selector}`;
  box.querySelector("button[type=button]").addEventListener("click", () => box.hidePopover());
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = cleanText(box.querySelector("textarea").value);
    if (!text) return;
    box.hidePopover();
    change((list) => list.push({ screen, selector, text, done: false, id: Math.max(0, ...list.map((note) => note.id)) + 1 }));
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
  done.addEventListener("click", () => {
    box.hidePopover();
    change((list) => { const item = byId(list, note.id); if (item) item.done = !note.done; });
  });
  box.querySelector("[data-delete]").addEventListener("click", () => {
    box.hidePopover();
    change((list) => withoutId(list, note.id));
  });
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = cleanText(box.querySelector("textarea").value);
    box.hidePopover();
    if (text) change((list) => { const item = byId(list, note.id); if (item) item.text = text; });
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
const MODE_TEXT = "Щёлкните по элементу или названию экрана, Esc выход";
modeHint.textContent = MODE_TEXT;
let noticeTimer;
const notice = (text) => {
  clearTimeout(noticeTimer);
  modeHint.textContent = text;
  modeHint.hidden = false;
  noticeTimer = setTimeout(() => {
    modeHint.textContent = MODE_TEXT;
    modeHint.hidden = !mode;
  }, NOTICE_MS);
};

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
addEventListener("blueprint:screens", renderPins);

watch(async (paths) => {
  if (!paths.has(FILE)) return;
  const text = await readFeedback().catch(() => null);
  if (text === null) return;
  notes.splice(0, notes.length, ...parse(text));
  if (panel.querySelector(".fb_edit")) renderPins();
  else render();
});

for (const href of ["/blueprint/ui.css", "/blueprint/feedback.css"]) {
  if (!document.querySelector(`link[href="${href}"]`)) {
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
  }
}
const bar = document.createElement("div");
bar.className = "fb_bar fb_ui ui_toolbar";
panel.classList.add("fb_ui");
try {
  uiTheme = window.parent.document.documentElement.dataset.theme
    ?? document.documentElement.dataset.theme
    ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {}
const modeButton = Object.assign(document.createElement("button"), { type: "button", className: "ui_button", innerHTML: "Оставить комментарий<span class=\"ui_kbd\">C</span>" });
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
  readFeedback().catch(() => ""),
]);
for (const screen of manifest.screens ?? []) titles.set(screen.file, screen.title);
notes.push(...parse(feedback));
render();
openPanel(false);
