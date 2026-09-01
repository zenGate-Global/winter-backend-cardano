import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ChainConfirmation, Check, CheckStatus } from './entities/check.entity';

// Appended to the error text of a row the reconciler has looked up against the
// chain. The first sighting adds CHAIN_RECHECK, the second replaces it with
// CHAIN_CHECKED and the row is never looked up again. Two passes spaced by the
// sweep interval give a real transaction time to reach a block before the row
// is written off, and `check` has no timestamp column to bound the sweep with.
// Kept for legacy rows; new confirmation path does not use this marker.
export const CHAIN_RECHECK = '[chain-recheck]';
export const CHAIN_CHECKED = '[chain-checked]';
@Injectable()
export class CheckService {
  constructor(
    @InjectRepository(Check)
    private readonly checkRepository: Repository<Check>,
  ) {}
  // A real INSERT, not `save`. `save` issues an UPDATE when the primary key
  // already exists, which would silently reset a finished row back to PENDING
  // and would hide a replay instead of reporting a conflict.
  async create(createCheckDto: CreateCheckDto) {
    await this.checkRepository.insert(new Check(createCheckDto));
  }

  // A stable order: offset pagination without one can repeat or skip a row
  // between pages, because Postgres gives no ordering guarantee otherwise.
  async findAll(limit = 50, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = Math.max(offset, 0);
    return await this.checkRepository.find({
      take,
      skip,
      order: { id: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Check> {
    const res = await this.checkRepository.findOneBy({ id });
    if (!res) {
      throw new NotFoundException(`Check with id ${id} not found`);
    }
    return res;
  }

  // Non-throwing lookup for the idempotency guard, which asks whether a
  // request was already accepted rather than requiring that it was.
  async exists(id: string): Promise<boolean> {
    return (await this.checkRepository.countBy({ id })) > 0;
  }

  // Rows that hold a transaction hash while claiming not to have succeeded. The
  // hash is written before the submit, so such a row may describe a transaction
  // that reached the chain after the service stopped watching.
  //
  // QUEUED counts, not only ERROR. The consumer parks an ambiguous submit as
  // QUEUED on purpose, and pg-boss has no retries left by then, so an
  // ERROR-only sweep would never see those rows and a caller would poll one for
  // ever. Sweeping a genuinely in-flight row is harmless: promotion needs the
  // chain to confirm the hash, and `update` refuses to move a SUCCESS row.
  //
  // Unmarked rows sort first. A marked row can sit for the reconciler's minimum
  // age before it may be written off, and a fixed id order would let a backlog
  // of those fill the batch and starve rows nothing has looked at yet.
  async findUnsettledHoldingTxid(limit: number): Promise<Check[]> {
    return await this.checkRepository
      .createQueryBuilder('check')
      .where('check.status IN (:...statuses)', {
        statuses: [CheckStatus.ERROR, CheckStatus.QUEUED],
      })
      .andWhere('check.txid IS NOT NULL')
      .andWhere('length(check.txid) = 64')
      .andWhere('(check.error IS NULL OR check.error NOT LIKE :done)', {
        done: `%${CHAIN_CHECKED}%`,
      })
      .orderBy('(check.error LIKE :seen)', 'ASC')
      .addOrderBy('check.id', 'ASC')
      .setParameter('seen', `%${CHAIN_RECHECK}%`)
      .limit(Math.min(Math.max(limit, 1), 200))
      .getMany();
  }

  // Confirmation candidates: SUBMITTED, legacy SUCCESS, and txid-bearing QUEUED/ERROR
  // with null confirmation. Ordered NULL first then oldest lastChainCheckAt then id,
  // so first-page permanent 404 rows rotate and a later confirmable row is reached.
  async findAwaitingConfirmation(limit: number): Promise<Check[]> {
    return await this.checkRepository
      .createQueryBuilder('check')
      .where('check.status IN (:...statuses)', {
        statuses: [
          CheckStatus.SUBMITTED,
          CheckStatus.SUCCESS,
          CheckStatus.QUEUED,
          CheckStatus.ERROR,
        ],
      })
      .andWhere('check.txid IS NOT NULL')
      .andWhere('length(check.txid) = 64')
      .andWhere('check.confirmation IS NULL')
      .andWhere("check.txid ~ '^[0-9a-fA-F]{64}$'")
      .orderBy('check.lastChainCheckAt', 'ASC', 'NULLS FIRST')
      .addOrderBy('check.id', 'ASC')
      .limit(Math.min(Math.max(limit, 1), 200))
      .getMany();
  }

  async markChainAttempt(id: string): Promise<void> {
    try {
      await this.checkRepository
        .createQueryBuilder()
        .update(Check)
        .set({ lastChainCheckAt: () => 'NOW()' } as unknown as Record<
          string,
          unknown
        >)
        .where('id = :id', { id })
        .execute();
    } catch {
      void 0;
    }
  }

  async markObservedSubmitted(
    id: string,
    expectedTxid: string,
  ): Promise<boolean> {
    const normalized = expectedTxid.toLowerCase();
    try {
      const result = await this.checkRepository
        .createQueryBuilder()
        .update(Check)
        .set({
          status: CheckStatus.SUBMITTED,
          txid: normalized,
          error: null,
        } as unknown as Record<string, unknown>)
        .where('id = :id', { id })
        .andWhere('LOWER("txid") = :txid', { txid: normalized })
        .andWhere('"confirmation" IS NULL')
        .andWhere('"status" IN (:...eligible)', {
          eligible: [CheckStatus.QUEUED, CheckStatus.ERROR],
        })
        .execute();
      return (result.affected ?? 0) > 0;
    } catch {
      return false;
    }
  }

  // Conditional SUBMITTED write used by the worker after a successful submit.
  // Guards against overwriting a terminal CONFIRMED row and against rebinding
  // to another hash or CBOR.
  async markSubmitted(
    id: string,
    txid: string,
    signedTx: string,
  ): Promise<void> {
    const normalized = txid.toLowerCase();
    const result = await this.checkRepository
      .createQueryBuilder()
      .update(Check)
      .set({
        status: CheckStatus.SUBMITTED,
        txid: normalized,
        signedTx,
        error: null,
      })
      .where('id = :id', { id })
      .andWhere('LOWER("txid") = :txid', { txid: normalized })
      .andWhere('"signedTx" = :signedTx', { signedTx })
      .andWhere('"confirmation" IS NULL')
      .andWhere('"status" IN (:...eligible)', {
        eligible: [CheckStatus.PENDING, CheckStatus.QUEUED, CheckStatus.ERROR],
      })
      .execute();
    if (result.affected === 0) {
      await this.findOne(id);
    }
  }

  // Atomic CONFIRMED transition. Succeeds only when the row still holds the
  // expected txid, has no confirmation, and remains in an eligible status.
  // A concurrent winner makes the second update a no-op.
  async markConfirmed(
    id: string,
    expectedTxid: string,
    confirmation: ChainConfirmation,
  ): Promise<boolean> {
    const normalized = expectedTxid.toLowerCase();
    // Ensure stored confirmation txid matches expected
    if (confirmation.txid.toLowerCase() !== normalized) return false;
    const result = await this.checkRepository
      .createQueryBuilder()
      .update(Check)
      .set({
        status: CheckStatus.CONFIRMED,
        confirmation: confirmation as unknown as ChainConfirmation,
        error: null,
        txid: normalized,
      })
      .where('id = :id', { id })
      .andWhere('LOWER("txid") = :txid', { txid: normalized })
      .andWhere('"confirmation" IS NULL')
      .andWhere('"status" IN (:...eligible)', {
        eligible: [
          CheckStatus.SUBMITTED,
          CheckStatus.SUCCESS,
          CheckStatus.QUEUED,
          CheckStatus.ERROR,
        ],
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  // Attach only when the row still holds the exact mint identity. Confirmation
  // can win this race, so the update preserves all terminal state.
  async attachReferenceDeployment(
    id: string,
    expectedMintTxid: string,
    currentSignedTx: string,
    compositeSignedTx: string,
  ): Promise<void> {
    const normalized = expectedMintTxid.toLowerCase();
    const allowed = [
      CheckStatus.SUBMITTED,
      CheckStatus.SUCCESS,
      CheckStatus.CONFIRMED,
    ];
    const result = await this.checkRepository
      .createQueryBuilder()
      .update(Check)
      .set({ signedTx: compositeSignedTx } as unknown as Record<
        string,
        unknown
      >)
      .where('id = :id', { id })
      .andWhere('"status" IN (:...allowed)', { allowed })
      .andWhere('LOWER("txid") = :txid', { txid: normalized })
      .andWhere('"signedTx" = :currentSignedTx', { currentSignedTx })
      .execute();
    if ((result.affected ?? 0) > 0) return;
    const row = await this.checkRepository.findOneBy({ id });
    if (
      row?.signedTx === compositeSignedTx &&
      row.txid?.toLowerCase() === normalized &&
      allowed.includes(row.status)
    )
      return;
    throw new BadRequestException('guarded deployment attachment refused');
  }

  // Marks an included transaction that failed Plutus validation as terminal ERROR.
  async markFailedContract(
    id: string,
    expectedTxid: string,
    reason: string,
  ): Promise<boolean> {
    const normalized = expectedTxid.toLowerCase();
    const result = await this.checkRepository
      .createQueryBuilder()
      .update(Check)
      .set({
        status: CheckStatus.ERROR,
        error: reason,
        txid: normalized,
      } as unknown as Record<string, unknown>)
      .where('id = :id', { id })
      .andWhere('LOWER("txid") = :txid', { txid: normalized })
      .andWhere('"confirmation" IS NULL')
      .andWhere('"status" != :confirmed', {
        confirmed: CheckStatus.CONFIRMED,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async update(id: string, updateCheckDto: UpdateCheckDto) {
    if (
      updateCheckDto.status === CheckStatus.CONFIRMED ||
      updateCheckDto.status === CheckStatus.SUBMITTED
    ) {
      throw new BadRequestException(
        'Use markSubmitted or markConfirmed for SUBMITTED/CONFIRMED',
      );
    }
    if (
      (updateCheckDto as unknown as { confirmation?: unknown }).confirmation !==
      undefined
    ) {
      throw new BadRequestException('Generic update cannot write confirmation');
    }
    const partial: Partial<Check> = {};
    if (updateCheckDto.status !== undefined)
      partial.status = updateCheckDto.status;
    if (updateCheckDto.txid !== undefined) partial.txid = updateCheckDto.txid;
    if (updateCheckDto.signedTx !== undefined)
      partial.signedTx = updateCheckDto.signedTx ?? null;
    if (updateCheckDto.error !== undefined)
      partial.error = updateCheckDto.error ?? null;
    const isNonSuccessTransition =
      updateCheckDto.status !== undefined &&
      updateCheckDto.status !== CheckStatus.SUCCESS;
    const protectedStatuses = isNonSuccessTransition
      ? [CheckStatus.CONFIRMED, CheckStatus.SUBMITTED, CheckStatus.SUCCESS]
      : [CheckStatus.CONFIRMED, CheckStatus.SUBMITTED];
    const result = await this.checkRepository.update(
      {
        id,
        status: Not(In(protectedStatuses)),
      } as unknown as Record<string, unknown>,
      partial,
    );
    if (result.affected === 0) {
      await this.findOne(id);
    }
  }
}
