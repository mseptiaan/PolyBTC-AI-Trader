import { cn } from "../lib/utils";
import { PerformanceSummary } from "../types";

export default function PerformanceWidget({ summary }: { summary: PerformanceSummary | undefined }) {
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Realized PnL</div>
        <div
          className={cn(
            "text-lg font-bold font-mono",
            Number(summary.realizedPnl) >= 0 ? "text-green-400" : "text-red-400"
          )}
        >
          ${Number(summary.realizedPnl).toFixed(2)}
        </div>
      </div>
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Win Rate</div>
        <div className="text-lg font-bold font-mono">{summary.winRate}%</div>
      </div>
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Wins / Losses</div>
        <div className="text-lg font-bold font-mono">
          {summary.winCount} / {summary.lossCount}
        </div>
      </div>
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Matched Trades</div>
        <div className="text-lg font-bold font-mono">{summary.totalMatchedTrades}</div>
      </div>
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Open Exposure</div>
        <div className="text-lg font-bold font-mono">${Number(summary.openExposure).toFixed(2)}</div>
      </div>
    </div>
  );
}