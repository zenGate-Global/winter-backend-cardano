# Winter Manual
Comprehensive guide to setting up and running the winter-backend-cardano application. 

## Requirements
In order to proceed with installing and running the application, make sure you have the following installed:

[git](https://git-scm.com): This is necessary to clone the GitHub repository. 

[Docker](https://www.docker.com): The application is containerized, so Docker will be required to build the image and then run it.

[Bruno](https://www.usebruno.com): This will be necessary to make API calls to the application.

## Installation
Clone the repository on your computer:

`git clone https://github.com/zenGate-Global/winter-backend-cardano`

## Environment File
Once the repository is cloned locally on your computer, enter its directory and copy `.env.example` to `.env`.

We will now explain each variable in the environment file.

`NETWORK`: This is the Cardano network type to use for application. The valid values are: `mainnet` | `preview` | `preprod`

`ZENGATE_WALLET_MNEMONIC`: This is the mnemonic to use for paying all the Cardano transaction fees. When wanting to submit transactions to the Cardano blockchain with the running application, make sure this wallet has enough ADA in it. This mnemonic can be created with any valid Cardnao wallet application, e.g. [eternl](https://eternl.io/)

`BLOCKFROST_KEY`: [Blockfrost](https://blockfrost.io) is used for fetching and submitting data on the Cardano blockchain. This API key is necessary for the winter-cardano library. Make an account to obtain a valid API key.

`PINATA_JWT`: [Pinata]() is used for submitting data to IPFS. Make an account to obtain a valid API key.

`NEXT_PUBLIC_GATEWAY_URL`: This is used along with the `PINATA_JWT` to create a PinataSDK object. We need this public gateway url because the data is being made publically available on IPFS.

`POSTGRES_HOST`: The database is used for storing information used by the application as it processes requests for building and submitting transactions to the Cardano blockchain. This value should be left as `db` because we are running the application within a Docker container.

`POSTGRES_PORT`: This should be left as `5432`, there is no need to change this value.

`POSTGRES_DB`: You can set this to the default database as `postgres`.

`POSTGRES_USER`: This can be set to any valid value you want.

`POSTGRES_PASSWORD`: This can be set to any valid value you want.

`POSTGRES_SYNC`: This can be set to `TRUE` | `FALSE`.

`POSTGRES_LOGGING`: This can be set to `TRUE` | `FALSE`.

`REDIS_HOST`: Redis is used as queue for handling the jobs for building and submitting transaction to the Cardano blockchain. This is can be left as `redis`.

`REDIS_PORT`: This can be left as `6379`

`PORT`: A valid port value for where the application will listen to incoming API requests.

## Running the Application
Once all the environment variables have been properly set, you can use the following command to build and then run the image:

`docker compose up --build`

## Bruno
Once the application is started succesfully, you can use Bruno to submit API requests to the exposed endpoints, prefixed with: `http://localhost:PORT`, where `PORT` is the value assigned to the same environment variable in the `.env` file.

If you are using Bruno, make sure to select the `local` environment and assign the `http://localhost:PORT` url to the `winter` variable. There are two other environments for `staging` and `production`, where a valid url to where the application is being hosted should be used instead.

## Application Endpoints
We now describe the endpoints exposed by the application. To see the complete OpenAPI specification, check the documentation [here](https://palmyra-docs.vercel.app/docs/Backend/endpoints).

### IPFS
`POST /ipfs`: Here you include the metadata in the [EPCIS](https://www.gs1.org/standards/epcis) format that will be uploaded to IPFS. The response will be the IPFS CID.

### Palmyra
`POST /palmyra/tokenizeCommodity`: Here you include the IPFS CID and token name in the body. Note that the token name can only be 32 bytes long. The response will include a job id, which can be used to check that status of the job in the queue.

`POST /palmyra/recreateCommodity`: Here you include in the body of the request the relevant transaction hash (i.e. transaction id), the output index of the utxo in the transaction and the new IPFS data reference desired. This is meant to function as an update of the metadata, but the token id of the NFT will remain the same.

`POST /palmyra/spendCommodity`: Here you include in the body of the request the relevant transaction hash (i.e. transaction id) and the output index of the utxo in the transaction. This will spend the utxo and burn the NFT so that it can no longer be used as a valid reference to metadata.

`POST /palmyra/commodityDetails`: Here you include in the body of the request a list of relevant token ids. This will return a list of objects representing the datum stored in each utxo referenced by it corresponding NFT id.

### Check
`GET /check`: This will return the satus of all transactions in the Redis queue of the application. 

`GET /check/:id`: Include the job id as a query parameter to get the status of the job. If there is a `SUCCESS` status, then the response will also contain a valid Cardano transaction id, which can be used to look up the transaction on the explorer corresponding to the Cardano network type used to run the application. Note that the transaction may not appear immediately, since there will be a delay until it is confirmed to be included inside a block.

### Transactions
`GET /transactions`: This will return information about all transactions that have been built and submitted by the application and stored in the Postgres database.

`GET /transactions/:txid`: This will return information about a particular transaction built and submitted by the application and stored in the Postgres database

