import { Injectable } from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateRecreateTransactionDto } from './dto/update-recreate-transaction.dto';
import { EntityManager, Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateSpentTransactionDto } from './dto/spent-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txRepository: Repository<Transaction>,
    private readonly entityManager: EntityManager,
  ) {}
  async create(createTransactionDto: CreateTransactionDto) {
    const tx = new Transaction(createTransactionDto);
    await this.entityManager.save(tx);
  }

  async findAll() {
    return this.txRepository.find();
  }

  async findOne(txid: string) {
    return this.txRepository.findOneBy({ txid });
  }

  async findRecreated(
    txHash: string,
    outputIndex: number,
  ): Promise<Transaction | null> {
    return this.txRepository
      .createQueryBuilder('transaction')
      .where(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(transaction.recreated) AS r WHERE r->>'txHash' = :txHash AND (r->>'outputIndex')::int = :outputIndex)`,
        {
          txHash,
          outputIndex,
        },
      )
      .getOne();
  }

  async findRecreatedByHash(txHash: string): Promise<Transaction[]> {
    return this.txRepository
      .createQueryBuilder('transaction')
      .where(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(transaction.recreated) AS r WHERE r->>'txHash' = :txHash)`,
        {
          txHash,
        },
      )
      .getMany();
  }

  async recreate(
    txid: string,
    outputIndex: number,
    updateTransactionDto: UpdateRecreateTransactionDto,
  ) {
    let tx = await this.findOne(txid);
    if (!tx) {
      tx = await this.findRecreated(txid, outputIndex);
    }
    tx.recreated.push(updateTransactionDto.recreated);
    await this.entityManager.save(tx);
  }

  async spent(
    txid: string,
    outputIndex: number,
    updateTransactionDto: UpdateSpentTransactionDto,
  ) {
    let tx = await this.findOne(txid);
    if (!tx) {
      tx = await this.findRecreated(txid, outputIndex);
    }
    console.log(`here: ${tx}`);
    tx.spent = updateTransactionDto.spent;
    await this.entityManager.save(tx);
  }

  async remove(txid: string) {
    await this.txRepository.delete(txid);
  }
}
