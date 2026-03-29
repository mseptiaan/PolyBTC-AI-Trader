import OpenAI from "openai";
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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_TOKEN || "";
const OPENROUTER_BASE_URL = process.env.OPENAI_API_URL || "https://openrouter.ai/api/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "openai/gpt-5.2";

const openai = new OpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: OPENROUTER_API_KEY,
});

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
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a quantitative trading AI. Always respond with valid JSON matching the requested schema exactly. No explanations outside the JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    return parseAIResponse(result, ctx.patterns, ctx.dataMode);
  } catch (error) {
    console.error("OpenAI Analysis Error:", error);
    return createErrorResponse(ctx.patterns, ctx.dataMode, "Error occurred during AI analysis.");
  }
}

export type { LossPattern, WinPattern, DivergenceSignal };