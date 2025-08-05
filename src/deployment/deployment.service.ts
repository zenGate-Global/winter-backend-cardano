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

  async saveDeployment(createDeploymentDto: CreateDeploymentDto): Promise<Deployment> {
    const deployment = new Deployment(createDeploymentDto);
    return await this.entityManager.save(deployment);
  }

  async getAllDeployments(): Promise<Deployment[]> {
    return await this.deploymentRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async getDeploymentByContractAddress(contractAddress: string): Promise<Deployment> {
    const deployment = await this.deploymentRepository.findOneBy({ contractAddress });
    if (!deployment) {
      throw new NotFoundException(`Deployment not found for contract address: ${contractAddress}`);
    }
    return deployment;
  }

  async getUtxoReferenceByContractAddress(contractAddress: string): Promise<{ txHash: string; outputIndex: number }> {
    const deployment = await this.getDeploymentByContractAddress(contractAddress);
    return {
      txHash: deployment.deploymentTxHash,
      outputIndex: deployment.deploymentOutputIndex,
    };
  }

  async deploymentExistsByContractAddress(contractAddress: string): Promise<boolean> {
    const count = await this.deploymentRepository.countBy({ contractAddress });
    return count > 0;
  }

  async updateDeploymentByContractAddress(
    contractAddress: string,
    updateData: Partial<CreateDeploymentDto>
  ): Promise<Deployment> {
    const deployment = await this.getDeploymentByContractAddress(contractAddress);
    Object.assign(deployment, updateData);
    return await this.entityManager.save(deployment);
  }

  async deleteDeploymentByContractAddress(contractAddress: string): Promise<void> {
    const result = await this.deploymentRepository.delete({ contractAddress });
    if (result.affected === 0) {
      throw new NotFoundException(`Deployment not found for contract address: ${contractAddress}`);
    }
  }
}