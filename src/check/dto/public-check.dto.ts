import { ApiProperty } from '@nestjs/swagger';
import {
  ChainConfirmation,
  Check,
  CheckStatus,
  CheckType,
  TokenizeProvenance,
} from '../entities/check.entity';

export class PublicCheckDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, enum: CheckType, nullable: true })
  type: CheckType | null;

  @ApiProperty({ type: String, enum: CheckStatus })
  status: CheckStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'operation failed',
  })
  error: 'operation failed' | 'operation retry pending' | null;

  @ApiProperty({ type: String, nullable: true })
  txid: string | null;

  @ApiProperty({ type: ChainConfirmation, nullable: true })
  confirmation: ChainConfirmation | null;

  @ApiProperty({ nullable: true, type: Object })
  additionalInfo: Record<string, unknown> | null;
}

function publicProvenance(
  value: TokenizeProvenance | null,
): TokenizeProvenance | null {
  if (!value) return null;
  return {
    policyId: value.policyId,
    assetNameHex: value.assetNameHex,
    contractAddress: value.contractAddress,
    outputIndex: value.outputIndex,
    cid: value.cid,
  };
}

function publicConfirmation(
  value: ChainConfirmation | null,
): ChainConfirmation | null {
  if (!value) return null;
  return {
    network: value.network,
    txid: value.txid,
    blockHash: value.blockHash,
    blockHeight: value.blockHeight,
    slot: value.slot,
    depth: value.depth,
    requiredDepth: value.requiredDepth,
    confirmedAt: value.confirmedAt,
    provenance: publicProvenance(value.provenance),
  };
}

function publicAdditionalInfo(check: Check): Record<string, unknown> | null {
  const source = check.additionalInfo as unknown as Record<
    string,
    unknown
  > | null;
  if (!source) return null;
  if (check.type === CheckType.TOKENIZE) {
    return {
      tokenName: source.tokenName,
      metadataReference: source.metadataReference,
    };
  }
  if (check.type === CheckType.RECREATE) {
    const utxos = Array.isArray(source.utxos)
      ? source.utxos.map((value) => {
          const utxo =
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)
              : {};
          return {
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
          };
        })
      : undefined;
    return {
      ...(utxos ? { utxos } : {}),
      newDataReferences: source.newDataReferences,
    };
  }
  return null;
}

export function toPublicCheck(check: Check): PublicCheckDto {
  const retryPending =
    (check.status === CheckStatus.PENDING ||
      check.status === CheckStatus.QUEUED) &&
    Boolean(check.error);
  return {
    id: check.id,
    type: Object.values(CheckType).includes(check.type) ? check.type : null,
    status: check.status,
    error:
      check.status === CheckStatus.ERROR
        ? 'operation failed'
        : retryPending
          ? 'operation retry pending'
          : null,
    txid: check.txid ?? null,
    confirmation: publicConfirmation(check.confirmation),
    additionalInfo: publicAdditionalInfo(check),
  };
}
