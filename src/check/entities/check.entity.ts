import { Column, Entity, PrimaryColumn } from 'typeorm';
import { UtxoQuery } from '../../types/job.dto';
import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { TokenizeCommodityDto } from '../../palmyra/dto/tokenize-commodity.dto';
import { RecreateCommodityDto } from '../../palmyra/dto/recreate-commodity.dto';

export enum CheckType {
  SPEND = 'SPEND',
  TOKENIZE = 'TOKENIZE',
  RECREATE = 'RECREATE',
}

export enum CheckStatus {
  SUCCESS = 'SUCCESS',
  QUEUED = 'QUEUED',
  ERROR = 'ERROR',
  PENDING = 'PENDING',
}

@Entity()
export class Check {
  @ApiProperty({
    description: 'uuid',
    example: '2dc32cfe-cc0f-45cd-991c-7d68b2476e1a',
  })
  @PrimaryColumn('text')
  id: string;

  @ApiProperty({
    description: 'type',
    enum: CheckType,
    example: CheckType.RECREATE,
  })
  @Column('text', { nullable: true })
  type: CheckType;

  @ApiProperty({
    description: 'status',
    enum: CheckStatus,
    example: CheckStatus.SUCCESS,
  })
  @Column('text', { nullable: true })
  status: CheckStatus;

  @ApiProperty({
    description: 'error',
    example: null,
  })
  @Column('text', { nullable: true })
  error: string;

  @ApiProperty({
    description: 'txid',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @Column('text', { nullable: true })
  txid: string;

  @ApiProperty({
    description:
      'additionalInfo only there for tokenizing and recreate, it shows token name and metadata ref or utxo respectively',
    oneOf: [
      { $ref: getSchemaPath(TokenizeCommodityDto) },
      { $ref: getSchemaPath(RecreateCommodityDto) },
    ],
  })
  @Column('jsonb', { nullable: true })
  additionalInfo: TokenizeCommodityDto | RecreateCommodityDto;

  constructor(item: Partial<Check>) {
    Object.assign(this, item);
  }
}
