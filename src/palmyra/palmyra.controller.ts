import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PalmyraService } from './palmyra.service';
import {
  deriveRequestFingerprint,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IdempotencyScope,
  resolveJobId,
} from './idempotency';
import {
  CommodityDetailsDto,
  CommodityDetailsResponseDto,
} from './dto/commodity-details.dto';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from './dto/error.dto';
import { SpendCommodityDto } from './dto/spend-commodity.dto';
import { TokenizeCommodityDto } from './dto/tokenize-commodity.dto';
import { RecreateCommodityDto } from './dto/recreate-commodity.dto';
import { OperationResponseDto } from './dto/operation-response.dto';
import { CheckService } from '../check/check.service';

@ApiTags('Blockchain')
@Controller('palmyra')
export class PalmyraController {
  constructor(
    private readonly palmyraService: PalmyraService,
    private readonly checkService: CheckService,
  ) {}

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

  private statusUrl(id: string): string {
    return `/check/${id}`;
  }

  private async operationResponse(
    id: string,
    res: Response,
  ): Promise<OperationResponseDto> {
    let status: string = 'PENDING';
    try {
      const row = await this.checkService.findOne(id);
      status = row.status ?? 'PENDING';
    } catch {
      // row not yet visible, treat as pending
    }
    const url = this.statusUrl(id);
    res.setHeader('Location', url);
    res.setHeader('Retry-After', '5');
    return {
      message: 'accepted',
      id,
      status: status as unknown as OperationResponseDto['status'],
      statusUrl: url,
    };
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
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'returns queue data associated to spending',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async spendCommodity(
    @Body() message: SpendCommodityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<OperationResponseDto> {
    const id = this.jobId('spend-commodity', idempotencyKey);
    const requestFingerprint = idempotencyKey?.trim()
      ? deriveRequestFingerprint(message)
      : null;
    await this.palmyraService.dispatchSpendCommodity(
      {
        id,
        utxos: message.utxos,
        utxoRef: {},
      },
      requestFingerprint,
    );
    return this.operationResponse(id, res as Response);
  }

  @Post('tokenizeCommodity')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'returns queue data associated to tokenizing',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async tokenizeCommodity(
    @Body() message: TokenizeCommodityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<OperationResponseDto> {
    const id = this.jobId('tokenize-commodity', idempotencyKey);
    const requestFingerprint = idempotencyKey?.trim()
      ? deriveRequestFingerprint(message)
      : null;
    await this.palmyraService.dispatchTokenizeCommodity(
      {
        id,
        tokenName: message.tokenName,
        metadataReference: message.metadataReference,
      },
      requestFingerprint,
    );
    return this.operationResponse(id, res as Response);
  }

  @Post('recreateCommodity')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'returns queue data associated to recreating',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async recreateCommodity(
    @Body() message: RecreateCommodityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<OperationResponseDto> {
    const utxoLen = message.utxos.length;
    const dataLen = message.newDataReferences.length;
    if (utxoLen !== dataLen) {
      throw new HttpException(
        `utxo(s) of length ${utxoLen} should match data array of length ${dataLen}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const id = this.jobId('recreate-commodity', idempotencyKey);
    const requestFingerprint = idempotencyKey?.trim()
      ? deriveRequestFingerprint(message)
      : null;
    await this.palmyraService.dispatchRecreateCommodity(
      {
        id,
        utxos: message.utxos,
        newDataReferences: message.newDataReferences,
        utxoRef: {},
      },
      requestFingerprint,
    );
    return this.operationResponse(id, res as Response);
  }
}
