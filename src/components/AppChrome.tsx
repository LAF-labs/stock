"use client";

import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "sia-stock-score:theme";
const THEME_OPTIONS = ["system", "light", "dark"] as const;
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export type ThemeMode = (typeof THEME_OPTIONS)[number];

function safeThemeFromStorage(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function resolvedThemeKey(theme: ThemeMode): string {
  if (typeof window === "undefined") return theme;
  if (theme !== "system") return theme;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "system-dark" : "system-light";
}

export function useThemePreference() {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [themeKey, setThemeKey] = useState("system");

  useEffect(() => {
    const storedTheme = safeThemeFromStorage();
    setTheme(storedTheme);
    applyTheme(storedTheme);
    setThemeKey(resolvedThemeKey(storedTheme));
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setThemeKey(resolvedThemeKey(theme));
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference is best effort.
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || theme !== "system") return;
    const media = window.matchMedia(DARK_SCHEME_QUERY);
    const syncSystemTheme = () => setThemeKey(resolvedThemeKey("system"));
    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [theme]);

  return { theme, setTheme, themeKey };
}

export function AppTopbar({
  active,
  theme,
  onThemeChange,
}: {
  active: "analysis" | "compare";
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copyCurrentUrl() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopyState("copied");
    } catch {
      setCopyState("idle");
    }
  }

  return (
    <div className="app-topbar">
      <a className="app-brand" href="/" aria-label="SIA Stock Score 홈">
        <strong>SIA</strong>
        <span>Stock Score</span>
      </a>
      <nav className="app-nav" aria-label="주요 화면">
        <a href="/" aria-current={active === "analysis" ? "page" : undefined}>
          분석
        </a>
        <a href="/compare" aria-current={active === "compare" ? "page" : undefined}>
          비교
        </a>
      </nav>
      <button type="button" className={`share-link-button ${copyState === "copied" ? "copied" : ""}`} onClick={copyCurrentUrl}>
        {copyState === "copied" ? "복사됨" : "링크 복사"}
      </button>
      <ThemeToggle value={theme} onChange={onThemeChange} />
    </div>
  );
}

export function AppDisclaimerFooter() {
  return <footer className="app-disclaimer-footer">점수는 투자 추천이 아니라 비교를 돕는 분석 기준입니다.</footer>;
}

function ThemeToggle({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }) {
  const labels: Record<ThemeMode, string> = {
    system: "자동",
    light: "밝게",
    dark: "어둡게",
  };

  return (
    <div className="theme-toggle" role="group" aria-label="화면 테마">
      {THEME_OPTIONS.map((option) => (
        <button key={option} type="button" className={value === option ? "active" : undefined} aria-pressed={value === option} onClick={() => onChange(option)}>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
