import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class CommodityDetailsDto {
  @ApiProperty({
    description:
      'Each `id` is a concatenation of policyId and the hex bytes of token name',
    example: ['802ad2b341d95e0f55fd02bf364f3fa28aae08abb3e304160e76e808617065'],
  })
  @ArrayNotEmpty()
  @IsArray()
  @IsString({ each: true })
  tokenIds: string[];
}

export class ObjectDatum {
  @ApiProperty({ description: 'protocol_version wrapped as int', example: { int: 1 } })
  protocol_version: { int: number };
  @ApiProperty({
    description: 'data_reference_hex wrapped as bytes',
    example: {
      bytes: '697066733a2f2f516d4e4c6f657a62586b6b33376d314458356959414452777071765a3379667535556a4d4736736e647531416151',
    },
  })
  data_reference_hex: { bytes: string };
  @ApiProperty({
    description: 'event_creation_info_tx_hash wrapped as bytes',
    example: { bytes: '' },
  })
  event_creation_info_tx_hash: { bytes: string };
  @ApiProperty({
    description: 'signers_pk_hash wrapped as list of bytes',
    example: { list: [{ bytes: '5afc8364f8733c895f54b5cf261b5efe71d3669f59ccad7439ccf289' }] },
  })
  signers_pk_hash: { list: { bytes: string }[] };
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
