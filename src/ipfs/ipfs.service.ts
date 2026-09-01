import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinataSDK } from 'pinata';
import { canonicalJson } from './lossless-json';

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

  async storeJson(json: unknown): Promise<string> {
    try {
      const bytes = canonicalJson(json);
      const upload = await this.pinata.upload.public.file(
        new File([bytes], 'data.json', { type: 'application/json' }),
      );
      return upload.cid;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('IPFS upload failed');
      throw new BadRequestException('IPFS Upload Error');
    }
  }

  async storeCanonical(canonical: Buffer): Promise<string> {
    try {
      const upload = await this.pinata.upload.public.file(
        new File([canonical as unknown as BlobPart], 'data.json', {
          type: 'application/json',
        }),
      );
      return upload.cid;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('IPFS upload failed');
      throw new BadRequestException('IPFS Upload Error');
    }
  }
}
