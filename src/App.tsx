import { useState, useCallback } from "react";
import { Market, AIRecommendation } from "./types/index.js";
import { analyzeMarket } from "./services/ai.js";
import { useMarketData } from "./hooks/useMarketData.js";
import { useWindowCountdown } from "./hooks/useWindowCountdown.js";
import { usePolymarketOrder } from "./hooks/usePolymarketOrder.js";
import { useAutomations } from "./hooks/useAutomations.js";
import BotDashboard from "./components/BotDashboard.js";
import BotLogSidebar from "./components/BotLogSidebar.js";
import CandlestickChart from "./components/CandlestickChart.js";
import MarketCard from "./components/MarketCard.js";
import IndicatorsBar from "./components/IndicatorsBar.js";
import PerformanceWidget from "./components/PerformanceWidget.js";
import OpenPositionsTable from "./components/OpenPositionsTable.js";
import TradeHistoryTable from "./components/TradeHistoryTable.js";
import TradeModal from "./components/TradeModal.js";
import { Clock, Zap, Activity, DollarSign, Smile, RefreshCw, BarChart3, AlertTriangle } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { cn } from "./lib/utils.js";

// ── Kelly Criterion (15% Kelly, hard-capped at 3% of bankroll) ──────────────
function kellyBet(bankroll: number, confidence: number, impliedPrice: number): number {
  const p = confidence / 100;
  const q = 1 - p;
  const b = (1 - impliedPrice) / impliedPrice; // net odds
  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;
  const bet = bankroll * kelly * 0.15; // 15% Kelly
  const maxBet = bankroll * 0.03;      // hard cap: 3% of bankroll
  return parseFloat(Math.min(bet, maxBet).toFixed(2));
}

export default function App() {
  const countdown = useWindowCountdown();
  const { markets, btcPrice, btcHistory, indicators, sentiment, loading, initialLoad, fetchData, balance, performance, orderBooks, setOrderBooks, marketHistories, setMarketHistories } = useMarketData(countdown);
  const { orderLookupId, setOrderLookupId, orderLookupLoading, trackedOrder, lookupOrder, setOrderLookupLoading } = usePolymarketOrder();
  const { positionAutomation, automationBusy, updateAutomation, saveAutomation, recommendAutomation, refreshPositionPrice, exitPosition } = useAutomations(fetchData);

  const [page, setPage] = useState<"markets" | "bot">("markets");
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, AIRecommendation>>({});
  const [tradingId, setTradingId] = useState<string | null>(null);
  const [tradeAmount, setTradeAmount] = useState<string>("10");
  const [confirmTradeAmount, setConfirmTradeAmount] = useState<string>("");
  const [confirmTradeData, setConfirmTradeData] = useState<{ market: Market; outcomeIndex: number } | null>(null);
  const [executionMode, setExecutionMode] = useState<"PASSIVE" | "AGGRESSIVE">("AGGRESSIVE");
  const [autoRepriceEnabled, setAutoRepriceEnabled] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [openPositionFilter, setOpenPositionFilter] = useState<"active" | "all">("active");
  const [openPositionsRefreshing, setOpenPositionsRefreshing] = useState(false);

  // Kelly bet for a given market outcome
  const kellyAmount = useCallback((market: Market, outcomeIndex: number): string => {
    const rec = recommendations[market.id];
    if (!rec || rec.decision === "NO_TRADE") return tradeAmount;
    const bankroll = parseFloat(balance?.balance || "100");
    const impliedPrice = parseFloat(market.outcomePrices[outcomeIndex] || "0.5");
    const bet = kellyBet(bankroll, rec.confidence, impliedPrice);
    return bet > 0 ? bet.toString() : tradeAmount;
  }, [recommendations, balance, tradeAmount]);

  // Edge filter: only show trade button as active when there is real edge
  const hasEdge = useCallback((market: Market): boolean => {
    const rec = recommendations[market.id];
    if (!rec || rec.decision === "NO_TRADE") return false;
    return rec.estimatedEdge >= 8 && rec.riskLevel === "LOW"; // at least 8¢ edge, LOW risk only
  }, [recommendations]);

  const handleAnalyze = async (market: Market) => {
    setAnalyzingId(market.id);

    // Fetch order books for all tokens in parallel
    const books: Record<string, any> = {};
    if (market.clobTokenIds?.length) {
      await Promise.all([
        ...market.clobTokenIds.map(async (tokenId) => {
          try {
            const res = await fetch(`/api/polymarket/orderbook/${tokenId}`);
            books[tokenId] = await res.json();
          } catch (e) {
            console.error(`Order book error for ${tokenId}:`, e);
          }
        }),
        (async () => {
          try {
            // Fetch price history for both outcome tokens (Yes=idx0, No=idx1)
            const [yesId, noId] = market.clobTokenIds ?? [];
            if (!yesId) return;

            const [yesRes, noRes] = await Promise.all([
              fetch(`/api/polymarket/history/${yesId}`),
              noId ? fetch(`/api/polymarket/history/${noId}`) : Promise.resolve(null),
            ]);

            const yesData: { t: number; p: number }[] = yesRes.ok ? await yesRes.json() : [];
            const noData: { t: number; p: number }[] = (noRes && noRes.ok) ? await noRes.json() : [];

            // Merge by timestamp into { t, yes, no }
            const noMap = new Map(noData.map((d) => [d.t, d.p]));
            const merged = (Array.isArray(yesData) ? yesData : []).map((d) => ({
              t: d.t,
              yes: d.p,
              no: noMap.get(d.t) ?? 1 - d.p,
            }));

            setMarketHistories((prev) => ({ ...prev, [market.id]: merged }));
          } catch (e) {
            console.error(`History error for ${market.id}:`, e);
          }
        })(),
      ]);
      setOrderBooks((prev) => ({ ...prev, ...books }));
    }

    const rec = await analyzeMarket(
      market,
      btcPrice?.price ?? null,
      btcHistory,
      sentiment,
      indicators,
      { ...orderBooks, ...books },
      marketHistories[market.id] || [],
      300 - countdown
    );
    setRecommendations((prev) => ({ ...prev, [market.id]: rec }));
    setAnalyzingId(null);
  };

  const handleTrade = (market: Market, outcomeIndex: number) => {
    setConfirmTradeAmount(kellyAmount(market, outcomeIndex));
    setExecutionMode("AGGRESSIVE");
    setAutoRepriceEnabled(false);
    setConfirmTradeData({ market, outcomeIndex });
  };

  const executeTrade = async () => {
    if (!confirmTradeData) return;
    const { market, outcomeIndex } = confirmTradeData;
    const tokenId = market.clobTokenIds?.[outcomeIndex];
    if (!tokenId) return;

    const book = orderBooks[tokenId];
    const bestBid = Number(book?.bids?.[0]?.price || "0");
    const bestAsk = Number(book?.asks?.[0]?.price || "0");
    const price =
      executionMode === "AGGRESSIVE"
        ? String(bestAsk || market.outcomePrices[outcomeIndex])
        : String(bestBid || market.outcomePrices[outcomeIndex]);
    const amountToTrade = confirmTradeAmount || kellyAmount(market, outcomeIndex);
    const numericPrice = Number(price);
    const numericAmount = Number(amountToTrade);
    const minimumUsdc = Number.isFinite(numericPrice) && numericPrice > 0 ? 5 * numericPrice : 0;
    if (Number.isFinite(numericAmount) && minimumUsdc > 0 && numericAmount < minimumUsdc) {
      alert(`Trade terlalu kecil. Minimum sekitar ${minimumUsdc.toFixed(2)} USDC untuk limit price ini.`);
      return;
    }
    setConfirmTradeData(null);
    setConfirmTradeAmount("");
    setTradingId(`${market.id}-${outcomeIndex}`);
    try {
      const response = await fetch("/api/polymarket/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenID: tokenId,
          amount: amountToTrade,
          side: "BUY",
          executionMode,
        }),
      });
      const result = await response.json();
      if (response.ok) {
        if (result.orderID) {
          setOrderLookupId(result.orderID);
          lookupOrder(result.orderID);
          if (autoRepriceEnabled) {
            setTimeout(async () => {
              try {
                const orderRes = await fetch(`/api/polymarket/order/${result.orderID}`);
                const orderData = await orderRes.json();
                if (orderRes.ok && orderData.positionState === "OPEN" && Number(orderData.fillPercent) === 0) {
                  const repriceRes = await fetch("/api/polymarket/order/reprice", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderID: result.orderID, executionMode: "AGGRESSIVE" }),
                  });
                  const repriceData = await repriceRes.json();
                  if (repriceRes.ok && repriceData.replacement?.orderID) {
                    setOrderLookupId(repriceData.replacement.orderID);
                    lookupOrder(repriceData.replacement.orderID);
                  }
                }
              } catch (error) {
                console.error("Auto reprice error:", error);
              }
            }, 12000);
          }
        }
        alert(
          `Trade submitted. Order ID: ${result.orderID || "Pending"}${result.status ? ` (${result.status})` : ""}` +
          `${result.marketSnapshot?.bestAsk ? ` | Best ask ${(Number(result.marketSnapshot.bestAsk) * 100).toFixed(1)}c` : ""}`
        );
      } else {
        alert(`Trade failed: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Trade Error:", error);
      alert("Error executing trade.");
    } finally {
      setTradingId(null);
      fetchData();
    }
  };

  const getTradePreview = (market: Market, outcomeIndex: number, amount: string) => {
    const tokenId = market.clobTokenIds?.[outcomeIndex];
    const book = tokenId ? orderBooks[tokenId] : null;
    const bestBid = Number(book?.bids?.[0]?.price || "0");
    const bestAsk = Number(book?.asks?.[0]?.price || "0");
    const price =
      executionMode === "AGGRESSIVE"
        ? bestAsk || Number(market.outcomePrices[outcomeIndex])
        : bestBid || Number(market.outcomePrices[outcomeIndex]);
    const spend = Number(amount);
    const minimumUsdc = Number.isFinite(price) && price > 0 ? 5 * price : 0;
    const estimatedShares = Number.isFinite(price) && price > 0 && Number.isFinite(spend) ? spend / price : 0;
    const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
    const distanceToFill = bestAsk > 0 ? bestAsk - price : 0;
    return { price, spend, minimumUsdc, estimatedShares, bestBid, bestAsk, spread, distanceToFill };
  };

  const refreshOpenPositionRoi = useCallback(async () => {
    const assetIds = new Set(markets.flatMap((market) => market.clobTokenIds || []));
    const positions = (performance?.openPositions || [])
      .sort((a, b) => Number(b.costBasis) - Number(a.costBasis))
      .filter((position) =>
        openPositionFilter === "all" ? true : assetIds.has(position.assetId)
      );

    if (!positions.length) return;

    setOpenPositionsRefreshing(true);
    try {
      await Promise.all(positions.map((position) => refreshPositionPrice(position)));
    } finally {
      setOpenPositionsRefreshing(false);
    }
  }, [performance, openPositionFilter, markets, refreshPositionPrice]);

  const countdownColor = countdown <= 30 ? "text-red-400" : countdown <= 60 ? "text-yellow-400" : "text-green-400";
  const activeAssetIds = new Set(markets.flatMap((market) => market.clobTokenIds || []));

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Activity className="text-blue-500 w-10 h-10" />
            PolyBTC AI Trader
          </h1>
          <p className="text-zinc-400 max-w-md italic">
            AI-powered BTC 5-minute market scanner with edge detection.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          {/* Countdown */}
          <div className="glass-card p-4 flex items-center gap-3">
            <Clock className="w-4 h-4 text-zinc-500" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Window closes in</span>
              <span className={cn("text-xl font-mono font-bold", countdownColor)}>
                {String(Math.floor(countdown / 60)).padStart(2, "0")}:{String(countdown % 60).padStart(2, "0")}
              </span>
            </div>
          </div>

          {/* Auto-analyze toggle */}
          <button
            onClick={() => setAutoAnalyze((v) => !v)}
            className={cn(
              "glass-card p-4 flex items-center gap-2 text-sm font-bold transition-colors",
              autoAnalyze ? "text-blue-400 border-blue-500/30" : "text-zinc-500"
            )}
          >
            <Zap className="w-4 h-4" />
            Auto-Analyze {autoAnalyze ? "ON" : "OFF"}
          </button>

          {balance && (
            <div className="glass-card p-4 flex flex-col justify-center">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Trading Balance</span>
              <span className="text-sm font-mono text-green-400 font-bold">${balance.polymarketBalance} USDC</span>
              <span className="text-[10px] text-zinc-500">Trade via {balance.funderAddress ? "Polymarket Profile" : "Wallet Signer"}</span>
              <span className="text-xs font-mono text-zinc-500 truncate w-40">{balance.tradingAddress}</span>
              <span className="text-[10px] text-zinc-600 mt-1">Wallet: {balance.onChainBalance} {balance.tokenSymbolUsed}</span>
            </div>
          )}

          {sentiment && (
            <div className="glass-card p-4 flex items-center gap-4">
              <div className="bg-zinc-800 p-2 rounded-lg">
                <Smile className={cn("w-5 h-5", sentiment.value > 60 ? "text-green-500" : sentiment.value < 40 ? "text-red-500" : "text-yellow-500")} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Sentiment</span>
                <span className="text-sm font-bold">{sentiment.value_classification} ({sentiment.value})</span>
              </div>
            </div>
          )}

          <div className="glass-card p-4 flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Live BTC</span>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-500" />
                <span className="text-xl font-mono font-bold">
                  {btcPrice ? parseFloat(btcPrice.price).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "---"}
                </span>
              </div>
            </div>
            <button onClick={fetchData} disabled={loading} className="btn-secondary p-2 rounded-full">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Page tabs ── */}
      <div className="flex gap-1 mb-8 bg-zinc-900 rounded-xl p-1 w-fit">
        <button
          type="button"
          onClick={() => setPage("markets")}
          className={cn(
            "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all",
            page === "markets" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Activity className="w-4 h-4" />
          Markets
        </button>
        <button
          type="button"
          onClick={() => setPage("bot")}
          className={cn(
            "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all",
            page === "bot" ? "bg-blue-600 text-white" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Zap className="w-4 h-4" />
          Bot
        </button>
      </div>

      {page === "bot" && <BotDashboard />}

      <main className={cn("grid grid-cols-1 gap-8", page !== "markets" && "hidden")}>
        {/* ── Indicators bar ── */}
        <IndicatorsBar indicators={indicators} />

        {/* ── BTC Candlestick Chart (1m) ── */}
        {btcHistory.length > 0 && (
          <section className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">BTC/USDT — Last 60 Minutes (1m candles)</h2>
            </div>
            <CandlestickChart data={btcHistory} height={220} />
          </section>
        )}

        {/* ── Markets ── */}
        <section>
          {/* Performance Widget */}
          <PerformanceWidget summary={performance?.summary} />

          <div className="glass-card p-4 mb-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Order Tracker</div>
                <input
                  type="text"
                  value={orderLookupId}
                  onChange={(e) => setOrderLookupId(e.target.value)}
                  placeholder="Paste trade/order id"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none"
                />
              </div>
              <button
                onClick={() => lookupOrder()}
                disabled={orderLookupLoading || !orderLookupId.trim()}
                className="btn-primary px-5 py-3 rounded-xl disabled:opacity-50"
              >
                {orderLookupLoading ? "Checking..." : "Track Order"}
              </button>
            </div>

            {trackedOrder && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Status</div>
                  <div className={cn(
                    "text-sm font-bold",
                    trackedOrder.positionState === "FILLED" ? "text-green-400" :
                    trackedOrder.positionState === "PARTIALLY_FILLED" ? "text-yellow-400" :
                    trackedOrder.positionState === "OPEN" ? "text-blue-400" : "text-zinc-300"
                  )}>
                    {trackedOrder.positionState}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Exchange: {trackedOrder.status}</div>
                </div>
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Fill</div>
                  <div className="text-sm font-bold font-mono">{trackedOrder.fillPercent}%</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{trackedOrder.matchedSize} / {trackedOrder.originalSize} shares</div>
                </div>
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Side</div>
                  <div className="text-sm font-bold">{trackedOrder.side} {trackedOrder.outcome}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">@ {(Number(trackedOrder.price) * 100).toFixed(1)}¢</div>
                </div>
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Remaining</div>
                  <div className="text-sm font-bold font-mono">{trackedOrder.remainingSize}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 truncate">{trackedOrder.orderID}</div>
                  {trackedOrder.positionState === "OPEN" && (
                    <button
                      onClick={async () => {
                        try {
                          setOrderLookupLoading(true);
                          const response = await fetch("/api/polymarket/order/reprice", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ orderID: trackedOrder.orderID, executionMode: "AGGRESSIVE" }),
                          });
                          const result = await response.json();
                          if (!response.ok) {
                            alert(`Reprice failed: ${result.error || "Unknown error"}`);
                            return;
                          }
                          if (result.replacement?.orderID) {
                            setOrderLookupId(result.replacement.orderID);
                            await lookupOrder(result.replacement.orderID);
                          }
                        } catch (error) {
                          console.error("Reprice order error:", error);
                          alert("Failed to reprice order.");
                        } finally {
                          setOrderLookupLoading(false);
                        }
                      }}
                      className="mt-3 text-[10px] uppercase font-bold rounded px-2 py-1 border text-amber-300 border-amber-500/30"
                    >
                      Reprice To Market
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {performance && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              <TradeHistoryTable performance={performance} />

              <OpenPositionsTable
                performance={performance}
                activeAssetIds={activeAssetIds}
                positionAutomation={positionAutomation}
                automationBusy={automationBusy}
                refreshOpenPositionRoi={refreshOpenPositionRoi}
                openPositionsRefreshing={openPositionsRefreshing}
                updateAutomation={updateAutomation}
                recommendAutomation={recommendAutomation}
                saveAutomation={saveAutomation}
                refreshPositionPrice={refreshPositionPrice}
                exitPosition={exitPosition}
              />
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Active BTC 5-Min Markets
            </h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Amount:</span>
                <input
                  type="number"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  className="bg-transparent text-sm font-mono w-16 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">USDC</span>
              </div>
              <span className="text-sm text-zinc-500 font-mono">{markets.length} markets</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {initialLoad ? (
              <div className="col-span-full flex flex-col items-center justify-center p-20 glass-card">
                <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                <p className="text-zinc-400 font-medium">Scanning markets...</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {markets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    rec={recommendations[market.id]}
                    edge={hasEdge(market)}
                    marketHistory={marketHistories[market.id]}
                    orderBooks={orderBooks}
                    analyzingId={analyzingId}
                    tradingId={tradingId}
                    kellyAmount={kellyAmount}
                    onAnalyze={handleAnalyze}
                    onTrade={handleTrade}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>

          {markets.length === 0 && !initialLoad && (
            <div className="glass-card p-12 text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">No Active BTC Markets Found</h3>
              <p className="text-zinc-400 mb-6">The current 5-minute window may not have an active market yet.</p>
              <button onClick={fetchData} className="btn-primary px-6 py-2 rounded-lg flex items-center gap-2 mx-auto">
                <RefreshCw className="w-4 h-4" /> Retry
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="mt-20 pt-8 border-t border-zinc-900 text-center text-zinc-600 text-sm">
        <p>© 2026 PolyBTC AI Trader • Personal use only • Not financial advice</p>
      </footer>

      {/* ── Confirm Trade Modal ── */}
      <TradeModal
        confirmTradeData={confirmTradeData}
        confirmTradeAmount={confirmTradeAmount}
        executionMode={executionMode}
        autoRepriceEnabled={autoRepriceEnabled}
        recommendations={recommendations}
        setConfirmTradeData={setConfirmTradeData}
        setConfirmTradeAmount={setConfirmTradeAmount}
        setExecutionMode={setExecutionMode}
        setAutoRepriceEnabled={setAutoRepriceEnabled}
        executeTrade={executeTrade}
        preview={confirmTradeData ? getTradePreview(confirmTradeData.market, confirmTradeData.outcomeIndex, confirmTradeAmount || kellyAmount(confirmTradeData.market, confirmTradeData.outcomeIndex)) : { price: 0, spend: 0, minimumUsdc: 0, estimatedShares: 0, bestBid: 0, bestAsk: 0, spread: 0, distanceToFill: 0 }}
        kellyAmount={kellyAmount}
      />

      {/* ── Bot Log Sidebar ── */}
      <BotLogSidebar />
    </div>
  );
}