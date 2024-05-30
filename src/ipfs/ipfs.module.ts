import { Module } from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { IpfsController } from './ipfs.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [IpfsController],
  providers: [IpfsService],
})
export class IpfsModule {}
