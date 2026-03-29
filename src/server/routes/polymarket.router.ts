import express from "express";
import axios from "axios";
import { ethers } from "ethers";
import { AssetType, Side } from "@polymarket/clob-client";
import { config } from "../config/index.js";
import { getClobClient, getClobWallet, formatTradeError, executePolymarketTrade } from "../services/polymarket.service.js";
import { getPositionAutomationCollection, savePositionAutomation, recommendAutomationLevels } from "../services/automation.service.js";

const router = express.Router();

// Helper to resolve trading address
const getTradingAddress = async (): Promise<string | null> => {
  if (config.POLYMARKET_FUNDER_ADDRESS) return config.POLYMARKET_FUNDER_ADDRESS;
  await getClobClient();
  const wallet = getClobWallet();
  return wallet?.address ?? null;
};

// Markets
router.get("/api/polymarket/markets", async (req, res) => {
  try {
    const nowUtcSeconds = Math.floor(Date.now() / 1000);
    const currentStart = Math.floor(nowUtcSeconds / config.MARKET_SESSION_SECONDS) * config.MARKET_SESSION_SECONDS;
    const slugs = Array.from({ length: 2 }, (_, i) => `btc-updown-5m-${currentStart + i * config.MARKET_SESSION_SECONDS}`);

    const results = await Promise.allSettled(
      slugs.map((slug) => axios.get(`https://gamma-api.polymarket.com/events/slug/${slug}`, { timeout: 8000 }))
    );

    const events = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value.data)
      .filter(Boolean);

    const parseArr = (val: any): any[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
      return [];
    };

    const markets = events.flatMap((event: any) =>
      (event.markets || []).map((m: any) => ({
        ...m,
        outcomes: parseArr(m.outcomes),
        outcomePrices: parseArr(m.outcomePrices),
        clobTokenIds: parseArr(m.clobTokenIds),
        eventSlug: event.slug,
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
      }))
    );

    res.json(markets);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch BTC 5-min markets" });
  }
});

// Orderbook
router.get("/api/polymarket/orderbook/:tokenID", async (req, res) => {
  try {
    const { tokenID } = req.params;
    const client = await getClobClient();

    let raw: any;
    if (!client) {
      const response = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenID}`, { timeout: 6000 });
      raw = response.data;
    } else {
      raw = await client.getOrderBook(tokenID);
    }

    const sumSize = (orders: any[]) => (orders || []).reduce((acc: number, o: any) => acc + parseFloat(o.size || "0"), 0);
    const sumNotional = (orders: any[]) => (orders || []).reduce((acc: number, o: any) => acc + parseFloat(o.size || "0") * parseFloat(o.price || "0"), 0);
    const bidSize = sumSize(raw.bids);
    const askSize = sumSize(raw.asks);
    const total = bidSize + askSize;
    const imbalance = total > 0 ? parseFloat((bidSize / total).toFixed(4)) : 0.5;
    const imbalanceSignal = imbalance > 0.60 ? "BUY_PRESSURE" : imbalance < 0.40 ? "SELL_PRESSURE" : "NEUTRAL";
    const totalLiquidityUsdc = parseFloat((sumNotional(raw.bids) + sumNotional(raw.asks)).toFixed(2));

    res.json({ ...raw, imbalance, imbalanceSignal, totalLiquidityUsdc });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch order book" });
  }
});

// Trade execution
router.post("/api/polymarket/trade", async (req, res) => {
  try {
    const { tokenID, amount, side, price, executionMode, amountMode } = req.body;
    if (!price && String(executionMode || "MANUAL").toUpperCase() === "MANUAL") {
      return res.status(400).json({ error: "Limit price is required." });
    }
    const result = await executePolymarketTrade({
      tokenID,
      amount,
      side: String(side || "BUY").toUpperCase() as Side,
      price,
      executionMode: String(executionMode || "MANUAL").toUpperCase() as "MANUAL" | "PASSIVE" | "AGGRESSIVE",
      amountMode,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json(formatTradeError(error, req.body));
  }
});

// Reprice
router.post("/api/polymarket/order/reprice", async (req, res) => {
  try {
    const { orderID, executionMode = "AGGRESSIVE" } = req.body || {};
    if (!orderID) return res.status(400).json({ error: "orderID is required." });

    const client = await getClobClient();
    if (!client) return res.status(400).json({ error: "CLOB client not initialized." });

    const order = await client.getOrder(orderID);
    const originalSize = Number(order.original_size || "0");
    const matchedSize = Number(order.size_matched || "0");
    const remainingSize = Math.max(0, originalSize - matchedSize);
    if (!(remainingSize > 0)) return res.status(400).json({ error: "No remaining size left to reprice." });

    const status = String(order.status || "").toUpperCase();
    if (status === "LIVE" || status === "OPEN") await client.cancelOrder({ orderID });

    const repriced = await executePolymarketTrade({
      tokenID: order.asset_id,
      amount: remainingSize,
      side: String(order.side || "BUY").toUpperCase() as Side,
      price: Number(order.price || "0"),
      executionMode: String(executionMode || "AGGRESSIVE").toUpperCase() as "MANUAL" | "PASSIVE" | "AGGRESSIVE",
      amountMode: "SIZE",
    });

    res.json({ success: true, cancelledOrderID: orderID, replacement: repriced, remainingSize: remainingSize.toFixed(6) });
  } catch (error: any) {
    res.status(500).json(formatTradeError(error, req.body));
  }
});

// Order lookup
router.get("/api/polymarket/order/:orderID", async (req, res) => {
  try {
    const { orderID } = req.params;
    const client = await getClobClient();
    if (!client) return res.status(400).json({ error: "CLOB client not initialized." });

    const order = await client.getOrder(orderID);
    const originalSize = Number(order.original_size || "0");
    const matchedSize = Number(order.size_matched || "0");
    const remainingSize = Math.max(0, originalSize - matchedSize);
    const fillPercent = originalSize > 0 ? (matchedSize / originalSize) * 100 : 0;
    const normalizedStatus = String(order.status || "UNKNOWN").toUpperCase();
    const positionState =
      normalizedStatus === "MATCHED" || fillPercent >= 100 ? "FILLED"
        : matchedSize > 0 ? "PARTIALLY_FILLED"
          : normalizedStatus === "LIVE" ? "OPEN" : normalizedStatus;

    res.json({
      orderID, status: normalizedStatus, positionState, outcome: order.outcome, side: order.side, market: order.market,
      assetId: order.asset_id, price: order.price, originalSize: order.original_size, matchedSize: order.size_matched,
      remainingSize: remainingSize.toFixed(4), fillPercent: fillPercent.toFixed(2), createdAt: order.created_at, expiration: order.expiration, raw: order,
    });
  } catch (error: any) {
    res.status(500).json(formatTradeError(error, { orderID: req.params.orderID }));
  }
});

// Automations
router.get("/api/polymarket/automation", async (req, res) => {
  try {
    const collection = await getPositionAutomationCollection();
    if (!collection) return res.json({ automations: [] });
    const automations = await collection.find({}).sort({ updatedAt: -1 }).toArray();
    res.json({ automations });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch position automation", detail: error?.message || String(error) });
  }
});

router.post("/api/polymarket/automation", async (req, res) => {
  try {
    const { assetId, market, outcome, averagePrice, size, takeProfit, stopLoss, trailingStop, armed } = req.body || {};
    if (!assetId) return res.status(400).json({ error: "assetId is required." });

    const saved = await savePositionAutomation({
      assetId, market, outcome, averagePrice, size, takeProfit: takeProfit ?? "", stopLoss: stopLoss ?? "", trailingStop: trailingStop ?? "",
      armed: Boolean(armed), status: armed ? "Armed on backend" : "Disarmed",
    });

    res.json({ success: true, automation: saved });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to save position automation", detail: error?.message || String(error) });
  }
});

router.post("/api/polymarket/automation/recommend", (req, res) => {
  try {
    const averagePrice = Number(req.body?.averagePrice || "0");
    if (!(averagePrice > 0 && averagePrice < 1)) return res.status(400).json({ error: "averagePrice must be between 0 and 1." });
    res.json(recommendAutomationLevels(averagePrice));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to recommend automation levels", detail: error?.message || String(error) });
  }
});

// Balance
router.get("/api/polymarket/balance", async (req, res) => {
  try {
    const client = await getClobClient();
    const wallet = getClobWallet();
    if (!wallet) return res.status(400).json({ error: "Wallet not initialized." });

    const walletAddress = wallet.address;
    const funderAddress = config.POLYMARKET_FUNDER_ADDRESS || null;
    const tradingAddress = funderAddress || walletAddress;

    const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];
    let onChainBalance = "0.00";
    let tokenAddressUsed = config.POLYGON_USDC_TOKENS[0].address;
    let tokenSymbolUsed = config.POLYGON_USDC_TOKENS[0].symbol;

    for (const token of config.POLYGON_USDC_TOKENS) {
      try {
        const usdc = new ethers.Contract(token.address, ERC20_ABI, wallet.provider);
        const raw: ethers.BigNumber = await usdc.balanceOf(walletAddress);
        const formatted = Number(ethers.utils.formatUnits(raw, 6));
        if (formatted > 0 || onChainBalance === "0.00") {
          onChainBalance = formatted.toFixed(2);
          tokenAddressUsed = token.address;
          tokenSymbolUsed = token.symbol;
        }
      } catch {}
    }

    let polymarketBalance = onChainBalance;
    let polymarketRawBalance = null;
    if (client) {
      try {
        const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        polymarketRawBalance = collateral.balance || "0";
        polymarketBalance = Number(ethers.utils.formatUnits(collateral.balance || "0", 6)).toFixed(2);
      } catch {}
    }

    res.json({ address: tradingAddress, walletAddress, funderAddress, tradingAddress, balance: polymarketBalance, polymarketBalance, polymarketRawBalance, onChainBalance, tokenAddressUsed, tokenSymbolUsed });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// Performance
router.get("/api/polymarket/performance", async (req, res) => {
  try {
    const userAddress = await getTradingAddress();
    if (!userAddress) return res.status(400).json({ error: "Wallet not initialized." });

    const [openRes, closedRes] = await Promise.allSettled([
      axios.get("https://data-api.polymarket.com/positions", { params: { user: userAddress, limit: 500, sizeThreshold: 0 }, timeout: 10000 }),
      axios.get("https://data-api.polymarket.com/closed-positions", { params: { user: userAddress, limit: 50, sortBy: "TIMESTAMP", sortDirection: "DESC" }, timeout: 10000 }),
    ]);

    const openPositionsRaw: any[] = openRes.status === "fulfilled" ? (openRes.value.data ?? []) : [];
    const closedPositionsRaw: any[] = closedRes.status === "fulfilled" ? (closedRes.value.data ?? []) : [];

    const winCount = closedPositionsRaw.filter((p) => p.realizedPnl > 0).length;
    const lossCount = closedPositionsRaw.filter((p) => p.realizedPnl < 0).length;
    const closedTrades = closedPositionsRaw.length;
    const winRate = closedTrades > 0 ? (winCount / closedTrades) * 100 : 0;
    const realizedPnl = closedPositionsRaw.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);
    const openExposure = openPositionsRaw.reduce((sum, p) => sum + (p.currentValue ?? p.initialValue ?? 0), 0);

    const openPositions = openPositionsRaw.map((p) => ({
      assetId: p.asset, market: p.title, outcome: p.outcome, size: Number(p.size ?? 0).toFixed(4), costBasis: Number(p.initialValue ?? 0).toFixed(4),
      averagePrice: Number(p.avgPrice ?? 0).toFixed(4), currentValue: Number(p.currentValue ?? 0).toFixed(4), cashPnl: Number(p.cashPnl ?? 0).toFixed(4),
      percentPnl: Number(p.percentPnl ?? 0).toFixed(2), curPrice: Number(p.curPrice ?? 0).toFixed(4), redeemable: p.redeemable ?? false,
    }));

    res.json({
      summary: { totalMatchedTrades: closedTrades, closedTrades, winCount, lossCount, winRate: winRate.toFixed(2), realizedPnl: realizedPnl.toFixed(4), openExposure: openExposure.toFixed(4) },
      openPositions,
      closedPositions: closedPositionsRaw.map((p) => ({
        assetId: p.asset, market: p.title, outcome: p.outcome, avgPrice: Number(p.avgPrice ?? 0).toFixed(4), totalBought: Number(p.totalBought ?? 0).toFixed(4),
        realizedPnl: Number(p.realizedPnl ?? 0).toFixed(4), curPrice: Number(p.curPrice ?? 0).toFixed(4), timestamp: p.timestamp, endDate: p.endDate, eventSlug: p.eventSlug,
      })),
      history: [], user: userAddress,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch performance", detail: error.message });
  }
});

// Price history
router.get("/api/polymarket/history/:marketID", async (req, res) => {
  const { marketID } = req.params;
  try {
    const response = await axios.get(`https://clob.polymarket.com/prices-history`, { params: { market: marketID, interval: "1m", fidelity: 10 }, timeout: 8000 });
    const history = Array.isArray(response.data) ? response.data : response.data?.history ?? [];
    res.json(history);
  } catch (error: any) {
    return res.json([]);
  }
});

export default router;