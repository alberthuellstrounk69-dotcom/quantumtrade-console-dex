import type { DexToken } from "./types";

const token = (chainId: number, address: `0x${string}`, symbol: string, name: string, decimals: number, isStablecoin = false, riskTier: "low" | "medium" = "low"): DexToken => ({ chainId, address, symbol, name, decimals, enabled: true, isStablecoin, riskTier });

export const TOKEN_REGISTRY: DexToken[] = [
  token(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH", "Wrapped Ether", 18),
  token(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 6, true),
  token(1, "0xdAC17F958D2ee523a2206206994597C13D831ec7", "USDT", "Tether USD", 6, true),
  token(1, "0x6B175474E89094C44Da98b954EedeAC495271d0F", "DAI", "Dai Stablecoin", 18, true),
  token(1, "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "WBTC", "Wrapped BTC", 8, false, "medium"),
  token(8453, "0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether", 18),
  token(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USD Coin", 6, true),
  token(8453, "0xD9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", "USDbC", "USD Base Coin", 6, true, "medium"),
  token(42161, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "WETH", "Wrapped Ether", 18),
  token(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", "USD Coin", 6, true),
  token(42161, "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USDT", "Tether USD", 6, true),
  token(42161, "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", "DAI", "Dai Stablecoin", 18, true),
];

export function listTokens(chainId?: number) {
  return TOKEN_REGISTRY.filter((entry) => entry.enabled && (chainId === undefined || entry.chainId === chainId));
}

export function findToken(chainId: number, address: string) {
  return TOKEN_REGISTRY.find((entry) => entry.enabled && entry.chainId === chainId && entry.address.toLowerCase() === address.toLowerCase());
}
