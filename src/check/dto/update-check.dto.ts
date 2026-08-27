import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCheckDto } from './create-check.dto';
import { CheckStatus } from '../entities/check.entity';

export class UpdateCheckDto extends PartialType(
  OmitType(CreateCheckDto, ['confirmation'] as const),
) {
  @ApiProperty({
    description: 'status',
    enum: CheckStatus,
    example: CheckStatus.SUCCESS,
  })
  @IsOptional()
  @IsEnum(CheckStatus)
  status?: CheckStatus;

  @ApiProperty({
    description: 'txid',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  txid?: string;

  @ApiProperty({
    description: 'signedTx CBOR',
    example: null,
  })
  @IsOptional()
  @IsString()
  signedTx?: string | null;

  @ApiProperty({
    description: 'error',
    example: null,
  })
  @IsOptional()
  @IsString()
  error?: string | null;
}
