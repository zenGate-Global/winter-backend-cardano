import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { deserializeAddress } from '@meshsdk/core';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import { NETWORK } from '../constants';
import {
  ChainConfirmation,
  TokenizeProvenance,
} from '../check/entities/check.entity';

const HEX64 = /^[0-9a-f]{64}$/;

export function isHex64(value: string): boolean {
  return HEX64.test(value.toLowerCase());
}

export function isSafeNonNegativeInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseRequiredDepth(
  raw: string | undefined,
  genesisSecurityParam: number | null,
): number | null {
  if (raw !== undefined && raw !== null && String(raw) !== '') {
    const text = String(raw);
    if (!/^[1-9][0-9]*$/.test(text)) return null;
    const num = Number(text);
    if (!Number.isSafeInteger(num) || num <= 0) return null;
    return num;
  }
  if (
    genesisSecurityParam !== null &&
    Number.isSafeInteger(genesisSecurityParam) &&
    genesisSecurityParam > 0
  ) {
    return genesisSecurityParam;
  }
  return null;
}

export function depthFromHeights(
  latestHeight: number,
  txBlockHeight: number,
): number {
  return latestHeight - txBlockHeight;
}

export function buildConfirmation(params: {
  network: string;
  txid: string;
  blockHash: string;
  blockHeight: number;
  slot: number;
  depth: number;
  requiredDepth: number;
  confirmedAt: string;
  provenance: TokenizeProvenance | null;
}): ChainConfirmation {
  return {
    network: params.network,
    txid: params.txid.toLowerCase(),
    blockHash: params.blockHash.toLowerCase(),
    blockHeight: params.blockHeight,
    slot: params.slot,
    depth: params.depth,
    requiredDepth: params.requiredDepth,
    confirmedAt: params.confirmedAt,
    provenance: params.provenance,
  };
}

export async function proveTokenizeProvenance(
  bf: BlockFrostAPI,
  txid: string,
  tokenName: string,
  metadataReference: string,
): Promise<TokenizeProvenance | null> {
  if (!tokenName || !metadataReference) return null;
  const expectedAssetNameHex = Buffer.from(tokenName, 'utf8')
    .toString('hex')
    .toLowerCase();
  const expectedCidHex = Buffer.from(metadataReference, 'utf8')
    .toString('hex')
    .toLowerCase();
  if (expectedAssetNameHex.length > 64) return null;
  if (expectedAssetNameHex.length % 2 !== 0) return null;

  let response: unknown;
  try {
    const api = bf as unknown as {
      txsUtxos: (hash: string) => Promise<unknown>;
    };
    response = await api.txsUtxos(txid);
  } catch {
    return null;
  }
  if (!response || typeof response !== 'object') return null;
  const record = response as Record<string, unknown>;
  if (
    typeof record.hash !== 'string' ||
    record.hash.toLowerCase() !== txid.toLowerCase() ||
    !Array.isArray(record.outputs)
  ) {
    return null;
  }
  const outputs = record.outputs as unknown[];
  const matches: Array<{
    address: string;
    output_index: number;
    unit: string;
  }> = [];
  for (const entry of outputs) {
    if (!entry || typeof entry !== 'object') continue;
    const out = entry as Record<string, unknown>;
    if (out.collateral) continue;
    if (!isSafeNonNegativeInt(out.output_index)) continue;
    if (typeof out.address !== 'string' || out.address.trim() === '') continue;
    const lowerAddr = out.address.toLowerCase();
    if (!lowerAddr.startsWith('addr1') && !lowerAddr.startsWith('addr_test1'))
      continue;
    try {
      deserializeAddress(out.address);
    } catch {
      continue;
    }
    if (typeof out.inline_datum !== 'string' || !out.inline_datum) continue;
    let decoded: { data_reference_hex: { bytes: string } } | null;
    try {
      decoded = EventFactory.getObjectDatumFieldsFromPlutusCbor(
        out.inline_datum,
      ) as unknown as {
        data_reference_hex: { bytes: string };
      };
    } catch {
      continue;
    }
    const datumHex = (decoded?.data_reference_hex?.bytes ?? '').toLowerCase();
    if (datumHex !== expectedCidHex) continue;
    const amounts = Array.isArray(out.amount) ? out.amount : [];
    for (const value of amounts) {
      if (!value || typeof value !== 'object') continue;
      const amount = value as Record<string, unknown>;
      if (amount.quantity !== '1') continue;
      const unit = String(amount.unit).toLowerCase();
      if (unit === 'lovelace') continue;
      const assetHex = unit.slice(56);
      if (assetHex !== expectedAssetNameHex) continue;
      if (unit.length < 56) continue;
      const policyId = unit.slice(0, 56);
      if (!/^[0-9a-f]{56}$/.test(policyId)) continue;
      matches.push({
        address: out.address as string,
        output_index: out.output_index as number,
        unit,
      });
    }
  }
  if (matches.length !== 1) return null;
  const m = matches[0];
  const policyId = m.unit.slice(0, 56);
  return {
    policyId,
    assetNameHex: expectedAssetNameHex,
    contractAddress: m.address,
    outputIndex: m.output_index,
    cid: metadataReference,
  };
}

export function validateTxResponse(
  tx: unknown,
  expectedTxid: string,
): {
  block: string;
  block_height: number;
  block_time: number;
  slot: number;
  valid_contract: boolean;
} | null {
  if (!tx || typeof tx !== 'object') return null;
  const t = tx as Record<string, unknown>;
  const hash = typeof t.hash === 'string' ? t.hash.toLowerCase() : '';
  if (hash !== expectedTxid.toLowerCase()) return null;
  const block = typeof t.block === 'string' ? t.block.toLowerCase() : '';
  if (!isHex64(block)) return null;
  const block_height = t.block_height as number;
  const block_time = t.block_time as number;
  const slot = t.slot as number;
  const valid_contract = t.valid_contract as boolean;
  if (!isSafeNonNegativeInt(block_height)) return null;
  if (!isSafeNonNegativeInt(block_time)) return null;
  if (!isSafeNonNegativeInt(slot)) return null;
  if (typeof valid_contract !== 'boolean') return null;
  return { block, block_height, block_time, slot, valid_contract };
}

export function validateBlockResponse(
  block: unknown,
  tx: { block: string; block_height: number; block_time: number; slot: number },
): boolean {
  if (!block || typeof block !== 'object') return false;
  const b = block as Record<string, unknown>;
  const hash =
    typeof b.hash === 'string' ? (b.hash as string).toLowerCase() : '';
  const height = b.height as number | null;
  const slot = b.slot as number | null;
  const time = b.time as number;
  if (hash !== tx.block) return false;
  if (
    height === null ||
    !isSafeNonNegativeInt(height) ||
    height !== tx.block_height
  )
    return false;
  if (slot === null || !isSafeNonNegativeInt(slot) || slot !== tx.slot)
    return false;
  if (!isSafeNonNegativeInt(time) || time !== tx.block_time) return false;
  return true;
}

let cachedGenesisSecurityParam: number | null | undefined = undefined;
let cachedGenesisNetworkMagic: number | null | undefined = undefined;

export async function getCachedGenesis(
  bf: BlockFrostAPI,
): Promise<{ securityParam: number | null; networkMagic: number | null }> {
  if (cachedGenesisSecurityParam !== undefined) {
    return {
      securityParam: cachedGenesisSecurityParam,
      networkMagic: cachedGenesisNetworkMagic ?? null,
    };
  }
  try {
    const genesis = await (
      bf as unknown as { genesis: () => Promise<Record<string, unknown>> }
    ).genesis();
    const sp = genesis.security_param as unknown;
    const nm = genesis.network_magic as unknown;
    const securityParam =
      typeof sp === 'number' && Number.isSafeInteger(sp) && sp > 0 ? sp : null;
    const networkMagic =
      typeof nm === 'number' && Number.isSafeInteger(nm) ? nm : null;
    if (securityParam !== null) {
      cachedGenesisSecurityParam = securityParam;
      cachedGenesisNetworkMagic = networkMagic;
    }
    if (securityParam === null) {
      return { securityParam: null, networkMagic };
    }
    return { securityParam, networkMagic };
  } catch {
    return { securityParam: null, networkMagic: null };
  }
}

export function resetGenesisCache(): void {
  cachedGenesisSecurityParam = undefined;
  cachedGenesisNetworkMagic = undefined;
}

export function networkLabel(): string {
  try {
    return String(NETWORK()).toLowerCase();
  } catch {
    return 'unknown';
  }
}
