import { PartialType } from '@nestjs/mapped-types';
import { CreateCheckDto } from './create-check.dto';

export class UpdateCheckDto extends PartialType(CreateCheckDto) {
  status: string;
  txid?: string;
  error?: string;
}
