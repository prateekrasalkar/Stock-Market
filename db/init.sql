CREATE TABLE IF NOT EXISTS stock_ticks (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(16) NOT NULL,
  event_time TIMESTAMP NOT NULL,
  price NUMERIC(12, 4) NOT NULL,
  volume BIGINT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'live_api'
);

CREATE TABLE IF NOT EXISTS stock_indicators (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(16) NOT NULL,
  event_time TIMESTAMP NOT NULL,
  price NUMERIC(12, 4) NOT NULL,
  volume BIGINT NOT NULL,
  sma_5 NUMERIC(12, 4),
  sma_10 NUMERIC(12, 4),
  volatility NUMERIC(12, 6),
  pct_change NUMERIC(12, 6),
  trend VARCHAR(16) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'database_sample',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stock_indicators
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'database_sample';

CREATE INDEX IF NOT EXISTS idx_stock_indicators_symbol_time
  ON stock_indicators(symbol, event_time DESC);
