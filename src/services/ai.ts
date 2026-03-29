import { Market, AIRecommendation, BTCHistory, SentimentData, OrderBook, BTCIndicators } from "../types/index.js";
import { LossPattern, WinPattern, DivergenceSignal } from "./analysis-common.js";
import { analyzeMarket as analyzeMarketGemini } from "./gemini.js";
import { analyzeMarket as analyzeMarketOpenAI } from "./openai.js";

export async function analyzeMarket(
  market: Market,
  btcPrice: string | null,
  history: BTCHistory[],
  sentiment: SentimentData | null,
  indicators: BTCIndicators | null,
  orderBooks: Record<string, OrderBook>,
  marketHistory: { t: number; yes: number; no: number }[] = [],
  windowElapsedSeconds: number = 150,
  lossPatterns: LossPattern[] = [],
  divergence: DivergenceSignal | null = null,
  winPatterns: WinPattern[] = []
): Promise<AIRecommendation> {
  const provider = process.env.AI_PROVIDER || "gemini";

  if (provider === "openai") {
    return analyzeMarketOpenAI(
      market,
      btcPrice,
      history,
      sentiment,
      indicators,
      orderBooks,
      marketHistory,
      windowElapsedSeconds,
      lossPatterns,
      divergence,
      winPatterns
    );
  }

  // Default to Gemini
  return analyzeMarketGemini(
    market,
    btcPrice,
    history,
    sentiment,
    indicators,
    orderBooks,
    marketHistory,
    windowElapsedSeconds,
    lossPatterns,
    divergence,
    winPatterns
  );
}
