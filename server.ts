import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { AssetType, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 5-minute market session window in seconds
const MARKET_SESSION_SECONDS = 300;

// Initialize CLOB Client and Wallet lazily
let clobClient: ClobClient | null = null;
let clobWallet: ethers.Wallet | null = null;
let clobClientInitPromise: Promise<ClobClient | null> | null = null;
const POLYGON_NETWORK = { name: "polygon", chainId: 137 };
const POLYGON_RPC_URLS = (
  process.env.POLYGON_RPC_URLS ||
  [
    "https://1rpc.io/matic",
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.drpc.org",
    "https://polygon-mainnet.public.blastapi.io",
  ].join(",")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const POLYGON_USDC_TOKENS = [
  { symbol: "USDC", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  { symbol: "USDC.e", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
];
const POLYMARKET_SIGNATURE_TYPE = Number(process.env.POLYMARKET_SIGNATURE_TYPE || "0");
const POLYMARKET_FUNDER_ADDRESS = process.env.POLYMARKET_FUNDER_ADDRESS || undefined;

function createPolygonProvider() {
  if (POLYGON_RPC_URLS.length === 0) {
    throw new Error("No Polygon RPC URLs configured. Set POLYGON_RPC_URLS in .env.");
  }

  return new ethers.providers.FallbackProvider(
    POLYGON_RPC_URLS.map(
      (url) =>
        new ethers.providers.StaticJsonRpcProvider(
          { url, timeout: 8000, allowGzip: true },
          POLYGON_NETWORK
        )
    ),
    1
  );
}

async function buildAuthenticatedClobClient(wallet: ethers.Wallet) {
  const rawKey = process.env.POLYMARKET_API_KEY || "";
  const rawSecret = process.env.POLYMARKET_API_SECRET || "";
  const rawPassphrase = process.env.POLYMARKET_API_PASSPHRASE || "";
  const hasEnvCreds = Boolean(rawKey && rawSecret && rawPassphrase);

  if (hasEnvCreds) {
    const envClient = new ClobClient(
      "https://clob.polymarket.com",
      137,
      wallet,
      { key: rawKey, secret: rawSecret, passphrase: rawPassphrase },
      POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
      POLYMARKET_FUNDER_ADDRESS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    try {
      await envClient.getApiKeys();
      return envClient;
    } catch (error: any) {
      console.warn("Configured Polymarket API credentials are invalid. Falling back to derive/create API key.", error?.message || error);
    }
  }

  const bootstrapClient = new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet,
    undefined,
    POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
    POLYMARKET_FUNDER_ADDRESS,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  let derivedCreds;
  try {
    derivedCreds = await bootstrapClient.createApiKey();
  } catch {
    derivedCreds = await bootstrapClient.deriveApiKey();
  }

  return new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet,
    derivedCreds,
    POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
    POLYMARKET_FUNDER_ADDRESS,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
}

async function getClobClient() {
  if (clobClient) return clobClient;
  if (clobClientInitPromise) return clobClientInitPromise;

  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  if (!privateKey) {
    console.warn("POLYGON_PRIVATE_KEY not found in environment. CLOB trading features will be disabled.");
    return null;
  }

  clobClientInitPromise = (async () => {
    const provider = createPolygonProvider();
    clobWallet = new ethers.Wallet(privateKey, provider);
    clobClient = await buildAuthenticatedClobClient(clobWallet);
    return clobClient;
  })()
    .catch((error) => {
      console.error("Failed to initialize CLOB client:", error);
      clobClient = null;
      return null;
    })
    .finally(() => {
      clobClientInitPromise = null;
    });

  return clobClientInitPromise;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  const formatTradeError = (error: any, context?: Record<string, unknown>) => {
    const rawMessage =
      error?.data?.error ||
      error?.errorMsg ||
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to execute trade";
    const message = String(rawMessage);

    if (/allowance|insufficient allowance|not approved/i.test(message)) {
      return {
        error: "Allowance USDC untuk Polymarket belum siap. Lakukan approval/deposit di akun Polymarket dulu.",
        detail: message,
        context,
      };
    }

    if (/insufficient|balance/i.test(message)) {
      return {
        error: "Saldo atau buying power tidak cukup untuk order ini.",
        detail: message,
        context,
      };
    }

    const minSizeMatch = message.match(/Size \(([^)]+)\) lower than the minimum: ([0-9.]+)/i);
    if (minSizeMatch) {
      const attemptedShares = Number(minSizeMatch[1]);
      const minimumShares = Number(minSizeMatch[2]);
      const limitPrice = Number((context?.price as number) || 0);
      const minimumUsdc = limitPrice > 0 ? (minimumShares * limitPrice).toFixed(2) : null;
      return {
        error: minimumUsdc
          ? `Order terlalu kecil. Minimum sekitar ${minimumUsdc} USDC pada limit price ini.`
          : `Order terlalu kecil. Minimum size market ini ${minimumShares} shares.`,
        detail: message,
        context: { ...context, attemptedShares, minimumShares, minimumUsdc },
      };
    }

    if (/funder|profile/i.test(message)) {
      return {
        error: "Funder/Profile address Polymarket belum dikonfigurasi benar.",
        detail: message,
        context,
      };
    }

    if (/api key|signature|auth|unauthorized|forbidden|invalid credentials/i.test(message)) {
      return {
        error: "Autentikasi Polymarket gagal. API key, signature type, atau private key tidak cocok.",
        detail: message,
        context,
      };
    }

    return { error: message, detail: message, context };
  };

  app.use(express.json());

  // API Proxy for Polymarket — BTC Up/Down 5-Minute Events (5 timeframes)
  app.get("/api/polymarket/markets", async (req, res) => {
    try {
      const nowUtcSeconds = Math.floor(Date.now() / 1000);
      const currentStart = Math.floor(nowUtcSeconds / MARKET_SESSION_SECONDS) * MARKET_SESSION_SECONDS;

      // Generate 2 slugs: current window + next upcoming window
      const slugs = Array.from({ length: 2 }, (_, i) => {
        const ts = currentStart + i * MARKET_SESSION_SECONDS;
        return `btc-updown-5m-${ts}`;
      });

      console.log("Fetching slugs:", slugs);

      // Fetch each slug via /events/slug/{slug} in parallel
      const results = await Promise.allSettled(
        slugs.map((slug) =>
          axios.get(`https://gamma-api.polymarket.com/events/slug/${slug}`, { timeout: 8000 })
        )
      );

      // Collect all found events (skip 404s / failures)
      const events = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value.data)
        .filter(Boolean);

      // Gamma API returns outcomes/outcomePrices/clobTokenIds as JSON strings — parse them
      const parseArr = (val: any): any[] => {
        if (Array.isArray(val)) return val;
        if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
        return [];
      };

      // Flatten each event's markets and attach event metadata
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

      console.log(`Fetched ${events.length}/2 events → ${markets.length} markets`);
      res.json(markets);
    } catch (error: any) {
      console.error("Polymarket Events API Error:", error.message);
      res.status(500).json({ error: "Failed to fetch BTC 5-min markets" });
    }
  });

  // API for Polymarket CLOB Order Book (with imbalance signal)
  app.get("/api/polymarket/orderbook/:tokenID", async (req, res) => {
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

      // Compute order book imbalance: totalBidSize / (totalBidSize + totalAskSize)
      const sumSize = (orders: any[]) =>
        (orders || []).reduce((acc: number, o: any) => acc + parseFloat(o.size || "0"), 0);
      const bidSize = sumSize(raw.bids);
      const askSize = sumSize(raw.asks);
      const total = bidSize + askSize;
      const imbalance = total > 0 ? parseFloat((bidSize / total).toFixed(4)) : 0.5;
      const imbalanceSignal = imbalance > 0.65 ? "BUY_PRESSURE"
                            : imbalance < 0.35 ? "SELL_PRESSURE"
                            : "NEUTRAL";

      res.json({ ...raw, imbalance, imbalanceSignal });
    } catch (error: any) {
      console.error("Polymarket CLOB API Error:", error.message);
      res.status(500).json({ error: "Failed to fetch order book" });
    }
  });

  // API for Placing Trades
  app.post("/api/polymarket/trade", async (req, res) => {
    try {
      const { tokenID, amount, side, price } = req.body;
      const client = await getClobClient();

      if (!client) {
        return res.status(400).json({ error: "CLOB client not initialized. Check credentials." });
      }

      if (!price) {
        return res.status(400).json({ error: "Limit price is required." });
      }

      const parsedAmount = Number(amount);
      const parsedPrice = Number(price);
      const parsedSide = String(side || "BUY").toUpperCase() as Side;
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Trade amount must be greater than 0." });
      }
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0 || parsedPrice >= 1) {
        return res.status(400).json({ error: "Limit price must be between 0 and 1." });
      }

      const orderSize = parsedSide === Side.BUY ? parsedAmount / parsedPrice : parsedAmount;
      if (!Number.isFinite(orderSize) || orderSize <= 0) {
        return res.status(400).json({ error: "Computed order size is invalid." });
      }

      const [tickSize, negRisk] = await Promise.all([
        client.getTickSize(tokenID),
        client.getNegRisk(tokenID),
      ]);

      if (parsedSide === Side.BUY) {
        const allowance = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        const allowanceResponse = allowance as any;
        const allowanceValues = [
          allowanceResponse.allowance,
          ...Object.values(allowanceResponse.allowances || {}),
        ].filter(Boolean) as string[];
        const rawAllowance = allowanceValues.reduce((max, current) => {
          if (!max) return current;
          return ethers.BigNumber.from(current).gt(max) ? current : max;
        }, "0");

        const numericBalance = Number(ethers.utils.formatUnits(allowance.balance || "0", 6));
        const numericAllowance = Number(ethers.utils.formatUnits(rawAllowance, 6));
        if (numericBalance < parsedAmount) {
          return res.status(400).json({
            error: `Insufficient Polymarket collateral balance. Available ${numericBalance.toFixed(2)} USDC, requested ${parsedAmount.toFixed(2)} USDC.`,
          });
        }
        if (numericAllowance < parsedAmount) {
          return res.status(400).json({
            error: `Insufficient Polymarket collateral allowance. Approved ${numericAllowance.toFixed(2)} USDC, requested ${parsedAmount.toFixed(2)} USDC.`,
          });
        }
      }

      const order = await client.createAndPostOrder(
        {
          tokenID,
          size: Number(orderSize.toFixed(6)),
          side: parsedSide,
          price: parsedPrice,
        },
        { tickSize, negRisk },
        OrderType.GTC
      );

      if (order?.success === false) {
        return res.status(400).json(formatTradeError(order, { tickSize, negRisk }));
      }

      res.json({
        success: true,
        orderID: order?.orderID || order?.id || null,
        status: order?.status || "PENDING",
        tickSize,
        negRisk,
        orderSize: Number(orderSize.toFixed(6)),
        spendingAmount: parsedAmount,
        raw: order,
      });
    } catch (error: any) {
      console.error("Trade Execution Error:", error);
      res.status(500).json(formatTradeError(error, req.body));
    }
  });

  app.get("/api/polymarket/order/:orderID", async (req, res) => {
    try {
      const { orderID } = req.params;
      const client = await getClobClient();
      if (!client) {
        return res.status(400).json({ error: "CLOB client not initialized. Check credentials." });
      }

      const order = await client.getOrder(orderID);
      const originalSize = Number(order.original_size || "0");
      const matchedSize = Number(order.size_matched || "0");
      const remainingSize = Math.max(0, originalSize - matchedSize);
      const fillPercent = originalSize > 0 ? (matchedSize / originalSize) * 100 : 0;
      const normalizedStatus = String(order.status || "UNKNOWN").toUpperCase();
      const positionState =
        normalizedStatus === "MATCHED" || fillPercent >= 100
          ? "FILLED"
          : matchedSize > 0
            ? "PARTIALLY_FILLED"
            : normalizedStatus === "LIVE"
              ? "OPEN"
              : normalizedStatus;

      res.json({
        orderID,
        status: normalizedStatus,
        positionState,
        outcome: order.outcome,
        side: order.side,
        market: order.market,
        assetId: order.asset_id,
        price: order.price,
        originalSize: order.original_size,
        matchedSize: order.size_matched,
        remainingSize: remainingSize.toFixed(4),
        fillPercent: fillPercent.toFixed(2),
        createdAt: order.created_at,
        expiration: order.expiration,
        raw: order,
      });
    } catch (error: any) {
      console.error("Order Lookup Error:", error);
      res.status(500).json(formatTradeError(error, { orderID: req.params.orderID }));
    }
  });

  app.get("/api/polymarket/performance", async (_req, res) => {
    try {
      const client = await getClobClient();
      if (!client) {
        return res.status(400).json({ error: "CLOB client not initialized. Check credentials." });
      }

      const trades = await client.getTrades();
      const sortedTrades = [...trades].sort(
        (a, b) => new Date(b.match_time).getTime() - new Date(a.match_time).getTime()
      );

      const inventory = new Map<string, { qty: number; cost: number; outcome: string; market: string }>();
      let realizedPnl = 0;
      let winCount = 0;
      let lossCount = 0;

      const history = sortedTrades.map((trade) => {
        const qty = Number(trade.size || "0");
        const price = Number(trade.price || "0");
        const notional = qty * price;
        const key = trade.asset_id;
        const current = inventory.get(key) || { qty: 0, cost: 0, outcome: trade.outcome, market: trade.market };
        let tradePnl = 0;

        if (trade.side === Side.BUY) {
          current.qty += qty;
          current.cost += notional;
          inventory.set(key, current);
        } else {
          const avgCost = current.qty > 0 ? current.cost / current.qty : 0;
          const matchedQty = Math.min(qty, current.qty);
          tradePnl = (price - avgCost) * matchedQty;
          realizedPnl += tradePnl;

          if (matchedQty > 0) {
            if (tradePnl > 0) winCount += 1;
            else if (tradePnl < 0) lossCount += 1;
          }

          current.qty = Math.max(0, current.qty - qty);
          current.cost = Math.max(0, current.cost - avgCost * qty);
          inventory.set(key, current);
        }

        return {
          id: trade.id,
          market: trade.market,
          outcome: trade.outcome,
          side: trade.side,
          traderSide: trade.trader_side,
          status: trade.status,
          size: qty.toFixed(4),
          price: price.toFixed(4),
          notional: notional.toFixed(4),
          pnl: tradePnl.toFixed(4),
          matchTime: trade.match_time,
          transactionHash: trade.transaction_hash,
          assetId: trade.asset_id,
        };
      });

      const openPositions = Array.from(inventory.entries())
        .filter(([, position]) => position.qty > 0)
        .map(([assetId, position]) => ({
          assetId,
          market: position.market,
          outcome: position.outcome,
          size: position.qty.toFixed(4),
          costBasis: position.cost.toFixed(4),
          averagePrice: position.qty > 0 ? (position.cost / position.qty).toFixed(4) : "0.0000",
        }));

      const closedTrades = winCount + lossCount;
      const winRate = closedTrades > 0 ? (winCount / closedTrades) * 100 : 0;
      const openExposure = openPositions.reduce((sum, position) => sum + Number(position.costBasis), 0);

      res.json({
        summary: {
          totalMatchedTrades: history.length,
          closedTrades,
          winCount,
          lossCount,
          winRate: winRate.toFixed(2),
          realizedPnl: realizedPnl.toFixed(4),
          openExposure: openExposure.toFixed(4),
        },
        history,
        openPositions,
      });
    } catch (error: any) {
      console.error("Performance Lookup Error:", error);
      res.status(500).json(formatTradeError(error));
    }
  });

  // API for Fetching Balance
  app.get("/api/polymarket/balance", async (req, res) => {
    try {
      const client = await getClobClient(); // Ensure wallet is initialized
      if (!clobWallet) return res.status(400).json({ error: "Wallet not initialized. Set POLYGON_PRIVATE_KEY in .env" });

      const walletAddress = clobWallet.address;
      const funderAddress = POLYMARKET_FUNDER_ADDRESS || null;
      const tradingAddress = funderAddress || walletAddress;

      // Try both Polygon USDC contracts because wallets can still hold bridged USDC.e.
      const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

      let onChainBalance = "0.00";
      let tokenAddressUsed = POLYGON_USDC_TOKENS[0].address;
      let tokenSymbolUsed = POLYGON_USDC_TOKENS[0].symbol;
      try {
        for (const token of POLYGON_USDC_TOKENS) {
          const usdc = new ethers.Contract(token.address, ERC20_ABI, clobWallet.provider);
          const raw: ethers.BigNumber = await usdc.balanceOf(walletAddress);
          const formatted = Number(ethers.utils.formatUnits(raw, 6));
          if (formatted > 0 || onChainBalance === "0.00") {
            onChainBalance = formatted.toFixed(2);
            tokenAddressUsed = token.address;
            tokenSymbolUsed = token.symbol;
          }
        }
      } catch (err: any) {
        console.warn("Could not fetch USDC balance:", err.message);
      }

      let polymarketBalance = onChainBalance;
      let polymarketRawBalance = null;
      try {
        if (client) {
          const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
          polymarketRawBalance = collateral.balance || "0";
          polymarketBalance = Number(ethers.utils.formatUnits(collateral.balance || "0", 6)).toFixed(2);
        }
      } catch (err: any) {
        console.warn("Could not fetch Polymarket collateral balance:", err.message);
      }

      res.json({
        address: tradingAddress,
        walletAddress,
        funderAddress,
        tradingAddress,
        balance: polymarketBalance,
        polymarketBalance,
        polymarketRawBalance,
        onChainBalance,
        tokenAddressUsed,
        tokenSymbolUsed,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // API for Polymarket Market Price History (CLOB endpoint)
  app.get("/api/polymarket/history/:marketID", async (req, res) => {
    const { marketID } = req.params;
    console.log(`[history] Fetching price history for token: ${marketID}`);
    try {
      const response = await axios.get(`https://clob.polymarket.com/prices-history`, {
        params: { market: marketID, interval: "1m", fidelity: 10 },
        timeout: 8000,
      });
      const history = Array.isArray(response.data)
        ? response.data
        : response.data?.history ?? [];
      console.log(`[history] Got ${history.length} data points for ${marketID}`);
      res.json(history);
    } catch (error: any) {
      const status = error.response?.status;
      const body = error.response?.data;
      console.log(`[history] CLOB returned ${status} for token ${marketID}:`, JSON.stringify(body));
      // Any CLOB error (400, 404, 422, 500…) — return empty array so UI doesn't break
      return res.json([]);
    }
  });

  // Proxy for BTC Price (Binance with CoinGecko fallback)
  app.get("/api/btc-price", async (req, res) => {
    // Try Binance first, fall back to CoinGecko if geo-blocked
    const binanceHosts = [
      "https://api.binance.com",
      "https://api1.binance.com",
      "https://api2.binance.com",
    ];
    for (const host of binanceHosts) {
      try {
        const response = await axios.get(`${host}/api/v3/ticker/price`, {
          params: { symbol: "BTCUSDT" },
          timeout: 5000,
        });
        return res.json(response.data);
      } catch {
        // try next host
      }
    }
    try {
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price",
        { params: { ids: "bitcoin", vs_currencies: "usd" }, timeout: 8000 }
      );
      const price = response.data.bitcoin.usd.toString();
      return res.json({ symbol: "BTCUSDT", price });
    } catch (error: any) {
      console.error("BTC price fetch failed (all sources):", error.message);
      res.status(500).json({ error: "Failed to fetch BTC price" });
    }
  });

  // Proxy for BTC Historical Data — 1m candles, last 60 (for chart + indicators)
  app.get("/api/btc-history", async (req, res) => {
    const binanceHosts = [
      "https://api.binance.com",
      "https://api1.binance.com",
      "https://api2.binance.com",
    ];
    for (const host of binanceHosts) {
      try {
        const response = await axios.get(`${host}/api/v3/klines`, {
          params: { symbol: "BTCUSDT", interval: "1m", limit: 60 },
          timeout: 5000,
        });
        const history = response.data.map((k: any) => ({
          time: Math.floor(k[0] / 1000), // seconds for lightweight-charts
          open:  parseFloat(k[1]),
          high:  parseFloat(k[2]),
          low:   parseFloat(k[3]),
          close: parseFloat(k[4]),
          price: parseFloat(k[4]),       // keep for backward compat
          volume: parseFloat(k[5]),
        }));
        return res.json(history);
      } catch {
        // try next host
      }
    }
    // CoinGecko OHLC fallback (returns 30m candles for 1-day window)
    try {
      console.warn("[btc-history] Binance blocked, falling back to CoinGecko OHLC");
      const response = await axios.get("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc", {
        params: { vs_currency: "usd", days: 1 },
        timeout: 10000,
      });
      // CoinGecko returns [[timestamp_ms, open, high, low, close], ...]
      const history = response.data.slice(-60).map((k: number[]) => ({
        time: Math.floor(k[0] / 1000),
        open: k[1], high: k[2], low: k[3], close: k[4],
        price: k[4],
        volume: 0,
      }));
      return res.json(history);
    } catch (err: any) {
      console.error("[btc-history] CoinGecko fallback failed:", err.message);
    }
    res.status(500).json({ error: "Failed to fetch BTC history" });
  });

  // BTC Technical Indicators — RSI(14), EMA(9), EMA(21), volume spike
  app.get("/api/btc-indicators", async (_req, res) => {
    const binanceHosts = [
      "https://api.binance.com",
      "https://api1.binance.com",
      "https://api2.binance.com",
    ];

    let klines: any[] = [];
    for (const host of binanceHosts) {
      try {
        const response = await axios.get(`${host}/api/v3/klines`, {
          params: { symbol: "BTCUSDT", interval: "1m", limit: 60 },
          timeout: 5000,
        });
        klines = response.data;
        break;
      } catch { /* try next */ }
    }
    if (!klines.length) {
      // CoinGecko OHLC fallback
      try {
        console.warn("[indicators] Binance blocked, falling back to CoinGecko OHLC");
        const response = await axios.get("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc", {
          params: { vs_currency: "usd", days: 1 },
          timeout: 10000,
        });
        // Map to Binance kline format: [ts, open, high, low, close, volume]
        klines = response.data.slice(-60).map((k: number[]) => [k[0], k[1], k[2], k[3], k[4], 0]);
      } catch (err: any) {
        console.error("[indicators] CoinGecko fallback failed:", err.message);
        return res.status(500).json({ error: "Failed to fetch klines for indicators" });
      }
    }

    try {
      const closes = klines.map((k: any) => parseFloat(k[4]));
      const volumes = klines.map((k: any) => parseFloat(k[5]));

      // EMA helper
      const calcEma = (data: number[], period: number): number => {
        const k = 2 / (period + 1);
        let result = data[0];
        for (let i = 1; i < data.length; i++) result = data[i] * k + result * (1 - k);
        return result;
      };

      // RSI(14) — need at least 15 candles
      const rsiPeriod = 14;
      let gains = 0, losses = 0;
      const start = Math.max(1, closes.length - rsiPeriod);
      for (let i = start; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
      }
      const count = closes.length - start;
      const avgGain = count > 0 ? gains / count : 0;
      const avgLoss = count > 0 ? losses / count : 0;
      const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

      const ema9  = calcEma(closes, 9);
      const ema21 = calcEma(closes, 21);

      const last3 = klines.slice(-3).map((k: any) => ({
        open:  parseFloat(k[1]),
        high:  parseFloat(k[2]),
        low:   parseFloat(k[3]),
        close: parseFloat(k[4]),
        direction: parseFloat(k[4]) >= parseFloat(k[1]) ? "UP" : "DOWN",
      }));

      const avgVol = volumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const lastVol = volumes[volumes.length - 1];
      const volumeSpike = avgVol > 0 ? lastVol / avgVol : 1;

      const trend = last3.every(c => c.direction === "UP") ? "STRONG_UP"
                  : last3.every(c => c.direction === "DOWN") ? "STRONG_DOWN"
                  : "MIXED";

      res.json({
        rsi: parseFloat(rsi.toFixed(2)),
        ema9: parseFloat(ema9.toFixed(2)),
        ema21: parseFloat(ema21.toFixed(2)),
        emaCross: ema9 > ema21 ? "BULLISH" : "BEARISH",
        volumeSpike: parseFloat(volumeSpike.toFixed(2)),
        last3Candles: last3,
        trend,
        currentPrice: closes[closes.length - 1],
      });
    } catch (err: any) {
      console.error("[indicators] Computation error:", err.message);
      res.status(500).json({ error: "Failed to compute indicators", detail: err.message });
    }
  });

  // Proxy for Crypto Sentiment (Fear & Greed Index)
  app.get("/api/sentiment", async (req, res) => {
    try {
      const response = await axios.get("https://api.alternative.me/fng/");
      res.json(response.data.data[0]);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch sentiment data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
