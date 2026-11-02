import { describe, expect, it } from "vitest";

const liveIt = it.skipIf(!process.env.UNISWAP_API_KEY);

describe("live Uniswap credential validation", () => {
  liveIt("authenticates a quote-only request without exposing the configured key", async () => {
    const response = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
      method: "POST",
      headers: {
        "x-api-key": process.env.UNISWAP_API_KEY!,
        "x-permit2-disabled": "true",
        "x-universal-router-version": "2.1.2",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        type: "EXACT_INPUT",
        amount: "1000000000000000",
        tokenInChainId: 1,
        tokenOutChainId: 1,
        tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        swapper: "0x000000000000000000000000000000000000dEaD",
        slippageTolerance: 0.5,
        permitAmount: "EXACT",
        protocols: ["V2", "V3", "V4"],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    expect([401, 403], `Uniswap rejected the configured key with HTTP ${response.status}.`).not.toContain(response.status);
    expect(response.status).toBeLessThan(500);
    await response.body?.cancel();
  }, 25_000);
});
