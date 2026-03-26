import { GoogleGenAI } from "@google/genai";
import { Market, AIRecommendation, BTCHistory, SentimentData, OrderBook, BTCIndicators } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function detectPatterns(candles: Candle[]): string[] {
  if (candles.length < 2) return [];

  const patterns: string[] = [];
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const bullish = c.close > c.open;

  if (range > 0 && body / range < 0.1) patterns.push("Doji");

  if (lowerWick > body * 2 && upperWick < body * 0.5 && range > 0) {
    patterns.push(bullish ? "Hammer (bullish)" : "Hanging Man (bearish)");
  }

  if (upperWick > body * 2 && lowerWick < body * 0.5 && range > 0) {
    patterns.push(bullish ? "Inverted Hammer" : "Shooting Star (bearish)");
  }

  if (!(p.close > p.open) && bullish && c.open < p.close && c.close > p.open) {
    patterns.push("Bullish Engulfing");
  }

  if (p.close > p.open && !bullish && c.open > p.close && c.close < p.open) {
    patterns.push("Bearish Engulfing");
  }

  if (lowerWick > body * 3) patterns.push("Bullish Pin Bar");
  if (upperWick > body * 3) patterns.push("Bearish Pin Bar");

  if (upperWick < body * 0.05 && lowerWick < body * 0.05 && body > 0) {
    patterns.push(bullish ? "Bullish Marubozu" : "Bearish Marubozu");
  }

  if (c.high < p.high && c.low > p.low) patterns.push("Inside Bar (consolidation)");

  if (c.volume > p.volume * 1.5 && patterns.length > 0) {
    patterns.push("High Volume Confirmation");
  }

  if (candles.length >= 3) {
    const c2 = candles[candles.length - 3];
    const allBull = c.close > c.open && p.close > p.open && c2.close > c2.open;
    const allBear = c.close < c.open && p.close < p.open && c2.close < c2.open;
    if (allBull) patterns.push("Three White Soldiers (strong bullish)");
    if (allBear) patterns.push("Three Black Crows (strong bearish)");
  }

  return patterns.length > 0 ? patterns : ["No clear pattern"];
}

export async function analyzeMarket(
  market: Market,
  btcPrice: string | null,
  history: BTCHistory[],
  sentiment: SentimentData | null,
  indicators: BTCIndicators | null,
  orderBooks: Record<string, OrderBook>,
  marketHistory: { t: number; yes: number; no: number }[] = []
): Promise<AIRecommendation> {
  const sentimentSummary = sentiment
    ? `${sentiment.value_classification} (${sentiment.value}/100)`
    : "Unknown";

  const hasBtcPrice = Boolean(btcPrice && Number.isFinite(Number(btcPrice)));
  const hasBtcHistory = history.length >= 5;
  const dataMode: "FULL_DATA" | "POLYMARKET_ONLY" =
    hasBtcPrice && hasBtcHistory ? "FULL_DATA" : "POLYMARKET_ONLY";

  const last15 = history.slice(-15);
  const patterns = hasBtcHistory ? detectPatterns(last15) : ["BTC candlestick feed unavailable"];

  const ohlcvTable =
    last15
      .map((h, i) => {
        const dir = h.close >= h.open ? "UP" : "DOWN";
        return `  [${i + 1}] ${dir} O:${h.open.toFixed(1)} H:${h.high.toFixed(1)} L:${h.low.toFixed(1)} C:${h.close.toFixed(1)} Vol:${h.volume.toFixed(2)}`;
      })
      .join("\n") || "BTC candlestick feed unavailable.";

  const indicatorBlock = indicators
    ? `
TECHNICAL INDICATORS (last 60x 1m candles):
- RSI(14): ${indicators.rsi} ${indicators.rsi > 70 ? "Overbought" : indicators.rsi < 30 ? "Oversold" : "Neutral"}
- EMA9: $${indicators.ema9} | EMA21: $${indicators.ema21} -> ${indicators.emaCross}
- Trend (last 3): ${indicators.trend}
- Volume spike: ${indicators.volumeSpike}x avg ${indicators.volumeSpike > 2 ? "High" : "Normal"}
`
    : "BTC indicators unavailable.";

  const tokenIds = market.clobTokenIds || [];
  const obLines = tokenIds
    .map((tid, i) => {
      const ob = orderBooks[tid];
      if (!ob) return `  ${market.outcomes[i]}: No data`;
      return `  ${market.outcomes[i]}: imbalance=${ob.imbalance ?? "?"} -> ${ob.imbalanceSignal ?? "NEUTRAL"} | bid=${ob.bids[0]?.price ?? "?"} ask=${ob.asks[0]?.price ?? "?"}`;
    })
    .join("\n");

  const impliedProbs = market.outcomePrices
    .map((p, i) => `  ${market.outcomes[i]}: ${(parseFloat(p) * 100).toFixed(1)}c`)
    .join("\n");

  const marketHistoryBlock =
    marketHistory.length > 0
      ? marketHistory
          .slice(-10)
          .map((point, i) => `  [${i + 1}] yes=${(point.yes * 100).toFixed(1)}c no=${(point.no * 100).toFixed(1)}c t=${point.t}`)
          .join("\n")
      : "Polymarket market history unavailable.";

  const prompt = `You are a quantitative trader analyzing a Polymarket BTC 5-minute prediction market.
Determine if there is a profitable edge to trade, and which direction.
Current analysis mode: ${dataMode}.

== MARKET ==
Question: ${market.question}
Outcomes and implied probabilities:
${impliedProbs}
Volume: $${parseFloat(market.volume || "0").toLocaleString()} | Liquidity: $${parseFloat(market.liquidity || "0").toLocaleString()}
Window: ${market.startDate} -> ${market.endDate}

== BTC PRICE ==
Current: ${hasBtcPrice ? `$${btcPrice}` : "Unavailable"}

== BTC CANDLESTICK DATA (last 15x 1m candles, oldest to newest) ==
${ohlcvTable}

== DETECTED CANDLE PATTERNS ==
${patterns.join(", ")}

== MARKET SENTIMENT ==
Fear and Greed: ${sentimentSummary}
${indicatorBlock}

== ORDER BOOK IMBALANCE ==
${obLines}

== POLYMARKET PRICE HISTORY (recent) ==
${marketHistoryBlock}

== EDGE ANALYSIS RULES ==
1. Edge exists only when your probability estimate differs from implied price by more than 5 cents.
2. Candle patterns, RSI extremes, EMA cross, and order book imbalance aligned means higher confidence.
3. Conflicting signals or fairly priced market means NO_TRADE.
4. Strong Polymarket momentum plus order book imbalance can still justify a trade even if BTC feed is unavailable.
5. If BTC price/candles are unavailable, still analyze using Polymarket probabilities, history, liquidity, and order book only, but reduce confidence.

Respond with JSON only:
{
  "decision": "TRADE" | "NO_TRADE",
  "direction": "UP" | "DOWN" | "NONE",
  "confidence": number,
  "estimatedEdge": number,
  "candlePatterns": ["pattern1", "pattern2"],
  "reasoning": "string",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "dataMode": "FULL_DATA" | "POLYMARKET_ONLY"
}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const result = JSON.parse(response.text || "{}");
    return {
      decision: result.decision || "NO_TRADE",
      direction: result.direction || "NONE",
      confidence: result.confidence || 0,
      estimatedEdge: result.estimatedEdge || 0,
      candlePatterns: result.candlePatterns || patterns,
      reasoning: result.reasoning || "Failed to generate analysis.",
      riskLevel: result.riskLevel || "MEDIUM",
      dataMode: result.dataMode || dataMode,
    };
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return {
      decision: "NO_TRADE",
      direction: "NONE",
      confidence: 0,
      estimatedEdge: 0,
      candlePatterns: patterns,
      reasoning: "Error occurred during AI analysis.",
      riskLevel: "HIGH",
      dataMode,
    };
  }
}
