import { describe, expect, it } from "vitest";
import { calculateMinimum, isAddress, assertUnsignedTransaction } from "./provider";
import { assertApprovalTransaction, decodeApprovalSpender } from "./allowance";
import { findToken, listTokens, TOKEN_REGISTRY } from "./tokenRegistry";

describe("QuantumTrade API primitives", () => {
  it("only lists curated enabled assets by supported chain", () => {
    expect(listTokens(1).some((token) => token.symbol === "WETH")).toBe(true);
    expect(listTokens(8453).some((token) => token.symbol === "USDC")).toBe(true);
    expect(listTokens(42161).some((token) => token.symbol === "USDT")).toBe(true);
    expect(findToken(1, "0x1111111111111111111111111111111111111111")).toBeUndefined();
    expect(TOKEN_REGISTRY.every((token) => isAddress(token.address))).toBe(true);
  });

  it("uses integer arithmetic for the minimum output", () => {
    expect(calculateMinimum("1000000", 50)).toBe("995000");
    expect(calculateMinimum("100", 100)).toBe("99");
    expect(() => calculateMinimum("1", 10_001)).toThrow();
  });

  it("validates EVM address shape before accepting provider addresses", () => {
    expect(isAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true);
    expect(isAddress("0x1234")).toBe(false);
    expect(isAddress("not-an-address" )).toBe(false);
  });

  it("blocks malformed or cross-chain provider transactions", () => {
    const valid = { to: "0x1111111111111111111111111111111111111111", data: "0x12345678", value: "0", chainId: 1 };
    expect(assertUnsignedTransaction(valid, 1).to).toBe(valid.to);
    expect(() => assertUnsignedTransaction({ ...valid, chainId: 8453 }, 1)).toThrow();
    expect(() => assertUnsignedTransaction({ ...valid, data: "0x" }, 1)).toThrow();
  });

  it("only accepts standard approve calldata targeting the expected token", () => {
    const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const spender = "0x1111111111111111111111111111111111111111";
    const data = `0x095ea7b3${"0".repeat(24)}${spender.slice(2)}${"0".repeat(64)}`;
    const approval = assertApprovalTransaction({ to: token, data, value: "0", chainId: 1 }, 1, token);
    expect(decodeApprovalSpender(approval, token)?.toLowerCase()).toBe(spender.toLowerCase());
    expect(() => assertApprovalTransaction({ to: spender, data, value: "0", chainId: 1 }, 1, token)).toThrow();
  });
});
