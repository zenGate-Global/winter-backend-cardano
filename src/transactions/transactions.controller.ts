import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from './entities/transaction.entity';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../palmyra/dto/error.dto';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiCreatedResponse({
    description: 'Returns all transactions',
    type: Transaction,
    isArray: true,
  })
  async findAll(): Promise<Transaction[]> {
    return this.transactionsService.findAll();
  }

  @Get(':txid')
  @ApiCreatedResponse({
    description: 'Returns a transaction by txid',
    type: Transaction,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'issue with txid',
    type: ErrorResponse,
  })
  async findOne(@Param('txid') txid: string): Promise<Transaction[]> {
    if (!/[0-9A-Fa-f]{6}/g.test(txid) || txid.length !== 64) {
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

  // @Patch(':txid')
  // async update(
  //   @Param('txid') txid: string,
  //   @Body() updateTransactionDto: UpdateTransactionDto,
  // ) {
  //   return this.transactionsService.update(+txid, updateTransactionDto);
  // }
  //
  // @Delete(':txid')
  // remove(@Param('txid') txid: string) {
  //   return this.transactionsService.remove(+txid);
  // }
}
