export type AppTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "mqm-theme";

function normalizeTheme(value: string | null | undefined): AppTheme | null {
  if (value === "dark" || value === "light") return value;
  return null;
}

export function readThemePreference(storage?: Pick<Storage, "getItem"> | null): AppTheme | null {
  if (!storage) return null;
  return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
}

export function writeThemePreference(theme: AppTheme, storage?: Pick<Storage, "setItem"> | null): void {
  if (!storage) return;
  storage.setItem(THEME_STORAGE_KEY, theme);
}

export function resolveInitialTheme(storedTheme: AppTheme | null, fallback: AppTheme = "dark"): AppTheme {
  return storedTheme ?? fallback;
}

export function nextTheme(theme: AppTheme): AppTheme {
  return theme === "dark" ? "light" : "dark";
}
