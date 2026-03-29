import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  // Directories
  DATA_DIR: path.join(__dirname, "../../../data"),
  get LOSS_MEMORY_FILE() { return path.join(this.DATA_DIR, "loss_memory.json"); },
  get TRADE_LOG_FILE() { return path.join(this.DATA_DIR, "trade_log.jsonl"); },

  // Bot configuration
  MARKET_SESSION_SECONDS: 300,
  BOT_SCAN_INTERVAL_MS: Number(process.env.BOT_SCAN_INTERVAL_MS || 5_000),
  BOT_MIN_CONFIDENCE: Number(process.env.BOT_MIN_CONFIDENCE || 52),
  BOT_MIN_EDGE: Number(process.env.BOT_MIN_EDGE || 0.05),
  BOT_KELLY_FRACTION: Number(process.env.BOT_KELLY_FRACTION || 0.40),
  BOT_MAX_BET_USDC: Number(process.env.BOT_MAX_BET_USDC || 250),
  BOT_SESSION_LOSS_LIMIT: Number(process.env.BOT_SESSION_LOSS_LIMIT || 0.30),

  // Database
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || "polybtc",
  MONGODB_CACHE_COLLECTION: process.env.MONGODB_CACHE_COLLECTION || "market_cache",
  MONGODB_PRICE_SNAPSHOTS_COLLECTION: process.env.MONGODB_PRICE_SNAPSHOTS_COLLECTION || "btc_price_snapshots",
  MONGODB_CHART_COLLECTION: process.env.MONGODB_CHART_COLLECTION || "chart",
  MONGODB_POSITION_AUTOMATION_COLLECTION: process.env.MONGODB_POSITION_AUTOMATION_COLLECTION || "position_automation",
  MONGODB_PAPER_POSITIONS_COLLECTION: process.env.MONGODB_PAPER_POSITIONS_COLLECTION || "paper_positions",
  MONGODB_PAPER_BALANCE_COLLECTION: process.env.MONGODB_PAPER_BALANCE_COLLECTION || "paper_balance",

  // Paper Trading
  PAPER_TRADING_ENABLED: process.env.PAPER_TRADING_ENABLED === "true",
  PAPER_TRADING_INITIAL_BALANCE: Number(process.env.PAPER_TRADING_INITIAL_BALANCE || 10000),

  // Caching
  BTC_PRICE_CACHE_MS: 5_000,
  BTC_HISTORY_CACHE_MS: 15_000,
  BTC_INDICATORS_CACHE_MS: 15_000,
  BTC_PRICE_SNAPSHOT_TTL_SECONDS: Number(process.env.BTC_PRICE_SNAPSHOT_TTL_SECONDS || 60 * 60 * 24 * 14),
  BTC_CANDLE_TTL_SECONDS: Number(process.env.BTC_CANDLE_TTL_SECONDS || 60 * 60 * 24 * 30),
  BTC_BACKGROUND_SYNC_MS: Number(process.env.BTC_BACKGROUND_SYNC_MS || 5_000),
  POSITION_AUTOMATION_SYNC_MS: Number(process.env.POSITION_AUTOMATION_SYNC_MS || 10_000),

  // Polygon & Polymarket
  POLYGON_PRIVATE_KEY: process.env.POLYGON_PRIVATE_KEY || "",
  POLYMARKET_API_KEY: process.env.POLYMARKET_API_KEY || "",
  POLYMARKET_API_SECRET: process.env.POLYMARKET_API_SECRET || "",
  POLYMARKET_API_PASSPHRASE: process.env.POLYMARKET_API_PASSPHRASE || "",
  POLYMARKET_SIGNATURE_TYPE: Number(process.env.POLYMARKET_SIGNATURE_TYPE || "0"),
  POLYMARKET_FUNDER_ADDRESS: process.env.POLYMARKET_FUNDER_ADDRESS || undefined,
  POLYGON_NETWORK: { name: "polygon", chainId: 137 },
  POLYGON_RPC_URLS: (
    process.env.POLYGON_RPC_URLS ||
    [
      "https://1rpc.io/matic",
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.drpc.org",
      "https://polygon-mainnet.public.blastapi.io",
    ].join(",")
  ).split(",").map((url) => url.trim()).filter(Boolean),
  POLYGON_USDC_TOKENS: [
    { symbol: "USDC", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
    { symbol: "USDC.e", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
  ]
};

export const CONSERVATIVE_CONFIG = {
  minConfidence: 68,
  minEdge: 0.08,
  kellyFraction: 0.20,
  maxBetUsdc: 50,
  sessionLossLimit: 0.15,
  balanceCap: 0.10,
  entryWindowStart: 30,
  entryWindowEnd: 240,
} as const;
