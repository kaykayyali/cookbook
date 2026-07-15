import { isWorkspace } from './workspace-sync.js';

export const DB_NAME = 'cookbook-client';
export const DB_VERSION = 2;
const RECORD_VERSION = 2;
export const cacheKeys = {
  membership: (authSub) => `membership:${authSub}`,
  recipes: (authSub, householdId) => `recipes:${authSub}:${householdId}`,
  workspace: (authSub, householdId) => `workspace:${authSub}:${householdId}`,
};

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
});
const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('indexeddb_transaction_failed'));
  transaction.onabort = () => reject(transaction.error || new Error('indexeddb_transaction_aborted'));
});
const validMembership = (value) => typeof value?.household?.id === 'string' && value.household.id
  && typeof value?.member?.id === 'string' && value.member.id;

function cacheRecord(kind, authSub, householdId, value) {
  const key = kind === 'membership' ? cacheKeys.membership(authSub) : cacheKeys[kind](authSub, householdId);
  return { key, schemaVersion: RECORD_VERSION, authSub, householdId, kind, value, cachedAt: Date.now() };
}

function backfillStore(store) {
  const cursor = store.openCursor();
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (!current) return;
    if (current.value?.schemaVersion !== RECORD_VERSION) {
      current.update({ ...current.value, schemaVersion: RECORD_VERSION });
    }
    current.continue();
  };
}

export async function openOfflineDb({ indexedDB = globalThis.indexedDB, name = DB_NAME, onBlocked = () => {} } = {}) {
  if (!indexedDB?.open) throw new Error('indexeddb_unavailable');
  const open = indexedDB.open(name, DB_VERSION);
  open.onblocked = () => onBlocked();
  open.onupgradeneeded = (event) => {
    const db = open.result;
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('outbox')) {
      const outbox = db.createObjectStore('outbox', { keyPath: 'sequence', autoIncrement: true });
      outbox.createIndex('mutationId', 'mutationId', { unique: true });
      outbox.createIndex('scopeOrder', ['authSub', 'householdId', 'status', 'sequence']);
    }
    if (event.oldVersion > 0 && event.oldVersion < 2) {
      backfillStore(open.transaction.objectStore('meta'));
      backfillStore(open.transaction.objectStore('cache'));
      backfillStore(open.transaction.objectStore('outbox'));
    }
  };
  const db = await requestResult(open);
  db.onversionchange = () => db.close();

  const rawGet = async (storeName, key) => {
    const tx = db.transaction(storeName, 'readonly');
    const result = await requestResult(tx.objectStore(storeName).get(key));
    await transactionDone(tx);
    return result;
  };
  const rawPut = async (storeName, value) => {
    const tx = db.transaction(storeName, 'readwrite');
    const key = await requestResult(tx.objectStore(storeName).put(value));
    await transactionDone(tx);
    return key;
  };
  const getValue = async (store, key, validate) => {
    const record = await rawGet(store, key);
    return record && record.schemaVersion === RECORD_VERSION && validate(record.value) ? record.value : null;
  };

  return {
    db,
    close: () => db.close(),
    rawPut,
    async putMembership(authSub, membership) {
      if (!validMembership(membership)) throw new Error('invalid_cached_membership');
      return rawPut('meta', cacheRecord('membership', authSub, membership.household.id, membership));
    },
    getMembership: (authSub) => getValue('meta', cacheKeys.membership(authSub), validMembership),
    async putRecipes(authSub, householdId, recipes) {
      if (!Array.isArray(recipes)) throw new Error('invalid_cached_recipes');
      return rawPut('cache', cacheRecord('recipes', authSub, householdId, recipes));
    },
    getRecipes: (authSub, householdId) => getValue('cache', cacheKeys.recipes(authSub, householdId), Array.isArray),
    async putWorkspace(authSub, householdId, workspace) {
      if (!isWorkspace(workspace) || workspace.householdId !== householdId) throw new Error('invalid_cached_workspace');
      return rawPut('cache', cacheRecord('workspace', authSub, householdId, workspace));
    },
    getWorkspace: (authSub, householdId) => getValue('cache', cacheKeys.workspace(authSub, householdId), isWorkspace),
    async enqueue(mutation) {
      if (!mutation?.mutationId || !mutation?.authSub || !mutation?.householdId || !mutation?.op) {
        throw new Error('invalid_outbox_mutation');
      }
      const record = {
        scope: 'workspace', payload: {}, createdAt: Date.now(),
        status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null,
        ...mutation,
        schemaVersion: RECORD_VERSION,
      };
      const tx = db.transaction('outbox', 'readwrite');
      const sequence = await requestResult(tx.objectStore('outbox').add(record));
      await transactionDone(tx);
      return { ...record, sequence };
    },
    async listOutbox(authSub, householdId, scope = 'workspace') {
      const tx = db.transaction('outbox', 'readonly');
      const rows = await requestResult(tx.objectStore('outbox').getAll());
      await transactionDone(tx);
      return rows.filter((row) => [1, RECORD_VERSION].includes(row.schemaVersion) && row.authSub === authSub
        && row.householdId === householdId && row.scope === scope)
        .sort((a, b) => a.sequence - b.sequence);
    },
    async acknowledge(authSub, householdId, mutationId, workspace) {
      if (!isWorkspace(workspace) || workspace.householdId !== householdId) throw new Error('invalid_cached_workspace');
      const tx = db.transaction(['cache', 'outbox'], 'readwrite');
      const outbox = tx.objectStore('outbox');
      const row = await requestResult(outbox.index('mutationId').get(mutationId));
      if (row && (row.authSub !== authSub || row.householdId !== householdId)) {
        tx.abort();
        throw new Error('outbox_mutation_scope_mismatch');
      }
      tx.objectStore('cache').put(cacheRecord('workspace', authSub, householdId, workspace));
      if (row) outbox.delete(row.sequence);
      await transactionDone(tx);
      return Boolean(row);
    },
    async acknowledgeRecipes(authSub, householdId, mutationId, recipes) {
      if (!Array.isArray(recipes)) throw new Error('invalid_cached_recipes');
      const tx = db.transaction(['cache', 'outbox'], 'readwrite');
      const outbox = tx.objectStore('outbox');
      const row = await requestResult(outbox.index('mutationId').get(mutationId));
      if (row && (row.authSub !== authSub || row.householdId !== householdId || row.scope !== 'recipe')) {
        tx.abort();
        throw new Error('outbox_mutation_scope_mismatch');
      }
      tx.objectStore('cache').put(cacheRecord('recipes', authSub, householdId, recipes));
      if (row) outbox.delete(row.sequence);
      await transactionDone(tx);
      return Boolean(row);
    },
    async updateOutbox(row) {
      if (!Number.isInteger(row?.sequence)) throw new Error('invalid_outbox_row');
      return rawPut('outbox', row);
    },
    async deleteOutbox(sequence) {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').delete(sequence);
      await transactionDone(tx);
    },
  };
}
