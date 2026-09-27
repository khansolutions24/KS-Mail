// Applies theme, density, font size and accent colour from the settings to the document.

import type { Settings } from '@shared/types';
import { setNativeTheme } from '../api/client';

function mix(hex: string, with_: string, amount: number): string {
  const p = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(with_)];
  return '#' + a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount).toString(16).padStart(2, '0')).join('');
}

export function isDark(s: Settings | null): boolean {
  const t = s?.theme ?? 'system';
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function applyTheme(s: Settings | null): void {
  const root = document.documentElement;
  const dark = isDark(s);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = s?.density ?? 'comfortable';
  root.style.setProperty('--fs', `${s?.fontSize ?? 14}px`);
  root.style.setProperty('--fs-s', `${(s?.fontSize ?? 14) - 2}px`);
  root.style.setProperty('--fs-xs', `${(s?.fontSize ?? 14) - 3}px`);
  const accent = /^#[0-9a-f]{6}$/i.test(s?.accentColor ?? '') ? s!.accentColor : '#0f6cbd';
  root.style.setProperty('--accent', dark ? mix(accent, '#ffffff', 0.25) : accent);
  root.style.setProperty('--accent-hover', dark ? mix(accent, '#ffffff', 0.35) : mix(accent, '#000000', 0.12));
  root.style.setProperty('--accent-pressed', mix(accent, '#000000', 0.35));
  root.style.setProperty('--accent-soft', dark ? mix(accent, '#1f1f1f', 0.78) : mix(accent, '#ffffff', 0.9));
  root.style.setProperty('--accent-soft-2', dark ? mix(accent, '#1f1f1f', 0.62) : mix(accent, '#ffffff', 0.78));
  root.style.setProperty('--accent-text', dark ? '#000000' : '#ffffff');
  setNativeTheme(dark);
}
