import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CIDString, NFTStorage } from 'nft.storage';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IpfsService {
  private readonly NFT_STORAGE_KEY: string;
  private readonly logger = new Logger(IpfsService.name);

  constructor(private configService: ConfigService) {
    this.NFT_STORAGE_KEY = this.configService.get<string>(
      'NFT_STORAGE_API_KEY',
    );
  }
  async storeJson(json: any): Promise<CIDString> {
    try {
      const nftstorage = new NFTStorage({ token: this.NFT_STORAGE_KEY });
      const file = new Blob([JSON.stringify(json)], {
        type: 'application/json',
      });
      return nftstorage.storeBlob(file);
    } catch (error) {
      this.logger.error(`ipfs upload error: ${error}`);
      throw new BadRequestException({
        message: 'IPFS Upload Error',
        cause: error.message,
      });
    }
  }
}
