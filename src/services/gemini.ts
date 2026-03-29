import { GoogleGenAI } from "@google/genai";
import { Market, AIRecommendation, BTCHistory, SentimentData, OrderBook, BTCIndicators } from "../types/index";
import {
  LossPattern,
  WinPattern,
  DivergenceSignal,
  applyGates,
  buildPrompt,
  parseAIResponse,
  createErrorResponse,
  prepareAnalysisContext,
} from "./analysis-common.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
  const ctx = prepareAnalysisContext(btcPrice, history, indicators);

  const gateResult = applyGates(
    market,
    orderBooks,
    windowElapsedSeconds,
    ctx.alignment,
    ctx.patterns,
    ctx.hasBtcHistory,
    ctx.dataMode
  );
  if (gateResult) return gateResult;

  const prompt = buildPrompt(
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
    winPatterns,
    ctx.triggerAnalysis,
    ctx.confirmationAnalysis,
    ctx.biasAnalysis,
    ctx.alignment,
    ctx.hasBtcPrice,
    ctx.dataMode
  );

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const result = JSON.parse(response.text || "{}");
    return parseAIResponse(result, ctx.patterns, ctx.dataMode);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return createErrorResponse(ctx.patterns, ctx.dataMode, "Error occurred during AI analysis.");
  }
}

export type { LossPattern, WinPattern, DivergenceSignal };