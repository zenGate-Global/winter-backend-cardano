import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponse {
  @ApiProperty({
    example: 'Blockfrost API Error',
    description: 'The error message indicating the general error category',
  })
  message: string;

  @ApiProperty({
    example: 'id not found',
    description: 'The specific error message thrown',
  })
  cause: string;
}
