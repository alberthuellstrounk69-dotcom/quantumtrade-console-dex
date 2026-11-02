import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dexQuotes, dexSwaps, type DexQuote, type DexSwap } from "../../drizzle/schema";
import { getDb } from "../db";
import type { SwapStatus } from "./types";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable.");
  return db;
}

export async function insertQuote(input: Omit<DexQuote, "id" | "createdAt">) {
  const db = await database();
  await db.insert(dexQuotes).values({ ...input, id: randomUUID() });
}

export async function getUserQuote(quoteId: string, userId: number): Promise<DexQuote | undefined> {
  const db = await database();
  const rows = await db.select().from(dexQuotes).where(and(eq(dexQuotes.quoteId, quoteId), eq(dexQuotes.userId, userId))).limit(1);
  return rows[0];
}

export async function getUserSwap(quoteId: string, userId: number): Promise<DexSwap | undefined> {
  const db = await database();
  const rows = await db.select().from(dexSwaps).where(and(eq(dexSwaps.quoteId, quoteId), eq(dexSwaps.userId, userId))).limit(1);
  return rows[0];
}

export async function createSwapIfMissing(input: {
  userId: number;
  quoteId: string;
  provider: string;
  chainId: number;
  walletAddress: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  quotedBuyAmount: string;
  minimumBuyAmount: string;
  slippageBps: number;
  priceImpactBps: number | null;
  status: SwapStatus;
}): Promise<DexSwap> {
  const db = await database();
  const existing = await getUserSwap(input.quoteId, input.userId);
  if (existing) return existing;
  await db.insert(dexSwaps).values({ ...input, id: randomUUID() }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  const created = await getUserSwap(input.quoteId, input.userId);
  if (!created) throw new Error("Swap record could not be created.");
  return created;
}

export async function updateUserSwap(quoteId: string, userId: number, patch: Partial<Pick<DexSwap, "approvalTxHash" | "swapTxHash" | "actualBuyAmount" | "status" | "failureReason" | "submittedAt" | "confirmedAt">>) {
  const db = await database();
  await db.update(dexSwaps)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(dexSwaps.quoteId, quoteId), eq(dexSwaps.userId, userId)));
  return getUserSwap(quoteId, userId);
}

export async function listUserSwaps(userId: number, limit = 50) {
  const db = await database();
  return db.select().from(dexSwaps).where(eq(dexSwaps.userId, userId)).orderBy(desc(dexSwaps.createdAt)).limit(limit);
}
