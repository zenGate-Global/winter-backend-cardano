import { PartialType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

export class UpdateSpentTransactionDto extends PartialType(
  CreateTransactionDto,
) {
  spent: string;
}
