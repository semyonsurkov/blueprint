const ICONS = "https://esm.sh/lucide-static@1.51.0/icons";
const iconCache = new Map();

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

const placeIcons = () => Promise.all([...document.querySelectorAll("[data-icon]")].map(async (node) => {
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

export const renderScreens = async (blocks = {}) => {
  await fillBlocks(blocks);
  expandRepeats();
  await placeIcons();
  const annotate = new URLSearchParams(location.search).has("annotate");
  if (window.WIRE_ANNOTATE || annotate || window.top === window) {
    await import("./feedback.js");
    if (annotate) addBackLink();
  }
};
