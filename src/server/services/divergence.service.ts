import axios from "axios";
import { getBtcPrice } from "./btc.service.js";
import { DivergenceState } from "../../types/index.js";

interface PricePoint { ts: number; price: number; }
const btcRingBuffer: PricePoint[] = [];   // 5s samples, 10-min window
export const yesRingBuffer: PricePoint[] = [];   // YES token ask price
export let currentWindowYesTokenId: string | null = null;
export let currentWindowNoTokenId:  string | null = null;

export let divergenceState: DivergenceState | null = null;
let divergenceTrackerInterval: NodeJS.Timeout | null = null;

export function setCurrentWindowTokens(yesId: string | null, noId: string | null) {
  if (currentWindowYesTokenId !== yesId) {
    yesRingBuffer.length = 0; // Clear buffer on window rollover
    currentWindowYesTokenId = yesId;
  }
  currentWindowNoTokenId = noId;
}

export function startDivergenceTracker() {
  if (divergenceTrackerInterval) return;

  const tick = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);

      // 1. BTC price sample
      const btcData = await getBtcPrice();
      const btcPrice = btcData?.price ? parseFloat(btcData.price as any) : null;
      if (btcPrice && btcPrice > 0) {
        btcRingBuffer.push({ ts: now, price: btcPrice });
        if (btcRingBuffer.length > 120) btcRingBuffer.shift(); // 10-min cap
      }

      // 2. YES / NO token ask price sample (current window)
      let yesAsk: number | null = null;
      let noAsk:  number | null = null;

      if (currentWindowYesTokenId) {
        try {
          const r = await axios.get(
            `https://clob.polymarket.com/book?token_id=${currentWindowYesTokenId}`,
            { timeout: 4000 }
          );
          const asks: any[] = r.data?.asks ?? [];
          const bids: any[] = r.data?.bids ?? [];
          yesAsk = asks.length > 0 ? parseFloat(asks[0].price)
                 : bids.length > 0 ? parseFloat(bids[0].price) : null;
          if (yesAsk && yesAsk > 0) {
            yesRingBuffer.push({ ts: now, price: yesAsk });
            if (yesRingBuffer.length > 120) yesRingBuffer.shift();
          }
        } catch { /* non-fatal */ }
      }

      if (currentWindowNoTokenId) {
        try {
          const r = await axios.get(
            `https://clob.polymarket.com/book?token_id=${currentWindowNoTokenId}`,
            { timeout: 4000 }
          );
          const asks: any[] = r.data?.asks ?? [];
          const bids: any[] = r.data?.bids ?? [];
          noAsk = asks.length > 0 ? parseFloat(asks[0].price)
                : bids.length > 0 ? parseFloat(bids[0].price) : null;
        } catch { /* non-fatal */ }
      }

      // 3. Compute 30s and 60s deltas from ring buffers
      const btcNow = btcRingBuffer.length > 0 ? btcRingBuffer[btcRingBuffer.length - 1].price : null;
      const yesNow = yesRingBuffer.length > 0 ? yesRingBuffer[yesRingBuffer.length - 1].price : null;

      const findNearest = (buf: PricePoint[], targetTs: number) =>
        buf.reduce<PricePoint | null>((best, p) => {
          if (p.ts > targetTs) return best;
          if (!best || Math.abs(p.ts - targetTs) < Math.abs(best.ts - targetTs)) return p;
          return best;
        }, null);

      const btc30ref = findNearest(btcRingBuffer, now - 30);
      const btc60ref = findNearest(btcRingBuffer, now - 60);
      const yes30ref = findNearest(yesRingBuffer, now - 30);

      const btcDelta30s = btcNow && btc30ref ? btcNow - btc30ref.price : 0;
      const btcDelta60s = btcNow && btc60ref ? btcNow - btc60ref.price : 0;
      const yesDelta30s = yesNow && yes30ref ? (yesNow - yes30ref.price) * 100 : 0; // in ¢

      // 4. Classify divergence
      // A divergence occurs when BTC moves meaningfully but the YES token hasn't repriced
      const BTC_STRONG = 100; // $100 in 30s
      const BTC_MOD    = 60;  // $60
      const BTC_WEAK   = 30;  // $30
      const YES_LAG    = 2.0; // ¢ — YES hasn't moved at least 2¢ in BTC's direction

      let direction: DivergenceState["direction"] = "NEUTRAL";
      let strength:  DivergenceState["strength"]  = "NONE";
      let divergence = 0;

      const absBtc = Math.abs(btcDelta30s);

      if (absBtc >= BTC_WEAK) {
        direction = btcDelta30s > 0 ? "UP" : "DOWN";
        const yesInBtcDir = direction === "UP" ? yesDelta30s : -yesDelta30s;
        const yesLagging  = yesInBtcDir < YES_LAG; // YES hasn't caught up

        divergence = absBtc / BTC_STRONG; // normalized 0–1+

        if      (absBtc >= BTC_STRONG && yesLagging) strength = "STRONG";
        else if (absBtc >= BTC_MOD    && yesLagging) strength = "MODERATE";
        else if (absBtc >= BTC_WEAK   && yesLagging) strength = "WEAK";
        else direction = "NEUTRAL"; // BTC moved but YES kept pace — no lag
      }

      divergenceState = {
        btcDelta30s, btcDelta60s, yesDelta30s,
        divergence, direction, strength,
        currentBtcPrice: btcNow,
        currentYesAsk: yesAsk,
        currentNoAsk: noAsk,
        updatedAt: now,
      };

    } catch { /* never crash the tracker */ }
  };

  void tick();
  divergenceTrackerInterval = setInterval(() => void tick(), 5000);
  console.log("[Divergence] Tracker started — 5s BTC vs YES token lag detector");
}