import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsHexadecimal,
  IsInt,
  IsNotEmpty,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UtxoDto {
  @ApiProperty({
    description: 'txHash of utxo to spend',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @IsNotEmpty()
  @IsString()
  @Length(62, 62)
  @IsHexadecimal()
  txHash: string;
  @ApiProperty({
    description: 'output index of utxo to spend',
    example: 0,
  })
  @IsInt()
  @Min(0)
  outputIndex: number;
}

export class SpendCommodityDto {
  @ApiProperty({
    description: 'Array of utxos',
    type: UtxoDto,
    isArray: true,
  })
  @IsArray()
  utxos: UtxoDto[];
}

export class SpendCommodityResponseDto {
  @ApiProperty({
    description: 'message indicating response',
    example: 'success',
  })
  @IsString()
  message: string;

  @ApiProperty({
    description: 'uuid of request',
    example: '2dc32cfe-cc0f-45cd-991c-7d68b2476e1a',
  })
  @IsString()
  id: string;
}
