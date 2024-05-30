import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';

class MetadataValue {
  @IsNotEmpty()
  @ApiProperty({ description: 'Metadata key', example: 'Location' })
  key: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Metadata unit', example: 'kilogram' })
  unit: string | null;

  @IsNotEmpty()
  @ApiProperty({
    description: 'Metadata value',
    oneOf: [
      { type: 'string', example: '7.2905° N, 80.6337° E' },
      { type: 'array', items: { $ref: '#/components/schemas/MetadataValue' } },
    ],
  })
  value: string | MetadataValue[];
}

class InputItem {
  @IsNotEmpty()
  @ApiProperty({ description: 'Item identifier', example: '<identifier>' })
  itemIdentifier: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Item event ID', example: '<tokenId>' })
  itemEventId: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Item quantity', example: 500 })
  itemQuantity: number;

  @IsOptional()
  @IsNotEmpty()
  @ApiProperty({ description: 'Item unit', example: 'kilograms' })
  unit: string | null;
}

class OutputItem {
  @IsNotEmpty()
  @ApiProperty({ description: 'Item identifier', example: '<identifier>' })
  itemIdentifier: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Item quantity', example: 500 })
  itemQuantity: number;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Item unit', example: 'null' })
  unit: string | null;
}

export class EventDto {
  @IsNotEmpty()
  @ApiProperty({ description: 'Event name', example: 'Green Tea' })
  name: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Event version', example: 1.0 })
  version: number;

  @IsNotEmpty()
  @ApiProperty({
    description: 'Event creation date',
    example: '2023-05-26T14:30:00Z',
  })
  creationDate: string;

  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => value.toLowerCase())
  @IsIn([
    'object',
    'aggregation',
    'transformation',
    'association',
    'transaction',
  ])
  @ApiProperty({ description: 'Event type', example: 'object' })
  eventType: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Event ID', example: '' })
  eventId: string;

  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => InputItem)
  @ApiProperty({
    description: 'Input items',
    type: [InputItem],
  })
  inputItems: InputItem[];

  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OutputItem)
  @ApiProperty({ description: 'Output items', type: [OutputItem] })
  outputItems: OutputItem[];

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetadataValue)
  @ApiProperty({
    description: 'Event metadata',
    type: [MetadataValue],
  })
  metadata: MetadataValue[];
}
