import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Deployment } from './entities/deployment.entity';
import { CreateDeploymentDto } from './dto/create-deployment.dto';

@Injectable()
export class DeploymentService {
  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepository: Repository<Deployment>,
    private readonly entityManager: EntityManager,
  ) {}

  async saveDeployment(
    createDeploymentDto: CreateDeploymentDto,
  ): Promise<Deployment> {
    const deployment = new Deployment(createDeploymentDto);
    return await this.entityManager.save(deployment);
  }

  async getAllDeployments(limit = 50, offset = 0): Promise<Deployment[]> {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = Math.max(offset, 0);
    return await this.deploymentRepository.find({
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
  }

  async getDeploymentByContractAddress(
    contractAddress: string,
  ): Promise<Deployment> {
    const deployment = await this.deploymentRepository.findOneBy({
      contractAddress,
    });
    if (!deployment) {
      throw new NotFoundException(
        `Deployment not found for contract address: ${contractAddress}`,
      );
    }
    return deployment;
  }


  async deploymentExistsByContractAddress(
    contractAddress: string,
  ): Promise<boolean> {
    const count = await this.deploymentRepository.countBy({ contractAddress });
    return count > 0;
  }

}
