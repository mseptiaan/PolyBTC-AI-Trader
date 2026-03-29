import { MongoClient, Db } from "mongodb";
import { config } from "../config/index.js";
import { CacheDocument, BtcPriceSnapshotDocument, BtcCandleDocument, PositionAutomationDocument, BtcCandle } from "../../types/index.js";

let mongoDb: Db | null = null;
let mongoInitPromise: Promise<Db | null> | null = null;

export async function getMongoDb() {
  if (!config.MONGODB_URI) return null;
  if (mongoDb) return mongoDb;
  if (mongoInitPromise) return mongoInitPromise;

  mongoInitPromise = (async () => {
    try {
      const client = new MongoClient(config.MONGODB_URI!);
      await client.connect();
      mongoDb = config.MONGODB_DB_NAME ? client.db(config.MONGODB_DB_NAME) : client.db();
      return mongoDb;
    } catch (error: any) {
      console.warn("MongoDB connection failed. Continuing without persistent BTC cache.", error?.message || error);
      return null;
    } finally {
      mongoInitPromise = null;
    }
  })();

  return mongoInitPromise;
}

export async function getCacheCollection() {
  const db = await getMongoDb();
  return db?.collection<CacheDocument<any>>(config.MONGODB_CACHE_COLLECTION) || null;
}

export async function getPriceSnapshotsCollection() {
  const db = await getMongoDb();
  return db?.collection<BtcPriceSnapshotDocument>(config.MONGODB_PRICE_SNAPSHOTS_COLLECTION) || null;
}

export async function getCandlesCollection() {
  const db = await getMongoDb();
  return db?.collection<BtcCandleDocument>(config.MONGODB_CHART_COLLECTION) || null;
}

export async function getPositionAutomationCollection() {
  const db = await getMongoDb();
  return db?.collection<PositionAutomationDocument>(config.MONGODB_POSITION_AUTOMATION_COLLECTION) || null;
}

export async function ensureMongoCollections() {
  try {
    const db = await getMongoDb();
    if (!db) return;

    const marketCache = db.collection(config.MONGODB_CACHE_COLLECTION);
    const priceSnapshots = db.collection(config.MONGODB_PRICE_SNAPSHOTS_COLLECTION);
    const candles = db.collection(config.MONGODB_CHART_COLLECTION);
    const automations = db.collection(config.MONGODB_POSITION_AUTOMATION_COLLECTION);

    await Promise.all([
      marketCache.createIndex({ fetchedAt: -1 }),
      priceSnapshots.createIndex({ symbol: 1, fetchedAt: -1 }),
      priceSnapshots.createIndex({ fetchedAt: -1 }),
      priceSnapshots.createIndex(
        { fetchedAt: 1 },
        { expireAfterSeconds: config.BTC_PRICE_SNAPSHOT_TTL_SECONDS, name: "btc_price_ttl" }
      ),
      candles.createIndex({ symbol: 1, interval: 1, time: -1 }, { unique: true }),
      candles.createIndex({ fetchedAt: -1 }),
      candles.createIndex(
        { fetchedAt: 1 },
        { expireAfterSeconds: config.BTC_CANDLE_TTL_SECONDS, name: "btc_candle_ttl" }
      ),
      automations.createIndex({ assetId: 1 }, { unique: true }),
      automations.createIndex({ armed: 1, updatedAt: -1 }),
    ]);
  } catch (error: any) {
    console.warn("MongoDB index initialization failed:", error?.message || error);
  }
}

export async function readPersistentCache<T>(id: string, maxAgeMs: number) {
  const collection = await getCacheCollection();
  if (!collection) return null;

  const doc = await collection.findOne({ _id: id });
  if (!doc) return null;

  const ageMs = Date.now() - new Date(doc.fetchedAt).getTime();
  return {
    payload: doc.payload as T,
    source: ageMs <= maxAgeMs ? "mongo-cache" : "mongo-stale-cache",
    fetchedAt: doc.fetchedAt,
    stale: ageMs > maxAgeMs,
  };
}

export async function writePersistentCache<T>(id: string, payload: T, source: string) {
  const collection = await getCacheCollection();
  if (!collection) return;

  await collection.updateOne(
    { _id: id },
    {
      $set: {
        payload,
        source,
        fetchedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function writeBtcPriceSnapshot(payload: { symbol: string; price: string; source?: string }) {
  const collection = await getPriceSnapshotsCollection();
  if (!collection) return;

  const numericPrice = Number(payload.price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return;

  await collection.insertOne({
    symbol: payload.symbol,
    price: numericPrice,
    source: payload.source || "unknown",
    fetchedAt: new Date(),
  });
}

export async function writeBtcCandles(history: BtcCandle[], source: string) {
  const collection = await getCandlesCollection();
  if (!collection || !history.length) return;

  await collection.bulkWrite(
    history.map((candle) => ({
      updateOne: {
        filter: { symbol: "BTCUSDT", interval: "1m", time: candle.time },
        update: {
          $set: {
            symbol: "BTCUSDT",
            interval: "1m",
            time: candle.time,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: Number(candle.volume || 0),
            source,
            fetchedAt: new Date(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

export function getCacheMeta(expiresAt?: number) {
  const now = Date.now();
  const ageMs = expiresAt ? Math.max(0, expiresAt - now) : null;
  return {
    stale: expiresAt ? expiresAt <= now : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    ttlRemainingMs: ageMs,
  };
}
