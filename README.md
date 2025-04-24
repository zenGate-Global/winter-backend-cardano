See docs: https://docs-winter.palmyra.app/docs/Backend/overview

# Winter Cardano Backend
Winter protocol service for the Cardano blockchain. Metadata standard follows the [EPCIS](https://www.gs1.org/standards/epcis) stanard. Note: This application should be considered an MVP/POC.

## Requirements
1. [Ogmios](https://ogmios.dev)
2. [Blockfrost](https://blockfrost.io)
3. [Cardano wallet mnemonic](https://eternl.io)
4. [Pinata](https://pinata.cloud)
5. [Docker](https://www.docker.com)
6. [Bruno](https://www.usebruno.com): If testing API endpoints locally.

## Setup
1. Copy `.env.example` to `.env` and fill in the required environment variables.
2. Run `docker compose up --build`
3. Use the Bruno collection from the repository to test out the exposed API endoints.

## Environment File Explanation
- The `NETWORK` can be one of `mainnet` | `preview` | `preprod`.
- The `OGMIOS_HOST` and `OGMIOS_PORT` should be configured depending on the value used for `NETWORK`. The same is true for `BLOCKFROST_KEY`.
