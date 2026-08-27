import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsString } from 'class-validator';
import { SpendCommodityResponseDto } from './spend-commodity.dto';

export class TokenizeCommodityDto {
  @ApiProperty({
    description: 'token name as utf8 string, 1..32 bytes',
    example: 'coffee-singleton',
  })
  @IsString()
  @IsByteLength(1, 32)
  tokenName: string;

  @ApiProperty({
    description: 'metadata utf8 string',
    example:
      'ipfs://bafkreihfxojbr7gvaukph2jaxeoc4n25lut4s6tepfnnouwlxwc74uyhaa',
  })
  @IsString()
  metadataReference: string;
}

export class TokenizeCommodityResponseDto extends SpendCommodityResponseDto {}
