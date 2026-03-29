export interface Order {
  price: string;
  size: string;
}

export interface OrderBook {
  bids: Order[];
  asks: Order[];
  hash?: string;
  imbalance?: number;
  imbalanceSignal?: "BUY_PRESSURE" | "SELL_PRESSURE" | "NEUTRAL";
  totalLiquidityUsdc?: number;
}

export interface BTCIndicators {
  rsi: number;
  ema9: number;
  ema21: number;
  emaCross: "BULLISH" | "BEARISH";
  volumeSpike: number;
  trend: "STRONG_UP" | "STRONG_DOWN" | "MIXED";
  last3Candles: { open: number; high: number; low: number; close: number; direction: "UP" | "DOWN" }[];
  currentPrice: number;
  // MACD
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdTrend: "BULLISH" | "BEARISH" | "NEUTRAL";
  // Bollinger Bands
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPosition: "ABOVE_UPPER" | "NEAR_UPPER" | "MIDDLE" | "NEAR_LOWER" | "BELOW_LOWER";
  // Momentum
  momentum5: number;
  // Pre-computed signal alignment score (-6 bullish to +6 bearish, negative = bullish)
  signalScore: number;
}

export interface Market {
  id: string;
  conditionId: string;
  question: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
  image: string;
  icon: string;
  category: string;
  volume: string;
  liquidity: string;
  eventSlug: string;
  eventTitle: string;
  eventId: string;
  startDate: string;
  endDate: string;
}

export interface BTCPrice {
  symbol: string;
  price: string;
}

export interface BTCHistory {
  time: number;   // Unix seconds (for lightweight-charts)
  open: number;
  high: number;
  low: number;
  close: number;
  price: number;  // alias for close, backward compat
  volume: number;
}

export interface SentimentData {
  value: number;
  value_classification: string;
  timestamp: string;
}

export interface AIRecommendation {
  decision: "TRADE" | "NO_TRADE";
  direction: "UP" | "DOWN" | "NONE";
  confidence: number;
  estimatedEdge: number;
  candlePatterns: string[];
  reasoning: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  dataMode?: "FULL_DATA" | "POLYMARKET_ONLY";
  reversalProbability?: number;
  oppositePressureProbability?: number;
  reversalReasoning?: string;
}

// ── Backend Types ────────────────────────────────────────────────────────

export interface TradeLogEntry {
  ts: string;                       // ISO timestamp
  market: string;
  direction: "UP" | "DOWN";
  confidence: number;
  edge: number;
  betAmount: number;
  entryPrice: number;
  pnl: number;
  result: "WIN" | "LOSS";
  rsi?: number;
  emaCross?: string;
  signalScore?: number;
  imbalanceSignal?: string;
  divergenceDirection?: string;
  divergenceStrength?: string;
  btcDelta30s?: number;
  yesDelta30s?: number;
  windowElapsedSeconds: number;
  orderId: string | null;
}

export interface PersistedLearning {
  lossMemory: LossMemory[];
  winMemory: WinMemory[];
  consecutiveLosses: number;
  consecutiveWins: number;
  adaptiveConfidenceBoost: number;
  savedAt: string;
}

export type BtcCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  price: number;
  volume: number;
};

export interface DivergenceState {
  btcDelta30s: number;       // raw $ BTC change in last 30s
  btcDelta60s: number;       // raw $ BTC change in last 60s
  yesDelta30s: number;       // YES token ¢ change in last 30s
  divergence: number;        // 0.0–1.0+ normalized score
  direction: "UP" | "DOWN" | "NEUTRAL";
  strength: "STRONG" | "MODERATE" | "WEAK" | "NONE";
  currentBtcPrice: number | null;
  currentYesAsk:   number | null;
  currentNoAsk:    number | null;
  updatedAt: number;         // unix seconds
}

export interface EntrySnapshot {
  market: string;
  windowStart: number;
  yesPrice: number | null;
  noPrice: number | null;
  direction: string | null;
  confidence: number | null;
  edge: number | null;
  riskLevel: string | null;
  estimatedBet: number | null;
  btcPrice: number | null;
  divergence: { direction: string; strength: string; btcDelta30s: number; yesDelta30s: number; } | null;
  updatedAt: string;
}

export interface BotLogEntry {
  timestamp: string;
  market: string;
  decision: string;
  direction: string;
  confidence: number;
  edge: number;
  riskLevel: string;
  reasoning: string;
  tradeExecuted: boolean;
  tradeAmount?: number;
  tradePrice?: number;
  orderId?: string | null;
  error?: string;
}

export interface RawLogEntry {
  ts: string;
  level: string;
  msg: string;
}

export interface PendingResult {
  eventSlug: string;
  marketId: string;
  market: string;
  tokenId: string;
  direction: string;
  outcome: string;
  entryPrice: number;
  betAmount: number;
  orderId: string | null;
  windowEnd: number;
  confidence: number;
  edge: number;
  reasoning: string;
  windowElapsedSeconds: number;
  rsi?: number;
  emaCross?: string;
  signalScore?: number;
  imbalanceSignal?: string;
}

export interface LossMemory {
  timestamp: string;
  market: string;
  direction: string;
  confidence: number;
  edge: number;
  entryPrice: number;
  betAmount: number;
  pnl: number;
  windowElapsedSeconds: number;
  rsi?: number;
  emaCross?: string;
  signalScore?: number;
  imbalanceSignal?: string;
  reasoning: string;
  lesson: string;
}

export interface WinMemory {
  timestamp: string;
  market: string;
  direction: string;
  confidence: number;
  edge: number;
  entryPrice: number;
  betAmount: number;
  pnl: number;
  windowElapsedSeconds: number;
  rsi?: number;
  emaCross?: string;
  signalScore?: number;
  imbalanceSignal?: string;
  lesson: string;
}

export type CacheDocument<T> = {
  _id: string;
  payload: T;
  source: string;
  fetchedAt: Date;
};

export type BtcPriceSnapshotDocument = {
  symbol: string;
  price: number;
  source: string;
  fetchedAt: Date;
};

export type BtcCandleDocument = {
  symbol: string;
  interval: "1m";
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  fetchedAt: Date;
};

export type PositionAutomationDocument = {
  assetId: string;
  market: string;
  outcome: string;
  averagePrice: string;
  size: string;
  takeProfit: string;
  stopLoss: string;
  trailingStop: string;
  armed: boolean;
  windowEnd?: number;       // unix seconds — when the 5-min market resolves
  highestPrice?: string;
  trailingStopPrice?: string;
  lastPrice?: string;
  status?: string;
  lastExitOrderId?: string | null;
  updatedAt: Date;
  lastTriggeredAt?: Date | null;
};

export type PaperPositionDocument = {
  assetId: string;
  market: string;
  outcome: string;
  size: number;
  costBasis: number;
  averagePrice: number;
  side: string;
  status: "OPEN" | "CLOSED";
  realizedPnl: number;
  createdAt: Date;
  closedAt?: Date;
  eventSlug?: string;
};

export type PaperBalanceDocument = {
  balance: number;
  updatedAt: Date;
};

// ── UI / Dashboard specific types ──────────────────────────────────────────

export type BalanceState = {
  address: string;
  balance: string;
  polymarketBalance: string;
  onChainBalance: string;
  walletAddress: string;
  funderAddress: string | null;
  tradingAddress: string;
  tokenSymbolUsed: string;
};

export type OrderTrackerState = {
  orderID: string;
  status: string;
  positionState: string;
  outcome: string;
  side: string;
  market: string;
  assetId: string;
  price: string;
  originalSize: string;
  matchedSize: string;
  remainingSize: string;
  fillPercent: string;
  createdAt: number;
  expiration: string;
};

export type OpenPosition = {
  assetId: string;
  market: string;
  outcome: string;
  size: string;
  costBasis: string;
  averagePrice: string;
  currentValue?: string;
  cashPnl?: string;
  percentPnl?: string;
  curPrice?: string;
  redeemable?: boolean;
};

export type ClosedPosition = {
  assetId: string;
  market: string;
  outcome: string;
  avgPrice: string;
  totalBought: string;
  realizedPnl: string;
  curPrice: string;
  timestamp: number;
  endDate: string;
  eventSlug: string;
};

export type PerformanceSummary = {
  totalMatchedTrades: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  winRate: string;
  realizedPnl: string;
  openExposure: string;
};

export type PerformanceState = {
  summary: PerformanceSummary;
  history: Array<{
    id: string;
    market: string;
    outcome: string;
    side: string;
    traderSide: string;
    status: string;
    size: string;
    price: string;
    notional: string;
    pnl: string;
    matchTime: string;
    transactionHash: string;
    assetId: string;
  }>;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
};

export type PositionAutomation = {
  assetId?: string; // Sometimes used loosely as the record key
  market?: string;
  outcome?: string;
  takeProfit: string;
  stopLoss: string;
  trailingStop: string;
  armed: boolean;
  status?: string;
  lastPrice?: string;
  highestPrice?: string;
  trailingStopPrice?: string;
  lastExitOrderId?: string | null;
};

export type BotStatus = {
  enabled: boolean;
  running: boolean;
  sessionStartBalance: number | null;
  sessionTradesCount: number;
  windowElapsedSeconds: number;
  analyzedThisWindow: number;
  entrySnapshot: EntrySnapshot | null;
  config: {
    mode: "AGGRESSIVE" | "CONSERVATIVE";
    minConfidence: number;
    minEdge: number;
    kellyFraction: number;
    maxBetUsdc: number;
    sessionLossLimit: number;
    scanIntervalMs: number;
  };
};

export type TradeLogStats = {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  divergence: {
    trades: number;
    wins: number;
    winRate: number | null;
  };
  entries: TradeLogEntry[];
};

export type PreFetchCache = {
  windowStart: number;
  fetchedAt: number;
  slug: string;
  markets: any[];
  btcPriceData: any;
  btcHistoryResult: any;
  btcIndicatorsData: any;
  sentimentData: any;
  orderBooks: Record<string, any>;
  marketHistory: { t: number; yes: number; no: number }[];
  rec: any;
};