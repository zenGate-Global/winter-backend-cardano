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
import { ObjectDatum } from 'winter-cardano-mesh';
@Controller('palmyra')
export class PalmyraController {
  constructor(private readonly palmyraService: PalmyraService) {}

  @Post('commodityDetails')
  async commodityDetails(
    @Body() message: { tokenIds: string[] },
  ): Promise<{ message: ObjectDatum[] }> {
    const response = await this.palmyraService.getDataByTokenIds(
      message.tokenIds,
    );
    const convertedResponse = JSON.parse(
      JSON.stringify(response, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );

    return { message: convertedResponse };
  }

  @Post('spendCommodity')
  async spendCommodity(
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
