import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const SHELL = [
  './', './index.html', './css/bundle.css', './js/bundle.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

export async function buildServiceWorker() {
  const hash = createHash('sha256');
  for (const path of SHELL.filter((item) => item !== './')) {
    hash.update(path);
    hash.update(await readFile(join(DOCS, path.slice(2))));
  }
  const buildId = hash.digest('hex').slice(0, 16);
  const template = await readFile(join(HERE, 'service-worker.template.js'), 'utf8');
  const output = template
    .replace('__BUILD_ID__', buildId)
    .replace('__APP_SHELL__', JSON.stringify(SHELL, null, 2));
  await writeFile(join(DOCS, 'sw.js'), output);
  return buildId;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(await buildServiceWorker());
}
