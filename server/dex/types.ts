export const SWAP_STATUSES = [
  "quoted",
  "awaiting_approval",
  "approval_submitted",
  "awaiting_swap",
  "submitted",
  "confirmed",
  "failed",
  "expired",
] as const;

export type SwapStatus = (typeof SWAP_STATUSES)[number];
export type HexAddress = `0x${string}`;

export type DexToken = {
  chainId: number;
  address: HexAddress;
  symbol: string;
  name: string;
  decimals: number;
  enabled: boolean;
  isStablecoin: boolean;
  riskTier: "low" | "medium";
};

export type SwapQuoteRequest = {
  chainId: number;
  sellToken: HexAddress;
  buyToken: HexAddress;
  sellAmount: string;
  takerAddress: HexAddress;
  slippageBps: number;
};

export type UnsignedTransaction = {
  to: string;
  data: string;
  value: string;
  gas?: string;
  chainId?: number;
};

export type SwapQuote = {
  provider: string;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minimumBuyAmount: string;
  slippageBps: number;
  priceImpactBps?: number;
  estimatedGas?: string;
  estimatedGasFee?: string;
  allowanceTarget?: string;
  approvalRequired: boolean;
  transaction: UnsignedTransaction;
  routeSummary: unknown;
  expiresAt: string;
  quoteId: string;
};

export type SwapHistoryItem = {
  id: string;
  userId: number;
  quoteId: string;
  provider: string;
  chainId: number;
  walletAddress: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  quotedBuyAmount: string;
  actualBuyAmount: string | null;
  minimumBuyAmount: string;
  slippageBps: number;
  priceImpactBps: number | null;
  approvalTxHash: string | null;
  swapTxHash: string | null;
  status: SwapStatus;
  failureReason: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
