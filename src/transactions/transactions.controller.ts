import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from './entities/transaction.entity';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // @Post()
  // async create(@Body() createTransactionDto: CreateTransactionDto) {
  //   return this.transactionsService.create(createTransactionDto);
  // }

  @Get()
  async findAll() {
    return this.transactionsService.findAll();
  }

  @Get(':txid')
  async findOne(@Param('txid') txid: string) {
    if (!/[0-9A-Fa-f]{6}/g.test(txid) || txid.length !== 64) {
      throw new HttpException(
        'txid must be hex of length 64',
        HttpStatus.BAD_REQUEST,
      );
    }
    let res: Transaction | Transaction[] =
      await this.transactionsService.findOne(txid);
    if (!res) {
      res = await this.transactionsService.findRecreatedByHash(txid);
    }
    if (Array.isArray(res)) {
      return res;
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
