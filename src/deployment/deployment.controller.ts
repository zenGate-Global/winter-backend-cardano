import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { DeploymentService } from './deployment.service';
import { Deployment } from './entities/deployment.entity';
import { DeploymentResponseDto } from './dto/deployment-response.dto';

@ApiTags('deployments')
@Controller('deployments')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all deployments' })
  @ApiResponse({
    status: 200,
    description: 'List of all deployments (default 50, max 200)',
    type: [Deployment],
  })
  async getAllDeployments(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Deployment[]> {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    return this.deploymentService.getAllDeployments(take, skip);
  }

  @Get(':contractAddress')
  @ApiOperation({ summary: 'Get deployment by contract address' })
  @ApiParam({ name: 'contractAddress', description: 'The contract address' })
  @ApiResponse({
    status: 200,
    description: 'Deployment found',
    type: DeploymentResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async getDeploymentByContractAddress(
    @Param('contractAddress') contractAddress: string,
  ): Promise<DeploymentResponseDto> {
    const deployment =
      await this.deploymentService.getDeploymentByContractAddress(
        contractAddress,
      );

    return {
      contractAddress: deployment.contractAddress,
      deployAddress: deployment.deployAddress,
      deploymentTxHash: deployment.deploymentTxHash,
      deploymentOutputIndex: deployment.deploymentOutputIndex,
      createdAt: deployment.createdAt,
      utxoReference: {
        txHash: deployment.deploymentTxHash,
        outputIndex: deployment.deploymentOutputIndex,
      },
    };
  }

}
