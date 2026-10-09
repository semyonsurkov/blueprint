import { pathOf, watch } from "./live.js";

const ICONS = "https://esm.sh/lucide-static@1.51.0/icons";
const iconCache = new Map();
let rendered = null;

const loadSite = async () => {
  try {
    return (await (await fetch("screens.json")).json()).site ?? {};
  } catch {
    return {};
  }
};

const fillBlocks = async (blocks) => {
  const slots = document.querySelectorAll("[data-wire]");
  if (!slots.length) return;
  const site = await loadSite();
  for (const slot of slots) {
    const render = blocks[slot.dataset.wire];
    if (!render) continue;
    slot.className = slot.dataset.wire;
    slot.innerHTML = render(site, slot);
  }
};

const expandRepeats = () => {
  for (let node; (node = document.querySelector("[data-repeat]"));) {
    const count = Number(node.dataset.repeat);
    node.removeAttribute("data-repeat");
    const copies = Array.from({ length: count - 1 }, () => node.cloneNode(true));
    node.after(...copies);
    [node, ...copies].forEach((item, index) => { item.dataset.copy = `${index + 1}/${count}`; });
  }
};

const loadIcon = (name) => {
  if (!iconCache.has(name)) {
    iconCache.set(name, fetch(`${ICONS}/${name}.svg`).then((response) => (response.ok ? response.text() : null)).catch(() => null));
  }
  return iconCache.get(name);
};

const placeIcons = () => Promise.all([...document.querySelectorAll("[data-icon]:not([data-icon-placed])")].map(async (node) => {
  node.dataset.iconPlaced = "";
  const svg = await loadIcon(node.dataset.icon);
  if (svg) node.insertAdjacentHTML("afterbegin", svg.replace(/<!--.*?-->/s, ""));
  else node.dataset.iconMissing = "";
}));

const addBackLink = () => {
  const back = document.createElement("a");
  back.className = "ui_button fb_back";
  back.href = "index.html";
  back.textContent = "← Доска";
  document.body.append(back);
};

const render = async (blocks) => {
  await fillBlocks(blocks);
  expandRepeats();
  await placeIcons();
};

export const rerenderScreens = () => rendered?.() ?? Promise.resolve();

const reloadOnChange = () => {
  const own = pathOf(location.href);
  const folder = own.slice(0, own.lastIndexOf("/") + 1);
  watch((paths) => {
    if ([own, `${folder}wire.js`, `${folder}screens.json`].some((path) => paths.has(path))) location.reload();
  });
};

export const renderScreens = async (blocks = {}) => {
  rendered = () => render(blocks);
  await render(blocks);
  if (!window.WIRE_ANNOTATE) reloadOnChange();
  const annotate = new URLSearchParams(location.search).has("annotate");
  if (window.WIRE_ANNOTATE || annotate || window.top === window) {
    await import("./feedback.js");
    if (annotate) addBackLink();
  }
};
