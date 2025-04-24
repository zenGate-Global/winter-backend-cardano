import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsString,
  IsIn,
  IsNumber,
  IsBoolean,
  IsISO8601,
  IsDataURI,
} from 'class-validator';
import { IsEventTimeZoneOffset } from './isEventTimeZoneOffset';

type EventType =
  | 'ObjectEvent'
  | 'AggregationEvent'
  | 'TransformationEvent'
  | 'AssociationEvent'
  | 'TransactionEvent';
type EventID = string;
type Action = 'ADD' | 'OBSERVE' | 'DELETE';
type UOM = 'kg' | 'g' | 'lb' | 'oz' | 'l' | 'ml' | 'm3' | 'cm3' | 'ft3' | 'in3';
class LocationID {
  @IsNotEmpty()
  @IsString()
  id: string;
}
class ReadPointID extends LocationID {}
class BusinessLocationID extends LocationID {}
type BusinessStepID = string;
type DispositionID = string;
type BusinessTransactionTypeID = string;
type ItemClass = string;
type SourceDestTypeID = string;
type PartyID = string;
type SourceDestID = PartyID
type ErrorReasonID = string;
type SensorPropertyTypeID = string;
type MircroorganismID = string;
type ChemicalSubstanceID = string;
type ResourceID = string;
type Item = string;
type BusinessTransactionID = string;
type DateTimeStamp = string;
type CertificationDetails = string;

class QuantityElement {
  @IsNotEmpty()
  @IsString()
  itemClass: ItemClass;

  @IsOptional()
  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  @IsIn(['kg', 'g', 'lb', 'oz', 'l', 'ml', 'm3', 'cm3', 'ft3', 'in3'])
  uom: UOM;
}

class ErrorDeclaration {
  @IsNotEmpty()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  declarationTime: string;

  @IsOptional()
  @IsString()
  reason: ErrorReasonID;

  @IsOptional()
  @IsString({
    each: true,
  })
  correctiveEventIDs: EventID[];
}

class PersistentDisposition {
  @IsNotEmpty()
  @IsString({
    each: true,
  })
  set: DispositionID[];

  @IsNotEmpty()
  @IsString({
    each: true,
  })
  unset: DispositionID[];
}

class BusinessTransaction {
  @IsOptional()
  @IsString()
  type: BusinessTransactionTypeID;

  @IsNotEmpty()
  @IsString()
  bizTransaction: BusinessTransactionID;
}

class Source {
  @IsOptional()
  @IsString()
  type: SourceDestTypeID;

  @IsNotEmpty()
  @ValidateNested()
  source: SourceDestID;
}

class Destination {
  @IsOptional()
  @IsString()
  type: SourceDestTypeID;

  @IsNotEmpty()
  @ValidateNested()
  destination: SourceDestID;
}

class SensorMetadata {
  @IsOptional()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  time: string;

  @IsNotEmpty()
  @IsOptional()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  startTime: string;

  @IsOptional()
  @IsString()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  endTime: string;

  @IsOptional()
  @IsString()
  deviceID: Item;

  @IsOptional()
  @IsString()
  deviceMetadata: ResourceID;

  @IsOptional()
  @IsString()
  rawData: ResourceID;

  @IsOptional()
  @IsString()
  dataProcessingMethod: ResourceID;

  @IsOptional()
  @IsString()
  bizRules: ResourceID;
}

class SensorReport {
  @IsOptional()
  @IsString()
  type: SensorPropertyTypeID;

  @IsOptional()
  @IsString()
  exception: string;

  @IsOptional()
  @IsString()
  deviceID: Item;

  @IsOptional()
  @IsString()
  deviceMetadata: ResourceID;

  @IsOptional()
  @IsString()
  rawData: ResourceID;

  @IsOptional()
  @IsString()
  dataProcessingMethod: ResourceID;

  @IsOptional()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  time: string;

  @IsString()
  mircroorganism: MircroorganismID;

  @IsOptional()
  @IsString()
  chemicalSubstance: ChemicalSubstanceID;

  @IsOptional()
  @IsNumber()
  value: number;

  @IsOptional()
  @IsString()
  component: string;

  @IsOptional()
  @IsString()
  stringValue: string;

  @IsOptional()
  @IsBoolean()
  booleanValue: boolean;

  @IsOptional()
  @IsString()
  hexBinaryValue: string;

  @IsOptional()
  @IsString()
  uriValue: string;

  @IsOptional()
  @IsNumber()
  minValue: number;

  @IsOptional()
  @IsNumber()
  maxValue: number;

  @IsOptional()
  @IsNumber()
  meanValue: number;

  @IsOptional()
  @IsNumber()
  sDev: number;

  @IsOptional()
  @IsNumber()
  percRank: number;

  @IsOptional()
  @IsNumber()
  percValue: number;

  @IsOptional()
  @IsString()
  uom: UOM;

  @IsOptional()
  @IsString()
  coordinateReferenceSystem?: string;
}

class SensorElement {
  @IsOptional()
  @ValidateNested()
  sensorMetadata: SensorMetadata;

  @IsNotEmpty()
  @ValidateNested({ each: true })
  sensorReport: SensorReport[];
}

type ILMD = Record<string, string>;
type TransformationID = string;

export class Event {

  @IsNotEmpty()
  @IsString()
  @IsIn([
    'ObjectEvent',
    'AggregationEvent',
    'TransformationEvent',
    'AssociationEvent',
    'TransactionEvent',
  ])
  type: EventType;

  @IsNotEmpty()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  eventTime: DataTimeStamp;

  @IsOptional()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  recordTime: DateTimeStamp;

  @IsNotEmpty()
  @IsEventTimeZoneOffset()
  eventTimeZoneOffset: string;

  @IsOptional()
  @IsString()
  eventID: EventID;

  @IsOptional()
  @ValidateNested()
  errorDeclaration: ErrorDeclaration;

  @IsOptional()
  @IsString()
  certificationInfo: CertificationDetails;
}

export class ObjectEvent extends Event {
  @IsOptional()
  @IsString({
    each: true,
  })
  itemList: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  quantityList: QuantityElement[];

  @IsNotEmpty()
  @IsString()
  @IsIn(['ADD', 'OBSERVE', 'DELETE'])
  action: Action;

  @IsOptional()
  @IsString()
  bizStep: BusinessStepID;

  @IsOptional()
  @IsString()
  disposition: DispositionID;

  @IsOptional()
  @ValidateNested()
  persistentDisposition: PersistentDisposition;

  @IsOptional()
  @ValidateNested()
  readPoint: ReadPointID;

  @IsOptional()
  @ValidateNested()
  bizLocation: BusinessLocationID;

  @IsOptional()
  @ValidateNested({ each: true })
  bizTransactionList: BusinessTransaction[];

  @IsOptional()
  @ValidateNested({ each: true })
  sourceList: Source[];

  @IsOptional()
  @ValidateNested({ each: true })
  destinationList: Destination[];

  @IsOptional()
  ilmd: ILMD;

  @IsOptional()
  @ValidateNested({ each: true })
  sensorElementList: SensorElement[];
}

export class AggregationEvent extends Event {
  @IsOptional()
  @IsString()
  parentID: Item;

  @IsOptional()
  @IsString({ each: true })
  childItems: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  childQuantityList: QuantityElement[];

  @IsNotEmpty()
  @IsString()
  @IsIn(['ADD', 'OBSERVE', 'DELETE'])
  action: Action;

  @IsOptional()
  @IsString()
  bizStep: BusinessStepID;

  @IsOptional()
  @IsString()
  disposition: DispositionID;

  @IsOptional()
  @ValidateNested()
  readPoint: ReadPointID;

  @IsOptional()
  @ValidateNested()
  bizLocation: BusinessLocationID;

  @IsOptional()
  @ValidateNested({ each: true })
  bizTransactionList: BusinessTransaction[];

  @IsOptional()
  @ValidateNested({ each: true })
  sourceList: Source[];

  @IsOptional()
  @ValidateNested({ each: true })
  destinationList: Destination[];

  @IsOptional()
  @ValidateNested({ each: true })
  sensorElementList: SensorElement[];
}

export class TransactionEvent extends Event {
  @IsOptional()
  @ValidateNested({ each: true })
  bizTransactionList: BusinessTransaction[];

  @IsOptional()
  @IsString()
  parentID: Item;

  @IsOptional()
  @IsString({
    each: true,
  })
  itemList: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  quantityList: QuantityElement[];

  @IsNotEmpty()
  @IsString()
  @IsIn(['ADD', 'OBSERVE', 'DELETE'])
  action: Action;

  @IsOptional()
  @IsString()
  bizStep: BusinessStepID;

  @IsOptional()
  @IsString()
  disposition: DispositionID;

  @IsOptional()
  @ValidateNested()
  readPoint: ReadPointID;

  @IsOptional()
  @ValidateNested()
  bizLocation: BusinessLocationID;

  @IsOptional()
  @ValidateNested({ each: true })
  sourceList: Source[];

  @IsOptional()
  @ValidateNested({ each: true })
  destinationList: Destination[];

  @IsOptional()
  @ValidateNested({ each: true })
  sensorElementList: SensorElement[];
}

export class TransformationEvent extends Event {
  @IsOptional()
  @IsString({
    each: true,
  })
  inputItemList: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  inputQuantityList: QuantityElement[];

  @IsOptional()
  @IsString({
    each: true,
  })
  outputItemList: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  outputQuantityList: QuantityElement[];

  @IsOptional()
  @IsString()
  transormationID: TransformationID;

  @IsOptional()
  @IsString()
  bizStep: BusinessStepID;

  @IsOptional()
  @IsString()
  disposition: DispositionID;

  @IsOptional()
  @ValidateNested()
  persistentDisposition: PersistentDisposition;

  @IsOptional()
  @ValidateNested()
  readPoint: ReadPointID;

  @IsOptional()
  @ValidateNested()
  bizLocation: BusinessLocationID;

  @IsOptional()
  @ValidateNested({ each: true })
  bizTransactionList: BusinessTransaction[];

  @IsOptional()
  @ValidateNested({ each: true })
  sourceList: Source[];

  @IsOptional()
  @ValidateNested({ each: true })
  destinationList: Destination[];

  @IsOptional()
  ilmd: ILMD;

  @IsOptional()
  @ValidateNested({ each: true })
  sensorElementList: SensorElement[];
}

export class AssociationEvent extends Event {
  @IsOptional()
  @IsString()
  parentID: Item;

  @IsOptional()
  @IsString({ each: true })
  childItems: Item[];

  @IsOptional()
  @ValidateNested({ each: true })
  childQuantityList: QuantityElement[];

  @IsNotEmpty()
  @IsString()
  @IsIn(['ADD', 'OBSERVE', 'DELETE'])
  action: Action;

  @IsOptional()
  @IsString()
  bizStep: BusinessStepID;

  @IsOptional()
  @IsString()
  disposition: DispositionID;

  @IsOptional()
  @ValidateNested()
  readPoint: ReadPointID;

  @IsOptional()
  @ValidateNested()
  bizLocation: BusinessLocationID;

  @IsOptional()
  @ValidateNested({ each: true })
  bizTransactionList: BusinessTransaction[];

  @IsOptional()
  @ValidateNested({ each: true })
  sourceList: Source[];

  @IsOptional()
  @ValidateNested({ each: true })
  destinationList: Destination[];

  @IsOptional()
  @ValidateNested({ each: true })
  sensorElementList: SensorElement[];
}
