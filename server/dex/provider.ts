import { TRPCError } from "@trpc/server";
import type { UnsignedTransaction } from "./types";

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function assertUnsignedTransaction(value: unknown, expectedChainId: number): UnsignedTransaction {
  if (!value || typeof value !== "object") throw new TRPCError({ code: "BAD_GATEWAY", message: "Provider did not return a transaction." });
  const tx = value as Record<string, unknown>;
  const to = typeof tx.to === "string" ? tx.to : "";
  const data = typeof tx.data === "string" ? tx.data : "";
  const valueWei = typeof tx.value === "string" ? tx.value : "0";
  const chainId = typeof tx.chainId === "number" ? tx.chainId : expectedChainId;
  if (!isAddress(to) || !/^0x(?:[a-fA-F0-9]{2})+$/.test(data) || !/^\d+$/.test(valueWei) || chainId !== expectedChainId) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Provider returned an invalid transaction payload; signing was blocked." });
  }
  const gas = typeof tx.gasLimit === "string" && /^\d+$/.test(tx.gasLimit) ? tx.gasLimit : undefined;
  return { to, data, value: valueWei, ...(gas ? { gas } : {}), chainId };
}

export function calculateMinimum(amount: string, slippageBps: number) {
  if (!/^\d+$/.test(amount) || BigInt(amount) <= BigInt(0) || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error("Amount or slippage setting is outside the valid range.");
  }
  return ((BigInt(amount) * BigInt(10_000 - slippageBps)) / BigInt(10_000)).toString();
}
