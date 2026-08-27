export const NETWORK = () => {
  const networkValue = (process.env.NETWORK as string).toLowerCase();
  return networkValue.charAt(0).toUpperCase() + networkValue.slice(1);
};
export const ZENGATE_MNEMONIC = () =>
  process.env.ZENGATE_WALLET_MNEMONIC as string;

export const PORT = () => process.env.PORT as string;
export const BLOCKFROST_KEY = () => process.env.BLOCKFROST_KEY as string;
export const TRANSACTION_RETRY_ATTEMPTS = () =>
  parseInt(process.env.TRANSACTION_RETRY_ATTEMPTS || '3');
export const CHAIN_CONFIRMATION_DEPTH = (): string | undefined => {
  const value = process.env.CHAIN_CONFIRMATION_DEPTH;
  if (value === undefined) return undefined;
  return value;
};
