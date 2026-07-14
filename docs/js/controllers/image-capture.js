// ════════════════════════════════════════════════════════
// controllers/image-capture.js — image capture modal + draft creation
// ════════════════════════════════════════════════════════
import { getToken } from '../lib/auth.js';
import { createImportDraft, fetchImportDrafts, patchImportDraft } from '../lib/api.js';
import { toast } from '../lib/dom.js';
import { esc } from '../lib/format.js';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {function} [deps.getTokenFn]
 * @param {function} [deps.createDraft]
 * @param {function} [deps.listDrafts]
 * @param {function} [deps.patchDraft]
 * @param {function} [deps.toastFn]
 * @param {function} [deps.onDraftCreated]
 */
export function initImageCapture({
  state,
  document = globalThis.document,
  getTokenFn = getToken,
  createDraft = createImportDraft,
  listDrafts = fetchImportDrafts,
  patchDraft = patchImportDraft,
  toastFn = toast,
  onDraftCreated = null,
  createObjectURL = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL.bind(URL) : null,
  encodeFiles = null,
} = {}) {
  let orderedFiles = [];
  const transforms = new WeakMap();
  const overlay = () => document.getElementById('image-capture-overlay');
  const input = () => document.getElementById('image-capture-input');
  const preview = () => document.getElementById('image-capture-preview');
  const status = () => document.getElementById('image-capture-status');
  const submitBtn = () => document.getElementById('image-capture-submit');
  const encode = encodeFiles || (async (files) => Promise.all(files.map((file) => encodeImage(document, file, transforms.get(file)))));

  function open() {
    orderedFiles = [];
    const signedOut = !getTokenFn();
    const el = overlay();
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    const inp = input();
    if (inp) inp.value = '';
    const prev = preview();
    if (prev) prev.innerHTML = '';
    const st = status();
    if (st) st.textContent = signedOut ? 'Sign in to capture from images.' : '';
    if (!signedOut) inp?.focus?.();
  }

  function close() {
    const el = overlay();
    if (el) el.classList.remove('open');
    if (!isAnyOpen(document)) document.body.style.overflow = '';
  }

  function selectedFiles() {
    if (orderedFiles.length) return [...orderedFiles];
    const inp = input();
    if (!inp || !inp.files) return [];
    return Array.from(inp.files).filter((f) => f.type.startsWith('image/'));
  }

  function renderPreview(files) {
    orderedFiles = [...files];
    const prev = preview();
    if (!prev) return;
    prev.innerHTML = files.map((file, i) =>
      `<div class="capture-thumb" data-index="${i}" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
        <span class="drag-handle" aria-hidden="true">⠿</span>
        <img src="${createObjectURL ? createObjectURL(file) : ''}" alt="${esc(file.name)}" style="width:48px;height:48px;object-fit:cover;border-radius:6px" />
        <span style="font-size:.85rem">${esc(file.name)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-move="-1" aria-label="Move ${esc(file.name)} earlier">↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-move="1" aria-label="Move ${esc(file.name)} later">↓</button>
        <button type="button" class="btn btn-ghost btn-sm" data-transform="rotate" aria-label="Rotate ${esc(file.name)}">Rotate</button>
        <button type="button" class="btn btn-ghost btn-sm" data-transform="crop" aria-pressed="${String(!!transforms.get(file)?.crop)}" aria-label="Crop ${esc(file.name)}">Crop</button>
      </div>`
    ).join('');
  }

  function move(index, delta) {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= orderedFiles.length) return;
    [orderedFiles[index], orderedFiles[target]] = [orderedFiles[target], orderedFiles[index]];
    renderPreview(orderedFiles);
  }

  function transform(index, action) {
    const file = orderedFiles[index];
    if (!file) return;
    const current = transforms.get(file) || { rotation: 0, crop: false };
    transforms.set(file, action === 'rotate'
      ? { ...current, rotation: (current.rotation + 90) % 360 }
      : { ...current, crop: !current.crop });
    renderPreview(orderedFiles);
  }

  function wireInput() {
    const inp = input();
    if (!inp) return;
    inp.addEventListener('change', () => {
      const files = selectedFiles();
      renderPreview(files);
      const st = status();
      if (st) st.textContent = files.length ? `${files.length} image${files.length > 1 ? 's' : ''} ready to draft` : '';
    });
    preview()?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-move]');
      const transformButton = event.target.closest('[data-transform]');
      const row = (button || transformButton)?.closest('[data-index]');
      if (button && row) move(Number(row.dataset.index), Number(button.dataset.move));
      if (transformButton && row) transform(Number(row.dataset.index), transformButton.dataset.transform);
    });
  }

  async function submit() {
    const files = selectedFiles();
    if (!files.length) {
      const st = status();
      if (st) st.textContent = 'Select at least one image';
      return;
    }
    const btn = submitBtn();
    if (btn) btn.disabled = true;
    const st = status();
    if (st) st.textContent = 'Creating draft…';
    try {
      const imageRefs = await encode(files);
      if (JSON.stringify(imageRefs).length > 8_000_000) throw new Error('Images are too large; choose fewer or smaller photos');
      const result = await createDraft({ imageRefs, sourceType: 'image' });
      if (!result.ok) {
        if (st) st.textContent = result.error || 'Could not create draft';
        return;
      }
      state.pendingDraft = result.draft;
      if (onDraftCreated) onDraftCreated(result.draft);
      close();
      toastFn('Draft created — review before publishing');
    } catch (e) {
      if (st) st.textContent = e?.message || 'network error';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireSubmit() {
    const btn = submitBtn();
    if (btn) btn.addEventListener('click', () => submit());
    const closeBtn = document.getElementById('image-capture-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const ov = overlay();
    if (ov) ov.addEventListener('click', (e) => { if (e.target.id === 'image-capture-overlay') close(); });
  }

  wireInput();
  wireSubmit();
  return { open, close, submit, selectedFiles, renderPreview, move, transform };
}

async function encodeImage(document, file, transform = {}) {
  const createBitmap = document.defaultView?.createImageBitmap || globalThis.createImageBitmap;
  if (createBitmap) {
    const bitmap = await createBitmap(file);
    const cropRatio = transform?.crop ? 0.9 : 1;
    const sourceWidth = Math.floor(bitmap.width * cropRatio);
    const sourceHeight = Math.floor(bitmap.height * cropRatio);
    const sourceX = Math.floor((bitmap.width - sourceWidth) / 2);
    const sourceY = Math.floor((bitmap.height - sourceHeight) / 2);
    const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.floor(sourceWidth * scale));
    const height = Math.max(1, Math.floor(sourceHeight * scale));
    const quarterTurn = (transform?.rotation || 0) % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = quarterTurn ? height : width;
    canvas.height = quarterTurn ? width : height;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((transform?.rotation || 0) * Math.PI / 180);
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.84);
  }
  return new Promise((resolve, reject) => {
    const Reader = document.defaultView?.FileReader || globalThis.FileReader;
    if (!Reader) { reject(new Error('image_encoding_unavailable')); return; }
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('image_encoding_failed'));
    reader.readAsDataURL(file);
  });
}

function isAnyOpen(document) {
  return !!document.getElementById('detail-modal')?.classList.contains('open')
    || !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}