import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min } from 'class-validator';

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

  @ApiProperty({
    description:
      'Script hash of the parameterized object event validator that this deployment serves',
    example: '194b693a61ff0de6f07d8b47016f9c368793de6e7ad53584c1deafce',
  })
  @IsString()
  scriptHash: string;
}
