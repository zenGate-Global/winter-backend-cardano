import { ApiProperty } from '@nestjs/swagger';
import { CheckStatus } from '../../check/entities/check.entity';

export class OperationResponseDto {
  @ApiProperty({ example: 'accepted' })
  message: string;

  @ApiProperty({ example: '2dc32cfe-cc0f-45cd-991c-7d68b2476e1a' })
  id: string;

  @ApiProperty({ enum: CheckStatus, example: CheckStatus.PENDING })
  status: CheckStatus;

  @ApiProperty({ example: '/check/2dc32cfe-cc0f-45cd-991c-7d68b2476e1a' })
  statusUrl: string;
}
