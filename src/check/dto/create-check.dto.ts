import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CheckType, CheckStatus } from '../entities/check.entity';
import { recreateCommodity, tokenizeCommodity } from '../../types/job.dto';

export class CreateCheckDto {
  @ApiProperty({
    description: 'uuid',
    example: '2dc32cfe-cc0f-45cd-991c-7d68b2476e1a',
  })
  @IsUUID()
  id: string;

  @ApiProperty({
    description: 'type',
    enum: CheckType,
    example: CheckType.SPEND,
  })
  @IsEnum(CheckType)
  type: CheckType;

  @ApiProperty({
    description: 'status',
    enum: CheckStatus,
    example: CheckStatus.QUEUED,
  })
  @IsEnum(CheckStatus)
  status: CheckStatus;

  @ApiProperty({
    description: 'additionalInfo',
    type: 'object',
    example: null,
    additionalProperties: true,
  })
  @IsOptional()
  additionalInfo?: tokenizeCommodity | recreateCommodity;
}
