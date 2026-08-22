import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from './entities/transaction.entity';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponse } from '../palmyra/dto/error.dto';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Returns all transactions (default 50, max 200)',
    type: Transaction,
    isArray: true,
  })
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Transaction[]> {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    return this.transactionsService.findAll(take, skip);
  }

  @Get(':txid')
  @ApiOkResponse({
    description: 'Returns a transaction by txid',
    type: Transaction,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'issue with txid',
    type: ErrorResponse,
  })
  async findOne(@Param('txid') txid: string): Promise<Transaction[]> {
    if (!/^[0-9A-Fa-f]{64}$/.test(txid)) {
      throw new HttpException(
        'txid must be hex of length 64',
        HttpStatus.BAD_REQUEST,
      );
    }
    let res: Transaction | Transaction[] | null =
      await this.transactionsService.findOne(txid);
    if (!res) {
      res = await this.transactionsService.findRecreatedByHash(txid);
    }
    if (Array.isArray(res)) {
      return res;
    }
    if (res === null) {
      throw new HttpException('Transaction not found', HttpStatus.NOT_FOUND);
    }
    return [res];
  }

}
