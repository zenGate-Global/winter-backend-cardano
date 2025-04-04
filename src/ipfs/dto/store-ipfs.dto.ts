import { IsNotEmpty } from 'class-validator';
import { Event } from './metadata.dto';
import { ApiProperty } from '@nestjs/swagger';

export class StoreIpfsDto extends Event {}
export class StoreIpfsResponseDto {
  @IsNotEmpty()
  @ApiProperty({
    description: 'IPFS CID',
    example: 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e',
  })
  hash: string;
}
