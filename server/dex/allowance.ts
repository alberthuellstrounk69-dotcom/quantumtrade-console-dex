import { TRPCError } from "@trpc/server";
import { assertUnsignedTransaction, isAddress } from "./provider";
import type { UnsignedTransaction } from "./types";

const APPROVE_SELECTOR = "0x095ea7b3";

export function decodeApprovalSpender(transaction: UnsignedTransaction, expectedToken: string): string | undefined {
  if (transaction.to.toLowerCase() !== expectedToken.toLowerCase()) return undefined;
  const data = transaction.data;
  if (data.slice(0, 10).toLowerCase() !== APPROVE_SELECTOR || data.length < 138) return undefined;
  const spender = `0x${data.slice(34, 74)}`;
  return isAddress(spender) ? spender : undefined;
}

export function assertApprovalTransaction(value: unknown, chainId: number, token: string): UnsignedTransaction {
  const transaction = assertUnsignedTransaction(value, chainId);
  if (transaction.to.toLowerCase() !== token.toLowerCase() || transaction.data.slice(0, 10).toLowerCase() !== APPROVE_SELECTOR || !decodeApprovalSpender(transaction, token)) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Provider returned an unexpected approval transaction; signing was blocked." });
  }
  return transaction;
}
