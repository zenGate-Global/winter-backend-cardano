export const NETWORK = () => {
  const networkValue = (process.env.NETWORK as string).toLowerCase();
  return networkValue.charAt(0).toUpperCase() + networkValue.slice(1);
};
export const ZENGATE_MNEMONIC = () =>
  process.env.ZENGATE_WALLET_MNEMONIC as string;

export const OGMIOS_HOST = () => process.env.OGMIOS_HOST as string;

export const OGMIOS_PORT = () => parseInt(process.env.OGMIOS_PORT as string);
export const PORT = () => process.env.PORT as string;
export const BLOCKFROST_KEY = () => process.env.BLOCKFROST_KEY as string;
