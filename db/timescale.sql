CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
  'stock_ticks',
  'event_time',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

SELECT create_hypertable(
  'stock_indicators',
  'event_time',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS stock_indicators_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', event_time) AS bucket,
  symbol,
  AVG(price) AS avg_price,
  MAX(price) AS high_price,
  MIN(price) AS low_price,
  AVG(volume) AS avg_volume,
  AVG(volatility) AS avg_volatility,
  AVG(pct_change) AS avg_pct_change
FROM stock_indicators
GROUP BY bucket, symbol
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_stock_indicators_5m_symbol_bucket
  ON stock_indicators_5m(symbol, bucket DESC);
