import { TRPCError } from "@trpc/server";
import type { SwapQuoteRequest, UnsignedTransaction } from "./types";
import { assertUnsignedTransaction, calculateMinimum, isAddress } from "./provider";
import { assertApprovalTransaction, decodeApprovalSpender } from "./allowance";

export { calculateMinimum, isAddress } from "./provider";

const BASE_URL = "https://trade-api.gateway.uniswap.org/v1";
const ROUTER_VERSION = "2.1.2";
function requireApiKey() {
  const key = process.env.UNISWAP_API_KEY?.trim();
  if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Uniswap API is not configured. Add UNISWAP_API_KEY to project Secrets." });
  return key;
}

function parseError(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      if (typeof record[key] === "string") return (record[key] as string).slice(0, 300);
    }
  }
  return `Uniswap API request failed (HTTP ${status}).`;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": requireApiKey(),
      "x-universal-router-version": ROUTER_VERSION,
      "x-permit2-disabled": "true",
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Uniswap API rejected the configured key. Replace UNISWAP_API_KEY in project Secrets." });
    }
    if (response.status === 429) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Uniswap API rate limit reached. Try again shortly." });
    throw new TRPCError({ code: "BAD_GATEWAY", message: parseError(payload, response.status) });
  }
  return payload as Record<string, unknown>;
}

export async function getProviderQuote(request: SwapQuoteRequest) {
  const response = await post("/quote", {
    type: "EXACT_INPUT",
    amount: request.sellAmount,
    tokenInChainId: request.chainId,
    tokenOutChainId: request.chainId,
    tokenIn: request.sellToken,
    tokenOut: request.buyToken,
    swapper: request.takerAddress,
    slippageTolerance: request.slippageBps / 100,
    permitAmount: "EXACT",
    protocols: ["V2", "V3", "V4"],
    routingPreference: "BEST_PRICE",
  });
  const quote = response.quote as Record<string, unknown> | undefined;
  if (!quote || typeof quote !== "object") throw new TRPCError({ code: "BAD_GATEWAY", message: "Uniswap returned an incomplete quote." });
  const output = quote.output as Record<string, unknown> | undefined;
  const input = quote.input as Record<string, unknown> | undefined;
  const buyAmount = typeof output?.amount === "string" ? output.amount : "";
  const minimum = typeof output?.minimumAmount === "string" ? output.minimumAmount : "";
  const sellAmount = typeof input?.amount === "string" ? input.amount : request.sellAmount;
  if (!/^\d+$/.test(buyAmount) || !/^\d+$/.test(sellAmount)) throw new TRPCError({ code: "BAD_GATEWAY", message: "Uniswap returned invalid token amounts." });

  let transaction = response.swapTransaction;
  if (!transaction) {
    const swapResponse = await post("/swap", { quote, deadline: Math.floor(Date.now() / 1000) + 1_800, safetyMode: "SAFE" });
    transaction = swapResponse.swap;
  }
  const safeTransaction = assertUnsignedTransaction(transaction, request.chainId);
  const minBuyAmount = /^\d+$/.test(minimum) ? minimum : calculateMinimum(buyAmount, request.slippageBps);
  const impactValue = quote.priceImpactBps;
  const priceImpactBps = typeof impactValue === "number" && Number.isFinite(impactValue) ? Math.round(impactValue) : undefined;

  return {
    buyAmount,
    sellAmount,
    minimumBuyAmount: minBuyAmount,
    priceImpactBps,
    estimatedGas: safeTransaction.gas,
    estimatedGasFee: typeof response.swapGasFee === "string" ? response.swapGasFee : undefined,
    transaction: safeTransaction,
    providerQuote: quote,
    routeSummary: {
      routing: typeof response.routing === "string" ? response.routing : "Uniswap",
      route: quote.route ?? quote.routeString ?? null,
    },
  };
}

export async function getApprovalPlan(input: { chainId: number; walletAddress: string; sellToken: string; sellAmount: string }) {
  const response = await post("/check_approval", {
    walletAddress: input.walletAddress,
    token: input.sellToken,
    amount: input.sellAmount,
    chainId: input.chainId,
    includeGasInfo: true,
  });
  const approval = response.approval && typeof response.approval === "object" ? response.approval : undefined;
  const cancel = response.cancel && typeof response.cancel === "object" ? response.cancel : undefined;
  const approvalTransaction = approval ? assertApprovalTransaction(approval, input.chainId, input.sellToken) : undefined;
  const cancelTransaction = cancel ? assertApprovalTransaction(cancel, input.chainId, input.sellToken) : undefined;
  const allowanceTarget = approvalTransaction ? decodeApprovalSpender(approvalTransaction, input.sellToken) : undefined;
  return { approvalTransaction, cancelTransaction, allowanceTarget };
}
