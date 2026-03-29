import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config/index.js";
import { ensureDataDirectory } from "./utils/index.js";
import { ensureMongoCollections } from "./db/index.js";
import { startBtcBackgroundSync } from "./services/btc.service.js";
import { startDivergenceTracker } from "./services/divergence.service.js";
import { initLearningState, botEnabled } from "./services/bot.service.js";

import btcRouter from "./routes/btc.router.js";
import botRouter from "./routes/bot.router.js";
import polymarketRouter from "./routes/polymarket.router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize backend services
  ensureDataDirectory();
  initLearningState();
  void ensureMongoCollections();
  startBtcBackgroundSync();
  startDivergenceTracker();
  // Start the bot loop if enabled
  if (botEnabled) {
    // startBot(); // Would be exported from bot.service.ts
  }

  app.use(express.json());

  // Mount routers
  app.use(btcRouter);
  app.use(botRouter);
  app.use(polymarketRouter);

  // Fallback API route proxy for sentiment
  app.get("/api/sentiment", async (req, res) => {
    try {
      const response = await fetch("https://api.alternative.me/fng/");
      const data = await response.json();
      res.json(data.data[0]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sentiment data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();