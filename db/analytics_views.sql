CREATE OR REPLACE VIEW vw_latest_stock_trends AS
SELECT DISTINCT ON (symbol)
  symbol,
  event_time,
  price,
  volume,
  sma_5,
  sma_10,
  volatility,
  pct_change,
  trend,
  source,
  created_at
FROM stock_indicators
ORDER BY symbol, created_at DESC, event_time DESC;

CREATE OR REPLACE VIEW vw_daily_stock_summary AS
SELECT
  DATE(event_time) AS trading_day,
  symbol,
  MIN(price) AS low_price,
  MAX(price) AS high_price,
  AVG(price) AS avg_price,
  AVG(volume) AS avg_volume,
  AVG(volatility) AS avg_volatility,
  AVG(pct_change) AS avg_pct_change,
  COUNT(*) AS records_count
FROM stock_indicators
GROUP BY DATE(event_time), symbol;

CREATE OR REPLACE VIEW vw_trend_distribution AS
SELECT
  symbol,
  trend,
  COUNT(*) AS trend_count
FROM stock_indicators
GROUP BY symbol, trend;

