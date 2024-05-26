import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty } from 'class-validator';

export class CommodityDetailsDto {
  @ApiProperty({
    description:
      'Each `id` is a concatenation of policyId and the hex bytes of token name',
    example: ['802ad2b341d95e0f55fd02bf364f3fa28aae08abb3e304160e76e808617065'],
  })
  @IsNotEmpty()
  @IsArray()
  tokenIds: string[];
}

export class ObjectDatum {
  @ApiProperty({ description: 'protocol version of winter', example: 1 })
  protocol_version: number;
  @ApiProperty({
    description: 'data reference, usually a url to ipfs',
    example:
      '697066733a2f2f516d4e4c6f657a62586b6b33376d314458356959414452777071765a3379667535556a4d4736736e647531416151',
  })
  data_reference: string;
  @ApiProperty({
    description:
      'If events are created, this will be txid of first event, else its empty',
    example: '',
  })
  event_creation_info: string;
  @ApiProperty({
    description:
      'at least one of these signers must sign to further interact with this event',
    example: ['5afc8364f8733c895f54b5cf261b5efe71d3669f59ccad7439ccf289'],
  })
  signers: string[];
}

export class CommodityDetailsResponseDto {
  @ApiProperty({
    description: 'Array of ObjectDatum representing commodity details',
    type: ObjectDatum,
    isArray: true,
  })
  @IsArray()
  message: ObjectDatum[];
}
