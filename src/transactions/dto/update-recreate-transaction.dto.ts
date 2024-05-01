import { PartialType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

export class UpdateRecreateTransactionDto extends PartialType(
  CreateTransactionDto,
) {
  recreated: { txHash: string; outputIndex: number };
}
