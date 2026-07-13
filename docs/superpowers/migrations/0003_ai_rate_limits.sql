-- Durable, cross-isolate fixed-window limits for paid AI routes.
CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
