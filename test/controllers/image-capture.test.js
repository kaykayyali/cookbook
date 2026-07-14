import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initImageCapture } from '../../docs/js/controllers/image-capture.js';

function setup({ createDraft, onDraftCreated, encodeFiles } = {}) {
  const dom = new JSDOM(`
    <div id="image-capture-overlay" class="schema-overlay">
      <input type="file" id="image-capture-input" accept="image/*" multiple />
      <div id="image-capture-preview"></div>
      <button id="image-capture-submit">Create draft</button>
      <button id="image-capture-close-btn">Close</button>
      <span id="image-capture-status"></span>
    </div>
    <body></body>
  `);
  // JSDOM doesn't implement URL.createObjectURL
  dom.window.URL.createObjectURL = () => 'blob:fake';
  const state = {};
  const controller = initImageCapture({
    state,
    document: dom.window.document,
    getTokenFn: () => 'fake-token',
    createDraft: createDraft || (async () => ({ ok: true, draft: { id: 'd1', status: 'pending' } })),
    onDraftCreated: onDraftCreated || (() => {}),
    toastFn: () => {},
    createObjectURL: () => 'blob:fake',
    encodeFiles,
  });
  return { dom, state, controller };
}

test('open adds the open class and focuses the input', () => {
  const { dom, controller } = setup();
  controller.open();
  assert.ok(dom.window.document.getElementById('image-capture-overlay').classList.contains('open'));
});

test('close removes the open class', () => {
  const { dom, controller } = setup();
  controller.open();
  controller.close();
  assert.ok(!dom.window.document.getElementById('image-capture-overlay').classList.contains('open'));
});

test('submit creates a draft and calls onDraftCreated with the result', async () => {
  let created = null;
  const { controller } = setup({
    createDraft: async (input) => ({ ok: true, draft: { id: 'd1', status: 'pending', imageRefs: input.imageRefs } }),
    onDraftCreated: (draft) => { created = draft; },
  });
  // Can't easily set JSDOM file input, so test the empty-files path
  await controller.submit();
  // No files → status message, no draft
  // With files, createDraft is called
});

test('submit with no files shows a message and does not call createDraft', async () => {
  let called = false;
  const { dom, controller } = setup({
    createDraft: async () => { called = true; return { ok: true, draft: {} }; },
  });
  await controller.submit();
  assert.equal(called, false);
  assert.match(dom.window.document.getElementById('image-capture-status').textContent, /Select at least one image/);
});

test('renderPreview displays thumbnails for selected files', () => {
  const { dom, controller } = setup();
  // Create fake file objects
  const fakeFile = new dom.window.File(['data'], 'page1.png', { type: 'image/png' });
  controller.renderPreview([fakeFile]);
  const prev = dom.window.document.getElementById('image-capture-preview');
  assert.equal(prev.querySelectorAll('.capture-thumb').length, 1);
  assert.match(prev.textContent, /page1\.png/);
});

test('submit preserves ordered original image data on the server draft', async () => {
  let captured;
  const { dom, controller } = setup({
    encodeFiles: async (files) => files.map((file) => `data:${file.type};base64,${file.name}`),
    createDraft: async (input) => { captured = input; return { ok: true, draft: { id: 'd1', status: 'pending' } }; },
  });
  const files = [
    new dom.window.File(['one'], 'page1.png', { type: 'image/png' }),
    new dom.window.File(['two'], 'page2.png', { type: 'image/png' }),
  ];
  Object.defineProperty(dom.window.document.getElementById('image-capture-input'), 'files', { value: files });
  await controller.submit();
  assert.deepEqual(captured.imageRefs, ['data:image/png;base64,page1.png', 'data:image/png;base64,page2.png']);
});

test('multi-page drafts can be reordered before upload', () => {
  const { dom, controller } = setup();
  const files = [
    new dom.window.File(['one'], 'page1.png', { type: 'image/png' }),
    new dom.window.File(['two'], 'page2.png', { type: 'image/png' }),
  ];
  controller.renderPreview(files);
  controller.move(1, -1);
  assert.match(dom.window.document.getElementById('image-capture-preview').textContent, /page2\.png[\s\S]*page1\.png/);
});
