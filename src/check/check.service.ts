import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Check, CheckStatus } from './entities/check.entity';

// Appended to the error text of a row the reconciler has looked up against the
// chain. The first sighting adds CHAIN_RECHECK, the second replaces it with
// CHAIN_CHECKED and the row is never looked up again. Two passes spaced by the
// sweep interval give a real transaction time to reach a block before the row
// is written off, and `check` has no timestamp column to bound the sweep with.
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

  async update(id: string, updateCheckDto: UpdateCheckDto) {
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
    const result = await this.checkRepository.update(
      isNonSuccessTransition
        ? { id, status: Not(CheckStatus.SUCCESS) }
        : { id },
      partial,
    );
    if (result.affected === 0) {
      await this.findOne(id);
    }
  }
}
