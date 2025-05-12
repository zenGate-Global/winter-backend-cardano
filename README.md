# Winter Cardano Backend
Winter protocol service for the Cardano blockchain. Metadata standard follows the [EPCIS](https://www.gs1.org/standards/epcis) stanard. 

To see the OpenAPI sepcification, along with other usage details and example, please check documentation [overview](https://docs-winter.palmyra.app/docs/Backend/overview).

**Note: This application should be considered an MVP/PoC.**

## Requirements
1. [Ogmios](https://ogmios.dev)
2. [Blockfrost](https://blockfrost.io)
3. [Cardano wallet mnemonic](https://eternl.io)
4. [Pinata](https://pinata.cloud)
5. [Docker](https://www.docker.com)
6. [Bruno](https://www.usebruno.com): If testing API endpoints locally.

## Basic Setup
1. Copy `.env.example` to `.env` and fill in the required environment variables.
2. Run `docker compose up --build`
3. Use the Bruno collection from the repository to test out the exposed API endoints.

## Important Environment Variables
- The `NETWORK` can be one of `mainnet` | `preview` | `preprod`.
- The `OGMIOS_HOST` and `OGMIOS_PORT` should be configured depending on the value used for `NETWORK`. The same is true for `BLOCKFROST_KEY`.

## Basic Usage Guideline
In order to submit data to IPFS and then mint an NFT on the Cardano blockchain serving as a reference to the data, you should make the following API calls:

`POST /ipfs`: Here you include the metadata in the EPCIS format that will be uploaded to IPFS. The response will be the IPFS CID.

`POST /palmyra/tokenizeCommodity`: Here you include the IPFS CID and token name in the body. Note that the token name can only be 32 bytes long. The response will include a job id, which can be used to check that status of the job in the queue.

`GET /check/:id`: Include the job id as a query parameter to get the status of the job. If there is a `SUCCESS` status, then the response will also contain a valid Cardano transaction id, which can be used to look up the transaction on the explorer corresponding to the Cardano network type used to run the application. Note that the transaction may not appear immediately, since there will be a delay until it is confirmed to be included inside a block.

## Developer Resources and Best Practices
To get more in-depth information on how to setup the application and the environment variables, along with how to use the application, please check the following [winter-manual](./docs/WINTER-MANUAL.md).
