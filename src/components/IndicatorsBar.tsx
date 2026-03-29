import { BarChart3 } from "lucide-react";
import { cn } from "../lib/utils";
import { Pill } from "./Pill";
import { BTCIndicators } from "../types";

export default function IndicatorsBar({ indicators }: { indicators: BTCIndicators | null }) {
  if (!indicators) return null;

  return (
    <section className="glass-card p-4 flex flex-wrap gap-6 items-center">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-bold">Indicators (1m)</span>
      </div>
      <Pill
        label="RSI(14)"
        value={indicators.rsi.toFixed(1)}
        color={indicators.rsi > 70 ? "red" : indicators.rsi < 30 ? "green" : "zinc"}
      />
      <Pill
        label="EMA Cross"
        value={indicators.emaCross}
        color={indicators.emaCross === "BULLISH" ? "green" : "red"}
      />
      <Pill
        label="Trend"
        value={indicators.trend}
        color={indicators.trend === "STRONG_UP" ? "green" : indicators.trend === "STRONG_DOWN" ? "red" : "zinc"}
      />
      <Pill
        label="Vol Spike"
        value={`${indicators.volumeSpike}x`}
        color={indicators.volumeSpike > 2 ? "yellow" : "zinc"}
      />
      <div className="flex gap-1 items-center ml-auto">
        {indicators.last3Candles.map((c, i) => (
          <span key={i} className={cn("text-lg", c.direction === "UP" ? "text-green-400" : "text-red-400")}>
            {c.direction === "UP" ? "▲" : "▼"}
          </span>
        ))}
        <span className="text-xs text-zinc-500 ml-1">last 3 candles</span>
      </div>
    </section>
  );
}