import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsObject,
  Matches,
} from 'class-validator';

export class IpfsEnvelopeDto {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T/, {
    message: 'logTime must include an ISO-8601 date and time',
  })
  logTime: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsObject({ each: true })
  events: Record<string, unknown>[];
}
