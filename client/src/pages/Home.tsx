import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { ArrowDownUp, ArrowLeftRight, CheckCircle2, Clock3, ExternalLink, Loader2, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import type { SwapQuote, UnsignedTransaction } from "../../../server/dex/types";

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global { interface Window { ethereum?: Eip1193Provider } }

const CHAINS: Record<number, { name: string; explorer: string; rpc: string; currency: string }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io/tx/", rpc: "https://cloudflare-eth.com", currency: "ETH" },
  8453: { name: "Base", explorer: "https://basescan.org/tx/", rpc: "https://mainnet.base.org", currency: "ETH" },
  42161: { name: "Arbitrum", explorer: "https://arbiscan.io/tx/", rpc: "https://arb1.arbitrum.io/rpc", currency: "ETH" },
};
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function parseUnits(value: string, decimals: number): string {
  const amount = value.trim();
  if (!/^\d*(\.\d*)?$/.test(amount) || !amount || amount === ".") throw new Error("Enter a valid token amount.");
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) throw new Error(`This token supports up to ${decimals} decimal places.`);
  const base = BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
  if (base <= BigInt(0)) throw new Error("Amount must be greater than zero.");
  return base.toString();
}

function formatUnits(raw: string | null | undefined, decimals: number, places = 6) {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  try {
    const padded = raw.padStart(decimals + 1, "0");
    const whole = decimals ? padded.slice(0, -decimals) : padded;
    const fraction = decimals ? padded.slice(-decimals).slice(0, places).replace(/0+$/, "") : "";
    const grouped = new Intl.NumberFormat("en-US").format(BigInt(whole || "0"));
    return fraction ? `${grouped}.${fraction}` : grouped;
  } catch { return "—"; }
}

function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function formatError(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message.replace(/^\[.*?\]\s*/, "");
  return "Request failed. Please try again.";
}
function toHexQuantity(value: string) { return `0x${BigInt(value || "0").toString(16)}`; }

async function switchWalletChain(provider: Eip1193Provider, chainId: number) {
  const current = await provider.request({ method: "eth_chainId" });
  const currentId = typeof current === "string" ? Number.parseInt(current, 16) : Number(current);
  if (currentId === chainId) return;
  const network = CHAINS[chainId];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: `0x${chainId.toString(16)}`,
      chainName: network.name,
      nativeCurrency: { name: network.currency, symbol: network.currency, decimals: 18 },
      rpcUrls: [network.rpc],
      blockExplorerUrls: [network.explorer.replace(/tx\/$/, "")],
    }] });
  }
}

async function sendWalletTransaction(provider: Eip1193Provider, walletAddress: string, transaction: UnsignedTransaction) {
  const tx: Record<string, string> = {
    from: walletAddress,
    to: transaction.to,
    data: transaction.data,
    value: toHexQuantity(transaction.value),
  };
  if (transaction.gas) tx.gas = toHexQuantity(transaction.gas);
  const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("Wallet did not return a valid transaction hash.");
  return hash;
}

async function waitForReceipt(provider: Eip1193Provider, hash: string) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }) as Record<string, unknown> | null;
    if (receipt) {
      const status = String(receipt.status ?? "").toLowerCase();
      if (status === "0x0" || status === "0x00") throw new Error("Transaction reverted on-chain.");
      return receipt;
    }
    await sleep(2_000);
  }
  throw new Error("Receipt is not available yet. Use the transaction link to check its status.");
}

function receivedAmount(receipt: Record<string, unknown>, token: string, wallet: string): string | undefined {
  const logs = Array.isArray(receipt.logs) ? receipt.logs as Array<Record<string, unknown>> : [];
  let total = BigInt(0);
  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? log.topics.map(String) : [];
    if (typeof log.address !== "string" || log.address.toLowerCase() !== token.toLowerCase()) continue;
    if (topics[0]?.toLowerCase() !== TRANSFER_TOPIC || topics.length < 3) continue;
    if (`0x${topics[2].slice(-40)}`.toLowerCase() !== wallet.toLowerCase()) continue;
    if (typeof log.data === "string" && /^0x[0-9a-fA-F]{64}$/.test(log.data)) total += BigInt(log.data);
  }
  return total > BigInt(0) ? total.toString() : undefined;
}

function StateBadge({ status }: { status: string }) {
  const good = status === "confirmed";
  const bad = status === "failed" || status === "expired";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${good ? "bg-emerald-300/10 text-emerald-200" : bad ? "bg-rose-300/10 text-rose-200" : "bg-amber-300/10 text-amber-100"}`}>{status.replaceAll("_", " ")}</span>;
}

export default function Home() {
  const [location] = useLocation();
  const isHistory = location === "/history";
  const [chainId, setChainId] = useState(1);
  const chainInput = useMemo(() => ({ chainId }), [chainId]);
  const { data: registry, isLoading: tokensLoading } = trpc.dex.listTokens.useQuery(chainInput, { staleTime: 60_000 });
  const allTokenInput = useMemo(() => ({}), []);
  const { data: allRegistry } = trpc.dex.listTokens.useQuery(allTokenInput, { staleTime: 60_000 });
  const tokens = registry?.tokens ?? [];
  const allTokens = allRegistry?.tokens ?? tokens;
  const [sellTokenAddress, setSellTokenAddress] = useState("");
  const [buyTokenAddress, setBuyTokenAddress] = useState("");
  const [sellAmount, setSellAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(50);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteClock, setQuoteClock] = useState(Date.now());
  const [flow, setFlow] = useState("idle");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ hash: string; actual?: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [amountBase, setAmountBase] = useState("0");
  const utils = trpc.useUtils();
  const quoteQueryInput = useMemo(() => ({
    chainId,
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmount: amountBase,
    takerAddress: walletAddress ?? "0x0000000000000000000000000000000000000000",
    slippageBps,
  }), [chainId, sellTokenAddress, buyTokenAddress, amountBase, walletAddress, slippageBps]);
  const quoteQuery = trpc.dex.getQuote.useQuery(quoteQueryInput, { enabled: false, retry: false });
  const prepareMutation = trpc.dex.prepareSwap.useMutation();
  const recordMutation = trpc.dex.recordSubmission.useMutation();
  const historyQuery = trpc.dex.getHistory.useQuery(undefined, { enabled: isHistory, staleTime: 15_000, refetchOnWindowFocus: true });

  const sellToken = tokens.find((item) => item.address.toLowerCase() === sellTokenAddress.toLowerCase());
  const buyToken = tokens.find((item) => item.address.toLowerCase() === buyTokenAddress.toLowerCase());
  const expired = !!quote && Date.parse(quote.expiresAt) <= quoteClock;
  const secondsLeft = quote ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - quoteClock) / 1000)) : 0;
  const network = CHAINS[chainId];

  useEffect(() => {
    if (!tokens.length) return;
    setSellTokenAddress((current) => tokens.some((t) => t.address.toLowerCase() === current.toLowerCase()) ? current : (tokens.find((t) => t.symbol === "WETH") ?? tokens[0]).address);
    setBuyTokenAddress((current) => tokens.some((t) => t.address.toLowerCase() === current.toLowerCase()) && current.toLowerCase() !== sellTokenAddress.toLowerCase() ? current : (tokens.find((t) => t.symbol === "USDC") ?? tokens.find((t) => t.address.toLowerCase() !== sellTokenAddress.toLowerCase()) ?? tokens[1] ?? tokens[0]).address);
  }, [tokens, sellTokenAddress]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accountsChanged = (value: unknown) => {
      if (Array.isArray(value) && typeof value[0] === "string") setWalletAddress(value[0]);
      else setWalletAddress(null);
    };
    const chainChanged = (value: unknown) => setWalletChainId(typeof value === "string" ? Number.parseInt(value, 16) : Number(value));
    void provider.request({ method: "eth_accounts" }).then(accountsChanged).catch(() => undefined);
    void provider.request({ method: "eth_chainId" }).then(chainChanged).catch(() => undefined);
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    return () => { provider.removeListener?.("accountsChanged", accountsChanged); provider.removeListener?.("chainChanged", chainChanged); };
  }, []);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const clearQuote = () => { setQuote(null); setSuccess(null); setError(""); setFlow("idle"); setAmountBase("0"); };

  const connectWallet = async () => {
    if (!window.ethereum) { toast.error("Open this app in an EVM wallet browser or install a compatible wallet."); return; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Wallet did not return an address.");
      setWalletAddress(accounts[0]);
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      setWalletChainId(typeof chain === "string" ? Number.parseInt(chain, 16) : Number(chain));
      toast.success("Wallet connected.");
    } catch (reason) { toast.error(formatError(reason)); }
  };

  const getQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    clearQuote();
    setError("");
    if (!walletAddress) { toast.error("Connect your wallet first."); return; }
    if (!sellToken || !buyToken || sellToken.address.toLowerCase() === buyToken.address.toLowerCase()) { setError("Choose two different tokens."); return; }
    try { setAmountBase(parseUnits(sellAmount, sellToken.decimals)); setFlow("quoting"); }
    catch (reason) { setError(formatError(reason)); return; }
    // Amount state updates synchronously for the query input on the next render.
    await sleep(0);
  };

  useEffect(() => {
    if (amountBase === "0" || !walletAddress || !sellToken || !buyToken) return;
    let cancelled = false;
    void quoteQuery.refetch({ throwOnError: true }).then((result) => {
      if (cancelled) return;
      if (result.data) {
        setQuote(result.data as SwapQuote);
        setQuoteClock(Date.now());
        setFlow("review");
        toast.success("Uniswap quote ready.");
      }
    }).catch((reason: unknown) => {
      if (!cancelled) { setError(formatError(reason)); setFlow("failed"); }
    }).finally(() => {
      if (!cancelled) setAmountBase("0");
    });
    return () => { cancelled = true; };
    // Quote retrieval is triggered only after the parsed amount is explicitly set by the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountBase]);

  const submitSwap = async () => {
    if (!quote || !walletAddress || !window.ethereum) return;
    if (expired) { setError("This quote has expired. Request a new quote."); setReviewOpen(false); return; }
    setReviewOpen(false);
    setError("");
    let submittedHash: string | undefined;
    try {
      await switchWalletChain(window.ethereum, quote.chainId);
      setWalletChainId(quote.chainId);
      const prepared = await prepareMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress });
      if (prepared.cancelTransaction) {
        setFlow("approving");
        const cancelHash = await sendWalletTransaction(window.ethereum, walletAddress, prepared.cancelTransaction);
        await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, approvalTxHash: cancelHash, status: "approval_submitted" });
        await waitForReceipt(window.ethereum, cancelHash);
      }
      if (prepared.approvalTransaction) {
        setFlow("approving");
        const approvalHash = await sendWalletTransaction(window.ethereum, walletAddress, prepared.approvalTransaction);
        await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, approvalTxHash: approvalHash, status: "approval_submitted" });
        await waitForReceipt(window.ethereum, approvalHash);
        await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, approvalTxHash: approvalHash, status: "awaiting_swap" });
      }
      if (Date.parse(quote.expiresAt) <= Date.now()) {
        await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, status: "expired" }).catch(() => undefined);
        throw new Error("The quote expired while approval was pending. The approval remains in your wallet; request a fresh quote.");
      }
      setFlow("awaiting_wallet");
      const hash = await sendWalletTransaction(window.ethereum, walletAddress, prepared.transaction);
      submittedHash = hash;
      await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, swapTxHash: hash, status: "submitted" });
      setFlow("waiting");
      await utils.dex.getHistory.invalidate();
      const receipt = await waitForReceipt(window.ethereum, hash);
      const actual = buyToken ? receivedAmount(receipt, buyToken.address, walletAddress) : undefined;
      await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, swapTxHash: hash, actualBuyAmount: actual, status: "confirmed" });
      setSuccess({ hash, actual });
      setFlow("complete");
      await utils.dex.getHistory.invalidate();
      toast.success("Swap confirmed.");
    } catch (reason) {
      if (submittedHash && formatError(reason) === "Transaction reverted on-chain.") {
        await recordMutation.mutateAsync({ quoteId: quote.quoteId, walletAddress, swapTxHash: submittedHash, status: "failed", failureReason: "Transaction reverted on-chain." }).catch(() => undefined);
      }
      setError(formatError(reason));
      setFlow("failed");
      toast.error(formatError(reason));
    }
  };

  const history = historyQuery.data ?? [];
  const pageTitle = isHistory ? "Activity" : "Swap terminal";

  return (
    <div className="qt-shell">
      <header className="qt-topbar">
        <div><div className="qt-eyebrow">QuantumTrade Console / EVM</div><h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1><p className="mt-1 text-xs text-muted-foreground">Your API. Your wallet. Transparent execution.</p></div>
        {walletAddress ? <button type="button" onClick={connectWallet} className="qt-wallet"><span className="qt-dot" />{shortAddress(walletAddress)}</button> : <button type="button" onClick={connectWallet} className="qt-primary"><Wallet className="h-4 w-4" />Connect wallet</button>}
      </header>

      {!isHistory ? (
        <div className="qt-grid">
          <section className="qt-panel p-5 sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4"><div><div className="qt-eyebrow mb-2">Non-custodial execution</div><h2 className="text-xl font-semibold sm:text-2xl">Swap assets</h2><p className="mt-1 text-sm text-muted-foreground">Request a quote through QuantumTrade’s authenticated API.</p></div><span className="qt-pill">Uniswap routing</span></div>
            <form onSubmit={getQuote} className="space-y-4">
              <div><label className="qt-label" htmlFor="network">NETWORK</label><select id="network" className="qt-field" value={chainId} onChange={(event) => { setChainId(Number(event.target.value)); setSellTokenAddress(""); setBuyTokenAddress(""); clearQuote(); }}><option value={1}>Ethereum</option><option value={8453}>Base</option><option value={42161}>Arbitrum</option></select></div>
              <div className="qt-token-box"><div className="flex justify-between text-xs text-muted-foreground"><label htmlFor="amount">YOU PAY</label><span>Balance shown in wallet</span></div><div className="grid grid-cols-[1fr_130px] items-center gap-3"><input id="amount" className="qt-amount" value={sellAmount} inputMode="decimal" onChange={(event) => { setSellAmount(event.target.value); clearQuote(); }} placeholder="0.00"/><select className="qt-field" value={sellTokenAddress} onChange={(event) => { setSellTokenAddress(event.target.value); clearQuote(); }} disabled={tokensLoading}><option value="" disabled>Select token</option>{tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}</select></div><p className="text-[0.68rem] text-muted-foreground">{sellToken?.name ?? "Choose a token"}</p></div>
              <div className="flex justify-center"><button type="button" aria-label="Switch tokens" className="qt-switch" onClick={() => { setSellTokenAddress(buyTokenAddress); setBuyTokenAddress(sellTokenAddress); clearQuote(); }}><ArrowDownUp className="h-4 w-4" /></button></div>
              <div className="qt-token-box"><div className="flex justify-between text-xs text-muted-foreground"><span>YOU RECEIVE</span><span>Estimated output</span></div><div className="grid grid-cols-[1fr_130px] items-center gap-3"><div className="qt-amount">{quote && buyToken ? formatUnits(quote.buyAmount, buyToken.decimals) : <span className="text-muted-foreground/50">—</span>}</div><select className="qt-field" value={buyTokenAddress} onChange={(event) => { setBuyTokenAddress(event.target.value); clearQuote(); }} disabled={tokensLoading}><option value="" disabled>Select token</option>{tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}</select></div><p className="text-[0.68rem] text-muted-foreground">{quote && buyToken ? `Minimum output: ${formatUnits(quote.minimumBuyAmount, buyToken.decimals)} ${buyToken.symbol}` : "Minimum output is protected by slippage."}</p></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="qt-label" htmlFor="slippage">SLIPPAGE TOLERANCE</label><select id="slippage" className="qt-field" value={slippageBps} onChange={(event) => { setSlippageBps(Number(event.target.value)); clearQuote(); }}><option value={30}>0.30%</option><option value={50}>0.50%</option><option value={100}>1.00%</option><option value={300}>3.00%</option><option value={500}>5.00%</option></select></div><div className="qt-policy"><ShieldCheck className="h-4 w-4 text-emerald-200"/>Curated assets only</div></div>
              {walletChainId !== null && walletChainId !== chainId && <p className="qt-warning">Your wallet network will be switched before signing.</p>}
              {error && <p role="alert" className="qt-error">{error}</p>}
              <button type="submit" disabled={!walletAddress || !sellToken || !buyToken || quoteQuery.isFetching || tokensLoading} className="qt-primary w-full justify-center disabled:opacity-45">{quoteQuery.isFetching ? <><Loader2 className="h-4 w-4 animate-spin"/>Getting quote</> : <><Zap className="h-4 w-4"/>{quote ? "Get refreshed quote" : "Get quote"}</>}</button>
              {!walletAddress && <p className="text-center text-xs text-muted-foreground">Connect an EVM wallet to request a quote.</p>}
            </form>

            {quote && buyToken && sellToken && <div className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="qt-pill"><span className="qt-dot"/>{quote.provider} · {String((quote.routeSummary as { routing?: string })?.routing ?? "Smart route")}</span><span className={`text-xs ${expired ? "text-rose-300" : "text-muted-foreground"}`}><Clock3 className="mr-1 inline h-3.5 w-3.5"/>{expired ? "Expired" : `Expires in ${secondsLeft}s`}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="PRICE IMPACT" value={quote.priceImpactBps === undefined ? "Not supplied" : `${(quote.priceImpactBps / 100).toFixed(2)}%`} note={quote.priceImpactBps === undefined ? "Provider omitted metric" : "Provider-reported"}/><Metric label="EST. GAS" value={quote.estimatedGas ? `${Number(quote.estimatedGas).toLocaleString()} units` : "Not supplied"} note={quote.estimatedGasFee ? `Raw gas fee ${quote.estimatedGasFee}` : "Gas units"}/><Metric label="SLIPPAGE" value={`${(quote.slippageBps / 100).toFixed(2)}%`} note="Maximum execution movement"/></div>
              <div className="mt-4 border-t border-white/10 pt-3"><div className="text-[0.65rem] font-bold tracking-[0.12em] text-muted-foreground">ROUTE</div><div className="mt-2 flex items-center gap-2 text-sm"><span className="rounded-md bg-white/5 px-2 py-1">{sellToken.symbol}</span><ArrowLeftRight className="h-3.5 w-3.5 text-emerald-200"/><span className="rounded-md bg-white/5 px-2 py-1">{String((quote.routeSummary as { routing?: string })?.routing ?? "Uniswap")}</span><ArrowLeftRight className="h-3.5 w-3.5 text-emerald-200"/><span className="rounded-md bg-white/5 px-2 py-1">{buyToken.symbol}</span></div></div>
              <button type="button" className="qt-review mt-4 w-full" disabled={expired} onClick={() => setReviewOpen(true)}>Review quote and approval</button>
            </div>}
          </section>

          <aside className="space-y-5"><section className="qt-panel p-5"><div className="qt-eyebrow mb-2">Execution path</div><h3 className="text-lg font-semibold">Swap lifecycle</h3><div className="mt-5 space-y-3">{["Get quote", "Review quote", "Approve token", "Confirm swap in wallet", "Waiting for confirmation", "Swap completed"].map((step, index) => <div key={step} className={`qt-step ${flow === "complete" || index < (quote ? 1 : 0) ? "done" : ""} ${["quoting", "approving", "awaiting_wallet", "waiting"].includes(flow) && index === ({ quoting: 0, approving: 2, awaiting_wallet: 3, waiting: 4 } as Record<string, number>)[flow] ? "active" : ""}`}><span className="qt-marker">{flow === "complete" || index < (quote ? 1 : 0) ? "✓" : index + 1}</span>{step}{index === 2 && quote && <span className="ml-auto text-[0.65rem] text-muted-foreground">Checked on continue</span>}</div>)}</div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4"><Metric label="API" value="QuantumTrade" note="Authenticated tRPC"/><Metric label="ROUTING" value="Uniswap" note="Server-side key"/></div></section>
            {success && network && <section className="qt-panel border-emerald-300/20 p-5"><div className="flex gap-3"><CheckCircle2 className="h-6 w-6 text-emerald-200"/><div><div className="qt-eyebrow">Swap completed</div><h3 className="mt-1 font-semibold">Transaction confirmed</h3><p className="mt-1 text-sm text-muted-foreground">{success.actual && buyToken ? `Actual fill: ${formatUnits(success.actual, buyToken.decimals)} ${buyToken.symbol}` : "Receipt confirmed; token output was not decoded."}</p><a className="mt-3 inline-flex items-center gap-1 text-sm text-emerald-200" href={`${network.explorer}${success.hash}`} target="_blank" rel="noreferrer">View on explorer <ExternalLink className="h-3.5 w-3.5"/></a></div></div></section>}
            <section className="qt-panel-muted p-5"><div className="flex gap-3"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-200"/><div><h3 className="text-sm font-semibold">Non-custodial by design</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">QuantumTrade returns unsigned transactions. Your wallet reviews and signs each approval and swap. Only the Uniswap API key stays on the server.</p><p className="mt-2 text-[0.68rem] text-muted-foreground">Price impact is marked unavailable when the provider does not supply the metric.</p></div></div></section>
          </aside>
        </div>
      ) : (
        <section className="qt-panel p-5 sm:p-7"><div className="mb-5 flex items-end justify-between gap-4"><div><div className="qt-eyebrow mb-1">On-chain activity</div><h2 className="text-xl font-semibold">Swap history</h2><p className="mt-1 text-sm text-muted-foreground">Quotes prepared and transactions submitted by your account.</p></div><button type="button" className="qt-secondary" onClick={() => void historyQuery.refetch()}>Refresh</button></div>
          {historyQuery.isLoading ? <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>Loading activity…</div> : history.length === 0 ? <div className="qt-empty"><Clock3 className="mx-auto h-6 w-6 text-muted-foreground"/><h3 className="mt-3 font-semibold">No swaps yet</h3><p className="mt-1 text-xs text-muted-foreground">Submitted wallet trades will appear here.</p></div> : <div className="overflow-x-auto rounded-xl border border-white/10"><table className="qt-table"><thead><tr><th>Trade</th><th>Network</th><th>Quoted output</th><th>Actual fill</th><th>Status</th><th>Created</th><th>Explorer</th></tr></thead><tbody>{history.map((item) => { const sold = allTokens.find((t) => t.address.toLowerCase() === item.sellToken.toLowerCase()); const bought = allTokens.find((t) => t.address.toLowerCase() === item.buyToken.toLowerCase()); const chain = CHAINS[item.chainId]; return <tr key={item.id}><td><strong>{formatUnits(item.sellAmount, sold?.decimals ?? 18)} {sold?.symbol ?? "token"}</strong><div className="mt-1 text-xs text-muted-foreground">Uniswap</div></td><td>{chain?.name ?? item.chainId}</td><td>{formatUnits(item.quotedBuyAmount, bought?.decimals ?? 18)} {bought?.symbol ?? ""}</td><td>{item.actualBuyAmount ? `${formatUnits(item.actualBuyAmount, bought?.decimals ?? 18)} ${bought?.symbol ?? ""}` : "—"}</td><td><StateBadge status={item.status}/></td><td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</td><td>{item.swapTxHash && chain ? <a className="text-emerald-200" href={`${chain.explorer}${item.swapTxHash}`} target="_blank" rel="noreferrer">Open <ExternalLink className="inline h-3 w-3"/></a> : "—"}</td></tr>; })}</tbody></table></div>}
          <p className="mt-3 text-[0.68rem] text-muted-foreground">Receipt and actual fill are observed by the connected wallet client.</p>
        </section>
      )}
      <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-white/10 pt-4 text-[0.68rem] text-muted-foreground"><span>QuantumTrade Console · Wallet-signed only</span><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-200"/>No private keys stored</span></footer>

      {reviewOpen && quote && sellToken && buyToken && <div className="qt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}><section className="qt-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="qt-eyebrow mb-1">Final quote review</div><h2 id="review-title" className="text-xl font-semibold">Confirm swap details</h2><div className="qt-review-summary mt-5"><Row label="You pay" value={`${formatUnits(quote.sellAmount, sellToken.decimals)} ${sellToken.symbol}`}/><Row label="Expected output" value={`${formatUnits(quote.buyAmount, buyToken.decimals)} ${buyToken.symbol}`}/><Row label="Minimum output" value={`${formatUnits(quote.minimumBuyAmount, buyToken.decimals)} ${buyToken.symbol}`}/><Row label="Network · provider" value={`${network.name} · ${quote.provider}`}/><Row label="Price impact" value={quote.priceImpactBps === undefined ? "Not supplied" : `${(quote.priceImpactBps / 100).toFixed(2)}%`}/><Row label="Slippage tolerance" value={`${(quote.slippageBps / 100).toFixed(2)}%`}/></div><p className="mt-4 text-xs leading-relaxed text-muted-foreground">The server re-checks allowance before returning an approval transaction. Review each wallet confirmation. Quote validity is 30 seconds.</p>{expired && <p className="qt-error mt-3">Quote expired. Get a fresh quote before continuing.</p>}<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="qt-secondary" onClick={() => setReviewOpen(false)}>Back</button><button className="qt-primary justify-center" disabled={expired || prepareMutation.isPending || ["approving", "waiting"].includes(flow)} onClick={() => void submitSwap()}>{prepareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Wallet className="h-4 w-4"/>}Continue in wallet</button></div></section></div>}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-lg bg-white/[0.035] p-3"><div className="text-[0.62rem] font-bold tracking-[0.1em] text-muted-foreground">{label}</div><div className="mt-1.5 truncate text-sm font-semibold">{value}</div><div className="mt-1 truncate text-[0.62rem] text-muted-foreground">{note}</div></div>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 py-2 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>; }
