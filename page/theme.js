{
  const THEME_KEY = "blueprint_theme";
  let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try { theme = localStorage.getItem(THEME_KEY) || theme; } catch {}
  try { theme = window.parent.document.documentElement.dataset.theme || theme; } catch {}
  document.documentElement.dataset.theme = theme;
}
