// src/theme/theme.ts
export type Theme = "light" | "dark" | "system";
const KEY = "__theme__";

export function getStoredTheme(): Theme {
  try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; }
}

export function setStoredTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch {}
}

export function resolveTheme(t: Theme): "light" | "dark" {
  if (t !== "system") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme = getStoredTheme()) {
  const effective = resolveTheme(t);
  document.documentElement.setAttribute("data-theme", effective);
  setStoredTheme(t);
  // notify listeners (toolbar, etc.)
  window.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme: t, effective } }));
}

// Re-apply on system change if user picked "system"
export function watchSystemTheme() {
  const mm = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getStoredTheme() === "system") applyTheme("system");
  };
  if (mm.addEventListener) mm.addEventListener("change", onChange);
  else mm.addListener(onChange);
}