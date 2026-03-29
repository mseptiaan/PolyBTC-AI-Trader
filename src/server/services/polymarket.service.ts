import { ethers } from "ethers";
import { AssetType, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { config } from "../config/index.js";
import { getPaperBalanceCollection, getPaperPositionsCollection } from "../db/index.js";
import axios from "axios";

let clobClient: ClobClient | null = null;
let clobWallet: ethers.Wallet | null = null;
let clobClientInitPromise: Promise<ClobClient | null> | null = null;

export function getClobWallet() {
  return clobWallet;
}

function createPolygonProvider() {
  if (config.POLYGON_RPC_URLS.length === 0) {
    throw new Error("No Polygon RPC URLs configured. Set POLYGON_RPC_URLS in .env.");
  }

  return new ethers.providers.FallbackProvider(
    config.POLYGON_RPC_URLS.map(
      (url) =>
        new ethers.providers.StaticJsonRpcProvider(
          { url, timeout: 8000, allowGzip: true },
          config.POLYGON_NETWORK
        )
    ),
    1
  );
}

async function buildAuthenticatedClobClient(wallet: ethers.Wallet) {
  const hasEnvCreds = Boolean(config.POLYMARKET_API_KEY && config.POLYMARKET_API_SECRET && config.POLYMARKET_API_PASSPHRASE);

  if (hasEnvCreds) {
    const envClient = new ClobClient(
      "https://clob.polymarket.com",
      137,
      wallet,
      { key: config.POLYMARKET_API_KEY, secret: config.POLYMARKET_API_SECRET, passphrase: config.POLYMARKET_API_PASSPHRASE },
      config.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
      config.POLYMARKET_FUNDER_ADDRESS,
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
    config.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
    config.POLYMARKET_FUNDER_ADDRESS,
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
    config.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
    config.POLYMARKET_FUNDER_ADDRESS,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
}

export async function getClobClient() {
  if (clobClient) return clobClient;
  if (clobClientInitPromise) return clobClientInitPromise;

  if (!config.POLYGON_PRIVATE_KEY) {
    console.warn("POLYGON_PRIVATE_KEY not found in environment. CLOB trading features will be disabled.");
    return null;
  }

  clobClientInitPromise = (async () => {
    const provider = createPolygonProvider();
    clobWallet = new ethers.Wallet(config.POLYGON_PRIVATE_KEY, provider);
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

export const formatTradeError = (error: any, context?: Record<string, unknown>) => {
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

export async function executePolymarketTrade({
  tokenID,
  amount,
  side,
  price,
  executionMode = "MANUAL",
  amountMode,
}: {
  tokenID: string;
  amount: number | string;
  side: Side;
  price?: number | string;
  executionMode?: "MANUAL" | "PASSIVE" | "AGGRESSIVE";
  amountMode?: "SPEND" | "SIZE";
}) {
  let client: ClobClient | null = null;
  if (!config.PAPER_TRADING_ENABLED) {
    client = await getClobClient();
    if (!client) {
      throw new Error("CLOB client not initialized. Check credentials.");
    }
  }

  const parsedAmount = Number(amount);
  const parsedSide = String(side || "BUY").toUpperCase() as Side;
  const normalizedMode = String(executionMode || "MANUAL").toUpperCase() as "MANUAL" | "PASSIVE" | "AGGRESSIVE";
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error("Trade amount must be greater than 0.");
  }

  let orderbook: any;
  if (client) {
    orderbook = await client.getOrderBook(tokenID);
  } else {
    try {
      const response = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenID}`, { timeout: 6000 });
      orderbook = response.data;
    } catch (e) {
      throw new Error("Failed to fetch orderbook for paper trading.");
    }
  }

  const bestBid = Number(orderbook?.bids?.[0]?.price || "0");
  const bestAsk = Number(orderbook?.asks?.[0]?.price || "0");

  let parsedPrice = Number(price);
  if (normalizedMode === "AGGRESSIVE") {
    parsedPrice = parsedSide === Side.BUY ? bestAsk || parsedPrice : bestBid || parsedPrice;
  } else if (normalizedMode === "PASSIVE") {
    parsedPrice = parsedSide === Side.BUY ? bestBid || parsedPrice : bestAsk || parsedPrice;
  }

  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0 || parsedPrice >= 1) {
    throw new Error("Limit price must be between 0 and 1.");
  }

  const normalizedAmountMode = amountMode || (parsedSide === Side.BUY ? "SPEND" : "SIZE");
  const orderSize =
    normalizedAmountMode === "SIZE"
      ? parsedAmount
      : parsedSide === Side.BUY
        ? parsedAmount / parsedPrice
        : parsedAmount;
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    throw new Error("Computed order size is invalid.");
  }

  let tickSize: import("@polymarket/clob-client").TickSize = "0.01";
  let negRisk = false;
  if (client) {
    const [tSize, nRisk] = await Promise.all([
      client.getTickSize(tokenID),
      client.getNegRisk(tokenID),
    ]);
    tickSize = tSize;
    negRisk = nRisk;
  }

  if (parsedSide === Side.BUY && normalizedAmountMode === "SPEND" && !config.PAPER_TRADING_ENABLED) {
    const allowance = await client!.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
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
      throw {
        message: `Insufficient Polymarket collateral balance. Available ${numericBalance.toFixed(2)} USDC, requested ${parsedAmount.toFixed(2)} USDC.`,
      };
    }
    if (numericAllowance < parsedAmount) {
      throw {
        message: `Insufficient Polymarket collateral allowance. Approved ${numericAllowance.toFixed(2)} USDC, requested ${parsedAmount.toFixed(2)} USDC.`,
      };
    }
  }

  const finalOrderSize = Number(orderSize.toFixed(6));
  const spendingAmount = normalizedAmountMode === "SPEND" ? parsedAmount : Number((parsedAmount * parsedPrice).toFixed(6));

  let order: any;

  if (config.PAPER_TRADING_ENABLED) {
    const balanceCol = await getPaperBalanceCollection();
    const positionsCol = await getPaperPositionsCollection();
    if (!balanceCol || !positionsCol) throw new Error("Database not configured for paper trading");

    let balDoc = await balanceCol.findOne({});
    if (!balDoc) {
      await balanceCol.insertOne({ balance: config.PAPER_TRADING_INITIAL_BALANCE, updatedAt: new Date() });
      balDoc = await balanceCol.findOne({});
    }
    const currentBalance = balDoc!.balance;

    if (parsedSide === Side.BUY) {
      if (currentBalance < spendingAmount) {
        throw new Error(`Insufficient paper balance. Available: $${currentBalance.toFixed(2)}, Required: $${spendingAmount.toFixed(2)}`);
      }

      // Deduct balance
      await balanceCol.updateOne(
        { _id: balDoc!._id },
        { $inc: { balance: -spendingAmount }, $set: { updatedAt: new Date() } }
      );

      // Save position
      const existingPos = await positionsCol.findOne({ assetId: tokenID, status: "OPEN" });
      if (existingPos) {
        const newSize = existingPos.size + finalOrderSize;
        const newCostBasis = existingPos.costBasis + spendingAmount;
        await positionsCol.updateOne(
          { _id: existingPos._id },
          {
            $set: {
              size: newSize,
              costBasis: newCostBasis,
              averagePrice: newCostBasis / newSize,
            }
          }
        );
      } else {
        await positionsCol.insertOne({
          assetId: tokenID,
          market: "Paper Market",
          outcome: "Yes/No",
          size: finalOrderSize,
          costBasis: spendingAmount,
          averagePrice: parsedPrice,
          side: parsedSide,
          status: "OPEN",
          realizedPnl: 0,
          createdAt: new Date(),
        });
      }
    } else {
      // SELL order
      const existingPos = await positionsCol.findOne({ assetId: tokenID, status: "OPEN" });
      if (!existingPos) {
        throw new Error(`No open paper position found for asset ${tokenID} to sell.`);
      }

      if (existingPos.size < finalOrderSize - 0.0001) { // Floating point tolerance
        throw new Error(`Insufficient paper position size. Available: ${existingPos.size.toFixed(4)}, Required: ${finalOrderSize.toFixed(4)}`);
      }

      const saleProceeds = finalOrderSize * parsedPrice;
      const soldCostBasis = existingPos.averagePrice * finalOrderSize;
      const realizedPnl = saleProceeds - soldCostBasis;

      // Add to balance
      await balanceCol.updateOne(
        { _id: balDoc!._id },
        { $inc: { balance: saleProceeds }, $set: { updatedAt: new Date() } }
      );

      const remainingSize = existingPos.size - finalOrderSize;
      if (remainingSize <= 0.0001) {
        await positionsCol.updateOne(
          { _id: existingPos._id },
          {
            $set: {
              status: "CLOSED",
              size: 0,
              closedAt: new Date(),
            },
            $inc: { realizedPnl: realizedPnl }
          }
        );
      } else {
        await positionsCol.updateOne(
          { _id: existingPos._id },
          {
            $set: {
              size: remainingSize,
              costBasis: existingPos.costBasis - soldCostBasis,
            },
            $inc: { realizedPnl: realizedPnl }
          }
        );
      }
    }

    order = {
      success: true,
      orderID: `paper-order-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: "MATCHED" // Assume instant fill for paper trading
    };
  } else {
    order = await client!.createAndPostOrder(
      {
        tokenID,
        size: finalOrderSize,
        side: parsedSide,
        price: parsedPrice,
      },
      { tickSize, negRisk },
      OrderType.GTC
    );

    if (order?.success === false) {
      const formatted = formatTradeError(order, { tokenID, amount, side, price: parsedPrice, tickSize, negRisk });
      throw { ...formatted, message: formatted.error };
    }
  }

  const distanceToMarket =
    parsedSide === Side.BUY && bestAsk > 0
      ? parsedPrice - bestAsk
      : parsedSide === Side.SELL && bestBid > 0
        ? bestBid - parsedPrice
        : 0;

  return {
    success: true,
    orderID: order?.orderID || order?.id || null,
    status: order?.status || "PENDING",
    tickSize,
    negRisk,
    orderSize: Number(orderSize.toFixed(6)),
    spendingAmount:
      normalizedAmountMode === "SPEND"
        ? parsedAmount
        : Number((parsedAmount * parsedPrice).toFixed(6)),
    executionMode: normalizedMode,
    amountMode: normalizedAmountMode,
    limitPriceUsed: parsedPrice,
    marketSnapshot: {
      bestBid: bestBid || null,
      bestAsk: bestAsk || null,
      spread: bestBid > 0 && bestAsk > 0 ? Number((bestAsk - bestBid).toFixed(4)) : null,
      distanceToMarket: Number(distanceToMarket.toFixed(4)),
    },
    raw: order,
  };
}
