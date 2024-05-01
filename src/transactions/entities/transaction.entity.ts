import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Transaction {
  @PrimaryColumn('text')
  txid: string;

  @Column('jsonb', { default: '[]' })
  recreated: Array<{ txHash: string; outputIndex: number }>;

  @Column('text', { nullable: true })
  spent: string;

  constructor(item: Partial<Transaction>) {
    Object.assign(this, item);
  }
}
