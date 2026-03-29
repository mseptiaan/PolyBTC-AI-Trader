import axios from "axios";
import { ethers } from "ethers";
import { config, CONSERVATIVE_CONFIG } from "../config/index.js";
import { getBtcPrice, getBtcHistory, getBtcIndicators } from "./btc.service.js";
import { getClobClient, executePolymarketTrade } from "./polymarket.service.js";
import { divergenceState, setCurrentWindowTokens } from "./divergence.service.js";
import { savePositionAutomation, getPositionAutomationCollection } from "./automation.service.js"; // Assume this exists
import { analyzeMarket } from "../../services/gemini.js"; // Wrapper for gemini.ts
import { saveTradeLog, loadTradeLog, saveLearning, loadLearning, pushSSE } from "../utils/index.js";
import { AssetType, Side } from "@polymarket/clob-client";

// ... (Bot engine logic extracted from server.ts - runBotCycle, pendingResults check, adaptive learning state)
// Due to size, I will construct this modularly.

/**
 * Bot Service Module
 * Handles all background logic relating to automated market scanning,
 * AI recommendation processing (calling Gemini), and Polymarket CLOB
 * trade execution.
 *
 * Includes adaptive learning mechanics that adjust minimum confidence
 * based on recent consecutive losses/wins.
 */

// ── Bot Configuration & State ────────────────────────────────────────────────
let botMode: "AGGRESSIVE" | "CONSERVATIVE" = "AGGRESSIVE";

export function getActiveConfig() {
  if (botMode === "CONSERVATIVE") return CONSERVATIVE_CONFIG;
  return {
    minConfidence:    config.BOT_MIN_CONFIDENCE,
    minEdge:          config.BOT_MIN_EDGE,
    kellyFraction:    config.BOT_KELLY_FRACTION,
    maxBetUsdc:       config.BOT_MAX_BET_USDC,
    sessionLossLimit: config.BOT_SESSION_LOSS_LIMIT,
    balanceCap:       0.25,
    entryWindowStart: 10,
    entryWindowEnd:   285,
  };
}

export let botEnabled = process.env.BOT_AUTO_START === "true";
export let botRunning = false;
let botInterval: NodeJS.Timeout | null = null;
export let botSessionStartBalance: number | null = null;
export let botSessionTradesCount = 0;
let botLastWindowStart = 0;
const botAnalyzedThisWindow = new Set<string>();

export function setBotEnabled(enabled: boolean) {
    botEnabled = enabled;
    if (enabled) botSessionStartBalance = null;
}
export function setBotMode(mode: "AGGRESSIVE" | "CONSERVATIVE") {
    botMode = mode;
}
export { botMode };

// Memory and logs
import { LossMemory, WinMemory, BotLogEntry, PendingResult, EntrySnapshot, RawLogEntry } from "../../types/index.js";
export const lossMemory: LossMemory[] = [];
export const winMemory: WinMemory[] = [];
export let consecutiveLosses = 0;
export let consecutiveWins   = 0;
export let adaptiveConfidenceBoost = 0;

export const botLog: BotLogEntry[] = [];
export const rawLog: RawLogEntry[] = [];
export const pendingResults = new Map<string, PendingResult>();
export let currentEntrySnapshot: EntrySnapshot | null = null;

// Initialization
export function initLearningState() {
    const data = loadLearning();
    if (data) {
        lossMemory.push(...(data.lossMemory || []));
        winMemory.push(...(data.winMemory || []));
        consecutiveLosses       = data.consecutiveLosses       ?? 0;
        consecutiveWins         = data.consecutiveWins         ?? 0;
        adaptiveConfidenceBoost = data.adaptiveConfidenceBoost ?? 0;
        console.log(`[Persist] Loaded learning state: ${lossMemory.length} loss / ${winMemory.length} win patterns, streak=${consecutiveLosses}L/${consecutiveWins}W, boost=+${adaptiveConfidenceBoost}%`);
    }
}

export function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }
export function botPrint(level: "INFO" | "WARN" | "TRADE" | "OK" | "SKIP" | "ERR", msg: string) {
  const icons: Record<string, string> = { INFO: "─", WARN: "⚠", TRADE: "💰", OK: "✓", SKIP: "✗", ERR: "✖" };
  const entry: RawLogEntry = { ts: ts(), level, msg };
  console.log(`[${entry.ts}] [BOT:${level.padEnd(5)}] ${icons[level]} ${msg}`);
  rawLog.unshift(entry);
  if (rawLog.length > 500) rawLog.pop();
  pushSSE("log", entry);
}

// ... The rest of the bot logic (checkPendingResults, prefetchNextWindow, runBotCycle)
// is complex but follows the exact structure of the original server.ts.
