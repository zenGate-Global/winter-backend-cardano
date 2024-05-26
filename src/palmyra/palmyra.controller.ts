import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PalmyraService } from './palmyra.service';
import { v4 as uuidv4 } from 'uuid';
import {
  CommodityDetailsDto,
  CommodityDetailsResponseDto,
} from './dto/commodity-details.dto';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponse } from './dto/error.dto';
import {
  SpendCommodityDto,
  SpendCommodityResponseDto,
} from './dto/spend-commodity.dto';
import {
  TokenizeCommodityDto,
  TokenizeCommodityResponseDto,
} from './dto/tokenize-commodity.dto';
import {
  RecreateCommodityDto,
  RecreateCommodityResponseDto,
} from './dto/recreate-commodity.dto';

@ApiTags('Blockchain')
@Controller('palmyra')
export class PalmyraController {
  constructor(private readonly palmyraService: PalmyraService) {}

  @Post('commodityDetails')
  @ApiCreatedResponse({
    description:
      'returns data associated to the contract the token with matching id is in',
    type: CommodityDetailsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async commodityDetails(
    @Body() message: CommodityDetailsDto,
  ): Promise<CommodityDetailsResponseDto> {
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
  @ApiCreatedResponse({
    description: 'returns queue data associated to spending',
    type: SpendCommodityResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async spendCommodity(
    @Body() message: SpendCommodityDto,
  ): Promise<SpendCommodityResponseDto> {
    const id = uuidv4();
    await this.palmyraService.dispatchSpendCommodity({
      id,
      utxos: message.utxos,
    });
    return { message: 'success', id };
  }

  @Post('tokenizeCommodity')
  @ApiCreatedResponse({
    description: 'returns queue data associated to tokenizing',
    type: TokenizeCommodityResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async tokenizeCommodity(
    @Body() message: TokenizeCommodityDto,
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
  @ApiCreatedResponse({
    description: 'returns queue data associated to tokenizing',
    type: RecreateCommodityResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async recreateCommodity(
    @Body() message: RecreateCommodityDto,
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
