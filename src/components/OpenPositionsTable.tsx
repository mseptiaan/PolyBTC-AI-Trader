import { useState } from "react";
import { PerformanceState, PositionAutomation } from "../types";
import { cn } from "../lib/utils";
import { RefreshCw } from "lucide-react";

interface OpenPositionsTableProps {
  performance: PerformanceState;
  activeAssetIds: Set<string>;
  positionAutomation: Record<string, PositionAutomation>;
  automationBusy: Record<string, boolean>;
  refreshOpenPositionRoi: () => void;
  openPositionsRefreshing: boolean;
  updateAutomation: (assetId: string, patch: Partial<PositionAutomation>) => void;
  recommendAutomation: (position: PerformanceState["openPositions"][number]) => void;
  saveAutomation: (position: PerformanceState["openPositions"][number], patch?: Partial<PositionAutomation>) => void;
  refreshPositionPrice: (position: PerformanceState["openPositions"][number]) => void;
  exitPosition: (position: PerformanceState["openPositions"][number], trigger: string, exitPrice: string) => void;
}

/**
 * UI Component for rendering a user's currently held open positions on Polymarket.
 *
 * Maps through current positions and allows the user to view real-time ROIs and
 * manage trailing stop-loss / take-profit (TP/SL) parameters directly from the browser.
 */
export default function OpenPositionsTable({
  performance,
  activeAssetIds,
  positionAutomation,
  automationBusy,
  refreshOpenPositionRoi,
  openPositionsRefreshing,
  updateAutomation,
  recommendAutomation,
  saveAutomation,
  refreshPositionPrice,
  exitPosition,
}: OpenPositionsTableProps) {
  const [openPositionFilter, setOpenPositionFilter] = useState<"active" | "all">("active");

  const sortedOpenPositions = [...performance.openPositions].sort((a, b) => Number(b.costBasis) - Number(a.costBasis));
  const filteredOpenPositions = sortedOpenPositions.filter((position) =>
    openPositionFilter === "all" ? true : activeAssetIds.has(position.assetId)
  );

  return (
    <div className="glass-card p-4 max-h-[32rem] overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-bold">Open Positions</div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshOpenPositionRoi}
            disabled={openPositionsRefreshing || filteredOpenPositions.length === 0}
            className="text-[10px] uppercase font-bold rounded px-2 py-1 border text-amber-300 border-amber-500/30 disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw className={cn("w-3 h-3", openPositionsRefreshing && "animate-spin")} />
            Refresh ROI
          </button>
          <button
            onClick={() => setOpenPositionFilter("active")}
            className={cn(
              "text-[10px] uppercase font-bold rounded px-2 py-1 border",
              openPositionFilter === "active"
                ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/20"
                : "text-zinc-500 border-zinc-800"
            )}
          >
            Current Active
          </button>
          <button
            onClick={() => setOpenPositionFilter("all")}
            className={cn(
              "text-[10px] uppercase font-bold rounded px-2 py-1 border",
              openPositionFilter === "all"
                ? "text-blue-300 bg-blue-500/15 border-blue-500/20"
                : "text-zinc-500 border-zinc-800"
            )}
          >
            All
          </button>
        </div>
      </div>
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 mb-2 bg-zinc-950/95 border-b border-zinc-900">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
          {openPositionFilter === "active" ? "Current Active Market Positions" : "All Live Positions"}
        </div>
      </div>
      {filteredOpenPositions.length === 0 ? (
        <div className="text-sm text-zinc-500">No open positions.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left pb-2">Outcome</th>
              <th className="text-left pb-2">Size</th>
              <th className="text-left pb-2">Avg Price</th>
              <th className="text-left pb-2">Cost Basis</th>
              <th className="text-left pb-2">ROI</th>
              <th className="text-left pb-2">TP / SL</th>
            </tr>
          </thead>
          <tbody>
            {filteredOpenPositions.map((position) => (
              <tr
                key={position.assetId}
                className={cn(
                  "border-t border-zinc-900",
                  position.outcome === "Up" ? "bg-emerald-500/8" : "bg-red-500/8"
                )}
              >
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span>{position.outcome}</span>
                    <span
                      className={cn(
                        "text-[10px] uppercase font-bold rounded px-1.5 py-0.5 border",
                        position.outcome === "Up"
                          ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/20"
                          : "text-red-300 bg-red-500/15 border-red-500/20"
                      )}
                    >
                      {position.outcome === "Up" ? "Bullish" : "Bearish"}
                    </span>
                  </div>
                </td>
                <td className="py-2 font-mono">{position.size}</td>
                <td className="py-2 font-mono">{(Number(position.averagePrice) * 100).toFixed(1)}c</td>
                <td className="py-2 font-mono">
                  <div className="flex items-center gap-2">
                    <span>${Number(position.costBasis).toFixed(2)}</span>
                    <span className="text-[10px] uppercase font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/20 rounded px-1.5 py-0.5">
                      Live
                    </span>
                  </div>
                </td>
                <td className="py-2 font-mono">
                  {(() => {
                    const lastPrice = Number(positionAutomation[position.assetId]?.lastPrice || 0);
                    const avgPrice = Number(position.averagePrice || 0);
                    if (!(lastPrice > 0 && avgPrice > 0)) return <span className="text-zinc-500">--</span>;
                    const roi = ((lastPrice - avgPrice) / avgPrice) * 100;
                    return (
                      <span className={cn(roi > 0 ? "text-green-400" : roi < 0 ? "text-red-400" : "text-zinc-400")}>
                        {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
                      </span>
                    );
                  })()}
                </td>
                <td className="py-2">
                  <div className="flex flex-col gap-2 min-w-[220px]">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="0.99"
                        placeholder="TP"
                        value={positionAutomation[position.assetId]?.takeProfit || ""}
                        onChange={(e) => updateAutomation(position.assetId, { takeProfit: e.target.value })}
                        className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="0.99"
                        placeholder="SL"
                        value={positionAutomation[position.assetId]?.stopLoss || ""}
                        onChange={(e) => updateAutomation(position.assetId, { stopLoss: e.target.value })}
                        className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0.00"
                        max="0.25"
                        placeholder="Trail"
                        value={positionAutomation[position.assetId]?.trailingStop || ""}
                        onChange={(e) => updateAutomation(position.assetId, { trailingStop: e.target.value })}
                        className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
                      />
                      <button
                        onClick={() => recommendAutomation(position)}
                        disabled={automationBusy[position.assetId]}
                        className="text-[10px] uppercase font-bold rounded px-2 py-1 border text-emerald-300 border-emerald-500/30 disabled:opacity-50"
                      >
                        Auto
                      </button>
                      <button
                        onClick={() => saveAutomation(position, { armed: !positionAutomation[position.assetId]?.armed })}
                        disabled={automationBusy[position.assetId]}
                        className={cn(
                          "text-[10px] uppercase font-bold rounded px-2 py-1 border",
                          positionAutomation[position.assetId]?.armed
                            ? "text-yellow-300 border-yellow-500/30"
                            : "text-blue-300 border-blue-500/30"
                        )}
                      >
                        {positionAutomation[position.assetId]?.armed ? "Disarm" : "Arm"}
                      </button>
                      <button
                        onClick={() => refreshPositionPrice(position)}
                        disabled={automationBusy[position.assetId]}
                        className="text-[10px] uppercase font-bold rounded px-2 py-1 border text-amber-300 border-amber-500/30 disabled:opacity-50"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={() => exitPosition(position, "manual", positionAutomation[position.assetId]?.lastPrice || position.averagePrice)}
                        disabled={automationBusy[position.assetId]}
                        className="text-[10px] uppercase font-bold rounded px-2 py-1 border text-red-300 border-red-500/30 disabled:opacity-50"
                      >
                        Exit
                      </button>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Last bid: {positionAutomation[position.assetId]?.lastPrice ? `${(Number(positionAutomation[position.assetId]?.lastPrice) * 100).toFixed(1)}c` : "--"}
                      {positionAutomation[position.assetId]?.highestPrice ? ` | High: ${(Number(positionAutomation[position.assetId]?.highestPrice) * 100).toFixed(1)}c` : ""}
                      {positionAutomation[position.assetId]?.trailingStopPrice ? ` | Trail stop: ${(Number(positionAutomation[position.assetId]?.trailingStopPrice) * 100).toFixed(1)}c` : ""}
                      {positionAutomation[position.assetId]?.status ? ` | ${positionAutomation[position.assetId]?.status}` : ""}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}