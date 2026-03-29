import { useState, useCallback } from "react";
import { PositionAutomation, OpenPosition } from "../types";

export function useAutomations(fetchDataCallback: () => void) {
  const [positionAutomation, setPositionAutomation] = useState<Record<string, PositionAutomation>>({});
  const [automationBusy, setAutomationBusy] = useState<Record<string, boolean>>({});

  const updateAutomation = (assetId: string, patch: Partial<PositionAutomation>) => {
    setPositionAutomation((prev) => ({
      ...prev,
      [assetId]: {
        takeProfit: prev[assetId]?.takeProfit || "",
        stopLoss: prev[assetId]?.stopLoss || "",
        trailingStop: prev[assetId]?.trailingStop || "",
        armed: prev[assetId]?.armed || false,
        status: prev[assetId]?.status,
        lastPrice: prev[assetId]?.lastPrice,
        highestPrice: prev[assetId]?.highestPrice,
        trailingStopPrice: prev[assetId]?.trailingStopPrice,
        lastExitOrderId: prev[assetId]?.lastExitOrderId,
        ...patch,
      },
    }));
  };

  const saveAutomation = useCallback(async (
    position: OpenPosition,
    patch?: Partial<PositionAutomation>
  ) => {
    setAutomationBusy((prev) => ({ ...prev, [position.assetId]: true }));
    try {
      const current = positionAutomation[position.assetId] || {
        takeProfit: "",
        stopLoss: "",
        trailingStop: "",
        armed: false,
      };
      const next = { ...current, ...patch };
      const response = await fetch("/api/polymarket/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: position.assetId,
          market: position.market,
          outcome: position.outcome,
          averagePrice: position.averagePrice,
          size: position.size,
          takeProfit: next.takeProfit,
          stopLoss: next.stopLoss,
          trailingStop: next.trailingStop,
          armed: next.armed,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        updateAutomation(position.assetId, { status: result.error || "Failed to save automation" });
        return;
      }
      updateAutomation(position.assetId, {
        takeProfit: result.automation.takeProfit || "",
        stopLoss: result.automation.stopLoss || "",
        trailingStop: result.automation.trailingStop || "",
        armed: Boolean(result.automation.armed),
        status: result.automation.status,
        lastPrice: result.automation.lastPrice,
        highestPrice: result.automation.highestPrice,
        trailingStopPrice: result.automation.trailingStopPrice,
        lastExitOrderId: result.automation.lastExitOrderId || null,
      });
    } catch (error) {
      console.error("Automation save error:", error);
      updateAutomation(position.assetId, { status: "Failed to save automation" });
    } finally {
      setAutomationBusy((prev) => ({ ...prev, [position.assetId]: false }));
    }
  }, [positionAutomation]);

  const recommendAutomation = useCallback(async (
    position: OpenPosition
  ) => {
    setAutomationBusy((prev) => ({ ...prev, [position.assetId]: true }));
    try {
      const response = await fetch("/api/polymarket/automation/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ averagePrice: position.averagePrice }),
      });
      const result = await response.json();
      if (!response.ok) {
        updateAutomation(position.assetId, { status: result.error || "Failed to recommend TP/SL" });
        return;
      }
      updateAutomation(position.assetId, {
        takeProfit: result.takeProfit,
        stopLoss: result.stopLoss,
        trailingStop: result.trailingStop,
        status: "Recommended levels applied",
      });
    } catch (error) {
      console.error("Automation recommend error:", error);
      updateAutomation(position.assetId, { status: "Failed to recommend TP/SL" });
    } finally {
      setAutomationBusy((prev) => ({ ...prev, [position.assetId]: false }));
    }
  }, []);

  const refreshPositionPrice = useCallback(async (
    position: OpenPosition
  ) => {
    try {
      const res = await fetch(`/api/polymarket/orderbook/${position.assetId}`);
      const book = await res.json();
      const bestBid = Number(book?.bids?.[0]?.price || "0");
      if (bestBid > 0) {
        updateAutomation(position.assetId, {
          lastPrice: bestBid.toFixed(4),
          status: "Live ROI updated",
        });
      } else {
        updateAutomation(position.assetId, {
          status: "No live bid available",
        });
      }
    } catch (error) {
      console.error("Open position refresh error:", error);
      updateAutomation(position.assetId, { status: "Refresh failed" });
    }
  }, []);

  const exitPosition = useCallback(async (
    position: OpenPosition,
    trigger?: string,
    exitPrice?: string
  ) => {
    setAutomationBusy((prev) => ({ ...prev, [position.assetId]: true }));
    try {
      const response = await fetch("/api/polymarket/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenID: position.assetId,
          amount: position.size,
          side: "SELL",
          price: exitPrice || position.averagePrice,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        updateAutomation(position.assetId, { status: `Exit failed: ${result.error || "Unknown error"}` });
        return;
      }
      updateAutomation(position.assetId, {
        armed: false,
        status: trigger ? `Exit submitted by ${trigger}` : "Manual exit submitted",
      });
      fetchDataCallback();
    } catch (error) {
      console.error("Exit Position Error:", error);
      updateAutomation(position.assetId, { status: "Exit request failed" });
    } finally {
      setAutomationBusy((prev) => ({ ...prev, [position.assetId]: false }));
    }
  }, [fetchDataCallback]);

  return {
    positionAutomation, setPositionAutomation,
    automationBusy, updateAutomation, saveAutomation, recommendAutomation,
    refreshPositionPrice, exitPosition
  };
}