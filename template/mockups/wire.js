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
