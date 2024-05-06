import { Column, Entity, PrimaryColumn } from 'typeorm';
import { recreateCommodity, tokenizeCommodity } from '../../types/job.dto';

@Entity()
export class Check {
  @PrimaryColumn('text')
  id: string;

  @Column('text', { nullable: true })
  type: string;

  @Column('text', { nullable: true })
  status: string;

  @Column('text', { nullable: true })
  error: string;

  @Column('text', { nullable: true })
  txid: string;

  @Column('jsonb', { nullable: true })
  additionalInfo: tokenizeCommodity | recreateCommodity;

  constructor(item: Partial<Check>) {
    Object.assign(this, item);
  }
}
