import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SpendCommodityResponseDto, UtxoDto } from './spend-commodity.dto';

export class RecreateCommodityDto {
  @ApiProperty({
    description: 'Array of utxos which will be recreated',
    type: UtxoDto,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UtxoDto)
  utxos: UtxoDto[];

  @ApiProperty({
    description:
      'string utf8 data respective to utxos which will be the new data references ',
    example: ['ipfs://someotherhash'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  newDataReferences: string[];
}

export class RecreateCommodityResponseDto extends SpendCommodityResponseDto {}
