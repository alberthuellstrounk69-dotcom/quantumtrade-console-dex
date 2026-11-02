# QuantumTrade Console

QuantumTrade Console is a non-custodial EVM swap interface backed by an authenticated, app-owned tRPC API. The server currently uses the Uniswap Trading API as its routing provider. API credentials stay server-side; the browser receives normalized quotes and validated unsigned transactions, then asks the connected wallet to sign approvals and swaps.

## DEX API

All DEX procedures require Manus authentication:

- `dex.listTokens` returns enabled assets from the curated registry, optionally filtered by chain.
- `dex.getQuote` requests an exact-input quote in token base units and stores the user-scoped quote for 30 seconds.
- `dex.prepareSwap` verifies quote ownership and expiry, then asks Uniswap’s approval endpoint for a current ERC-20 approval plan.
- `dex.recordSubmission` stores approval/swap hashes and the client-observed receipt outcome.
- `dex.getSwapStatus` returns the authenticated user’s quote/swap lifecycle state.
- `dex.getHistory` returns the user’s latest 50 swaps.

The initial allowlist covers Ethereum, Base, and Arbitrum for selected WETH, USDC, USDT, DAI, WBTC, and USDbC assets. Expand it only after verifying token addresses, decimals, chain support, and token risk.

## Configuration

Set `UNISWAP_API_KEY` as a **server-side WebDev Secret**. Do not add it to `VITE_*` variables, source files, client bundles, or committed `.env` files. The current project key passed a live read-only authentication test. If the secret is missing or rejected, quote/preparation procedures return a configuration error rather than exposing key material.

The frontend needs an EIP-1193-compatible wallet. The wallet signs every approval and swap; no seed phrase or private key is sent to QuantumTrade. The client waits for transaction receipts and decodes ERC-20 transfer logs for the actual buy amount. Swap history records this client-observed result and should not be treated as an independent server-verified settlement ledger.

## Database

`drizzle/schema.ts` declares `dex_quotes` and `dex_swaps`. A bootstrap migration is in `drizzle/0000_same_reavers.sql`; it uses `IF NOT EXISTS` because the project database already contained these tables when the application source was restored. The migration was applied idempotently without dropping or rewriting existing data.

## Development and validation

```sh
pnpm check
pnpm test
pnpm build
```

Tests cover the allowlist, integer slippage calculations, address validation, the existing auth logout behavior, and a read-only Uniswap credential request. The live credential test skips when `UNISWAP_API_KEY` is not configured.

## Current scope and production follow-ups

This version uses Uniswap only. A 0x provider is not enabled. Price impact is shown as “Not supplied” when the provider response does not contain a supported impact metric. Before production use with real value, add server-side chain receipt verification, rate limiting and abuse controls, structured monitoring, and a testnet end-to-end review of approval reset and receipt handling.


## Provider references

- [Aggregator quote API](https://developers.uniswap.org/docs/api-reference/aggregator_quote)
- [Check approval API](https://developers.uniswap.org/docs/api-reference/check_approval)
- [Create swap transaction API](https://developers.uniswap.org/docs/api-reference/create_swap_transaction)
