import { cn } from "../lib/utils";

export function Pill({ label, value, color }: { label: string; value: string; color: "green" | "red" | "yellow" | "zinc" }) {
  const colors = {
    green:  "bg-green-500/20 text-green-400",
    red:    "bg-red-500/20 text-red-400",
    yellow: "bg-yellow-500/20 text-yellow-400",
    zinc:   "bg-zinc-800 text-zinc-400",
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{label}</span>
      <span className={cn("text-xs font-bold px-2 py-0.5 rounded", colors[color])}>{value}</span>
    </div>
  );
}
