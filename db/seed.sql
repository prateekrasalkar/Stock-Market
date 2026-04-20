INSERT INTO stock_indicators (
  symbol,
  event_time,
  price,
  volume,
  sma_5,
  sma_10,
  volatility,
  pct_change,
  trend
)
VALUES
  ('RELIANCE', NOW() - INTERVAL '9 minutes', 2948.20, 182340, 2948.20, 2948.20, 0.000000, 0.120000, 'sideways'),
  ('RELIANCE', NOW() - INTERVAL '6 minutes', 2953.80, 194120, 2951.00, 2951.00, 3.959798, 0.189944, 'bullish'),
  ('RELIANCE', NOW() - INTERVAL '3 minutes', 2961.40, 210880, 2954.47, 2954.47, 5.406169, 0.257292, 'bullish'),
  ('RELIANCE', NOW(), 2968.10, 225450, 2957.88, 2957.88, 7.457547, 0.226241, 'bullish'),

  ('TCS', NOW() - INTERVAL '9 minutes', 4021.50, 98420, 4021.50, 4021.50, 0.000000, -0.080000, 'sideways'),
  ('TCS', NOW() - INTERVAL '6 minutes', 4012.80, 102730, 4017.15, 4017.15, 6.151829, -0.216336, 'bearish'),
  ('TCS', NOW() - INTERVAL '3 minutes', 4006.40, 109850, 4013.57, 4013.57, 7.685917, -0.159497, 'bearish'),
  ('TCS', NOW(), 3998.90, 118990, 4009.90, 4009.90, 8.914454, -0.187205, 'bearish'),

  ('INFY', NOW() - INTERVAL '9 minutes', 1518.40, 143500, 1518.40, 1518.40, 0.000000, 0.050000, 'sideways'),
  ('INFY', NOW() - INTERVAL '6 minutes', 1524.10, 148920, 1521.25, 1521.25, 4.030509, 0.375312, 'bullish'),
  ('INFY', NOW() - INTERVAL '3 minutes', 1529.60, 156430, 1524.03, 1524.03, 5.389187, 0.360869, 'bullish'),
  ('INFY', NOW(), 1532.20, 161280, 1526.08, 1526.08, 5.458365, 0.169978, 'bullish'),

  ('HDFCBANK', NOW() - INTERVAL '9 minutes', 1682.30, 121600, 1682.30, 1682.30, 0.000000, -0.020000, 'sideways'),
  ('HDFCBANK', NOW() - INTERVAL '6 minutes', 1684.20, 125470, 1683.25, 1683.25, 1.343503, 0.112940, 'bullish'),
  ('HDFCBANK', NOW() - INTERVAL '3 minutes', 1681.10, 132080, 1682.53, 1682.53, 1.276715, -0.184064, 'sideways'),
  ('HDFCBANK', NOW(), 1678.60, 139340, 1681.55, 1681.55, 2.055480, -0.148713, 'bearish');
