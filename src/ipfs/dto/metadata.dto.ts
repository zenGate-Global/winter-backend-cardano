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

type WinterVersion = '1.0.0' | '2.0.0-alpha';
type EventType =
  | 'ObjectEvent'
  | 'AggregationEvent'
  | 'TransformationEvent'
  | 'AssociationEvent'
  | 'TransactionEvent';
type EventID = string;
type Action = 'ADD' | 'OBSERVE' | 'DELETE';
type UOM = 'kg' | 'g' | 'lb' | 'oz' | 'l' | 'ml' | 'm3' | 'cm3' | 'ft3' | 'in3';
type LocationID = string;
type ReadPointID = LocationID;
type BusinessLocationID = LocationID;
type DispositionID = string;
type BusinessTransactionTypeID = string;
type ItemClass = string;
type SourceDestTypeID = string;
type SourceDestID = LocationID;
type PartyID = string;
type ErrorReasonID = string;
type SensorPropertyTypeID = string;
type MircroorganismID = string;
type ChemicalSubstanceID = string;
type ResourceID = string;
type Item = string;
type DateTimeStamp = `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z`; // ISO-8601 format
type BusinessTransactionID = string;

type QuantityElement = {
  itemClass: ItemClass,
  quantity?: number,
  uom?: UOM
}

type ErrorDeclaration = {
  declarationTime: DateTimeStamp,
  reason?: ErrorReasonID,
  correctiveEventIDs?: EventID[],
}

type PersistentDisposition = {
  set: DispositionID[],
  unset: DispositionID[]
}

type BusinessTransaction = {
  type?: BusinessTransactionTypeID,
  bizTransaction: BusinessTransactionID
}

type Source = {
  type?: SourceDestTypeID,
  source: SourceDestID
}

type Destination = {
  type?: SourceDestTypeID,
  destination: SourceDestID
}

type SensorMetadata = {
  time?: DateTimeStamp,
  startTime?: DateTimeStamp,
  endTime?: DateTimeStamp,
  deviceID?: Item,
  deviceMetadata?: ResourceID,
  rawData?: ResourceID,
  dataProcessingMethod?: ResourceID,
  bizRules?: ResourceID,
}

type SensorReport = {
  type?: SensorPropertyTypeID,
  exception?: string,
  deviceID?: Item,
  deviceMetadata?: ResourceID,
  rawData?: ResourceID,
  dataProcessingMethod?: ResourceID,
  time?: DateTimeStamp,
  mircroorganism?: MircroorganismID,
  chemicalSubstance?: ChemicalSubstanceID,
  value?: number,
  component?: string,
  stringValue?: string,
  booleanValue?: boolean,
  hexBinaryValue?: string,
  uriValue?: string,
  minValue?: number,
  maxValue?: number,
  meanValue?: number,
  sDev?: number,
  percRank?: number,
  percValue?: number,
  uom?: UOM,
  coordinateReferenceSystem?: string,
}

type SensorElement = {
  sensorMetadata?: SensorMetadata,
  sensorReport: SensorReport[]
}

type ILMD = Record<string, string>;

class ReadPoint {
  @IsNotEmpty()
  @ApiProperty({
    description: 'Read point location information.',
    example: 'MWA',
  })
  id: ReadPointID;
}



export class Event {

  @IsNotEmpty()string
  @ApiProperty({ description: 'Event version.', example: '1.0.0' })
  @IsIn(['1.0.0', '2.0.0-alpha'])
  version: WinterVersion;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ description: 'Event type.', example: 'object' })
  @IsIn([
    'ObjectEvent',
    'AggregationEvent',
    'TransformationEvent',
    'AssociationEvent',
    'TransactionEvent',
  ])
  eventType: EventType;

  @IsNotEmpty()
  eventTime: DateTimeStamp;

  @IsOptional()
  recordTime: DateTimeStamp;

  @IsNotEmpty()
  eventTimeZoneOffset: string;

  @IsOptional()
  eventID: EventID;

  @IsOptional()
  errorDeclaration: ErrorDeclaration;

  @IsOptional()
  certificationInfo: string;

}

export class ObjectEvent extends Event {

  

}

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @ApiProperty({
    description: 'Input items.',
    type: String,
    isArray: true,string
    description: 'Output items.',
    type: String,
    isArray: true,
  })
  outputItems: Item[];

  @IsOptional()
  readPoint: ReadPoint;

  @IsOptional()
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

  // Dimension: WHAT
  // Level: Instance
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @ApiProperty({
    description: 'Items for object events.',
    type: String,
    isArray: true,
  })
  items: Item[];

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Id of parent aggregation.',
    example: 'BATCH-001',
  })
  parentID: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @ApiProperty({
    description: 'Child items of parent aggregation.',
    type: String,
    isArray: true,
  })
  childItems: Item[]string;

  class TransactionInfo {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ description: 'Buyer information.', example: '1234567890' })
    buyer: string;
  
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ description: 'Currency code.', example: '0987654321' })
    currencyCode: string;
  
    @IsString() zoneCode;
    @IsNotEmpty()
    @ApiProperty({
      description: 'Location of transaction(s).',
      example: '0987654321',
    })
    location: string;
  
    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
      description: 'Total amount of daily transactions.',
      example: 1000,
    })
    totalAmount: number;
  }