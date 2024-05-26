import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity()
export class Transaction {
  @ApiProperty({
    description: 'txid',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @PrimaryColumn('text')
  txid: string;

  @ApiProperty({
    description: 'recreated utxo details',
    example: [
      {
        txHash:
          'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
        outputIndex: 1,
      },
    ],
  })
  @Column('jsonb', { default: '[]' })
  recreated: Array<{ txHash: string; outputIndex: number }>;

  @ApiProperty({
    description: 'spent txid',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @Column('text', { nullable: true })
  spent: string;

  constructor(item: Partial<Transaction>) {
    Object.assign(this, item);
  }
}
