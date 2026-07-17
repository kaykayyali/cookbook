import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pantryRecordFingerprint } from '../docs/js/lib/pantry.js';
import { mutateWorkspace, readWorkspace } from '../functions/_lib/workspace.js';

class D1Statement {
  constructor(owner, sql) { this.owner = owner; this.sql = sql; this.values = []; }
  bind(...values) { const statement = new D1Statement(this.owner, this.sql); statement.values = values; return statement; }
  async first() {
    const row = this.owner.sqlite.prepare(this.sql).get(...this.values);
    if (/SELECT \* FROM household_workspace WHERE/.test(this.sql)) await this.owner.waitAtReadBarrier();
    return row || null;
  }
  async all() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class SqliteD1 {
  constructor(sqlite) { this.sqlite = sqlite; this.barrier = null; this.batchChain = Promise.resolve(); }
  prepare(sql) { return new D1Statement(this, sql); }
  async batch(statements) {
    const execute = async () => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    };
    const result = this.batchChain.then(execute, execute);
    this.batchChain = result.then(() => undefined, () => undefined);
    return result;
  }
  armReadBarrier(expected = 2) {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    this.barrier = { expected, arrived: 0, promise, release };
  }
  async waitAtReadBarrier() {
    if (!this.barrier) return;
    const barrier = this.barrier;
    barrier.arrived += 1;
    if (barrier.arrived === barrier.expected) barrier.release();
    await barrier.promise;
    if (this.barrier === barrier && barrier.arrived >= barrier.expected) this.barrier = null;
  }
}

const item = {
  id: 'stable-oil', raw: '2 cups Olive Oil', rawEvidence: ['olive oil', '2 cups Olive Oil'],
  name: 'olive oil', displayName: 'Olive Oil', quantity: 16, unit: 'ounce', kind: 'divisible',
  countLabel: '', category: 'pantry', confidence: 1, amountSource: 'manual', updatedAt: 10,
};

const mutation = (mutationId, baseRevision, op, payload) => ({ mutationId, baseRevision, op, payload });

test('real SQLite CAS makes restore expected-absent and remove expected-version atomic and idempotent', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { t.skip('node:sqlite unavailable'); return; }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE households (id TEXT PRIMARY KEY); INSERT INTO households VALUES ('our-home');");
  const db = new SqliteD1(sqlite);
  await readWorkspace(db, 'our-home');

  db.armReadBarrier(2);
  const restorePayload = { item, expectedAbsent: true };
  const [restoreA, restoreB] = await Promise.all([
    mutateWorkspace(db, 'our-home', mutation('restore-a', 0, 'pantry.restore', restorePayload)),
    mutateWorkspace(db, 'our-home', mutation('restore-b', 0, 'pantry.restore', restorePayload)),
  ]);
  assert.deepEqual([restoreA.status, restoreB.status].sort(), [200, 409]);
  let authority = await readWorkspace(db, 'our-home');
  assert.deepEqual(authority.pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'stable-oil', quantity: 16 }]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_workspace_mutations').get().count, 1);

  const winnerId = restoreA.status === 200 ? 'restore-a' : 'restore-b';
  const loserId = winnerId === 'restore-a' ? 'restore-b' : 'restore-a';
  const duplicate = await mutateWorkspace(db, 'our-home', mutation(winnerId, 0, 'pantry.restore', restorePayload));
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.workspace.revision, 1);
  const staleDistinctRestore = await mutateWorkspace(db, 'our-home', mutation(loserId, 1, 'pantry.restore', restorePayload));
  assert.deepEqual({ status: staleDistinctRestore.status, error: staleDistinctRestore.error },
    { status: 409, error: 'pantry_restore_conflict' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM household_workspace_mutations').get().count, 1);

  const stored = authority.pantry[0];
  const updated = { ...stored, raw: '3 cups Olive Oil', rawEvidence: [...stored.rawEvidence, '3 cups Olive Oil'], quantity: 24, updatedAt: 20 };
  db.armReadBarrier(2);
  const [remoteUpdate, staleRemove] = await Promise.all([
    mutateWorkspace(db, 'our-home', mutation('remote-update', 1, 'pantry.update', { id: stored.id, item: updated })),
    mutateWorkspace(db, 'our-home', mutation('stale-remove', 1, 'pantry.remove', {
      id: stored.id, expectedFingerprint: pantryRecordFingerprint(stored),
    })),
  ]);
  assert.equal(remoteUpdate.status, 200);
  assert.equal(staleRemove.status, 409);
  authority = await readWorkspace(db, 'our-home');
  assert.deepEqual(authority.pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'stable-oil', quantity: 24 }]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_workspace_mutations WHERE mutation_id = 'stale-remove'").get().count, 0);

  const freshRetry = await mutateWorkspace(db, 'our-home', mutation('stale-remove', authority.revision, 'pantry.remove', {
    id: stored.id, expectedFingerprint: pantryRecordFingerprint(stored),
  }));
  assert.deepEqual({ status: freshRetry.status, error: freshRetry.error },
    { status: 409, error: 'pantry_record_conflict' });
  assert.deepEqual((await readWorkspace(db, 'our-home')).pantry.map(({ quantity }) => quantity), [24]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_workspace_mutations WHERE mutation_id = 'stale-remove'").get().count, 0);
  sqlite.close();
});
