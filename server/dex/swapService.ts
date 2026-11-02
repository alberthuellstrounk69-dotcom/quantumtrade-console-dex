import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createSwapIfMissing, getUserQuote, getUserSwap, insertQuote, listUserSwaps, updateUserSwap } from "./repository";
import { calculateMinimum, getApprovalPlan, getProviderQuote, isAddress } from "./uniswapProvider";
import { findToken } from "./tokenRegistry";
import type { SwapQuoteRequest, SwapStatus, UnsignedTransaction } from "./types";

const MAX_UINT256 = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
const QUOTE_TTL_MS = 30_000;

function validateRequest(input: SwapQuoteRequest) {
  if (!Number.isInteger(input.chainId) || !findToken(input.chainId, input.sellToken) || !findToken(input.chainId, input.buyToken)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select tokens from the curated registry for a supported network." });
  }
  if (input.sellToken.toLowerCase() === input.buyToken.toLowerCase()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sell and buy tokens must be different." });
  }
  if (!isAddress(input.takerAddress)) throw new TRPCError({ code: "BAD_REQUEST", message: "Wallet address is invalid." });
  if (!/^\d{1,78}$/.test(input.sellAmount) || BigInt(input.sellAmount) <= BigInt(0) || BigInt(input.sellAmount) > MAX_UINT256) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sell amount must be a positive base-unit integer." });
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 500) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Slippage must be between 0.01% and 5%." });
  }
}

function unpackRoute(quote: { routeData: string }): {
  transaction: UnsignedTransaction;
  providerQuote: Record<string, unknown>;
  routeSummary: unknown;
  estimatedGasFee?: string;
} {
  try {
    return JSON.parse(quote.routeData) as ReturnType<typeof unpackRoute>;
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stored quote data could not be read." });
  }
}

export async function getQuote(userId: number, input: SwapQuoteRequest) {
  validateRequest(input);
  let providerQuote;
  try {
    providerQuote = await getProviderQuote(input);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "Quote provider is unavailable." });
  }
  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
  const priceImpactBps = providerQuote.priceImpactBps ?? null;
  const routeData = JSON.stringify({
    transaction: providerQuote.transaction,
    providerQuote: providerQuote.providerQuote,
    routeSummary: providerQuote.routeSummary,
    estimatedGasFee: providerQuote.estimatedGasFee,
  });
  await insertQuote({
    userId,
    quoteId,
    provider: "uniswap",
    chainId: input.chainId,
    takerAddress: input.takerAddress,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: providerQuote.sellAmount,
    quotedBuyAmount: providerQuote.buyAmount,
    minimumBuyAmount: providerQuote.minimumBuyAmount,
    slippageBps: input.slippageBps,
    priceImpactBps,
    routeData,
    expiresAt,
  });
  return {
    provider: "Uniswap",
    chainId: input.chainId,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: providerQuote.sellAmount,
    buyAmount: providerQuote.buyAmount,
    minimumBuyAmount: providerQuote.minimumBuyAmount,
    slippageBps: input.slippageBps,
    priceImpactBps: providerQuote.priceImpactBps,
    estimatedGas: providerQuote.estimatedGas,
    estimatedGasFee: providerQuote.estimatedGasFee,
    approvalRequired: true,
    transaction: providerQuote.transaction,
    routeSummary: providerQuote.routeSummary,
    expiresAt: expiresAt.toISOString(),
    quoteId,
  };
}

export async function prepareSwap(userId: number, quoteId: string, walletAddress: string) {
  if (!isAddress(walletAddress)) throw new TRPCError({ code: "BAD_REQUEST", message: "Wallet address is invalid." });
  const quote = await getUserQuote(quoteId, userId);
  if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found." });
  if (quote.takerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The quote belongs to a different wallet." });
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    const existing = await getUserSwap(quoteId, userId);
    if (existing && !["submitted", "confirmed"].includes(existing.status)) await updateUserSwap(quoteId, userId, { status: "expired" });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Quote expired. Request a fresh quote." });
  }

  const route = unpackRoute(quote);
  const approval = await getApprovalPlan({ chainId: quote.chainId, walletAddress, sellToken: quote.sellToken, sellAmount: quote.sellAmount });
  const approvalRequired = Boolean(approval.cancelTransaction || approval.approvalTransaction);
  const status: SwapStatus = approvalRequired ? "awaiting_approval" : "awaiting_swap";
  const swap = await createSwapIfMissing({
    userId,
    quoteId,
    provider: quote.provider,
    chainId: quote.chainId,
    walletAddress,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    sellAmount: quote.sellAmount,
    quotedBuyAmount: quote.quotedBuyAmount,
    minimumBuyAmount: quote.minimumBuyAmount,
    slippageBps: quote.slippageBps,
    priceImpactBps: quote.priceImpactBps,
    status,
  });
  return {
    quoteId,
    status: swap.status,
    chainId: quote.chainId,
    sellAmount: quote.sellAmount,
    approvalRequired,
    allowanceTarget: approval.allowanceTarget,
    approvalTransaction: approval.approvalTransaction,
    cancelTransaction: approval.cancelTransaction,
    transaction: route.transaction,
  };
}

export async function recordSubmission(userId: number, input: {
  quoteId: string;
  walletAddress: string;
  approvalTxHash?: string;
  swapTxHash?: string;
  status?: SwapStatus;
  actualBuyAmount?: string;
  failureReason?: string;
}) {
  const quote = await getUserQuote(input.quoteId, userId);
  if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found." });
  if (!isAddress(input.walletAddress) || input.walletAddress.toLowerCase() !== quote.takerAddress.toLowerCase()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Wallet does not match the quote." });
  }
  for (const hash of [input.approvalTxHash, input.swapTxHash]) {
    if (hash !== undefined && !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new TRPCError({ code: "BAD_REQUEST", message: "Transaction hash is invalid." });
  }
  if (input.actualBuyAmount !== undefined && !/^\d{1,78}$/.test(input.actualBuyAmount)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Actual output amount is invalid." });
  }
  const existing = await getUserSwap(input.quoteId, userId);
  if (!existing) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Prepare the swap before recording a transaction." });
  if (["confirmed", "failed"].includes(existing.status)) throw new TRPCError({ code: "CONFLICT", message: "This swap is already in a final state." });
  if ((input.status === "confirmed" || input.status === "failed") && !input.swapTxHash && !existing.swapTxHash) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A submitted swap transaction is required for a final status." });
  }
  const patch: Parameters<typeof updateUserSwap>[2] = {};
  if (input.approvalTxHash) patch.approvalTxHash = input.approvalTxHash;
  if (input.swapTxHash) {
    patch.swapTxHash = input.swapTxHash;
    patch.submittedAt = new Date();
  }
  if (input.actualBuyAmount !== undefined) patch.actualBuyAmount = input.actualBuyAmount;
  if (input.failureReason !== undefined) patch.failureReason = input.failureReason.slice(0, 500);
  if (input.status) patch.status = input.status;
  if (input.status === "confirmed" || input.status === "failed") patch.confirmedAt = new Date();
  return updateUserSwap(input.quoteId, userId, patch);
}

export async function getSwapStatus(userId: number, quoteId: string) {
  const quote = await getUserQuote(quoteId, userId);
  if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Quote or swap not found." });
  const swap = await getUserSwap(quoteId, userId);
  if (!swap) return { quoteId, status: quote.expiresAt.getTime() <= Date.now() ? "expired" as const : "quoted" as const, expiresAt: quote.expiresAt };
  const inFlight = ["quoted", "awaiting_approval", "approval_submitted", "awaiting_swap"].includes(swap.status);
  if (quote.expiresAt.getTime() <= Date.now() && inFlight) return updateUserSwap(quoteId, userId, { status: "expired" });
  return swap;
}

export function getHistory(userId: number) {
  return listUserSwaps(userId, 50);
}
