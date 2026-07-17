import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
let atomicWriteQueue = Promise.resolve();
const SHELL = [
  './', './index.html', './css/bundle.css', './js/bundle.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

async function atomicReplace(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const transientWindowsLock = ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
      if (!transientWindowsLock || attempt >= 24) throw error;
      await delay(Math.min(2 ** attempt, 50));
    }
  }
}

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
  const destination = join(DOCS, 'sw.js');
  const temporary = join(DOCS, `.sw.js.${process.pid}.${randomUUID()}.tmp`);
  const replace = atomicWriteQueue.then(async () => {
    try {
      await writeFile(temporary, output, { flag: 'wx' });
      await atomicReplace(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  });
  atomicWriteQueue = replace.catch(() => {});
  await replace;
  return buildId;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(await buildServiceWorker());
}
