import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PalmyraService } from './palmyra.service';
import {
  recreateCommodity,
  spendCommodity,
  tokenizeCommodity,
} from '../types/job.dto';
import { v4 as uuidv4 } from 'uuid';
@Controller('palmyra')
export class PalmyraController {
  constructor(private readonly palmyraService: PalmyraService) {}

  @Post('spendCommodity')
  async listComm(
    @Body() message: spendCommodity,
  ): Promise<{ message: string; id: string }> {
    const id = uuidv4();
    await this.palmyraService.dispatchSpendCommodity({
      id,
      utxos: message.utxos,
    });
    return { message: 'success', id };
  }

  @Post('tokenizeCommodity')
  async tokenizeCommodity(
    @Body() message: tokenizeCommodity,
  ): Promise<{ message: string; id: string }> {
    const id = uuidv4();
    await this.palmyraService.dispatchTokenizeCommodity({
      id,
      tokenName: message.tokenName,
      metadataReference: message.metadataReference,
    });
    return { message: 'success', id };
  }

  @Post('recreateCommodity')
  async recreateCommodity(
    @Body() message: recreateCommodity,
  ): Promise<{ message: string; id: string }> {
    const utxoLen = message.utxos.length;
    const dataLen = message.newDataReferences.length;
    if (utxoLen !== dataLen) {
      throw new HttpException(
        `utxo(s) of length ${utxoLen} should match data array of length ${dataLen}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const id = uuidv4();
    await this.palmyraService.dispatchRecreateCommodity({
      id,
      utxos: message.utxos,
      newDataReferences: message.newDataReferences,
    });
    return { message: 'success', id };
  }
}
