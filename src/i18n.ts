/**
 * Minimal i18n. Strings are written in Chinese in the source and looked up by
 * that Chinese text; `EN` holds the English rendering. Missing keys fall back
 * to the Chinese text, so a forgotten entry never shows a blank label.
 *
 * Placeholders use `{name}` and are filled from `vars`.
 */
import { EN } from "./i18n-en";

export type LanguagePreference = "auto" | "zh" | "en";
export type Language = "zh" | "en";

let current: Language = "zh";

/** Obsidian keeps its UI language in localStorage ("zh", "zh-TW", "en", …; unset means English). */
export function detectObsidianLanguage(): Language {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem("language");
  } catch {
    stored = null;
  }
  return stored && stored.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function setLanguage(preference: LanguagePreference | undefined): Language {
  current = preference === "zh" || preference === "en" ? preference : detectObsidianLanguage();
  return current;
}

export function language(): Language {
  return current;
}

export function isEnglish(): boolean {
  return current === "en";
}

/** BCP-47 locale for Intl date/number formatting. */
export function dateLocale(): string {
  return current === "en" ? "en-US" : "zh-CN";
}

export function t(zh: string, vars?: Record<string, string | number>): string {
  const template = current === "en" ? EN[zh] ?? zh : zh;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/* ------------------------------------------------------------------ */
/* Note-file labels. Written in the current language, parsed in both.  */
/* ------------------------------------------------------------------ */

export const SOURCE_LABELS = ["来源：", "Source: "] as const;
export const TIME_LABELS = ["时间：", "Time: "] as const;
export const NOTE_SUFFIXES = ["-笔记", "-notes"] as const;

export function sourceLabel(): string {
  return current === "en" ? "Source: " : "来源：";
}

export function timeLabel(): string {
  return current === "en" ? "Time: " : "时间：";
}

export function noteSuffix(): string {
  return current === "en" ? "-notes" : "-笔记";
}
