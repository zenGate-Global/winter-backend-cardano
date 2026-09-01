import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { StoreIpfsResponseDto } from './dto/store-ipfs.dto';
import { IpfsEnvelopeDto } from './dto/ipfs-envelope.dto';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../palmyra/dto/error.dto';
import { IPFS_CANONICAL_BODY } from './lossless-json';
import type { Request } from 'express';

@ApiTags('IPFS')
@Controller('ipfs')
export class IpfsController {
  private readonly logger = new Logger(IpfsController.name);
  constructor(private readonly ipfsService: IpfsService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'uploads data to ipfs and returns hash',
    type: StoreIpfsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'returns error message',
    type: ErrorResponse,
  })
  async store(
    @Body()
    data: IpfsEnvelopeDto,
    @Req() req: Request,
  ): Promise<StoreIpfsResponseDto> {
    try {
      const canonical = (req as unknown as Record<symbol, Buffer>)[
        IPFS_CANONICAL_BODY
      ];
      const cid = canonical
        ? await this.ipfsService.storeCanonical(canonical)
        : await this.ipfsService.storeJson(data);
      return {
        hash: cid as string,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('IPFS upload failed');
      throw new HttpException(
        'IPFS Upload Failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: error },
      );
    }
  }
}
