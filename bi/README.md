# Power BI Analytics Layer

Power BI is optional in this project. It is intended for historical analytics and reporting, while the Next.js dashboard remains the real-time interactive dashboard.

## Recommended Flow

```text
TimescaleDB/PostgreSQL
      |
      v
SQL Views in db/analytics_views.sql
      |
      v
Power BI Desktop / Power BI Service
```

## Suggested Power BI Pages

- Market overview: bullish, bearish, and sideways counts
- Stock trend report: price, SMA, volatility, and volume over time
- Daily summary: high, low, average price, and record count
- Model evaluation: accuracy, precision, recall, F1-score, and confusion matrix after the trend classifier is added

## Views To Import

- `vw_latest_stock_trends`
- `vw_daily_stock_summary`
- `vw_trend_distribution`

## Notes

Power BI should not replace the Next.js dashboard because watchlist search, live refresh, add/delete interactions, and API-based trend updates are better handled in the web application.

