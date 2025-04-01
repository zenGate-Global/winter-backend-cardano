import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  IsNumber,
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

class TransactionInfo {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Buyer identifier.', example: '1234567890' })
  buyerId: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Currency code.', example: '0987654321' })
  currencyCode: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Zone code of transactions.',
    example: '0987654321',
  })
  zoneCode: string;

  @IsNumber()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Total amount of daily transactions.',
    example: 1000,
  })
  totalAmount: number;
}

class ReadPoint {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Read point ID.', example: 'MWA' })
  id: string;
}

class InputItem {
  @IsNotEmpty()
  @ApiProperty({ description: 'Item identifier.', example: '<identifier>' })
  itemId: string;

  @IsOptional()
  @ApiProperty({ description: 'Item event ID.', example: '<tokenId>' })
  itemEventId: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Item quantity.', example: 500 })
  itemQuantity: number;

  @IsOptional()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Item unit of measurement.',
    example: 'kilograms',
  })
  uom: string | null;
}

class OutputItem {
  @IsNotEmpty()
  @ApiProperty({ description: 'Item identifier.', example: '<identifier>' })
  itemId: string;

  @IsNotEmpty()
  @ApiProperty({ description: 'Item quantity.', example: 500 })
  itemQuantity: number;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Item unit of measurement.', example: 'null' })
  uom: string | null;
}

export class EventDto {
  @IsNotEmpty()
  @ApiProperty({ description: 'Event version.', example: '1.0.0' })
  @IsIn(['1.0.0', '2.0.0-alpha'])
  version: string;

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
  @ApiProperty({ description: 'Event type.', example: 'object' })
  eventType: string;

  @IsNotEmpty()
  @ApiProperty({
    description: 'Event creation time.',
    example: '2023-05-26T14:30:00Z',
  })
  eventTime: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Event ID.', example: '' })
  eventId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Id of parent aggregation.',
    example: 'BATCH-001',
  })
  parentId: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutputItem)
  @ApiProperty({
    description: 'Child items of parent aggregation.',
    type: [OutputItem],
  })
  childItems: OutputItem[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InputItem)
  @ApiProperty({
    description: 'Input items.',
    type: [InputItem],
  })
  inputItems: InputItem[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutputItem)
  @ApiProperty({ description: 'Output items.', type: [OutputItem] })
  outputItems: OutputItem[];

  @IsOptional()
  @Type(() => ReadPoint)
  @ValidateNested({ each: true })
  @ApiProperty({ description: 'Event read point.', type: ReadPoint })
  readPoint: ReadPoint;

  @IsOptional()
  @ValidateNested({ each: true })
  @ApiProperty({ description: 'Event transaction information.' })
  transactionInfo: TransactionInfo;

  @IsOptional()
  @ValidateNested({ each: true })
  //@Type(() => MetadataValue)
  @ApiProperty({
    description: 'Event metadata.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  metadata: Record<string, string>;
}
