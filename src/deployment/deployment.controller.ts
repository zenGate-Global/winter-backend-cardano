import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  NotFoundException,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
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
    description: 'List of all deployments',
    type: [Deployment],
  })
  async getAllDeployments(): Promise<Deployment[]> {
    return this.deploymentService.getAllDeployments();
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

  // @Get(':contractAddress/utxo')
  // @ApiOperation({ summary: 'Get UTXO reference for deployment by contract address' })
  // @ApiParam({ name: 'contractAddress', description: 'The contract address' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'UTXO reference for the deployment',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       txHash: { type: 'string', example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9' },
  //       outputIndex: { type: 'number', example: 0 }
  //     }
  //   }
  // })
  // @ApiResponse({ status: 404, description: 'Deployment not found' })
  // async getUtxoReference(@Param('contractAddress') contractAddress: string): Promise<{ txHash: string; outputIndex: number }> {
  //   return this.deploymentService.getUtxoReferenceByContractAddress(contractAddress);
  // }

  // @Get(':contractAddress/exists')
  // @ApiOperation({ summary: 'Check if deployment exists for contract address' })
  // @ApiParam({ name: 'contractAddress', description: 'The contract address' })
  // @ApiResponse({ status: 200, description: 'Returns whether deployment exists' })
  // async checkDeploymentExists(@Param('contractAddress') contractAddress: string): Promise<{ exists: boolean }> {
  //   const exists = await this.deploymentService.deploymentExistsByContractAddress(contractAddress);
  //   return { exists };
  // }

  // @Post()
  // @ApiOperation({ summary: 'Manually create a deployment record' })
  // @ApiBody({ type: CreateDeploymentDto })
  // @ApiResponse({ status: 201, description: 'Deployment created', type: DeploymentResponseDto })
  // async createDeployment(@Body() createDeploymentDto: CreateDeploymentDto): Promise<DeploymentResponseDto> {
  //   const deployment = await this.deploymentService.saveDeployment(createDeploymentDto);

  //   return {
  //     contractAddress: deployment.contractAddress,
  //     deployAddress: deployment.deployAddress,
  //     deploymentTxHash: deployment.deploymentTxHash,
  //     deploymentOutputIndex: deployment.deploymentOutputIndex,
  //     createdAt: deployment.createdAt,
  //     utxoReference: {
  //       txHash: deployment.deploymentTxHash,
  //       outputIndex: deployment.deploymentOutputIndex,
  //     },
  //   };
  // }

  // @Put(':contractAddress')
  // @ApiOperation({ summary: 'Update deployment by contract address' })
  // @ApiParam({ name: 'contractAddress', description: 'The contract address' })
  // @ApiBody({ type: CreateDeploymentDto })
  // @ApiResponse({ status: 200, description: 'Deployment updated', type: DeploymentResponseDto })
  // @ApiResponse({ status: 404, description: 'Deployment not found' })
  // async updateDeployment(@Param('contractAddress') contractAddress: string, @Body() updateData: Partial<CreateDeploymentDto>): Promise<DeploymentResponseDto> {
  //   const deployment = await this.deploymentService.updateDeploymentByContractAddress(contractAddress, updateData);

  //   return {
  //     contractAddress: deployment.contractAddress,
  //     deployAddress: deployment.deployAddress,
  //     deploymentTxHash: deployment.deploymentTxHash,
  //     deploymentOutputIndex: deployment.deploymentOutputIndex,
  //     createdAt: deployment.createdAt,
  //     utxoReference: {
  //       txHash: deployment.deploymentTxHash,
  //       outputIndex: deployment.deploymentOutputIndex,
  //     },
  //   };
  // }
}
