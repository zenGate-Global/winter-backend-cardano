# Best Practices
This is a document outlining some best-practices for getting the project setup locally or within a hosted environment.

It is important to note that the current version is an MVP/PoC meant to be integrated within another application, and not meant to be used as a standalone service. 

## Deployment


### Local Deployment
Local deployment is used for development and testing any changes made. 

- It is recommended to use Docker for running the project locally instead of build and running it with npm/yarn/bun. 
- Make sure to provide a valid PORT number as an environment variable for the application to listen to incoming requests.

### Google Cloud Deployment
Within zenGate, we are using Google Cloud as our hosting infrastructure for most of our projects, so below are some good steps to follow for using this provider.

- Use Google Cloud Run for deploying the containerized application, make sure to provide enough memory to the instance, otherwise the project will fail to startup. More than 500 MB will be needed.
- Use Google Cloud Memorystore for Redis for hosting the requried Redis instance. For a staging environment, it is fine to use the Basic Tier. However, for a production environment, it is recommended to use the Standard Tier with one replica in case of failover from the primary instance. The queue cannot be flushed otherwise requests will need to be resubmitted to the application for submitting transactions to the Cardano blockchain.
- With Google Cloud Memory Store for Redis, create the instance using the Private Service Access connection mode, ensure you provide the correct subnet value as an environment variable when wanting to connect to the instance.
- Note that unlike the Google Cloud Run, the Redis instance does not get recreated for each new deployment. 
- Use Google Cloud SQL for hosting the required Postgres database instance.
- The repository uses a GitHub workflow to deploy a Google Cloud instance whenever changes are merged/pushed to the remote repository, which is used as our staging or production environment depending on the branch. This is useful for testing integrations of the service within other applications.

#### Common Google Cloud Deployment Errors
- The deployment instance does not have enough memory assigned to it.
- The deployment instance does not have correct environment variables assigned to it, so certain services will not be initialized properly or fail to communicate with other services.

### Other Hosting Providers
The setup process should be similar as for GCP, just make sure that there is access to Redis and a Postgre.

## Cost Reduction Techniques
A basic way to use the protocol is to create a tokenization event for each traceability event that occurs in the physical world. However, due to the minting cost requirements of the Cardano blockchain, it may become too expensive to do so.

In order to reduce minting and transaction costs, adjust the IPFS metadata template so that the structure can reflect a collection of traceability events instead of just one.

To implement the batching process, it is sufficient to create a CRON job that will read from a database the events that you wish to tokenize, and then make the appropriate API request to the application service.

