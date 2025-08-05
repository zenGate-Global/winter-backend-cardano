import { ApiProperty } from '@nestjs/swagger';

export class DeploymentResponseDto {
  @ApiProperty({
    description: 'Contract address - primary identifier',
    example: 'addr1contractaddressexample123456789',
  })
  contractAddress: string;

  @ApiProperty({
    description: 'Deployment address',
    example: 'addr1deploymentaddressexample123456789',
  })
  deployAddress: string;

  @ApiProperty({
    description: 'Deployment transaction hash',
    example: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
  })
  deploymentTxHash: string;

  @ApiProperty({
    description: 'Deployment output index',
    example: 0,
  })
  deploymentOutputIndex: number;

  @ApiProperty({
    description: 'Created at timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Complete UTXO reference for the deployment',
    example: {
      txHash: 'cb52c73335b6495e1662747a6a69c335e5341eaf391086b192650564658ce4b9',
      outputIndex: 0
    }
  })
  utxoReference: {
    txHash: string;
    outputIndex: number;
  };
}