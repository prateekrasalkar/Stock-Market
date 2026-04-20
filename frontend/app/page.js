"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const STOCK_UNIVERSE = [
  { symbol: "HDFCBANK", name: "HDFC Bank" },
  { symbol: "RELIANCE", name: "Reliance Industries" },
  { symbol: "TCS", name: "Tata Consultancy Services" },
  { symbol: "INFY", name: "Infosys" },
  { symbol: "NIFTY", name: "Nifty 50 Index" },
  { symbol: "SBIN", name: "State Bank of India" },
  { symbol: "ICICIBANK", name: "ICICI Bank" },
  { symbol: "AXISBANK", name: "Axis Bank" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank" },
  { symbol: "LT", name: "Larsen and Toubro" },
  { symbol: "ITC", name: "ITC" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel" },
  { symbol: "MARUTI", name: "Maruti Suzuki" },
  { symbol: "TMCV", name: "Tata Motors Limited" },
  { symbol: "TMPV", name: "Tata Motors Passenger Vehicles" },
  { symbol: "SUNPHARMA", name: "Sun Pharma" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance" },
  { symbol: "ASIANPAINT", name: "Asian Paints" },
  { symbol: "WIPRO", name: "Wipro" },
  { symbol: "HCLTECH", name: "HCL Technologies" },
  { symbol: "ADANIENT", name: "Adani Enterprises" },
  { symbol: "ADANIPORTS", name: "Adani Ports" },
  { symbol: "POWERGRID", name: "Power Grid" },
  { symbol: "NTPC", name: "NTPC" },
  { symbol: "ONGC", name: "ONGC" },
  { symbol: "COALINDIA", name: "Coal India" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement" },
  { symbol: "TITAN", name: "Titan" },
  { symbol: "TECHM", name: "Tech Mahindra" },
  { symbol: "M&M", name: "Mahindra and Mahindra" }
];

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return Number(value).toFixed(2);
}

function formatCurrency(value) {
  return `Rs. ${formatNumber(value)}`;
}

function formatSource(stock) {
  if (stock.source === "moneycontrol_live") {
    return "Moneycontrol live";
  }

  if (stock.source === "groww_live") {
    return "Groww live";
  }

  if (stock.source === "yahoo_live") {
    return "Yahoo live";
  }

  return "Database";
}

function formatIndicator(value) {
  if (value === null || value === undefined) {
    return "Collecting";
  }

  return formatNumber(value);
}

function formatTrendStrength(stock) {
  return stock.analytics?.trend_strength?.score
    ? `${formatNumber(stock.analytics.trend_strength.score)} / 100`
    : "N/A";
}

function formatVolatilityRegime(stock) {
  const regime = stock.analytics?.volatility_regime;
  if (!regime) return "N/A";
  return regime.replace("_", " ");
}

function getAlertToneClass(tone) {
  if (tone === "positive") return "positive";
  if (tone === "negative") return "negative";
  if (tone === "warning") return "warning";
  return "neutral";
}

export default function HomePage() {
  const [selectedSymbols, setSelectedSymbols] = useState([]);
  const [query, setQuery] = useState("");
  const [data, setData] = useState({ overview: [], history: [], predictions: {} });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedWatchlist, setHasLoadedWatchlist] = useState(false);
  const [remoteResults, setRemoteResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("stock-watchlist");
    if (stored) {
      try {
        setSelectedSymbols(JSON.parse(stored));
      } catch (_error) {
        setSelectedSymbols([]);
      }
    }
    setHasLoadedWatchlist(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedWatchlist) {
      return;
    }

    window.localStorage.setItem("stock-watchlist", JSON.stringify(selectedSymbols));
  }, [hasLoadedWatchlist, selectedSymbols]);

  useEffect(() => {
    async function loadDashboard() {
      if (selectedSymbols.length === 0) {
        setData({ overview: [], history: [], predictions: {} });
        return;
      }

      try {
        setError("");
        setIsLoading(true);
        const symbols = selectedSymbols.join(",");
        const response = await fetch(
          `${apiBase}/dashboard?symbols=${encodeURIComponent(symbols)}&t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error("Failed to fetch dashboard data");
        }
        const payload = await response.json();
        setData(payload);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboard();
    const timer = setInterval(loadDashboard, 15000);
    return () => clearInterval(timer);
  }, [selectedSymbols]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setRemoteResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const response = await fetch(
          `${apiBase}/search?q=${encodeURIComponent(normalized)}&t=${Date.now()}`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error("Search failed");
        }
        const payload = await response.json();
        setRemoteResults(payload.results || []);
      } catch (err) {
        if (err.name !== "AbortError") {
          setRemoteResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    const matches = STOCK_UNIVERSE.filter((stock) => {
      if (!normalized) {
        return true;
      }

      return (
        stock.symbol.includes(normalized) ||
        stock.name.toUpperCase().includes(normalized)
      );
    });

    const combined = [...matches, ...remoteResults]
      .filter((stock, index, all) => {
        return all.findIndex((item) => item.symbol === stock.symbol) === index;
      });

    if (
      normalized &&
      !combined.some((stock) => stock.symbol === normalized) &&
      /^[A-Z0-9&.-]+$/.test(normalized)
    ) {
      return [{ symbol: normalized, name: "Try as custom NSE symbol" }, ...combined].slice(0, 10);
    }

    return combined.slice(0, 10);
  }, [query, remoteResults]);

  const chartData = [...data.history]
    .reverse()
    .map((point) => ({
      time: new Date(point.event_time).toLocaleTimeString(),
      symbol: point.symbol,
      price: Number(point.price),
      sma5: Number(point.sma_5 || 0),
      sma10: Number(point.sma_10 || 0)
    }));
  const overviewBySymbol = Object.fromEntries(
    data.overview.map((stock) => [stock.symbol, stock])
  );

  function addSymbol(symbol) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || selectedSymbols.includes(normalized)) {
      return;
    }

    setSelectedSymbols((current) => [...current, normalized]);
    setQuery("");
  }

  function removeSymbol(symbol) {
    setSelectedSymbols((current) => current.filter((item) => item !== symbol));
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Real-Time Stock Analytics</p>
          <h1>Track trend strength, alerts, and live market shifts</h1>
          <p className="lead">
            Search any supported stock, add it to your watchlist, and monitor live pricing
            with analytics our system computes: rankings, volatility regimes, breakouts, and alerts.
          </p>
        </div>
        <div className="hero-stat-grid">
          <div className="hero-stat">
            <span>{selectedSymbols.length}</span>
            <p>Tracked stocks</p>
          </div>
          <div className="hero-stat">
            <span>{data.marketSummary?.active_alerts || 0}</span>
            <p>Active alerts</p>
          </div>
        </div>
      </section>

      <section className="search-panel">
        <div className="search-header">
          <div>
            <p className="eyebrow">Add Stocks</p>
            <h2>Search NSE symbols</h2>
          </div>
          <p>{isLoading ? "Refreshing live prices..." : "Auto-refreshes every 15 seconds"}</p>
        </div>

        <div className="search-box">
          <input
            aria-label="Search stocks"
            placeholder="Search HDFCBANK, RELIANCE, TCS, NIFTY..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim() ? (
            <button className="ghost-button" type="button" onClick={() => setQuery("")}>
              Clear
            </button>
          ) : null}
        </div>

        <div className="result-grid">
          {isSearching ? <p className="search-status">Searching live symbol directory...</p> : null}
          {searchResults.map((stock) => {
            const isSelected = selectedSymbols.includes(stock.symbol);
            return (
              <div className="result-row" key={stock.symbol}>
                <div>
                  <strong>{stock.symbol}</strong>
                  <span>
                    {stock.name}
                    {stock.yahoo_symbol ? ` | ${stock.yahoo_symbol}` : ""}
                  </span>
                </div>
                <button
                  className="add-button"
                  disabled={isSelected}
                  type="button"
                  onClick={() => addSymbol(stock.symbol)}
                >
                  {isSelected ? "Added" : "+ Add"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {selectedSymbols.length > 0 ? (
        <section className="summary-grid">
          <article className="summary-card">
            <p className="summary-label">Market Breadth</p>
            <h3>
              {data.marketSummary?.bullish_count || 0} bullish / {data.marketSummary?.bearish_count || 0} bearish
            </h3>
            <span>{data.marketSummary?.sideways_count || 0} sideways</span>
          </article>
          <article className="summary-card">
            <p className="summary-label">Average Move</p>
            <h3>{formatNumber(data.marketSummary?.average_pct_change)}%</h3>
            <span>Across selected watchlist</span>
          </article>
          <article className="summary-card">
            <p className="summary-label">Strongest Stock</p>
            <h3>{data.marketSummary?.strongest_stock?.symbol || "N/A"}</h3>
            <span>
              Score {formatNumber(data.marketSummary?.strongest_stock?.trend_strength || 0)}
            </span>
          </article>
          <article className="summary-card">
            <p className="summary-label">Most Volatile</p>
            <h3>{data.marketSummary?.most_volatile_stock?.symbol || "N/A"}</h3>
            <span>
              Volatility {formatNumber(data.marketSummary?.most_volatile_stock?.volatility || 0)}
            </span>
          </article>
        </section>
      ) : null}

      {selectedSymbols.length > 0 && data.alerts?.length > 0 ? (
        <section className="alerts-panel">
          <div className="panel-header">
            <h2>Analytics Alerts</h2>
            <p>Signals generated from breakout, volatility, and volume analytics.</p>
          </div>
          <div className="alerts-grid">
            {data.alerts.map((alert, index) => (
              <article className={`alert-card ${getAlertToneClass(alert.tone)}`} key={`${alert.symbol}-${index}`}>
                <p className="alert-symbol">{alert.symbol}</p>
                <h3>{alert.title}</h3>
                <p>{alert.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selectedSymbols.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">No Stocks Selected</p>
          <h2>Your dashboard is empty</h2>
          <p>Use the search bar above and click + Add to start tracking live market data.</p>
        </section>
      ) : null}

      <section className="card-grid">
        {selectedSymbols.map((symbol) => {
          const stock = overviewBySymbol[symbol];
          if (!stock) {
            return (
              <article className="stock-card unavailable" key={symbol}>
                <div className="stock-header">
                  <div>
                    <h2>{symbol}</h2>
                    <p className="source-label">No live data found</p>
                  </div>
                  <button
                    aria-label={`Remove ${symbol}`}
                    className="delete-button"
                    type="button"
                    onClick={() => removeSymbol(symbol)}
                  >
                    Delete
                  </button>
                </div>
                <p className="unavailable-copy">
                  Check the NSE symbol spelling, or try another stock from the search list.
                </p>
              </article>
            );
          }

          const prediction = data.predictions?.[stock.symbol];
          return (
            <article className="stock-card" key={stock.symbol}>
              <div className="stock-header">
                <div>
                  <h2>{stock.symbol}</h2>
                  <p className="source-label">{formatSource(stock)}</p>
                </div>
                <div className="card-actions">
                  <span className="rank-pill">#{stock.analytics?.relative_rank || "-"}</span>
                  <span className={`badge ${stock.trend}`}>{stock.trend}</span>
                  <button
                    aria-label={`Remove ${stock.symbol}`}
                    className="delete-button"
                    type="button"
                    onClick={() => removeSymbol(stock.symbol)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="price">{formatCurrency(stock.price)}</p>
              <div className="metric-grid">
                <p>SMA-5 <strong>{formatIndicator(stock.sma_5)}</strong></p>
                <p>SMA-10 <strong>{formatIndicator(stock.sma_10)}</strong></p>
                <p>Volatility <strong>{formatIndicator(stock.volatility)}</strong></p>
                <p>Change <strong>{formatNumber(stock.pct_change)}%</strong></p>
                <p>Trend strength <strong>{formatTrendStrength(stock)}</strong></p>
                <p>Volatility regime <strong>{formatVolatilityRegime(stock)}</strong></p>
              </div>
              <div className="signal-strip">
                <span>{stock.analytics?.breakout?.label || "No breakout"}</span>
                <span>{stock.analytics?.volume_signal?.label || "No volume signal"}</span>
              </div>
              <p className="prediction">
                Prediction{" "}
                <strong>{prediction ? formatCurrency(prediction.predicted_price) : "Pending"}</strong>
              </p>
              {prediction ? (
                <p className="model-note">
                  Model: {prediction.model} | Points: {prediction.training_points}
                </p>
              ) : null}
              {stock.analytics?.reasons?.length ? (
                <div className="reason-list">
                  {stock.analytics.reasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {selectedSymbols.length > 0 ? (
        <section className="ranking-panel">
          <div className="panel-header">
            <h2>Relative Strength Ranking</h2>
            <p>Stocks ranked by trend strength and current momentum.</p>
          </div>
          <div className="ranking-list">
            {(data.ranking || []).map((item) => (
              <article className="ranking-row" key={item.symbol}>
                <div className="ranking-left">
                  <span className="ranking-rank">#{item.rank}</span>
                  <div>
                    <strong>{item.symbol}</strong>
                    <p>{item.breakout}</p>
                  </div>
                </div>
                <div className="ranking-right">
                  <strong>{formatNumber(item.trend_strength)}</strong>
                  <span>{formatNumber(item.pct_change)}%</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="chart-panel">
        <div className="panel-header">
          <h2>Recent Price Movement</h2>
          <p>Chart updates for the stocks currently selected in your watchlist.</p>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d7dfd9" />
              <XAxis dataKey="time" stroke="#334155" minTickGap={24} />
              <YAxis stroke="#334155" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="price" stroke="#0f766e" dot={false} />
              <Line type="monotone" dataKey="sma5" stroke="#1d4ed8" dot={false} />
              <Line type="monotone" dataKey="sma10" stroke="#ea580c" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}
