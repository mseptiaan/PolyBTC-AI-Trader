import axios from "axios";
import { config } from "../config/index.js";
import { getPaperBalanceCollection, getPaperPositionsCollection } from "../db/index.js";
import { PaperPositionDocument } from "../../types/index.js";

let resolutionInterval: NodeJS.Timeout | null = null;

export function startPaperResolutionJob() {
  if (!config.PAPER_TRADING_ENABLED) return;
  if (resolutionInterval) return;

  console.log("Starting paper trading background resolution job...");

  resolutionInterval = setInterval(async () => {
    try {
      await checkOpenPaperPositions();
    } catch (e: any) {
      console.error("Error in paper trading resolution job:", e.message);
    }
  }, 15000); // Check every 15 seconds
}

export function stopPaperResolutionJob() {
  if (resolutionInterval) {
    clearInterval(resolutionInterval);
    resolutionInterval = null;
  }
}

async function checkOpenPaperPositions() {
  const positionsCol = await getPaperPositionsCollection();
  const balanceCol = await getPaperBalanceCollection();

  if (!positionsCol || !balanceCol) return;

  const openPositions = await positionsCol.find({ status: "OPEN" }).toArray();
  if (openPositions.length === 0) return;

  // We need to group by tokenID or fetch market info for each position
  // The tokenID (assetId) is used to find the market resolution
  for (const position of openPositions) {
    try {
      // Gamma API can fetch market by clobTokenIds
      const gammaUrl = `https://gamma-api.polymarket.com/events?clobTokenIds=${position.assetId}`;
      const res = await axios.get(gammaUrl, { timeout: 8000 });
      const events = res.data;

      if (!events || events.length === 0) continue;

      const event = events[0];
      const markets = event.markets || [];

      let resolvedMarket = null;
      let isWinner = false;

      for (const market of markets) {
        const tokenIds: string[] = typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : market.clobTokenIds || [];
        const tokenIndex = tokenIds.indexOf(position.assetId);

        if (tokenIndex !== -1) {
          if (market.closed && market.active === false) {
             resolvedMarket = market;
             // Check if this outcome won
             try {
               const outcomePrices = typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices || [];
               // If the market is resolved and this outcome is 1.0, it's a winner
               // Otherwise, if we can't parse, look for other resolution flags or assume price 1
               if (outcomePrices[tokenIndex] === "1" || outcomePrices[tokenIndex] === 1) {
                 isWinner = true;
               }
             } catch (e) {
               console.warn("Could not parse outcomePrices for resolved paper market");
             }
          }
          break;
        }
      }

      // If the market is closed and resolved
      if (resolvedMarket) {
        let payout = 0;
        let realizedPnl = -position.costBasis; // Start with total loss

        if (isWinner) {
          // If won, payout is 1 USDC per share (size)
          payout = position.size;
          realizedPnl = payout - position.costBasis;
        }

        // Close the position
        await positionsCol.updateOne(
          { _id: position._id },
          {
            $set: {
              status: "CLOSED",
              closedAt: new Date(),
              market: resolvedMarket.question || event.title || position.market,
            },
            $inc: { realizedPnl: realizedPnl }
          }
        );

        // Update balance if there is a payout
        if (payout > 0) {
          await balanceCol.updateOne(
            {},
            { $inc: { balance: payout }, $set: { updatedAt: new Date() } },
            { upsert: true }
          );
          console.log(`[PAPER TRADING] Market resolved. Position won! Payout: $${payout.toFixed(2)}, PNL: $${realizedPnl.toFixed(2)}`);
        } else {
          console.log(`[PAPER TRADING] Market resolved. Position lost. PNL: $${realizedPnl.toFixed(2)}`);
        }
      }
    } catch (error: any) {
      // If 404, might not be available yet or something else. We'll just skip and check again later
      if (error.response && error.response.status !== 404) {
        console.error(`Failed to check resolution for paper position ${position.assetId}:`, error.message);
      }
    }
  }
}
