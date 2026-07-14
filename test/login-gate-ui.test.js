import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../docs/css/app.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../docs/css/tokens.css', import.meta.url), 'utf8');
const loginMarkup = html.slice(html.indexOf('<!-- ─────────────────────────────── Login gate -->'), html.indexOf('<!-- ─────────────────────────────── Main content -->'));
const loginCss = css.slice(css.indexOf('Login gate'));

test('login gate presents the private shared-home identity with clear hierarchy', () => {
  assert.match(loginMarkup, /class="login-gate-eyebrow"[^>]*>Our kitchen</);
  assert.match(loginMarkup, /<h1>Our Cookbook<\/h1>/);
  assert.match(loginMarkup, /class="login-gate-copy"[^>]*>A private place for the meals we share\.<\/p>/);
  assert.match(loginMarkup, /class="login-gate-privacy"/);
  assert.match(loginMarkup, /Private to our household/);
  assert.match(loginMarkup, /class="login-error" role="status" aria-live="polite"/);
  assert.doesNotMatch(loginMarkup, /class="login-error"[^>]*style=/);
});

test('login gate uses the current design tokens and a deliberate elevated card', () => {
  assert.doesNotMatch(loginCss, /--color-surface|--color-ink(?:-light)?|--space-(?:lg|md|sm)|--text-base/);
  assert.match(loginCss, /\.login-gate\s*\{[^}]*background:[^;]*var\(--color-bg\)/s);
  assert.match(loginCss, /\.login-gate\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(loginCss, /\.login-gate-card\s*\{[^}]*background:[^;]*var\(--color-bg-elevated\)/s);
  assert.match(loginCss, /\.login-gate-card\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(loginCss, /\.login-gate-card\s*\{[^}]*max-width:\s*27\.5rem/s);
  assert.match(loginCss, /\.login-gate-card\s*\{[^}]*border:[^;]*var\(--color-border/s);
  assert.match(loginCss, /\.login-gate-card\s*\{[^}]*box-shadow:\s*var\(--shadow-lg\)/s);
  assert.match(loginCss, /\.login-gate-icon\s*\{[^}]*width:\s*4rem[^}]*height:\s*4rem/s);
  assert.match(loginCss, /#login-gate-btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(loginCss, /@media\s*\(max-width:\s*480px\)[\s\S]*\.login-gate-card/);
});

test('showing the login gate clears stale toasts', () => {
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  const showGate = app.slice(app.indexOf('function showLoginGate()'), app.indexOf('// ════════════════════════════════════════════════════════', app.indexOf('function showLoginGate()')));
  assert.match(showGate, /\$\('toast'\)\?\.classList\.remove\('show'\)/);
});

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('danger text meets WCAG AA contrast on every themed elevated surface', () => {
  const themeBlocks = [...tokensCss.matchAll(/:root(?:\[data-theme="([^"]+)"\])?\s*\{([^}]+)\}/g)];
  assert.ok(themeBlocks.length >= 6, 'expected default, automatic dark, and manual theme token blocks');

  for (const [index, match] of themeBlocks.entries()) {
    const danger = match[2].match(/--color-danger:\s*(#[0-9a-f]{6})/i)?.[1];
    const elevated = match[2].match(/--color-bg-elevated:\s*(#[0-9a-f]{6})/i)?.[1];
    if (!danger || !elevated) continue;
    const ratio = contrastRatio(danger, elevated);
    const name = match[1] || `default-${index + 1}`;
    assert.ok(ratio >= 4.5, `${name} danger contrast is ${ratio.toFixed(2)}:1`);
  }
});
