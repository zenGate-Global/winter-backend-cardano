import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PalmyraService } from './palmyra.service';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';

@Controller('palmyra')
export class PalmyraController {
  constructor(private readonly palmyraService: PalmyraService) {}

  @Post('spendCommodity')
  async listComm(
    @Body() message: spendCommodityJob,
  ): Promise<{ message: string }> {
    await this.palmyraService.dispatchSpendCommodity(message);
    return { message: 'success' };
  }

  @Post('tokenizeCommodity')
  async tokenizeCommodity(
    @Body() message: tokenizeCommodityJob,
  ): Promise<{ message: string }> {
    await this.palmyraService.dispatchTokenizeCommodity(message);
    return { message: 'success' };
  }

  @Post('recreateCommodity')
  async recreateCommodity(
    @Body() message: recreateCommodityJob,
  ): Promise<{ message: string }> {
    const utxoLen = message.utxos.length;
    const dataLen = message.newDataReferences.length;
    if (utxoLen !== dataLen) {
      throw new HttpException(
        `utxo(s) of length ${utxoLen} should match data array of length ${dataLen}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.palmyraService.dispatchRecreateCommodity(message);
    return { message: 'success' };
  }
}
