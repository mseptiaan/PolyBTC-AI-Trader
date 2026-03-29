import express from "express";
import { getBtcPrice, getBtcHistory, getBtcIndicators, getBtcCacheMeta } from "../services/btc.service.js";
import { getCacheMeta } from "../db/index.js";

const router = express.Router();

router.get("/api/debug/btc-cache", async (req, res) => {
  try {
    const debug = getBtcCacheMeta();
    res.json(debug);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to inspect BTC cache", detail: error?.message || String(error) });
  }
});

router.get("/api/btc-price", async (req, res) => {
  try {
    const price = await getBtcPrice();
    if (!price) {
      return res.status(500).json({ error: "Failed to fetch BTC price" });
    }
    const meta = getBtcCacheMeta();
    return res.json({
      ...price,
      freshness: meta.btcPrice,
    });
  } catch (error: any) {
    console.error("BTC price fetch failed:", error.message);
    res.status(500).json({ error: "Failed to fetch BTC price" });
  }
});

router.get("/api/btc-history", async (req, res) => {
  try {
    const historyResult = await getBtcHistory();
    if (!historyResult?.history?.length) {
      return res.status(500).json({ error: "Failed to fetch BTC history" });
    }
    res.setHeader("X-BTC-Source", historyResult.source);
    const meta = getBtcCacheMeta();
    res.setHeader("X-BTC-Cache-Stale", String(Boolean(meta.btcHistory?.stale)));
    return res.json(historyResult.history);
  } catch (err: any) {
    console.error("[btc-history] all sources failed:", err.message);
  }
  res.status(500).json({ error: "Failed to fetch BTC history" });
});

router.get("/api/btc-indicators", async (req, res) => {
  try {
    const indicators = await getBtcIndicators();
    if (!indicators) {
      return res.status(500).json({ error: "Failed to fetch klines for indicators" });
    }
    const meta = getBtcCacheMeta();
    res.json({
      ...indicators,
      freshness: meta.btcIndicators,
    });
  } catch (err: any) {
    console.error("[indicators] Computation error:", err.message);
    res.status(500).json({ error: "Failed to compute indicators", detail: err.message });
  }
});

export default router;