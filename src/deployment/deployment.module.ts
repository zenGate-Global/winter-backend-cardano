import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';
import { Deployment } from './entities/deployment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Deployment])],
  controllers: [DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
