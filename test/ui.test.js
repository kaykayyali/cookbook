import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Button, IconButton, Input, Icon } from '../docs/js/lib/ui.js';

test('Button renders a primary button with correct classes', () => {
  const html = Button({ label: 'Save', variant: 'primary' });
  assert.match(html, /<button[^>]*class="[^"]*\bbtn\b[^"]*\bbtn-primary\b/);
  assert.match(html, />Save</);
  assert.match(html, /type="button"/);
});

test('Button variants produce correct class sets', () => {
  assert.match(Button({ label: 'A', variant: 'secondary' }), /\bbtn-secondary\b/);
  assert.match(Button({ label: 'A', variant: 'ghost' }),     /\bbtn-ghost\b/);
});

test('Button sizes produce correct class sets', () => {
  assert.match(Button({ label: 'A', size: 'sm' }), /\bbtn-sm\b/);
  assert.match(Button({ label: 'A', size: 'lg' }), /\bbtn-lg\b/);
});

test('Button is disabled when disabled=true', () => {
  const html = Button({ label: 'A', disabled: true });
  assert.match(html, /\bdisabled\b/);
  assert.match(html, /aria-disabled="true"/);
});

test('IconButton requires aria-label (regression of spec §10 #2)', () => {
  assert.throws(() => IconButton({ icon: 'x' }), /aria-label/);
  const html = IconButton({ icon: 'x', label: 'Delete' });
  assert.match(html, /aria-label="Delete"/);
  assert.match(html, /\bicon-btn\b/);
});

test('Input produces a labeled input with the correct id', () => {
  const html = Input({ id: 'f-name', label: 'Name', value: 'Pie' });
  assert.match(html, /<label[^>]*for="f-name"/);
  assert.match(html, /<input[^>]*id="f-name"/);
  assert.match(html, /value="Pie"/);
});

test('Input marks invalid state with aria-invalid and an error region', () => {
  const html = Input({ id: 'f-x', label: 'X', invalid: true, hint: 'Required' });
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /Required/);
  assert.match(html, /\bform-error\b/);
});

test('Input type=textarea produces a textarea', () => {
  const html = Input({ id: 'f-b', label: 'Body', type: 'textarea' });
  assert.match(html, /<textarea[^>]*id="f-b"/);
});

test('Icon renders an inline svg with the icon class', () => {
  const html = Icon({ name: 'check' });
  assert.match(html, /<svg[^>]*class="[^"]*\bicon\b/);
  assert.match(html, /<\/svg>/);
});
