import fs from "fs";
import type { ServerResponse } from "http";
import { config } from "../config/index.js";
import { TradeLogEntry, PersistedLearning, LossMemory, WinMemory } from "../../types/index.js";

// ── Persistence ───────────────────────────────────────────────────────────────
export function ensureDataDirectory() {
  if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

export function saveTradeLog(entry: TradeLogEntry): void {
  try {
    ensureDataDirectory();
    fs.appendFileSync(config.TRADE_LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (e: any) {
    console.error("[Persist] Failed to write trade_log.jsonl:", e.message);
  }
}

export function loadTradeLog(): TradeLogEntry[] {
  try {
    if (!fs.existsSync(config.TRADE_LOG_FILE)) return [];
    return fs.readFileSync(config.TRADE_LOG_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TradeLogEntry);
  } catch (e: any) {
    console.error("[Persist] Failed to read trade_log.jsonl:", e.message);
    return [];
  }
}

export function saveLearning(
  lossMemory: LossMemory[],
  winMemory: WinMemory[],
  consecutiveLosses: number,
  consecutiveWins: number,
  adaptiveConfidenceBoost: number
): void {
  try {
    ensureDataDirectory();
    const payload: PersistedLearning = {
      lossMemory,
      winMemory,
      consecutiveLosses,
      consecutiveWins,
      adaptiveConfidenceBoost,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(config.LOSS_MEMORY_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (e: any) {
    console.error("[Persist] Failed to save loss_memory.json:", e.message);
  }
}

export function loadLearning(): Partial<PersistedLearning> | null {
  try {
    if (!fs.existsSync(config.LOSS_MEMORY_FILE)) return null;
    const raw = fs.readFileSync(config.LOSS_MEMORY_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e: any) {
    console.error("[Persist] Failed to load loss_memory.json:", e.message);
    return null;
  }
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const sseClients = new Set<ServerResponse>();

export function registerSSEClient(client: ServerResponse) {
  sseClients.add(client);
  return () => { sseClients.delete(client); };
}

export function pushSSE(event: string, data: unknown): void {
  if (sseClients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}
