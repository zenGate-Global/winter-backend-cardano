import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Deployment } from './entities/deployment.entity';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import {
  BlockFrostAPI,
  BlockfrostServerError,
} from '@blockfrost/blockfrost-js';
import { resolvePlutusScriptHash } from '@meshsdk/core';
import { BLOCKFROST_KEY } from '../constants';

@Injectable()
export class DeploymentService {
  private blockfrost?: BlockFrostAPI;

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepository: Repository<Deployment>,
    private readonly entityManager: EntityManager,
  ) {}

  private getBlockfrost(): BlockFrostAPI {
    if (this.blockfrost) return this.blockfrost;
    const key = BLOCKFROST_KEY() as string;
    this.blockfrost = key.startsWith('http')
      ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
      : new BlockFrostAPI({ projectId: key });
    return this.blockfrost;
  }

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

  async findLiveReference(
    contractAddress: string,
    deployAddress: string,
  ): Promise<{ txHash: string; outputIndex: number } | null> {
    const expectedHash = resolvePlutusScriptHash(contractAddress);
    const outputs = await this.getBlockfrost().addressesUtxosAll(deployAddress);
    const match = outputs.find(
      (output) => output.reference_script_hash === expectedHash,
    );
    return match
      ? { txHash: match.tx_hash, outputIndex: match.output_index }
      : null;
  }

  async getCurrentReferenceState(
    contractAddress: string,
  ): Promise<'none' | 'live' | 'pending' | 'stale'> {
    const deployment = await this.deploymentRepository.findOneBy({
      contractAddress,
    });
    if (!deployment) return 'none';

    const expectedHash = resolvePlutusScriptHash(contractAddress);
    if (deployment.scriptHash === null) {
      throw new Error('Historical deployment identity cannot become current');
    }
    if (deployment.scriptHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error('Current deployment script identity does not match');
    }
    if (
      !/^[0-9a-f]{64}$/i.test(deployment.deploymentTxHash) ||
      !Number.isSafeInteger(deployment.deploymentOutputIndex) ||
      deployment.deploymentOutputIndex < 0 ||
      !deployment.deployAddress
    ) {
      throw new Error('Current deployment outref is malformed');
    }

    const blockfrost = this.getBlockfrost();
    try {
      const transaction = await blockfrost.mempoolTx(
        deployment.deploymentTxHash,
      );
      const exact =
        transaction.tx.hash.toLowerCase() ===
          deployment.deploymentTxHash.toLowerCase() &&
        transaction.outputs.some(
          (output) =>
            output.address === deployment.deployAddress &&
            output.output_index === deployment.deploymentOutputIndex &&
            output.reference_script_hash === expectedHash,
        );
      if (!exact) {
        throw new Error('Pending deployment identity does not match');
      }
      return 'pending';
    } catch (error) {
      if (
        !(error instanceof BlockfrostServerError) ||
        error.status_code !== 404
      ) {
        throw error;
      }
    }

    const outputs = await blockfrost.addressesUtxosAll(
      deployment.deployAddress,
    );
    return outputs.some(
      (output) =>
        output.tx_hash.toLowerCase() ===
          deployment.deploymentTxHash.toLowerCase() &&
        output.output_index === deployment.deploymentOutputIndex &&
        output.reference_script_hash === expectedHash,
    )
      ? 'live'
      : 'stale';
  }

  async getLiveDeploymentByContractAddress(
    contractAddress: string,
  ): Promise<Deployment> {
    const deployment =
      await this.getDeploymentByContractAddress(contractAddress);
    const expectedHash = resolvePlutusScriptHash(contractAddress);
    const outputs = await this.getBlockfrost().addressesUtxosAll(
      deployment.deployAddress,
    );
    const exact = outputs.find(
      (output) =>
        output.tx_hash.toLowerCase() ===
          deployment.deploymentTxHash.toLowerCase() &&
        output.output_index === deployment.deploymentOutputIndex &&
        output.reference_script_hash === expectedHash,
    );
    if (exact) return deployment;
    if (deployment.scriptHash === null) {
      throw new NotFoundException(
        `Historical deployment unavailable for contract address: ${contractAddress}`,
      );
    }
    const live = outputs.find(
      (output) => output.reference_script_hash === expectedHash,
    );
    if (!live) {
      throw new NotFoundException(
        `Live deployment not found for contract address: ${contractAddress}`,
      );
    }
    return this.saveDeployment({
      contractAddress,
      deployAddress: deployment.deployAddress,
      deploymentTxHash: live.tx_hash,
      deploymentOutputIndex: live.output_index,
      scriptHash: deployment.scriptHash,
    });
  }

  async deploymentExistsByContractAddress(
    contractAddress: string,
  ): Promise<boolean> {
    const count = await this.deploymentRepository.countBy({ contractAddress });
    return count > 0;
  }

  async deploymentExistsByContractAddressAndScriptHash(
    contractAddress: string,
    scriptHash: string | null,
  ): Promise<boolean> {
    const deployment = await this.deploymentRepository.findOneBy({
      contractAddress,
    });
    return deployment?.scriptHash === scriptHash;
  }
}
