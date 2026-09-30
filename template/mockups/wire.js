const loadSite = async () => (await (await fetch("screens.json")).json()).site;

const REFRESH_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`;

const header = (SITE, active) => `
  <div class="h2">${SITE.logo}</div>
  <div class="nav">${SITE.nav.map((item) =>
    `<div class="nav_item${item === active ? " nav_item_active" : ""}">${item}</div>`).join("")}</div>
  <div class="grow"></div>
  <div class="row gap_16">
    <div class="label">${SITE.updated}</div>
    <button class="btn">${SITE.action}</button>
  </div>`;

const headerMobile = (SITE) => `
  <div class="t fs_18 fw_700">${SITE.logo}</div>
  <button class="btn_icon" aria-label="${SITE.refreshLabel}">${REFRESH_ICON}</button>`;

const slots = document.querySelectorAll("[data-wire]");
if (slots.length) {
  const SITE = await loadSite();
  for (const slot of slots) {
    if (slot.dataset.wire === "header") {
      slot.className = "header";
      slot.innerHTML = header(SITE, slot.dataset.active);
    } else if (slot.dataset.wire === "header_mobile") {
      slot.className = "header_mobile";
      slot.innerHTML = headerMobile(SITE);
    }
  }
}

for (let node; (node = document.querySelector("[data-repeat]"));) {
  const count = Number(node.dataset.repeat);
  node.removeAttribute("data-repeat");
  const copies = Array.from({ length: count - 1 }, () => node.cloneNode(true));
  node.after(...copies);
  [node, ...copies].forEach((item, index) => { item.dataset.copy = `${index + 1}/${count}`; });
}

const REACT_VERSION = "19.3.0";
const AGENTATION_VERSION = "3.1.2";
const ESM = "https://esm.sh";

const mountNotes = async () => {
  const deps = `deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`;
  const [react, dom, { Agentation }] = await Promise.all([
    import(`${ESM}/react@${REACT_VERSION}`),
    import(`${ESM}/react-dom@${REACT_VERSION}/client`),
    import(`${ESM}/agentation@${AGENTATION_VERSION}?${deps}`),
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  dom.createRoot(host).render((react.default ?? react).createElement(Agentation));
};

const annotate = new URLSearchParams(location.search).has("annotate");
if (annotate || window.top === window) {
  mountNotes();
  if (annotate) {
    const back = document.createElement("a");
    back.className = "back_chip";
    back.href = "index.html";
    back.textContent = "← Доска";
    document.body.append(back);
  }
}
