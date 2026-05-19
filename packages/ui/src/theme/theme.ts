export type Theme = "light" | "dark" | "system";
const KEY = "__theme__";

export function getStoredTheme(): Theme {
  try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; }
}

export function setStoredTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
}

export function resolveTheme(t: Theme): "light" | "dark" {
  if (t !== "system") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme = getStoredTheme()) {
  const effective = resolveTheme(t);
  document.documentElement.setAttribute("data-theme", effective);
  setStoredTheme(t);
  window.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme: t, effective } }));
}

export function watchSystemTheme() {
  const mm = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getStoredTheme() === "system") applyTheme("system");
  };
  if (mm.addEventListener) mm.addEventListener("change", onChange);
  else mm.addListener(onChange);
}
