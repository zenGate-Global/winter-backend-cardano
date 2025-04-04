import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { StoreIpfsResponseDto } from './dto/store-ipfs.dto';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../palmyra/dto/error.dto';
import { CID } from 'multiformats/cid';
import { isString } from 'class-validator';
import {
  AggregationEvent,
  AssociationEvent,
  Event,
  ObjectEvent,
  TransactionEvent,
  TransformationEvent,
} from '../ipfs/dto/metadata.dto';

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
    data:
      | ObjectEvent
      | AggregationEvent
      | TransactionEvent
      | TransformationEvent
      | AssociationEvent,
  ): Promise<StoreIpfsResponseDto> {
    console.log(`raw data: ${data}`);
    const res = await this.ipfsService.storeJson(data);
    try {
      if (isCID(res)) {
        return {
          hash: res as string,
        };
      }
    } catch (error) {
      this.logger.error(`CID validation failed: ${error}`);
      throw new HttpException(
        `IPFS Upload Failed`,
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error.message,
        },
      );
    }
  }
}

function isCID(hash: CID | Uint8Array | string): hash is CID {
  try {
    if (isString(hash)) {
      return Boolean(CID.parse(hash));
    }

    if (hash instanceof Uint8Array) {
      return Boolean(CID.decode(hash));
    }

    return Boolean(CID.asCID(hash));
  } catch {
    return false;
  }
}
