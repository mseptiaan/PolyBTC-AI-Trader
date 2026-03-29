import axios from "axios";
import { config } from "../config/index.js";
import { BtcCandle } from "../../types/index.js";
import { readPersistentCache, writePersistentCache, writeBtcCandles, writeBtcPriceSnapshot, getCacheMeta } from "../db/index.js";

let btcHistoryCache: { data: BtcCandle[]; expiresAt: number } | null = null;
let btcPriceCache: { data: { symbol: string; price: string; source?: string }; expiresAt: number } | null = null;
let btcIndicatorsCache: { data: any; expiresAt: number } | null = null;
let btcSyncInterval: NodeJS.Timeout | null = null;

/**
 * BTC Service handles obtaining external market data used to determine
 * Polymarket odds. It aggregates current prices and 60-min histories
 * from multiple sources (Binance, Coinbase, Kraken) to ensure resilience
 * against individual API rate-limits.
 *
 * Calculates technical indicators (EMA, RSI, Bollinger Bands, MACD)
 * required for the AI context.
 */

// ── Background Sync ─────────────────────────────────────────────────────────

/**
 * Periodically pulls the latest history and price to keep the bot's
 * cache hot, avoiding latency during the critical trading window.
 */
export async function runBtcBackgroundSync() {
  try {
    await Promise.all([getBtcHistory(true), getBtcPrice(true), getBtcIndicators(true)]);
  } catch (error: any) {
    console.warn("BTC background sync failed:", error?.message || error);
  }
}

export function startBtcBackgroundSync() {
  if (!config.MONGODB_URI || btcSyncInterval) return;

  void runBtcBackgroundSync();
  btcSyncInterval = setInterval(() => {
    void runBtcBackgroundSync();
  }, config.BTC_BACKGROUND_SYNC_MS);
}

// ── Persistence Helpers ─────────────────────────────────────────────────────

async function persistBtcHistory(history: BtcCandle[], source: string) {
  const results = await Promise.allSettled([
    writePersistentCache("btc-history-1m", history, source),
    writeBtcCandles(history, source),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("BTC history persistence failed:", result.reason?.message || result.reason);
    }
  }
}

async function persistBtcPrice(payload: { symbol: string; price: string; source?: string }) {
  const results = await Promise.allSettled([
    writePersistentCache("btc-price-latest", payload, payload.source || "unknown"),
    writeBtcPriceSnapshot(payload),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("BTC price persistence failed:", result.reason?.message || result.reason);
    }
  }
}

async function persistBtcIndicators(indicators: any, source: string) {
  try {
    await writePersistentCache("btc-indicators-latest", indicators, source);
  } catch (error: any) {
    console.warn("BTC indicators persistence failed:", error?.message || error);
  }
}

// ── API Fetchers ────────────────────────────────────────────────────────────

async function fetchBtcPriceFromBinance() {
  const binanceHosts = ["https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com"];
  for (const host of binanceHosts) {
    try {
      const response = await axios.get(`${host}/api/v3/ticker/price`, { params: { symbol: "BTCUSDT" }, timeout: 5000 });
      return { symbol: "BTCUSDT", price: String(response.data.price), source: host };
    } catch {}
  }
  return null;
}

async function fetchBtcPriceFromCoinbase() {
  try {
    const response = await axios.get("https://api.coinbase.com/v2/prices/BTC-USD/spot", { timeout: 5000 });
    return { symbol: "BTCUSDT", price: String(response.data?.data?.amount), source: "coinbase" };
  } catch { return null; }
}

async function fetchBtcPriceFromKraken() {
  try {
    const response = await axios.get("https://api.kraken.com/0/public/Ticker", { params: { pair: "XBTUSD" }, timeout: 5000 });
    const ticker = response.data?.result?.XXBTZUSD || response.data?.result?.XBTUSD;
    const price = ticker?.c?.[0];
    if (!price) return null;
    return { symbol: "BTCUSDT", price: String(price), source: "kraken" };
  } catch { return null; }
}

async function fetchBtcPriceFromCoinGecko() {
  try {
    const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", { params: { ids: "bitcoin", vs_currencies: "usd" }, timeout: 8000 });
    const price = response.data?.bitcoin?.usd;
    if (price == null) return null;
    return { symbol: "BTCUSDT", price: String(price), source: "coingecko" };
  } catch { return null; }
}

async function fetchBtcHistoryFromBinance() {
  const binanceHosts = ["https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com"];
  for (const host of binanceHosts) {
    try {
      const response = await axios.get(`${host}/api/v3/klines`, { params: { symbol: "BTCUSDT", interval: "1m", limit: 60 }, timeout: 5000 });
      const history = response.data.map((k: any) => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        price: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      })) as BtcCandle[];
      return { history, source: host };
    } catch {}
  }
  return null;
}

async function fetchBtcHistoryFromCoinGecko() {
  try {
    const response = await axios.get("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc", { params: { vs_currency: "usd", days: 1 }, timeout: 10000 });
    const history = response.data.slice(-60).map((k: number[]) => ({
      time: Math.floor(k[0] / 1000),
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      price: k[4],
      volume: 0,
    })) as BtcCandle[];
    return { history, source: "coingecko" };
  } catch { return null; }
}

async function fetchBtcHistoryFromCoinbase() {
  try {
    const response = await axios.get("https://api.exchange.coinbase.com/products/BTC-USD/candles", { params: { granularity: 60 }, timeout: 8000, headers: { Accept: "application/json" } });
    const history = (response.data || []).slice(0, 60).map((k: number[]) => ({
      time: Number(k[0]),
      low: Number(k[1]),
      high: Number(k[2]),
      open: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5] || 0),
      price: Number(k[4]),
    })).sort((a: BtcCandle, b: BtcCandle) => a.time - b.time) as BtcCandle[];
    if (!history.length) return null;
    return { history, source: "coinbase" };
  } catch { return null; }
}

// ── Public Accessors ────────────────────────────────────────────────────────

export async function getBtcHistory(forceRefresh = false) {
  if (!forceRefresh && btcHistoryCache && btcHistoryCache.expiresAt > Date.now()) {
    return { history: btcHistoryCache.data, source: "cache" };
  }

  if (!forceRefresh) {
    const persisted = await readPersistentCache<BtcCandle[]>("btc-history-1m", config.BTC_HISTORY_CACHE_MS);
    if (persisted?.payload?.length) {
      btcHistoryCache = {
        data: persisted.payload,
        expiresAt: Date.now() + (persisted.stale ? 5_000 : config.BTC_HISTORY_CACHE_MS),
      };
      return { history: persisted.payload, source: persisted.source };
    }
  }

  const providerResult =
    (await fetchBtcHistoryFromBinance()) ||
    (await fetchBtcHistoryFromCoinbase()) ||
    (await fetchBtcHistoryFromCoinGecko());

  if (providerResult?.history?.length) {
    btcHistoryCache = {
      data: providerResult.history,
      expiresAt: Date.now() + config.BTC_HISTORY_CACHE_MS,
    };
    await persistBtcHistory(providerResult.history, providerResult.source);
    return providerResult;
  }

  if (btcHistoryCache?.data?.length) {
    return { history: btcHistoryCache.data, source: "stale-cache" };
  }

  const persisted = await readPersistentCache<BtcCandle[]>("btc-history-1m", Number.MAX_SAFE_INTEGER);
  if (persisted?.payload?.length) {
    return { history: persisted.payload, source: "mongo-stale-cache" };
  }

  return null;
}

export async function getBtcPrice(forceRefresh = false) {
  if (!forceRefresh && btcPriceCache && btcPriceCache.expiresAt > Date.now()) {
    return btcPriceCache.data;
  }

  if (!forceRefresh) {
    const persisted = await readPersistentCache<{ symbol: string; price: string; source?: string }>(
      "btc-price-latest",
      config.BTC_PRICE_CACHE_MS
    );
    if (persisted?.payload?.price) {
      btcPriceCache = {
        data: { ...persisted.payload, source: persisted.source },
        expiresAt: Date.now() + (persisted.stale ? 5_000 : config.BTC_PRICE_CACHE_MS),
      };
      return btcPriceCache.data;
    }
  }

  const priceResult =
    (await fetchBtcPriceFromBinance()) ||
    (await fetchBtcPriceFromCoinbase()) ||
    (await fetchBtcPriceFromKraken()) ||
    (await fetchBtcPriceFromCoinGecko());

  if (priceResult?.price) {
    btcPriceCache = { data: priceResult, expiresAt: Date.now() + config.BTC_PRICE_CACHE_MS };
    await persistBtcPrice(priceResult);
    return priceResult;
  }

  const historyResult = await getBtcHistory(forceRefresh);
  const lastClose = historyResult?.history?.[historyResult.history.length - 1]?.close;
  if (lastClose) {
    const fallback = { symbol: "BTCUSDT", price: String(lastClose), source: historyResult?.source || "history" };
    btcPriceCache = { data: fallback, expiresAt: Date.now() + config.BTC_PRICE_CACHE_MS };
    await persistBtcPrice(fallback);
    return fallback;
  }

  if (btcPriceCache?.data?.price) {
    return { ...btcPriceCache.data, source: "stale-cache" };
  }

  const persisted = await readPersistentCache<{ symbol: string; price: string; source?: string }>(
    "btc-price-latest",
    Number.MAX_SAFE_INTEGER
  );
  if (persisted?.payload?.price) {
    return { ...persisted.payload, source: "mongo-stale-cache" };
  }

  return null;
}

function computeBtcIndicatorsFromHistory(history: BtcCandle[]) {
  const closes = history.map((k) => Number(k.close));
  const volumes = history.map((k) => Number(k.volume || 0));
  if (closes.length < 15) {
    throw new Error("Not enough BTC candles to compute indicators");
  }

  const calcEma = (data: number[], period: number): number => {
    const k = 2 / (period + 1);
    let result = data[0];
    for (let i = 1; i < data.length; i++) result = data[i] * k + result * (1 - k);
    return result;
  };

  const rsiPeriod = 14;
  let gains = 0;
  let losses = 0;
  const start = Math.max(1, closes.length - rsiPeriod);
  for (let i = start; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const count = closes.length - start;
  const avgGain = count > 0 ? gains / count : 0;
  const avgLoss = count > 0 ? losses / count : 0;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  const ema9 = calcEma(closes, 9);
  const ema21 = calcEma(closes, 21);

  const last3 = history.slice(-3).map((k) => ({
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
    direction: Number(k.close) >= Number(k.open) ? "UP" : "DOWN",
  }));

  const recentVolumes = volumes.slice(-20);
  const avgVol = recentVolumes.length
    ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
    : 0;
  const lastVol = volumes[volumes.length - 1] || 0;
  const volumeSpike = avgVol > 0 ? lastVol / avgVol : 1;

  const trend = last3.every((c) => c.direction === "UP")
    ? "STRONG_UP"
    : last3.every((c) => c.direction === "DOWN")
      ? "STRONG_DOWN"
      : "MIXED";

  // MACD (12, 26, 9)
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  let e12 = closes[0];
  let e26 = closes[0];
  const macdHistory: number[] = [];
  for (const price of closes) {
    e12 = price * k12 + e12 * (1 - k12);
    e26 = price * k26 + e26 * (1 - k26);
    macdHistory.push(e12 - e26);
  }
  const kMacd = 2 / 10;
  let macdSignalVal = macdHistory[0];
  for (const m of macdHistory) {
    macdSignalVal = m * kMacd + macdSignalVal * (1 - kMacd);
  }
  const macdLine = macdHistory[macdHistory.length - 1];
  const macdHistogram = macdLine - macdSignalVal;
  const macdTrend = macdHistogram > 0 ? "BULLISH" : macdHistogram < 0 ? "BEARISH" : "NEUTRAL";

  // Bollinger Bands (20, 2)
  const bbPeriod = Math.min(20, closes.length);
  const bbCloses = closes.slice(-bbPeriod);
  const bbMiddle = bbCloses.reduce((a, b) => a + b, 0) / bbCloses.length;
  const bbVariance = bbCloses.reduce((sum, c) => sum + Math.pow(c - bbMiddle, 2), 0) / bbCloses.length;
  const bbStdDev = Math.sqrt(bbVariance);
  const bbUpper = bbMiddle + 2 * bbStdDev;
  const bbLower = bbMiddle - 2 * bbStdDev;
  const currentClose = closes[closes.length - 1];
  const bbPosition =
    currentClose > bbUpper
      ? "ABOVE_UPPER"
      : currentClose > bbMiddle + bbStdDev
        ? "NEAR_UPPER"
        : currentClose < bbLower
          ? "BELOW_LOWER"
          : currentClose < bbMiddle - bbStdDev
            ? "NEAR_LOWER"
            : "MIDDLE";

  // 5-candle momentum (%)
  const momentum5 =
    closes.length >= 6
      ? parseFloat((((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100).toFixed(3))
      : 0;

  // Signal Score
  let signalScore = 0;
  if (ema9 > ema21) signalScore += 1; else signalScore -= 1;
  if (rsi < 35) signalScore += 2;
  else if (rsi > 65) signalScore -= 2;
  if (macdHistogram > 0) signalScore += 1; else if (macdHistogram < 0) signalScore -= 1;
  if (trend === "STRONG_UP") signalScore += 2; else if (trend === "STRONG_DOWN") signalScore -= 2;
  if (momentum5 > 0.15) signalScore += 1; else if (momentum5 < -0.15) signalScore -= 1;
  if (bbPosition === "NEAR_LOWER" || bbPosition === "BELOW_LOWER") signalScore += 1;
  else if (bbPosition === "NEAR_UPPER" || bbPosition === "ABOVE_UPPER") signalScore -= 1;

  return {
    rsi: parseFloat(rsi.toFixed(2)),
    ema9: parseFloat(ema9.toFixed(2)),
    ema21: parseFloat(ema21.toFixed(2)),
    emaCross: ema9 > ema21 ? "BULLISH" : "BEARISH",
    volumeSpike: parseFloat(volumeSpike.toFixed(2)),
    last3Candles: last3,
    trend,
    currentPrice: closes[closes.length - 1],
    macd: parseFloat(macdLine.toFixed(2)),
    macdSignal: parseFloat(macdSignalVal.toFixed(2)),
    macdHistogram: parseFloat(macdHistogram.toFixed(2)),
    macdTrend: macdTrend as "BULLISH" | "BEARISH" | "NEUTRAL",
    bbUpper: parseFloat(bbUpper.toFixed(2)),
    bbMiddle: parseFloat(bbMiddle.toFixed(2)),
    bbLower: parseFloat(bbLower.toFixed(2)),
    bbPosition: bbPosition as "ABOVE_UPPER" | "NEAR_UPPER" | "MIDDLE" | "NEAR_LOWER" | "BELOW_LOWER",
    momentum5,
    signalScore,
  };
}

export async function getBtcIndicators(forceRefresh = false) {
  if (!forceRefresh && btcIndicatorsCache && btcIndicatorsCache.expiresAt > Date.now()) {
    return btcIndicatorsCache.data;
  }

  const historyResult = await getBtcHistory(forceRefresh);
  if (!historyResult?.history?.length) {
    if (btcIndicatorsCache?.data) {
      return { ...btcIndicatorsCache.data, source: "stale-cache" };
    }
    return null;
  }

  const indicators = {
    ...computeBtcIndicatorsFromHistory(historyResult.history),
    source: historyResult.source,
  };
  btcIndicatorsCache = { data: indicators, expiresAt: Date.now() + config.BTC_INDICATORS_CACHE_MS };
  await persistBtcIndicators(indicators, historyResult.source);
  return indicators;
}

export function getBtcCacheMeta() {
  return {
    btcPrice: btcPriceCache ? getCacheMeta(btcPriceCache.expiresAt) : null,
    btcHistory: btcHistoryCache ? getCacheMeta(btcHistoryCache.expiresAt) : null,
    btcIndicators: btcIndicatorsCache ? getCacheMeta(btcIndicatorsCache.expiresAt) : null,
  };
}
