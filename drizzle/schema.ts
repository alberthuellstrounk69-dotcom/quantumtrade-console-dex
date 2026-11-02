import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const dexQuotes = mysqlTable("dex_quotes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  quoteId: varchar("quoteId", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  chainId: int("chainId").notNull(),
  takerAddress: varchar("takerAddress", { length: 42 }).notNull(),
  sellToken: varchar("sellToken", { length: 42 }).notNull(),
  buyToken: varchar("buyToken", { length: 42 }).notNull(),
  sellAmount: varchar("sellAmount", { length: 80 }).notNull(),
  quotedBuyAmount: varchar("quotedBuyAmount", { length: 80 }).notNull(),
  minimumBuyAmount: varchar("minimumBuyAmount", { length: 80 }).notNull(),
  slippageBps: int("slippageBps").notNull(),
  priceImpactBps: int("priceImpactBps"),
  routeData: text("routeData").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  quoteIdUnique: uniqueIndex("dex_quotes_quoteId_unique").on(table.quoteId),
  userCreatedIndex: index("dex_quotes_user_created_idx").on(table.userId, table.createdAt),
}));

export const dexSwaps = mysqlTable("dex_swaps", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  quoteId: varchar("quoteId", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  chainId: int("chainId").notNull(),
  walletAddress: varchar("walletAddress", { length: 42 }).notNull(),
  sellToken: varchar("sellToken", { length: 42 }).notNull(),
  buyToken: varchar("buyToken", { length: 42 }).notNull(),
  sellAmount: varchar("sellAmount", { length: 80 }).notNull(),
  quotedBuyAmount: varchar("quotedBuyAmount", { length: 80 }).notNull(),
  actualBuyAmount: varchar("actualBuyAmount", { length: 80 }),
  minimumBuyAmount: varchar("minimumBuyAmount", { length: 80 }).notNull(),
  slippageBps: int("slippageBps").notNull(),
  priceImpactBps: int("priceImpactBps"),
  approvalTxHash: varchar("approvalTxHash", { length: 66 }),
  swapTxHash: varchar("swapTxHash", { length: 66 }),
  status: mysqlEnum("status", ["quoted", "awaiting_approval", "approval_submitted", "awaiting_swap", "submitted", "confirmed", "failed", "expired"]).default("quoted").notNull(),
  failureReason: text("failureReason"),
  submittedAt: timestamp("submittedAt"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  quoteIdUnique: uniqueIndex("dex_swaps_quoteId_unique").on(table.quoteId),
  userCreatedIndex: index("dex_swaps_user_created_idx").on(table.userId, table.createdAt),
}));

export type DexQuote = typeof dexQuotes.$inferSelect;
export type InsertDexQuote = typeof dexQuotes.$inferInsert;
export type DexSwap = typeof dexSwaps.$inferSelect;
export type InsertDexSwap = typeof dexSwaps.$inferInsert;
