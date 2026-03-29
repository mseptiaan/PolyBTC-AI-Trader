import { PerformanceState } from "../types";
import { cn } from "../lib/utils";

interface TradeHistoryTableProps {
  performance: PerformanceState;
}

export default function TradeHistoryTable({ performance }: TradeHistoryTableProps) {
  return (
    <div className="glass-card p-4 max-h-[32rem] overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-bold">Trade History</div>
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Past and active fills</div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="text-left pb-2">Side</th>
            <th className="text-left pb-2">Outcome</th>
            <th className="text-left pb-2">Price</th>
            <th className="text-left pb-2">Size</th>
            <th className="text-left pb-2">PnL</th>
          </tr>
        </thead>
        <tbody>
          {performance.history.slice(0, 12).map((trade) => {
            const isOpenTrade = performance.openPositions.some((position) => position.assetId === trade.assetId);
            return (
              <tr
                key={trade.id}
                className={cn(
                  "border-t border-zinc-900",
                  isOpenTrade ? "bg-blue-500/5" : "opacity-75"
                )}
              >
                <td className="py-2">{trade.side}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span>{trade.outcome}</span>
                    {isOpenTrade && (
                      <span className="text-[10px] uppercase font-bold text-blue-300 bg-blue-500/15 border border-blue-500/20 rounded px-1.5 py-0.5">
                        Open
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 font-mono">{(Number(trade.price) * 100).toFixed(1)}c</td>
                <td className="py-2 font-mono">{trade.size}</td>
                <td
                  className={cn(
                    "py-2 font-mono",
                    Number(trade.pnl) > 0 ? "text-green-400" : Number(trade.pnl) < 0 ? "text-red-400" : "text-zinc-400"
                  )}
                >
                  ${Number(trade.pnl).toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}