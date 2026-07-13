// Durable D1-backed rate limiting for paid AI routes.

const SCHEMA = `CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
)`;

/**
 * Atomically increment a fixed-window bucket shared by every Worker isolate.
 * @param {object} db Cloudflare D1 binding
 * @param {string} bucket stable route + user key
 * @param {number} limit maximum requests in the window
 * @param {number} [now]
 * @returns {Promise<boolean>} true when the incremented count exceeds limit
 */
export async function durableRateLimited(db, bucket, limit, now = Date.now()) {
  if (!db || typeof db.prepare !== 'function') throw new Error('rate_limit_db_unavailable');
  await db.prepare(SCHEMA).run();
  const cutoff = now - 60_000;
  const row = await db.prepare(`INSERT INTO ai_rate_limits (bucket, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket) DO UPDATE SET
      count = CASE WHEN ai_rate_limits.window_start <= ? THEN 1 ELSE ai_rate_limits.count + 1 END,
      window_start = CASE WHEN ai_rate_limits.window_start <= ? THEN excluded.window_start ELSE ai_rate_limits.window_start END
    RETURNING count`)
    .bind(bucket, now, cutoff, cutoff)
    .first();
  if (!row || !Number.isFinite(Number(row.count))) throw new Error('rate_limit_update_failed');
  return Number(row.count) > limit;
}
