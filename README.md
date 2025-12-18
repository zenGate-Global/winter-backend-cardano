# Winter Cardano Backend
Winter protocol service for the Cardano blockchain. Metadata standard follows the [EPCIS](https://www.gs1.org/standards/epcis) stanard. 

To see the OpenAPI sepcification, along with other usage details and example, please check documentation [overview](https://docs-winter.palmyra.app/docs/Backend/overview).

**Note: This application should be considered an MVP/PoC.**

## Requirements
1. [Blockfrost](https://blockfrost.io)
2. [Cardano wallet mnemonic](https://eternl.io)
3. [Pinata](https://pinata.cloud)
4. [Docker](https://www.docker.com)
5. [Bruno](https://www.usebruno.com): If testing API endpoints locally.

## Basic Setup
1. Copy `.env.example` to `.env` and fill in the required environment variables.
2. Run `docker compose up --build`
3. Use the Bruno collection from the repository to test out the exposed API endoints.

## Important Environment Variables
- The `NETWORK` can be one of `mainnet` | `preview` | `preprod`.
- The `BLOCKFROST_KEY` should be configured depending on the value used for `NETWORK`.
- The `TRANSACTION_RETRY_ATTEMPTS` (optional, default: 3) configures how many times to retry failed transactions when invalid hashes are received.

## Basic Usage Guideline
In order to submit data to IPFS and then mint an NFT on the Cardano blockchain serving as a reference to the data, you should make the following API calls:

`POST /ipfs`: Here you include the metadata in the EPCIS format that will be uploaded to IPFS. The response will be the IPFS CID.

`POST /palmyra/tokenizeCommodity`: Here you include the IPFS CID and token name in the body. Note that the token name can only be 32 bytes long. The response will include a job id, which can be used to check that status of the job in the queue.

`GET /check/:id`: Include the job id as a query parameter to get the status of the job. If there is a `SUCCESS` status, then the response will also contain a valid Cardano transaction id, which can be used to look up the transaction on the explorer corresponding to the Cardano network type used to run the application. Note that the transaction may not appear immediately, since there will be a delay until it is confirmed to be included inside a block.

## Transaction Retry Handling
The application includes automatic retry logic for transaction building operations. Transactions will be automatically retried when:
- The transaction hash is not of type `string`
- The hash value contains "bad request" (case insensitive)

### Configuration
- Set `TRANSACTION_RETRY_ATTEMPTS` environment variable to configure the number of retry attempts (default: 3)
- Retries use exponential backoff with a maximum delay of 10 seconds
- All retry attempts and outcomes are logged for monitoring

### Affected Operations
- **Tokenize Commodity**: Minting transactions and deployment transactions
- **Recreate Commodity**: Recreation transactions  
- **Spend Commodity**: Spend transactions

## Application Setup

### Setup Guide
To get more in-depth information on how to setup the application and the environment variables, along with how to use the application, please check the following:
- [Getting Started](./docs/versions/v1.0.0/setup/getting-started.mdx)
- [Environment File](./docs/versions/v1.0.0/setup/environment.mdx)
- [Bruno](./docs/versions/v1.0.0/setup/bruno.mdx)

### Deployment
To see best practices for deployment of the application and dealing with different types of metadata, please check the following:
- [Local Deployment](./docs/versions/v1.0.0/deployment/local.mdx)
- [Google Cloud Deployment](./docs/versions/v1.0.0/deployment/google-cloud.mdx)
- [Cost Reduction](./docs/versions/v1.0.0/deployment/cost-reduction.mdx)

### Guides
The guides highlight the main features the application provides for people wanting to use it, please check the following:
- [How It Works](./docs/base/guides/how-it-works.mdx)
- [Glossary](./docs/base/guides/glossary.mdx)
- [Your First Record](./docs/base/guides/your-first-record.mdx)

