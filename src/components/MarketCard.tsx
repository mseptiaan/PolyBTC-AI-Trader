import { Market, AIRecommendation, OrderBook } from "../types";
import { motion } from "motion/react";
import { ExternalLink, Brain, CheckCircle2, XCircle, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface MarketCardProps {
  market: Market;
  rec: AIRecommendation | undefined;
  edge: boolean;
  marketHistory: { t: number; yes: number; no: number }[] | undefined;
  orderBooks: Record<string, OrderBook>;
  analyzingId: string | null;
  tradingId: string | null;
  kellyAmount: (market: Market, outcomeIndex: number) => string;
  onAnalyze: (market: Market) => void;
  onTrade: (market: Market, outcomeIndex: number) => void;
}

/**
 * Component to display a single BTC 5-minute prediction market.
 * It renders the AI recommendation, live prices from the Polymarket Orderbook,
 * and execution buttons for BUY or SELL options.
 *
 * Notice how it accepts all data and event handlers (`onAnalyze`, `onTrade`) via Props.
 * This is the "Presentational Component" pattern, keeping business logic in parent components
 * or custom hooks for separation of concerns and easier testing.
 */
export default function MarketCard({
  market,
  rec,
  edge,
  marketHistory,
  orderBooks,
  analyzingId,
  tradingId,
  kellyAmount, // calculates dynamic bet size depending on probability and edge.
  onAnalyze,
  onTrade,
}: MarketCardProps) {
  return (
    <motion.div
      key={market.id}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn("glass-card flex flex-col", edge && "ring-1 ring-blue-500/40")}
    >
      <div className="p-6 flex-1">
        <div className="flex justify-between items-start mb-4">
          <span className="px-2 py-1 bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-wider rounded">
            {market.eventSlug || "BTC 5m"}
          </span>
          <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
            <span>Vol: ${parseFloat(market.volume || "0").toLocaleString()}</span>
          </div>
        </div>

        <h3 className="text-lg font-bold mb-4 leading-tight">{market.question}</h3>

        {marketHistory && marketHistory.length > 0 && (
          <div className="h-32 mb-6 bg-zinc-950/50 rounded-xl border border-zinc-800/50 p-2">
            <div className="flex gap-3 mb-1 px-1">
              <span className="text-[10px] text-green-400 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Yes
              </span>
              <span className="text-[10px] text-red-400 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> No
              </span>
            </div>
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={marketHistory}>
                <defs>
                  <linearGradient id={`gy-${market.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={`gn-${market.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 1]} hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ display: "none" }}
                  formatter={(v: any, name: string) => [
                    `${(parseFloat(v) * 100).toFixed(1)}¢`,
                    name === "yes" ? "Yes" : "No",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="yes"
                  stroke="#22c55e"
                  fill={`url(#gy-${market.id})`}
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="no"
                  stroke="#ef4444"
                  fill={`url(#gn-${market.id})`}
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Outcome cards ── */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {market.outcomes.map((outcome, idx) => {
            const tokenId = market.clobTokenIds?.[idx];
            const book = tokenId ? orderBooks[tokenId] : null;
            const implied = parseFloat(market.outcomePrices[idx] || "0.5");
            const kelly = kellyAmount(market, idx);
            const isRecommended =
              rec?.decision === "TRADE" &&
              ((rec.direction === "UP" && idx === 0) || (rec.direction === "DOWN" && idx === 1));

            return (
              <div
                key={idx}
                className={cn(
                  "bg-zinc-950/50 p-4 rounded-xl border flex flex-col justify-between",
                  isRecommended ? "border-blue-500/50 bg-blue-500/5" : "border-zinc-800/50"
                )}
              >
                <div>
                  <div className="text-xs text-zinc-500 mb-1 font-medium flex items-center justify-between">
                    {outcome}
                    {isRecommended && <span className="text-[10px] text-blue-400 font-bold">AI PICK</span>}
                  </div>
                  <div className="text-2xl font-bold font-mono mb-2">{(implied * 100).toFixed(1)}¢</div>

                  {book && (
                    <div className="mb-3">
                      <div
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded inline-block mb-2",
                          book.imbalanceSignal === "BUY_PRESSURE"
                            ? "bg-green-500/20 text-green-400"
                            : book.imbalanceSignal === "SELL_PRESSURE"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-zinc-800 text-zinc-500"
                        )}
                      >
                        {book.imbalanceSignal} ({((book.imbalance ?? 0.5) * 100).toFixed(0)}% bid)
                      </div>
                      <div className="text-[10px] font-mono space-y-1">
                        <div className="flex justify-between text-green-500/70">
                          <span>Best Bid:</span>
                          <span>{(parseFloat(book.bids[0]?.price || "0") * 100).toFixed(1)}¢</span>
                        </div>
                        <div className="flex justify-between text-red-500/70">
                          <span>Best Ask:</span>
                          <span>{(parseFloat(book.asks[0]?.price || "0") * 100).toFixed(1)}¢</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Kelly + execution */}
                  <div className="flex flex-col gap-1.5">
                    {rec?.decision === "TRADE" && isRecommended && (
                      <div className="flex items-center justify-between bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">
                        <span className="text-[10px] text-blue-400 font-bold uppercase">Kelly Bet:</span>
                        <span className="text-xs font-mono text-blue-400 font-bold">${kelly} USDC</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between bg-zinc-900 px-2 py-1.5 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Market Price:</span>
                      <span className="text-xs font-mono text-zinc-300">
                        {book?.asks?.[0]?.price
                          ? `${(parseFloat(book.asks[0].price) * 100).toFixed(1)}¢ ask`
                          : `${(implied * 100).toFixed(1)}¢`}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onTrade(market, idx)}
                  disabled={tradingId === `${market.id}-${idx}`}
                  className={cn(
                    "w-full py-2 mt-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                    isRecommended && edge
                      ? idx === 0
                        ? "bg-green-500 text-white hover:bg-green-400"
                        : "bg-red-500 text-white hover:bg-red-400"
                      : idx === 0
                      ? "bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white"
                      : "bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                  )}
                >
                  {tradingId === `${market.id}-${idx}` ? "Executing..." : `Buy ${outcome}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── AI Recommendation ── */}
        {rec && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={cn(
              "mb-4 p-4 rounded-xl border",
              rec.decision === "TRADE" && edge ? "bg-blue-500/10 border-blue-500/30" : "bg-zinc-900/50 border-zinc-800"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold text-blue-400 uppercase tracking-wide">
                  AI Recommendation
                </span>
              </div>
              <div className="flex items-center gap-2">
                {rec.dataMode === "POLYMARKET_ONLY" && (
                  <div className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-500/20 text-orange-300">
                    Fallback Mode
                  </div>
                )}
                <div
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                    rec.riskLevel === "LOW"
                      ? "bg-green-500/20 text-green-400"
                      : rec.riskLevel === "MEDIUM"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-red-500/20 text-red-400"
                  )}
                >
                  {rec.riskLevel} RISK
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-lg font-bold text-sm",
                  rec.decision === "TRADE" ? "bg-green-500 text-white" : "bg-zinc-700 text-zinc-300"
                )}
              >
                {rec.decision === "TRADE" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {rec.decision}
              </div>

              {rec.direction !== "NONE" && (
                <div
                  className={cn(
                    "flex items-center gap-1 font-bold text-sm",
                    rec.direction === "UP" ? "text-green-400" : "text-red-400"
                  )}
                >
                  {rec.direction === "UP" ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  {rec.direction}
                </div>
              )}

              <span className="text-sm font-mono text-zinc-400">
                Conf: <span className="text-white font-bold">{rec.confidence}%</span>
              </span>

              {rec.estimatedEdge > 0 && (
                <span
                  className={cn(
                    "text-sm font-mono font-bold",
                    rec.estimatedEdge >= 10
                      ? "text-green-400"
                      : rec.estimatedEdge >= 5
                      ? "text-yellow-400"
                      : "text-zinc-500"
                  )}
                >
                  Edge: +{rec.estimatedEdge.toFixed(1)}¢
                </span>
              )}
            </div>

            <div className="mb-3 p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest font-bold text-yellow-300">
                  Reversal Risk
                </div>
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  {rec.direction === "DOWN"
                    ? "Chance of sudden BUY squeeze"
                    : rec.direction === "UP"
                    ? "Chance of sudden SELL flush"
                    : "Two-way reversal risk"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="bg-zinc-950/60 rounded-lg border border-zinc-800 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                    Reversal
                  </div>
                  <div className="text-lg font-bold font-mono text-yellow-300">
                    {rec.reversalProbability ?? 0}%
                  </div>
                </div>
                <div className="bg-zinc-950/60 rounded-lg border border-zinc-800 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                    {rec.direction === "DOWN"
                      ? "Opposite Buy Pressure"
                      : rec.direction === "UP"
                      ? "Opposite Sell Pressure"
                      : "Opposite Pressure"}
                  </div>
                  <div className="text-lg font-bold font-mono text-orange-300">
                    {rec.oppositePressureProbability ?? 0}%
                  </div>
                </div>
              </div>
              <div className="text-xs text-zinc-400 leading-relaxed">
                {rec.reversalReasoning || "Reversal layer unavailable."}
              </div>
            </div>

            {/* Detected candle patterns */}
            {rec.candlePatterns?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {rec.candlePatterns.map((pattern, i) => {
                  const bull = /bull|hammer|soldier|white|inverted/i.test(pattern);
                  const bear = /bear|shooting|crow|black|hanging/i.test(pattern);
                  return (
                    <span
                      key={i}
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                        bull
                          ? "bg-green-500/10 text-green-400 border-green-500/20"
                          : bear
                          ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      )}
                    >
                      {pattern}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="text-sm text-zinc-300 leading-relaxed prose prose-invert max-w-none prose-sm">
              <ReactMarkdown>{rec.reasoning}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </div>

      <div className="p-4 bg-zinc-900/80 border-t border-zinc-800 flex gap-3">
        <button
          onClick={() => onAnalyze(market)}
          disabled={analyzingId === market.id}
          className="btn-secondary flex-1 flex items-center justify-center gap-2"
        >
          {analyzingId === market.id ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Brain className="w-4 h-4" />
          )}
          {analyzingId === market.id ? "Analyzing..." : "Re-Analyze"}
        </button>
        <a
          href={`https://polymarket.com/event/${
            market.eventSlug || `btc-updown-5m-${Math.floor(Math.floor(Date.now() / 1000) / 300) * 300}`
          }/${market.eventSlug || `btc-updown-5m-${Math.floor(Math.floor(Date.now() / 1000) / 300) * 300}`}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex items-center gap-2"
        >
          Trade <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </motion.div>
  );
}