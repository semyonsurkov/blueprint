import { renderScreens } from "/blueprint/screen.js";

const header = (site, slot) => `
  <div class="h2">${site.logo ?? ""}</div>
  <div class="nav">${(site.nav ?? []).map((item) =>
    `<div class="nav_item${item === slot.dataset.active ? " nav_item_active" : ""}">${item}</div>`).join("")}</div>
  <div class="grow"></div>
  <button class="btn">${site.action ?? ""}</button>`;

const headerMobile = (site) => `
  <div class="t fs_18 fw_700">${site.logo ?? ""}</div>
  <button class="btn_icon" aria-label="${site.menuLabel ?? "Меню"}"><span data-icon="menu"></span></button>`;

await renderScreens({ header, header_mobile: headerMobile });
