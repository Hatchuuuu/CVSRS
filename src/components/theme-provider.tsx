"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** `nonce` (from the proxy's per-request CSP) lets the pre-paint theme script run under the production policy. */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

const useMounted = () => React.useSyncExternalStore(() => () => { }, () => true, () => false);

/** Light or Dark theme choices. */
export function ThemeChoice({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const name = React.useId();
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-sm font-bold text-ink">Colour theme</legend>
      <div className="grid gap-1">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2.5 text-sm font-semibold text-ink hover:bg-sunken has-[:checked]:bg-primary-soft has-[:checked]:text-primary-strong">
            <input
              type="radio"
              name={name}
              value={value}
              checked={mounted ? (resolvedTheme ?? "light") === value : false}
              disabled={!mounted}
              onChange={() => setTheme(value)}
              className="size-4"
            />
            <Icon aria-hidden className="size-4 shrink-0" />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Header control: direct 1-click toggle between light and dark theme. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <div aria-hidden className="size-11 rounded-control border border-line bg-surface/50" />;
  }

  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const nextTheme = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
      className="inline-flex size-11 items-center justify-center rounded-control border border-line bg-surface text-ink hover:border-line-strong hover:bg-sunken transition-colors"
    >
      {isDark ? (
        <Sun aria-hidden className="size-5 text-attention" />
      ) : (
        <Moon aria-hidden className="size-5 text-primary" />
      )}
    </button>
  );
}
