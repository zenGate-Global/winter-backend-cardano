import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Deployment } from '../deployment/entities/deployment.entity';
import { DeploymentService } from '../deployment/deployment.service';
import { openProofDatabase } from './proof-database';

async function main(): Promise<void> {
  const proof = await openProofDatabase(
    [Deployment],
    ['LEGACY_PROOF_DATABASE_URL', 'DEPLOYMENT_PROOF_DATABASE_URL'],
    'wt-legacy-proof',
  );
  try {
    const repository = proof.dataSource.getRepository(Deployment);
    const service = new DeploymentService(repository, proof.dataSource.manager);
    const legacyAddress =
      'addr_test1wph2wcr4ysaen987g87magjh96l2ymvrgyvnu6yjvrtahdqu7qvqy';
    const currentAddress =
      'addr_test1wpfc7e7zqlqtra8hnyq7k0hh3rdwjm7m0fnzuyqjl0xxt3gatmv8f';
    const currentHash = 'e'.repeat(56);
    await repository.save([
      new Deployment({
        contractAddress: legacyAddress,
        deployAddress: 'addr_test1_deployer',
        deploymentTxHash: 'c'.repeat(64),
        deploymentOutputIndex: 3,
        scriptHash: null,
      }),
      new Deployment({
        contractAddress: currentAddress,
        deployAddress: 'addr_test1_deployer',
        deploymentTxHash: 'd'.repeat(64),
        deploymentOutputIndex: 7,
        scriptHash: currentHash,
      }),
    ]);
    assert.equal(
      await service.deploymentExistsByContractAddressAndScriptHash(
        legacyAddress,
        null,
      ),
      true,
    );
    assert.equal(
      await service.deploymentExistsByContractAddressAndScriptHash(
        legacyAddress,
        currentHash,
      ),
      false,
    );
    assert.equal(
      await service.deploymentExistsByContractAddressAndScriptHash(
        currentAddress,
        currentHash,
      ),
      true,
    );
    console.log(
      'legacy routing DB-only check passed. Legacy chain fixture remains unverified',
    );
  } finally {
    await proof.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
