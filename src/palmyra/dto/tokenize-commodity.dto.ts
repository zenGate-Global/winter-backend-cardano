import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { SpendCommodityResponseDto } from './spend-commodity.dto';

export class TokenizeCommodityDto {
  @ApiProperty({
    description: 'token name utf8 string',
    example: 'coffee tracking singleton',
  })
  @IsString()
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
