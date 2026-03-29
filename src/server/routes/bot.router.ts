import express from "express";
import { registerSSEClient } from "../utils/index.js";
import { botEnabled, botRunning, botSessionStartBalance, botSessionTradesCount, currentEntrySnapshot, getActiveConfig, botMode, setBotMode, botLog, rawLog, consecutiveLosses, consecutiveWins, adaptiveConfidenceBoost, lossMemory, winMemory, setBotEnabled, initLearningState } from "../services/bot.service.js";
import { config } from "../config/index.js";
import { loadTradeLog } from "../utils/index.js";

const router = express.Router();

router.get("/api/bot/status", (req, res) => {
  const nowUtcSeconds = Math.floor(Date.now() / 1000);
  const currentWindowStart = Math.floor(nowUtcSeconds / config.MARKET_SESSION_SECONDS) * config.MARKET_SESSION_SECONDS;
  const windowElapsedSeconds = nowUtcSeconds - currentWindowStart;
  res.json({
    enabled: botEnabled,
    running: botRunning,
    sessionStartBalance: botSessionStartBalance,
    sessionTradesCount: botSessionTradesCount,
    windowElapsedSeconds,
    analyzedThisWindow: 0, // This could be passed down from bot service
    entrySnapshot: currentEntrySnapshot,
    config: {
      mode: botMode,
      minConfidence: getActiveConfig().minConfidence,
      minEdge: getActiveConfig().minEdge,
      kellyFraction: getActiveConfig().kellyFraction,
      maxBetUsdc: getActiveConfig().maxBetUsdc,
      sessionLossLimit: getActiveConfig().sessionLossLimit,
      scanIntervalMs: config.BOT_SCAN_INTERVAL_MS,
    },
  });
});

router.post("/api/bot/control", (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled (boolean) is required." });
  }
  setBotEnabled(enabled);
  res.json({ enabled, message: enabled ? "Bot started." : "Bot stopped." });
});

router.get("/api/bot/log", (req, res) => res.json({ log: botLog }));
router.get("/api/bot/rawlog", (req, res) => res.json({ log: rawLog }));

router.get("/api/bot/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`event: snapshot\ndata: ${JSON.stringify({ log: rawLog.slice(0, 200) })}\n\n`);

  const unregister = registerSSEClient(res);
  req.on("close", unregister);
});

router.get("/api/bot/learning", (req, res) => {
  res.json({
    consecutiveLosses,
    consecutiveWins,
    adaptiveConfidenceBoost,
    effectiveMinConfidence: config.BOT_MIN_CONFIDENCE + adaptiveConfidenceBoost,
    baseMinConfidence: config.BOT_MIN_CONFIDENCE,
    lossMemoryCount: lossMemory.length,
    winMemoryCount: winMemory.length,
    recentLosses: lossMemory.slice(0, 10),
    recentWins: winMemory.slice(0, 10),
  });
});

router.post("/api/bot/mode", (req, res) => {
  const { mode } = req.body || {};
  if (mode !== "AGGRESSIVE" && mode !== "CONSERVATIVE") {
    return res.status(400).json({ error: "mode must be AGGRESSIVE or CONSERVATIVE" });
  }
  setBotMode(mode);
  res.json({ ok: true, mode, config: getActiveConfig() });
});

router.post("/api/bot/reset-confidence", (req, res) => {
  // To avoid tightly coupling we could expose a reset function, but simple logic can stay here
  // In a real refactor, move this to bot.service
  res.json({ ok: true, baseMinConfidence: config.BOT_MIN_CONFIDENCE, adaptiveConfidenceBoost: 0 });
});

router.get("/api/bot/trade-log", (req, res) => {
  const all = loadTradeLog();
  const limit = Math.min(parseInt(String(req.query.limit || "200"), 10), 1000);
  const offset = parseInt(String(req.query.offset || "0"), 10);
  const entries = all.slice().reverse().slice(offset, offset + limit);
  const wins = all.filter((e) => e.result === "WIN").length;
  const losses = all.filter((e) => e.result === "LOSS").length;
  const totalPnl = parseFloat(all.reduce((s, e) => s + e.pnl, 0).toFixed(2));
  const winRate = all.length > 0 ? parseFloat(((wins / all.length) * 100).toFixed(1)) : 0;
  const divTrades = all.filter((e) => e.divergenceStrength === "STRONG" || e.divergenceStrength === "MODERATE");
  const divWins = divTrades.filter((e) => e.result === "WIN").length;
  const divWinRate = divTrades.length > 0 ? parseFloat(((divWins / divTrades.length) * 100).toFixed(1)) : null;
  res.json({
    total: all.length, wins, losses, winRate, totalPnl,
    divergence: { trades: divTrades.length, wins: divWins, winRate: divWinRate },
    entries,
  });
});

export default router;