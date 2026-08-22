import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
    private readonly entityManager: EntityManager,
  ) {}
  // A real INSERT, not `save`. `save` issues an UPDATE when the primary key
  // already exists, which would silently reset a finished row back to PENDING
  // and would hide a replay instead of reporting a conflict.
  async create(createCheckDto: CreateCheckDto) {
    await this.checkRepository.insert(new Check(createCheckDto));
  }

  async findAll(limit = 50, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = Math.max(offset, 0);
    return await this.checkRepository.find({ take, skip });
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

  // Rows that claim to have failed while holding a transaction hash. The hash
  // is written before the submit, so such a row may describe a transaction that
  // reached the chain after the service stopped watching. `CHAIN_CHECKED` marks
  // a row the reconciler has already settled against the chain twice, so a
  // genuine failure is not re-checked for ever.
  async findErrorsHoldingTxid(limit: number): Promise<Check[]> {
    return await this.checkRepository
      .createQueryBuilder('check')
      .where('check.status = :status', { status: CheckStatus.ERROR })
      .andWhere('check.txid IS NOT NULL')
      .andWhere('length(check.txid) = 64')
      .andWhere('(check.error IS NULL OR check.error NOT LIKE :done)', {
        done: `%${CHAIN_CHECKED}%`,
      })
      .orderBy('check.id')
      .limit(Math.min(Math.max(limit, 1), 200))
      .getMany();
  }

  async update(id: string, updateCheckDto: UpdateCheckDto) {
    const check = await this.findOne(id);
    if (updateCheckDto.status !== undefined) {
      check.status = updateCheckDto.status;
    }
    if (updateCheckDto.txid !== undefined) {
      check.txid = updateCheckDto.txid;
    }
    if (updateCheckDto.signedTx !== undefined) {
      check.signedTx = updateCheckDto.signedTx ?? null;
    }
    if (updateCheckDto.error !== undefined) {
      check.error = updateCheckDto.error ?? null;
    }
    await this.entityManager.save(check);
  }
}
