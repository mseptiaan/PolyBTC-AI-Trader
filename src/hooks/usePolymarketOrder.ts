import { useState, useEffect, useCallback } from "react";
import { OrderTrackerState } from "../types";

export function usePolymarketOrder() {
  const [orderLookupId, setOrderLookupId] = useState<string>("");
  const [orderLookupLoading, setOrderLookupLoading] = useState(false);
  const [trackedOrder, setTrackedOrder] = useState<OrderTrackerState | null>(null);

  const lookupOrder = useCallback(async (orderID?: string) => {
    const target = (orderID ?? orderLookupId).trim();
    if (!target) return;

    setOrderLookupLoading(true);
    try {
      const response = await fetch(`/api/polymarket/order/${target}`);
      const result = await response.json();
      if (!response.ok) {
        alert(`Order lookup failed: ${result.error || "Unknown error"}`);
        return;
      }
      setTrackedOrder(result);
      setOrderLookupId(target);
    } catch (error) {
      console.error("Order Lookup Error:", error);
      alert("Error looking up order.");
    } finally {
      setOrderLookupLoading(false);
    }
  }, [orderLookupId]);

  return { orderLookupId, setOrderLookupId, orderLookupLoading, setOrderLookupLoading, trackedOrder, lookupOrder };
}