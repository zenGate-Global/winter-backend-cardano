import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateDeploymentDto {
  @ApiProperty({
    description: 'Contract address - primary identifier',
    example: 'addr1contractaddressexample123456789',
  })
  @IsString()
  contractAddress: string;

  @ApiProperty({
    description: 'Deployment address',
    example: 'addr1deploymentaddressexample123456789',
  })
  @IsString()
  deployAddress: string;

  @ApiProperty({
    description: 'Deployment transaction hash',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  @IsString()
  deploymentTxHash: string;

  @ApiProperty({
    description: 'Deployment output index',
    example: 0,
  })
  @IsInt()
  @Min(0)
  deploymentOutputIndex: number;
}
