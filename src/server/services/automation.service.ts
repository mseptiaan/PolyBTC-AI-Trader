import { PositionAutomationDocument } from "../../types/index.js";
import { getPositionAutomationCollection as getDbPosCollection } from "../db/index.js";

export async function getPositionAutomationCollection() {
  return getDbPosCollection();
}

export async function savePositionAutomation(payload: Partial<PositionAutomationDocument> & { assetId: string }) {
  const collection = await getPositionAutomationCollection();
  if (!collection) {
    throw new Error("MongoDB not configured for backend TP/SL automation.");
  }

  const existing = await collection.findOne({ assetId: payload.assetId });
  const updateDoc: PositionAutomationDocument = {
    assetId: payload.assetId,
    market: payload.market || existing?.market || "",
    outcome: payload.outcome || existing?.outcome || "",
    averagePrice: payload.averagePrice || existing?.averagePrice || "0",
    size: payload.size || existing?.size || "0",
    takeProfit: payload.takeProfit ?? existing?.takeProfit ?? "",
    stopLoss: payload.stopLoss ?? existing?.stopLoss ?? "",
    trailingStop: payload.trailingStop ?? existing?.trailingStop ?? "",
    armed: payload.armed ?? existing?.armed ?? false,
    highestPrice: payload.highestPrice ?? existing?.highestPrice,
    trailingStopPrice: payload.trailingStopPrice ?? existing?.trailingStopPrice,
    lastPrice: payload.lastPrice ?? existing?.lastPrice,
    status: payload.status ?? existing?.status ?? "Configured",
    lastExitOrderId: payload.lastExitOrderId ?? existing?.lastExitOrderId ?? null,
    updatedAt: new Date(),
    lastTriggeredAt: payload.lastTriggeredAt ?? existing?.lastTriggeredAt ?? null,
  };

  await collection.updateOne({ assetId: payload.assetId }, { $set: updateDoc }, { upsert: true });
  return updateDoc;
}

export function recommendAutomationLevels(averagePrice: number) {
  let tpTarget: number;
  let slTarget: number;
  let trailingDistance: number;

  if (averagePrice < 0.35) {
    tpTarget = Math.min(0.78, averagePrice + 0.30);
    slTarget = Math.max(0.01, averagePrice - 0.12);
    trailingDistance = 0.10;
  } else if (averagePrice < 0.50) {
    tpTarget = Math.min(0.75, averagePrice + 0.22);
    slTarget = Math.max(0.01, averagePrice - 0.10);
    trailingDistance = 0.08;
  } else if (averagePrice < 0.65) {
    tpTarget = Math.min(0.82, averagePrice + 0.18);
    slTarget = Math.max(0.01, averagePrice - 0.12);
    trailingDistance = 0.07;
  } else {
    tpTarget = Math.min(0.90, averagePrice + 0.10);
    slTarget = Math.max(0.01, averagePrice - 0.08);
    trailingDistance = 0.05;
  }

  return {
    takeProfit: tpTarget.toFixed(2),
    stopLoss: slTarget.toFixed(2),
    trailingStop: trailingDistance.toFixed(2),
  };
}
