import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinataSDK } from 'pinata';

@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);
  private readonly pinata: PinataSDK;

  constructor(private configService: ConfigService) {
    const jwt = this.configService.get<string>('PINATA_JWT');
    const gateway = this.configService.get<string>('NEXT_PUBLIC_GATEWAY_URL');
    this.pinata = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: gateway,
    });
  }

  async storeJson(json: any): Promise<string> {
    try {
      const upload = await this.pinata.upload.public.json(json);
      return upload.cid;
    } catch (error) {
      this.logger.error(`ipfs upload error: ${error}`);
      throw new BadRequestException({
        message: 'IPFS Upload Error',
        cause: error.message,
      });
    }
  }
}
