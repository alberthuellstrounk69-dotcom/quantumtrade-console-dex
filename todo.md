# QuantumTrade Console — implementation tracker

## Completed

- [x] Restored the authenticated app-owned `dex` tRPC API: token list, quote, prepare, record submission, status, and history.
- [x] Added a curated token registry for Ethereum, Base, and Arbitrum.
- [x] Integrated the validated Uniswap Trading API key on the server only; no 0x credential/provider is used.
- [x] Added quote expiry, slippage minimum-output math, transaction address/data validation, token approval checks, and user/quote ownership checks.
- [x] Added quote/swap Drizzle tables and an idempotent bootstrap migration; confirmed the existing database tables/indexes and applied the migration without destructive changes.
- [x] Built a responsive swap terminal and activity screen with wallet connect, quote review, allowance handling, wallet signatures, receipt waiting, actual output parsing, and explorer links.
- [x] Added project README and API/provider security notes.
- [x] Verified `pnpm check`, `pnpm test` (7 tests), and `pnpm build`.

## Follow-up before production use

- [ ] Verify submitted and confirmed transaction receipts server-side; current confirmation and actual-fill history are client-observed.
- [ ] Add API rate limiting, request monitoring, and abuse controls.
- [ ] Run a complete wallet-signed approval/reset/swap flow on a testnet before exposing real-value swaps.
- [ ] Add a quote refresh/status polling strategy for long approval waits and abandoned quotes.
- [ ] Re-evaluate the token allowlist and add assets only after address/decimal/risk review.
- [ ] Add a provider-reported price-impact value if Uniswap exposes a stable supported metric; otherwise keep the “Not supplied” disclosure.
- [ ] Consider adding 0x only after a valid provider credential is supplied and its transactions receive the same safety validation.
