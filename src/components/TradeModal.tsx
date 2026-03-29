import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import { Market, AIRecommendation } from "../types";

interface TradeModalProps {
  confirmTradeData: { market: Market; outcomeIndex: number } | null;
  confirmTradeAmount: string;
  executionMode: "PASSIVE" | "AGGRESSIVE";
  autoRepriceEnabled: boolean;
  recommendations: Record<string, AIRecommendation>;
  setConfirmTradeData: (data: { market: Market; outcomeIndex: number } | null) => void;
  setConfirmTradeAmount: (amount: string) => void;
  setExecutionMode: (mode: "PASSIVE" | "AGGRESSIVE") => void;
  setAutoRepriceEnabled: (enabled: boolean) => void;
  executeTrade: () => void;
  preview: {
    price: number;
    spend: number;
    minimumUsdc: number;
    estimatedShares: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    distanceToFill: number;
  };
  kellyAmount: (market: Market, outcomeIndex: number) => string;
}

export default function TradeModal({
  confirmTradeData,
  confirmTradeAmount,
  executionMode,
  autoRepriceEnabled,
  recommendations,
  setConfirmTradeData,
  setConfirmTradeAmount,
  setExecutionMode,
  setAutoRepriceEnabled,
  executeTrade,
  preview,
  kellyAmount,
}: TradeModalProps) {
  if (!confirmTradeData) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="glass-card max-w-md w-full max-h-[90vh] overflow-hidden border-blue-500/30 flex flex-col"
        >
          <div className="flex items-center gap-3 p-6 pb-4 text-blue-400 shrink-0">
            <AlertTriangle className="w-8 h-8" />
            <h3 className="text-2xl font-bold">Confirm Trade</h3>
          </div>

          <div className="space-y-4 px-6 pb-6 overflow-y-auto flex-1 min-h-0">
            <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Market</div>
              <div className="text-sm font-medium leading-tight">{confirmTradeData.market.question}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 col-span-2">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
                  Execution Mode
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["PASSIVE", "AGGRESSIVE"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setExecutionMode(mode)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors",
                        executionMode === mode
                          ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                          : "border-zinc-800 text-zinc-400"
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <div className="mt-3 text-[10px] text-zinc-500">
                  {executionMode === "PASSIVE" &&
                    "Passive: place near current best bid, better price but slower fill."}
                  {executionMode === "AGGRESSIVE" &&
                    "Aggressive: cross to current best ask, faster fill but more expensive."}
                </div>
              </div>
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Outcome</div>
                <div className={cn("text-lg font-bold", confirmTradeData.outcomeIndex === 0 ? "text-green-500" : "text-red-500")}>
                  {confirmTradeData.market.outcomes[confirmTradeData.outcomeIndex]}
                </div>
              </div>
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Amount</div>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={confirmTradeAmount}
                  onChange={(e) => setConfirmTradeAmount(e.target.value)}
                  className="bg-transparent text-lg font-bold font-mono w-full focus:outline-none"
                />
                <div className="text-[10px] text-zinc-500 mt-1">USDC to spend</div>
                <button
                  type="button"
                  onClick={() => setConfirmTradeAmount(preview.minimumUsdc.toFixed(2))}
                  className="mt-3 text-[10px] uppercase tracking-widest text-blue-400 font-bold border border-blue-500/30 rounded-lg px-2 py-1 hover:bg-blue-500/10 transition-colors"
                >
                  Use Minimum Buy
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmTradeAmount(kellyAmount(confirmTradeData.market, confirmTradeData.outcomeIndex))
                  }
                  className="mt-2 text-[10px] uppercase tracking-widest text-emerald-400 font-bold border border-emerald-500/30 rounded-lg px-2 py-1 hover:bg-emerald-500/10 transition-colors"
                >
                  Use Kelly
                </button>
                <label className="mt-3 flex items-center gap-2 text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                  <input
                    type="checkbox"
                    checked={autoRepriceEnabled}
                    onChange={(e) => setAutoRepriceEnabled(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  Auto Reprice Once
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Est. Shares</div>
                <div className="text-lg font-bold font-mono">{preview.estimatedShares.toFixed(2)}</div>
              </div>
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Minimum</div>
                <div
                  className={cn(
                    "text-lg font-bold font-mono",
                    preview.spend >= preview.minimumUsdc ? "text-green-400" : "text-yellow-400"
                  )}
                >
                  ${preview.minimumUsdc.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Best Bid / Ask</div>
                <div className="text-sm font-bold font-mono">
                  {preview.bestBid > 0 ? `${(preview.bestBid * 100).toFixed(1)}c` : "--"} /{" "}
                  {preview.bestAsk > 0 ? `${(preview.bestAsk * 100).toFixed(1)}c` : "--"}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Spread: {(preview.spread * 100).toFixed(1)}c</div>
              </div>
              <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                  Distance To Fill
                </div>
                <div
                  className={cn(
                    "text-lg font-bold font-mono",
                    preview.distanceToFill <= 0.0001 ? "text-green-400" : "text-yellow-400"
                  )}
                >
                  {preview.distanceToFill <= 0.0001 ? "At Market" : `${(preview.distanceToFill * 100).toFixed(1)}c`}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">
                  {preview.distanceToFill <= 0.0001
                    ? "Should fill faster if liquidity stays."
                    : "Your order is resting below ask."}
                </div>
              </div>
            </div>

            {(() => {
              const rec = recommendations[confirmTradeData.market.id];
              if (!rec || rec.estimatedEdge <= 0) return null;
              return (
                <div
                  className={cn(
                    "p-4 rounded-xl border",
                    rec.estimatedEdge >= 5 ? "bg-green-500/10 border-green-500/20" : "bg-yellow-500/10 border-yellow-500/20"
                  )}
                >
                  <div className="text-[10px] uppercase tracking-widest font-bold mb-1 text-zinc-400">
                    Estimated Edge
                  </div>
                  <div
                    className={cn(
                      "text-xl font-bold font-mono",
                      rec.estimatedEdge >= 5 ? "text-green-400" : "text-yellow-400"
                    )}
                  >
                    +{rec.estimatedEdge.toFixed(1)}¢
                  </div>
                  {rec.estimatedEdge < 5 && (
                    <p className="text-xs text-yellow-400 mt-1">
                      ⚠ Edge below 5¢ threshold — trade at your own risk
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <div className="text-[10px] uppercase tracking-widest text-blue-400 font-bold mb-1">
                Market Execution Price
              </div>
              <div className="text-xl font-bold font-mono">{(preview.price * 100).toFixed(1)}¢</div>
              <div className="text-[10px] text-blue-200/80 mt-1">Mode: {executionMode}</div>
            </div>
          </div>

          <div className="flex gap-4 p-6 pt-4 border-t border-zinc-800/80 shrink-0">
            <button
              onClick={() => {
                setConfirmTradeData(null);
                setConfirmTradeAmount("");
              }}
              className="btn-secondary flex-1 py-3 rounded-xl font-bold uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={executeTrade}
              className="bg-blue-600 hover:bg-blue-500 text-white flex-1 py-3 rounded-xl font-bold uppercase tracking-wider transition-colors shadow-lg shadow-blue-500/20"
            >
              Confirm Buy
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}