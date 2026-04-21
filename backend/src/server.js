const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const stockApiKey = process.env.GROWW_ACCESS_TOKEN || process.env.STOCK_API_KEY || "";
const stockApiProvider = (process.env.STOCK_API_PROVIDER || "groww").toLowerCase();
const stockExchange = process.env.STOCK_EXCHANGE || "NSE";
const stockSegment = process.env.STOCK_SEGMENT || "CASH";
const liveDataFallback = (process.env.LIVE_DATA_FALLBACK || "yahoo").toLowerCase();
const yahooSymbolSuffix = process.env.YAHOO_SYMBOL_SUFFIX || ".NS";
const moneycontrolAliases = {
  HDFCBANK: "HDF01",
  SBIN: "SBI",
  ITC: "ITC",
  RELIANCE: "RI",
  TCS: "TCS",
  INFY: "IT",
  ICICIBANK: "ICI02",
  AXISBANK: "UTI10",
  KOTAKBANK: "KMB",
  LT: "LT",
  TMCV: "TML02",
  TMPV: "TEL",
  "M&M": "MM",
};
const moneycontrolCache = new Map(Object.entries(moneycontrolAliases));
const yahooSymbolOverrides = Object.fromEntries(
  (process.env.YAHOO_SYMBOL_OVERRIDES || "NIFTY:^NSEI")
    .split(",")
    .map((entry) => entry.split(":").map((part) => part.trim().toUpperCase()))
    .filter(([key, value]) => key && value)
);
const trackedSymbols = (process.env.STOCK_SYMBOLS || "RELIANCE,TCS,INFY,HDFCBANK,NIFTY")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);

app.use(cors());
app.use(express.json());
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/", (_req, res) => {
  res.json({
    name: "Stock Analytics Backend API",
    status: "running",
    routes: [
      "/api/health",
      "/api/search?q=HDFC",
      "/api/dashboard",
      "/api/refresh-live",
      "/api/stocks/RELIANCE",
      "/api/live/RELIANCE",
    ],
  });
});

function parseSymbolsParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

async function getLatestIndicators(limit = 100, symbols = []) {
  const params = [limit];
  const symbolFilter =
    symbols.length > 0
      ? "WHERE symbol = ANY($2)"
      : "";

  if (symbols.length > 0) {
    params.push(symbols);
  }

  const { rows } = await pool.query(
    `
      SELECT symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend, source
      FROM stock_indicators
      ${symbolFilter}
      ORDER BY created_at DESC, event_time DESC
      LIMIT $1
    `,
    params
  );
  return rows;
}

async function getRecentRowsBySymbol(symbol, limit = 20) {
  const { rows } = await pool.query(
    `
      SELECT symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend, source, created_at
      FROM stock_indicators
      WHERE symbol = $1
      ORDER BY created_at DESC, event_time DESC
      LIMIT $2
    `,
    [symbol, limit]
  );

  return rows.reverse();
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length === 0) {
    return null;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function buildIndicators(symbol, currentPrice, currentPctChange, source) {
  const { rows } = await pool.query(
    `
      SELECT price
      FROM stock_indicators
      WHERE symbol = $1 AND source = $2
      ORDER BY event_time DESC
      LIMIT 9
    `,
    [symbol, source]
  );

  const historicalPrices = rows.reverse().map((row) => Number(row.price));
  const prices = [...historicalPrices, Number(currentPrice)];
  const sma5 = average(prices.slice(-5));
  const sma10 = average(prices.slice(-10));
  const volatility = standardDeviation(prices.slice(-10));
  const previousPrice = prices.length > 1 ? prices[prices.length - 2] : null;
  const pctChange = previousPrice
    ? ((Number(currentPrice) - previousPrice) / previousPrice) * 100
    : Number(currentPctChange || 0);
  const trend = getTrendFromChange(pctChange, "sideways");

  return { sma5, sma10, volatility, pctChange, trend };
}

async function saveLiveQuote(quote) {
  const existing = await pool.query(
    `
      SELECT symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend, source
      FROM stock_indicators
      WHERE symbol = $1 AND event_time = $2 AND source = $3
      LIMIT 1
    `,
    [quote.symbol, quote.event_time, quote.source]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const indicators = await buildIndicators(
    quote.symbol,
    quote.price,
    quote.pct_change,
    quote.source
  );
  const { rows } = await pool.query(
    `
      INSERT INTO stock_indicators (
        symbol,
        event_time,
        price,
        volume,
        sma_5,
        sma_10,
        volatility,
        pct_change,
        trend,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend, source
    `,
    [
      quote.symbol,
      quote.event_time,
      quote.price,
      quote.volume || 0,
      indicators.sma5,
      indicators.sma10,
      indicators.volatility,
      indicators.pctChange,
      indicators.trend,
      quote.source,
    ]
  );

  return rows[0];
}

async function refreshLiveData(symbols = trackedSymbols) {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      const quote = await fetchLiveQuote(symbol);
      if (!quote) {
        return { symbol, status: "failed" };
      }

      const row = await saveLiveQuote(quote);
      return { symbol, status: "saved", row };
    })
  );

  return results;
}

function parseMoneycontrolSymbol(item) {
  const display = String(item.pdt_dis_nm || "");
  const spanMatch = display.match(/<span>(.*?)<\/span>/i);
  const parts = spanMatch
    ? spanMatch[1].split(",").map((part) => part.trim().toUpperCase())
    : [];
  const nseSymbol =
    parts.find((part) => /^[A-Z&.-]+$/.test(part)) ||
    parts.find((part) => /^[A-Z][A-Z0-9&.-]*$/.test(part) && !part.startsWith("INE"));

  return nseSymbol || String(item.sc_id || item.name || "").trim().toUpperCase();
}

async function searchMoneycontrolSymbols(query) {
  const normalized = String(query || "").trim();
  if (normalized.length < 2) {
    return [];
  }

  try {
    const queryVariants = [
      normalized,
      normalized.replace(/BANK$/i, " bank"),
      normalized.replace(/([a-z])([A-Z])/g, "$1 $2"),
    ].filter((value, index, all) => value && all.indexOf(value) === index);

    const responses = await Promise.all(
      queryVariants.map(async (variant) => {
        const url = new URL("https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php");
        url.searchParams.set("query", variant);
        url.searchParams.set("type", "1");
        url.searchParams.set("format", "json");

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 StockAnalyticsDashboard/1.0",
          },
        });
        const data = await response.json();
        return Array.isArray(data) ? data : data.value || [];
      })
    );
    const values = responses.flat();

    return values
      .map((item) => {
        const symbol = parseMoneycontrolSymbol(item);
        const scId = String(item.sc_id || "").trim().toUpperCase();
        if (symbol && scId) {
          moneycontrolCache.set(symbol, scId);
        }

        return {
          symbol,
          moneycontrol_sc_id: scId,
          name: item.stock_name || item.name || symbol,
          sector: item.sc_sector || "",
          exchange: "NSE",
          type: "EQUITY",
          source: "moneycontrol",
        };
      })
      .filter((item) => item.symbol && item.moneycontrol_sc_id)
      .filter((item, index, all) => {
        return all.findIndex((candidate) => candidate.symbol === item.symbol) === index;
      })
      .slice(0, 10);
  } catch (_error) {
    return [];
  }
}

async function resolveMoneycontrolInstrument(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (moneycontrolCache.has(normalized)) {
    return { symbol: normalized, scId: moneycontrolCache.get(normalized) };
  }

  const results = await searchMoneycontrolSymbols(normalized);
  const exact = results.find((item) => item.symbol === normalized);
  const selected = exact || results[0];

  if (!selected) {
    return null;
  }

  moneycontrolCache.set(selected.symbol, selected.moneycontrol_sc_id);
  return { symbol: selected.symbol, scId: selected.moneycontrol_sc_id };
}

async function fetchMoneycontrolQuote(symbol, includeError = false) {
  const instrument = await resolveMoneycontrolInstrument(symbol);
  if (!instrument) {
    return includeError
      ? { error: "Moneycontrol could not resolve this stock symbol", symbol }
      : null;
  }

  try {
    const url = `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/${instrument.scId}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 StockAnalyticsDashboard/1.0",
      },
    });
    const payload = await response.json();
    const data = payload.data;

    if (!response.ok || payload.code !== "200" || !data?.pricecurrent) {
      return includeError
        ? {
          error: "Moneycontrol did not return a usable live quote",
          httpStatus: response.status,
          request: { symbol, sc_id: instrument.scId },
          response: payload,
        }
        : null;
    }

    return {
      symbol: String(data.NSEID || instrument.symbol || symbol).toUpperCase(),
      event_time: data.lastupd_epoch
        ? new Date(Number(data.lastupd_epoch) * 1000).toISOString()
        : new Date().toISOString(),
      price: Number(data.pricecurrent),
      volume: Number(data.VOL || 0),
      pct_change: Number(data.pricepercentchange || 0),
      source: "moneycontrol_live",
      live: true,
      raw: {
        moneycontrol_sc_id: instrument.scId,
        company: data.company,
        last_updated: data.lastupd,
        previous_close: data.priceprevclose,
        open: data.OPN,
        high_52w: data["52H"],
        low_52w: data["52L"],
        market_state: data.market_state,
      },
    };
  } catch (error) {
    return includeError
      ? {
        error: "Moneycontrol request failed",
        request: { symbol, sc_id: instrument.scId },
        message: error.message,
      }
      : null;
  }
}

async function fetchGrowwQuote(symbol, includeError = false) {
  if (stockApiProvider !== "groww" || !stockApiKey) {
    return includeError
      ? { error: "Groww provider is not configured or STOCK_API_KEY is missing" }
      : null;
  }

  const url = new URL("https://api.groww.in/v1/live-data/quote");
  url.searchParams.set("exchange", stockExchange);
  url.searchParams.set("segment", stockSegment);
  url.searchParams.set("trading_symbol", symbol);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${stockApiKey}`,
      "X-API-VERSION": "1.0",
    },
  });

  const data = await response.json();
  if (!response.ok || data.status !== "SUCCESS" || !data.payload) {
    return includeError
      ? {
        error: "Groww did not return a successful live quote",
        httpStatus: response.status,
        request: {
          exchange: stockExchange,
          segment: stockSegment,
          trading_symbol: symbol,
        },
        response: data,
      }
      : null;
  }

  const payload = data.payload;
  return {
    symbol,
    event_time: payload.last_trade_time
      ? new Date(payload.last_trade_time).toISOString()
      : new Date().toISOString(),
    price: payload.last_price,
    volume: payload.volume || payload.last_trade_quantity || 0,
    pct_change: payload.day_change_perc,
    source: "groww_live",
    live: true,
    raw: payload,
  };
}

function toYahooSymbol(symbol) {
  if (yahooSymbolOverrides[symbol]) {
    return yahooSymbolOverrides[symbol];
  }

  if (symbol.includes(".")) {
    return symbol;
  }

  return `${symbol}${yahooSymbolSuffix}`;
}

function fromYahooSymbol(yahooSymbol) {
  const normalized = String(yahooSymbol || "").toUpperCase();
  if (normalized === "^NSEI") {
    return "NIFTY";
  }

  if (normalized.endsWith(yahooSymbolSuffix.toUpperCase())) {
    return normalized.slice(0, -yahooSymbolSuffix.length);
  }

  return normalized;
}

async function fetchFirstYahooQuote(symbols) {
  for (const symbol of symbols) {
    const quote = await fetchYahooQuote(symbol);
    if (quote) {
      return quote;
    }
  }

  return null;
}

async function searchYahooSymbols(query) {
  const normalized = String(query || "").trim();
  if (normalized.length < 2 || liveDataFallback !== "yahoo") {
    return [];
  }

  try {
    const exactSymbol = normalized.toUpperCase();
    const directQuote =
      /^[A-Z0-9&.-]+$/.test(exactSymbol)
        ? await fetchFirstYahooQuote(
          exactSymbol.includes(".")
            ? [exactSymbol]
            : [exactSymbol, `${exactSymbol}${yahooSymbolSuffix}`, `${exactSymbol}.BO`]
        )
        : null;
    const queryVariants = [
      normalized,
      `${normalized} NSE`,
      `${normalized} India`,
      /^[A-Za-z0-9&.-]+$/.test(normalized) ? `${normalized}${yahooSymbolSuffix}` : null,
    ].filter(Boolean);

    const responses = await Promise.all(
      queryVariants.map(async (variant) => {
        const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
        url.searchParams.set("q", variant);
        url.searchParams.set("quotesCount", "12");
        url.searchParams.set("newsCount", "0");

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 StockAnalyticsDashboard/1.0",
          },
        });
        const data = await response.json();
        return data.quotes || [];
      })
    );

    const searchedResults = responses
      .flat()
      .filter((quote) => {
        const symbol = String(quote.symbol || "").toUpperCase();
        return (
          quote.quoteType === "EQUITY" &&
          (quote.exchange === "NSI" ||
            quote.exchange === "BSE" ||
            symbol.endsWith(yahooSymbolSuffix.toUpperCase()) ||
            symbol.endsWith(".BO") ||
            symbol === "^NSEI")
        );
      })
      .map((quote) => ({
        symbol: fromYahooSymbol(quote.symbol),
        yahoo_symbol: quote.symbol,
        name: quote.shortname || quote.longname || quote.symbol,
        exchange: quote.exchange || "NSE",
        type: quote.quoteType,
      }))
      .filter((quote, index, all) => {
        return all.findIndex((item) => item.symbol === quote.symbol) === index;
      })
      .slice(0, 8);

    if (directQuote && !searchedResults.some((quote) => quote.symbol === exactSymbol)) {
      const yahooSymbol = directQuote.raw?.yahoo_symbol || toYahooSymbol(exactSymbol);
      return [
        {
          symbol: fromYahooSymbol(yahooSymbol),
          yahoo_symbol: yahooSymbol,
          name: `${fromYahooSymbol(yahooSymbol)} live quote`,
          exchange: yahooSymbol.endsWith(".BO") ? "BSE" : "NSI",
          type: "EQUITY",
        },
        ...searchedResults,
      ].slice(0, 8);
    }

    return searchedResults;
  } catch (_error) {
    return [];
  }
}

async function fetchYahooQuote(symbol, includeError = false) {
  if (liveDataFallback !== "yahoo") {
    return includeError ? { error: "Yahoo fallback is disabled" } : null;
  }

  const yahooSymbol = toYahooSymbol(symbol);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`);
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1m");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 StockAnalyticsDashboard/1.0",
      },
    });
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const quote = result?.indicators?.quote?.[0];
    const timestamps = result?.timestamp || [];

    if (!response.ok || !meta?.regularMarketPrice) {
      return includeError
        ? {
          error: "Yahoo Finance did not return a usable quote",
          httpStatus: response.status,
          request: { yahoo_symbol: yahooSymbol },
          response: data,
        }
        : null;
    }

    const lastTimestamp = timestamps[timestamps.length - 1];
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const price = Number(meta.regularMarketPrice);
    const pctChange = previousClose
      ? ((price - Number(previousClose)) / Number(previousClose)) * 100
      : null;
    const volumes = quote?.volume?.filter((value) => value !== null) || [];

    return {
      symbol,
      event_time: lastTimestamp
        ? new Date(lastTimestamp * 1000).toISOString()
        : new Date().toISOString(),
      price,
      volume: volumes.at(-1) || 0,
      pct_change: pctChange,
      source: "yahoo_live",
      live: true,
      raw: {
        yahoo_symbol: yahooSymbol,
        exchange_name: meta.exchangeName,
        currency: meta.currency,
        market_state: meta.marketState,
        regular_market_price: meta.regularMarketPrice,
        previous_close: previousClose,
      },
    };
  } catch (error) {
    return includeError
      ? {
        error: "Yahoo Finance request failed",
        request: { yahoo_symbol: yahooSymbol },
        message: error.message,
      }
      : null;
  }
}

async function fetchYahooHistoricalPrices(symbol) {
  if (liveDataFallback !== "yahoo") {
    return [];
  }

  const yahooSymbol = toYahooSymbol(symbol);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`);
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "5m");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 StockAnalyticsDashboard/1.0",
      },
    });
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const closePrices = result?.indicators?.quote?.[0]?.close || [];

    return closePrices
      .filter((price) => price !== null && price !== undefined)
      .map((price) => Number(price))
      .filter((price) => Number.isFinite(price))
      .slice(-50);
  } catch (_error) {
    return [];
  }
}

async function fetchLiveQuote(symbol, includeError = false) {
  const moneycontrolQuote = await fetchMoneycontrolQuote(symbol, includeError);
  if (moneycontrolQuote && !moneycontrolQuote.error) {
    return moneycontrolQuote;
  }

  const growwQuote = await fetchGrowwQuote(symbol, includeError);
  if (growwQuote && !growwQuote.error) {
    return growwQuote;
  }

  const yahooQuote = await fetchYahooQuote(symbol, includeError);
  if (yahooQuote && !yahooQuote.error) {
    return includeError && growwQuote?.error
      ? { ...yahooQuote, primary_error: growwQuote }
      : yahooQuote;
  }

  if (includeError) {
    return {
      error: "No live data provider returned a usable quote",
      moneycontrol: moneycontrolQuote,
      groww: growwQuote,
      yahoo: yahooQuote,
    };
  }

  return null;
}

function trainLinearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((total, point) => total + point.x, 0);
  const sumY = points.reduce((total, point) => total + point.y, 0);
  const sumXY = points.reduce((total, point) => total + point.x * point.y, 0);
  const sumXX = points.reduce((total, point) => total + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

async function getStoredPrices(symbol) {
  const { rows } = await pool.query(
    `
      SELECT price
      FROM stock_indicators
      WHERE symbol = $1
      ORDER BY created_at DESC, event_time DESC
      LIMIT 50
    `,
    [symbol]
  );

  return rows
    .reverse()
    .map((row) => Number(row.price))
    .filter((price) => Number.isFinite(price));
}

async function getMlPrediction(symbol) {
  const liveHistory = await fetchYahooHistoricalPrices(symbol);
  const storedHistory = liveHistory.length >= 2 ? [] : await getStoredPrices(symbol);
  const prices = liveHistory.length >= 2 ? liveHistory : storedHistory;

  if (prices.length < 2) {
    return null;
  }

  const trainingPoints = prices.map((price, index) => ({ x: index, y: price }));
  const model = trainLinearRegression(trainingPoints);
  const currentPrice = prices[prices.length - 1];
  const nextTimeStep = prices.length;
  const predictedPrice = model.slope * nextTimeStep + model.intercept;

  return {
    symbol,
    current_price: Number(currentPrice.toFixed(2)),
    predicted_price: Number(predictedPrice.toFixed(2)),
    model: "linear_regression_backend",
    features: ["time_step", "historical_price"],
    training_points: prices.length,
    training_source: liveHistory.length >= 2 ? "yahoo_intraday_history" : "postgres_history",
  };
}

function getTrendFromChange(pctChange, fallbackTrend) {
  const change = Number(pctChange);
  if (!Number.isFinite(change)) {
    return fallbackTrend;
  }

  if (change > 0.05) {
    return "bullish";
  }

  if (change < -0.05) {
    return "bearish";
  }

  return "sideways";
}

function getVolatilityRegime(currentVolatility, historicalVolatilities = []) {
  const current = Number(currentVolatility);
  if (!Number.isFinite(current)) {
    return "insufficient_data";
  }

  const baselineValues = historicalVolatilities
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (baselineValues.length < 3) {
    if (current < 0.5) return "low";
    if (current < 1.5) return "normal";
    return "high";
  }

  const baseline = average(baselineValues) || 0;
  if (current <= baseline * 0.8) return "low";
  if (current >= baseline * 1.25) return "high";
  return "normal";
}

function buildTrendStrength(row) {
  const pctChange = Number(row.pct_change || 0);
  const price = Number(row.price || 0);
  const sma5 = Number(row.sma_5);
  const sma10 = Number(row.sma_10);
  const volatility = Number(row.volatility || 0);

  const momentumScore = clamp(Math.abs(pctChange) * 18, 0, 35);
  const crossoverGap =
    Number.isFinite(sma5) && Number.isFinite(sma10) && price
      ? Math.abs(((sma5 - sma10) / price) * 100) * 45
      : 0;
  const stabilityBoost = clamp(18 - volatility * 6, 0, 18);
  const score = clamp(momentumScore + crossoverGap + stabilityBoost, 5, 99);

  return {
    score: Number(score.toFixed(1)),
    direction: row.trend,
    confidence: row.trend === "sideways" ? Number((score * 0.72).toFixed(1)) : Number(score.toFixed(1)),
  };
}

function buildBreakoutSignal(row, recentRows) {
  const price = Number(row.price);
  const previousRows = recentRows.slice(0, -1);
  const previousPrices = previousRows
    .map((item) => Number(item.price))
    .filter((value) => Number.isFinite(value));

  if (previousPrices.length < 3 || !Number.isFinite(price)) {
    return { status: "none", label: "No breakout", detail: "Need more live history" };
  }

  const recentHigh = Math.max(...previousPrices);
  const recentLow = Math.min(...previousPrices);

  if (price > recentHigh) {
    return {
      status: "breakout",
      label: "Bullish breakout",
      detail: `Price moved above recent high of Rs. ${recentHigh.toFixed(2)}`,
    };
  }

  if (price < recentLow) {
    return {
      status: "breakdown",
      label: "Bearish breakdown",
      detail: `Price moved below recent low of Rs. ${recentLow.toFixed(2)}`,
    };
  }

  return {
    status: "range",
    label: "Inside range",
    detail: `Trading between Rs. ${recentLow.toFixed(2)} and Rs. ${recentHigh.toFixed(2)}`,
  };
}

function buildVolumeSignal(row, recentRows) {
  const currentVolume = Number(row.volume || 0);
  const historicalVolumes = recentRows
    .slice(0, -1)
    .map((item) => Number(item.volume || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!currentVolume || historicalVolumes.length < 3) {
    return { ratio: null, label: "No volume signal" };
  }

  const baseline = average(historicalVolumes);
  const ratio = baseline > 0 ? currentVolume / baseline : null;

  if (!ratio) {
    return { ratio: null, label: "No volume signal" };
  }

  if (ratio >= 1.8) {
    return { ratio: Number(ratio.toFixed(2)), label: "Volume spike" };
  }

  if (ratio <= 0.65) {
    return { ratio: Number(ratio.toFixed(2)), label: "Light volume" };
  }

  return { ratio: Number(ratio.toFixed(2)), label: "Normal volume" };
}

function buildAnalyticsForRow(row, recentRows) {
  const historicalVolatilities = recentRows
    .slice(0, -1)
    .map((item) => item.volatility);

  const trendStrength = buildTrendStrength(row);
  const volatilityRegime = getVolatilityRegime(row.volatility, historicalVolatilities);
  const breakout = buildBreakoutSignal(row, recentRows);
  const volumeSignal = buildVolumeSignal(row, recentRows);

  const reasons = [];
  if (row.trend === "bullish") reasons.push("Positive momentum");
  if (row.trend === "bearish") reasons.push("Negative momentum");
  if (volatilityRegime === "high") reasons.push("High volatility regime");
  if (breakout.status === "breakout") reasons.push("Price above recent range");
  if (breakout.status === "breakdown") reasons.push("Price below recent range");
  if (volumeSignal.label === "Volume spike") reasons.push("Volume spike detected");

  return {
    trend_strength: trendStrength,
    volatility_regime: volatilityRegime,
    breakout,
    volume_signal: volumeSignal,
    reasons,
  };
}

function buildRanking(overview) {
  return [...overview]
    .sort((a, b) => {
      const left = Number(a.analytics?.trend_strength?.score || 0) + Number(a.pct_change || 0) * 4;
      const right = Number(b.analytics?.trend_strength?.score || 0) + Number(b.pct_change || 0) * 4;
      return right - left;
    })
    .map((row, index) => ({
      rank: index + 1,
      symbol: row.symbol,
      trend: row.trend,
      trend_strength: row.analytics?.trend_strength?.score || 0,
      pct_change: Number(row.pct_change || 0),
      breakout: row.analytics?.breakout?.label || "No breakout",
    }));
}

function buildAlerts(overview) {
  return overview
    .flatMap((row) => {
      const alerts = [];
      const breakout = row.analytics?.breakout;
      const volatility = row.analytics?.volatility_regime;
      const volume = row.analytics?.volume_signal;

      if (breakout?.status === "breakout") {
        alerts.push({
          symbol: row.symbol,
          tone: "positive",
          title: "Bullish breakout",
          detail: breakout.detail,
        });
      }

      if (breakout?.status === "breakdown") {
        alerts.push({
          symbol: row.symbol,
          tone: "negative",
          title: "Bearish breakdown",
          detail: breakout.detail,
        });
      }

      if (volatility === "high") {
        alerts.push({
          symbol: row.symbol,
          tone: "warning",
          title: "High volatility",
          detail: "Price movement is more aggressive than its recent baseline.",
        });
      }

      if (volume?.label === "Volume spike") {
        alerts.push({
          symbol: row.symbol,
          tone: "neutral",
          title: "Volume spike",
          detail: `Current volume is ${volume.ratio}x the recent average.`,
        });
      }

      return alerts;
    })
    .slice(0, 8);
}

function buildMarketSummary(overview, ranking, alerts) {
  const bullish = overview.filter((row) => row.trend === "bullish").length;
  const bearish = overview.filter((row) => row.trend === "bearish").length;
  const sideways = overview.filter((row) => row.trend === "sideways").length;
  const avgMove = average(overview.map((row) => Number(row.pct_change || 0)).filter((value) => Number.isFinite(value))) || 0;
  const strongest = ranking[0] || null;
  const mostVolatile = [...overview]
    .sort((a, b) => Number(b.volatility || 0) - Number(a.volatility || 0))[0] || null;

  return {
    tracked_count: overview.length,
    bullish_count: bullish,
    bearish_count: bearish,
    sideways_count: sideways,
    average_pct_change: Number(avgMove.toFixed(3)),
    strongest_stock: strongest,
    most_volatile_stock: mostVolatile
      ? {
        symbol: mostVolatile.symbol,
        volatility: Number(mostVolatile.volatility || 0),
      }
      : null,
    active_alerts: alerts.length,
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/api/symbols", (_req, res) => {
  res.json({ symbols: trackedSymbols });
});

app.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const [moneycontrolResults, yahooResults] = await Promise.all([
      searchMoneycontrolSymbols(query),
      searchYahooSymbols(query),
    ]);
    const results = [...moneycontrolResults, ...yahooResults]
      .filter((item, index, all) => {
        return all.findIndex((candidate) => candidate.symbol === item.symbol) === index;
      })
      .slice(0, 12);
    res.json({ query, results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/refresh-live", async (req, res) => {
  try {
    const requestedSymbols = parseSymbolsParam(req.query.symbols);
    const symbols = requestedSymbols.length > 0 ? requestedSymbols : trackedSymbols;
    const results = await refreshLiveData(symbols);
    res.json({ status: "ok", results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const requestedSymbols = parseSymbolsParam(req.query.symbols);

    if (requestedSymbols.length === 0) {
      return res.json({ overview: [], history: [], predictions: {} });
    }

    const refreshResults = await refreshLiveData(requestedSymbols);
    const successful = refreshResults.filter((result) => result.status === "saved");

    if (successful.length === 0) {
      return res.status(500).json({
        message: "Live data fetched but NOT stored in DB",
        debug: refreshResults,
      });
    }

    const { rows: latestBySymbol } = await pool.query(
      `
      SELECT DISTINCT ON (symbol)
        symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend, source
      FROM stock_indicators
      WHERE symbol = ANY($1)
      ORDER BY symbol, created_at DESC, event_time DESC
    `,
      [requestedSymbols]
    );

    if (latestBySymbol.length === 0) {
      return res.status(500).json({
        message: "No data found in DB after refresh",
        hint: "Check DB insertion logic",
      });
    }

    const overviewWithAnalytics = await Promise.all(
      latestBySymbol.map(async (row) => {
        const recentRows = await getRecentRowsBySymbol(row.symbol, 20);
        const analytics = buildAnalyticsForRow(row, recentRows);

        return {
          ...row,
          live:
            row.source === "groww_live" ||
            row.source === "yahoo_live" ||
            row.source === "moneycontrol_live",
          analytics,
        };
      })
    );

    const history = await getLatestIndicators(200, requestedSymbols);
    const predictionResponses = await Promise.all(
      overviewWithAnalytics.map(async (row) => {
        return [row.symbol, await getMlPrediction(row.symbol)];
      })
    );

    const ranking = buildRanking(overviewWithAnalytics);
    const overview = overviewWithAnalytics.map((row) => {
      const rankItem = ranking.find((item) => item.symbol === row.symbol);
      return {
        ...row,
        analytics: {
          ...row.analytics,
          relative_rank: rankItem?.rank || null,
        },
      };
    });
    const alerts = buildAlerts(overview);
    const marketSummary = buildMarketSummary(overview, ranking, alerts);
    const predictions = Object.fromEntries(predictionResponses);

    res.json({ overview, history, predictions, ranking, alerts, marketSummary });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/live/:symbol", async (req, res) => {
  try {
    const quote = await fetchLiveQuote(req.params.symbol.toUpperCase(), true);
    if (quote.error) {
      res.status(502).json(quote);
      return;
    }

    res.json(quote);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/stocks/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { rows } = await pool.query(
      `
        SELECT symbol, event_time, price, volume, sma_5, sma_10, volatility, pct_change, trend
        FROM stock_indicators
        WHERE symbol = $1
        ORDER BY event_time DESC
        LIMIT 100
      `,
      [symbol]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: `No data found for ${symbol}` });
      return;
    }

    res.json(rows.reverse());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend API listening on port ${PORT}`);
});
