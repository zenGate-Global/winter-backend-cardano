import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PalmyraService } from './palmyra.service';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IdempotencyScope,
  resolveJobId,
} from './idempotency';
import {
  CommodityDetailsDto,
  CommodityDetailsResponseDto,
} from './dto/commodity-details.dto';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
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

  // A caller may send an `Idempotency-Key` header. The same key on the same
  // route always resolves to the same job, so a retry of a request whose
  // response was lost returns the original job instead of starting a second
  // transaction. Without the header the behaviour is unchanged.
  private jobId(scope: IdempotencyScope, key?: string): string {
    if (key !== undefined && key.trim().length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new HttpException(
        `Idempotency-Key must be ${IDEMPOTENCY_KEY_MAX_LENGTH} characters or fewer`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return resolveJobId(scope, key);
  }

  @Post('commodityDetails')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SpendCommodityResponseDto> {
    const id = this.jobId('spend-commodity', idempotencyKey);
    await this.palmyraService.dispatchSpendCommodity({
      id,
      utxos: message.utxos,
      utxoRef: {},
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ message: string; id: string }> {
    const id = this.jobId('tokenize-commodity', idempotencyKey);
    await this.palmyraService.dispatchTokenizeCommodity({
      id,
      tokenName: message.tokenName,
      metadataReference: message.metadataReference,
    });
    return { message: 'success', id };
  }

  @Post('recreateCommodity')
  @ApiCreatedResponse({
    description: 'returns queue data associated to recreating',
    type: RecreateCommodityResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async recreateCommodity(
    @Body() message: RecreateCommodityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ message: string; id: string }> {
    const utxoLen = message.utxos.length;
    const dataLen = message.newDataReferences.length;
    if (utxoLen !== dataLen) {
      throw new HttpException(
        `utxo(s) of length ${utxoLen} should match data array of length ${dataLen}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const id = this.jobId('recreate-commodity', idempotencyKey);
    await this.palmyraService.dispatchRecreateCommodity({
      id,
      utxos: message.utxos,
      newDataReferences: message.newDataReferences,
      utxoRef: {},
    });
    return { message: 'success', id };
  }
}
