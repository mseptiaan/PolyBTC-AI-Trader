import { useState, useEffect, useCallback, useRef } from "react";
import { Market, BTCPrice, BTCHistory, BTCIndicators, SentimentData, OrderBook } from "../types";

/**
 * A custom hook to fetch all necessary state for the trading application.
 * Aggregates various backend API calls (Polymarket events, BTC prices, etc.)
 * into one state object.
 *
 * @param countdown The current 5-min session seconds remaining, used to trigger refresh.
 */
export function useMarketData(countdown: number) {
  // We use `useState` for all data to automatically cause React re-renders when data changes.
  const [markets, setMarkets] = useState<Market[]>([]);
  const [btcPrice, setBtcPrice] = useState<BTCPrice | null>(null);
  const [btcHistory, setBtcHistory] = useState<BTCHistory[]>([]);
  const [indicators, setIndicators] = useState<BTCIndicators | null>(null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [balance, setBalance] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [orderBooks, setOrderBooks] = useState<Record<string, OrderBook>>({});
  const [marketHistories, setMarketHistories] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const lastWindowRefreshRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [marketsRes, priceRes, historyRes, indicatorsRes, sentimentRes, balanceRes, perfRes] = await Promise.all([
        fetch("/api/polymarket/markets"),
        fetch("/api/btc-price"),
        fetch("/api/btc-history"),
        fetch("/api/btc-indicators"),
        fetch("/api/sentiment"),
        fetch("/api/polymarket/balance"),
        fetch("/api/polymarket/performance"),
      ]);

      const [marketsData, priceData, historyData, indicatorsData, sentimentData, balanceData, perfData] = await Promise.all([
        marketsRes.json(),
        priceRes.json(),
        historyRes.json(),
        indicatorsRes.json(),
        sentimentRes.json(),
        balanceRes.json(),
        perfRes.json()
      ]);

      setMarkets(Array.isArray(marketsData) ? marketsData : []);
      setBtcPrice(priceData);
      setBtcHistory(Array.isArray(historyData) ? historyData : []);
      setIndicators(indicatorsData.error ? null : indicatorsData);
      setSentiment(sentimentData);
      setBalance(balanceData.error ? null : balanceData);
      setPerformance(perfData.error ? null : perfData);
    } catch (error) {
      console.error("Fetch Error:", error);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, []);

  // Poll for data updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Handle window rollovers to fetch fresh market data immediately
  useEffect(() => {
    const currentWindow = Math.floor(Date.now() / 1000 / 300);
    if (countdown >= 299 && lastWindowRefreshRef.current !== currentWindow) {
      lastWindowRefreshRef.current = currentWindow;
      fetchData();
    }
  }, [countdown, fetchData]);

  return { markets, btcPrice, btcHistory, indicators, sentiment, balance, performance, orderBooks, setOrderBooks, marketHistories, setMarketHistories, loading, initialLoad, fetchData };
}