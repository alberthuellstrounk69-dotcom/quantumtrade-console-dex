import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getHistory, getQuote, getSwapStatus, prepareSwap, recordSubmission } from "./swapService";
import { listTokens } from "./tokenRegistry";
import { SWAP_STATUSES } from "./types";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const amount = z.string().regex(/^\d{1,78}$/);

export const dexRouter = router({
  listTokens: protectedProcedure
    .input(z.object({ chainId: z.number().int().optional() }))
    .query(({ input }) => ({ tokens: listTokens(input.chainId) })),

  getQuote: protectedProcedure
    .input(z.object({
      chainId: z.number().int(),
      sellToken: address,
      buyToken: address,
      sellAmount: amount,
      takerAddress: address,
      slippageBps: z.number().int().min(1).max(500),
    }))
    .query(({ ctx, input }) => getQuote(ctx.user.id, input as Parameters<typeof getQuote>[1])),

  prepareSwap: protectedProcedure
    .input(z.object({ quoteId: z.string().uuid(), walletAddress: address }))
    .mutation(({ ctx, input }) => prepareSwap(ctx.user.id, input.quoteId, input.walletAddress)),

  recordSubmission: protectedProcedure
    .input(z.object({
      quoteId: z.string().uuid(),
      walletAddress: address,
      approvalTxHash: z.string().optional(),
      swapTxHash: z.string().optional(),
      status: z.enum(SWAP_STATUSES).optional(),
      actualBuyAmount: amount.optional(),
      failureReason: z.string().max(500).optional(),
    }))
    .mutation(({ ctx, input }) => recordSubmission(ctx.user.id, input)),

  getSwapStatus: protectedProcedure
    .input(z.object({ quoteId: z.string().uuid() }))
    .query(({ ctx, input }) => getSwapStatus(ctx.user.id, input.quoteId)),

  getHistory: protectedProcedure.query(({ ctx }) => getHistory(ctx.user.id)),
});
