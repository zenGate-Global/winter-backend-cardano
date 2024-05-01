export const NETWORK = () => {
  const networkValue = (process.env.NETWORK as string).toLowerCase();
  return networkValue.charAt(0).toUpperCase() + networkValue.slice(1);
};
export const ZENGATE_MNEMONIC = () =>
  process.env.ZENGATE_WALLET_MNEMONIC as string;
