import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity()
export class Deployment {
  @ApiProperty({
    description: 'Contract address - primary identifier',
    example: 'addr1contractaddressexample123456789',
  })
  @PrimaryColumn('text')
  contractAddress: string;

  @ApiProperty({
    description: 'Deployment address',
    example: 'addr1deploymentaddressexample123456789',
  })
  @Column('text')
  deployAddress: string;

  @ApiProperty({
    description: 'Deployment transaction hash',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @Column('text')
  deploymentTxHash: string;

  @ApiProperty({
    description: 'Deployment output index',
    example: 0,
  })
  @Column('int')
  deploymentOutputIndex: number;

  @ApiProperty({
    description:
      'Script hash of the parameterized object event validator that this deployment serves',
    example: '194b693a61ff0de6f07d8b47016f9c368793de6e7ad53584c1deafce',
    nullable: true,
  })
  @Column('text', { nullable: true })
  scriptHash: string | null;

  @ApiProperty({
    description: 'created at timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  constructor(item: Partial<Deployment>) {
    Object.assign(this, item);
  }
}
