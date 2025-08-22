# Educational Material
Here we just highlight some of the most useful aspects of the Winter protocol.

## IPFS Data Uploading
Before any tokenization occurs, the data itself must be stored somewhere so that it can be referenced on the blockchain. The Winter protocol uses the IPFS (Inter-Planetary File System) network to store the traceability metadata.

### Why not store the data directly on the blockchain?
With respect to UTxO (Unspent Transaction Output) blockchains, although it is possible to store data directly in a datum associated to the UTxO, usually there are strict size limitations that can make it infeasible for large amounts of data.

So, another useful approach, is to use the UTxO as a reference to off-chain data stored somewhere else, and in the case of Winter protocol, it is IPFS. However, this could be different as well, all that is needed is a valid data reference.

## Tokenization
Once there is a valid data reference, e.g. an IPFS CID, a corresponding reference is needed on the blockchain that is immutable. Since token identifiers are unique, unlike UTxO identifiers that change once spent, these can minted and serves as the on-chain pointer.

The Winter protocol will store the CID in the datum of the UTxO and mint a corresponding NFT to be used as the on-chain reference to the off-chain data.

## Update
Once the NFT is minted and the traceability data has been tokenized, it is possible with the current implementation to update the data reference, if needed. A potential use case for this would be in case of an error made in the off-chain data. Future implementations may restrict this functionality due to the potential of unwanted data tampering.

In order to update the off-chain data, the new data must be uploaded to IPFS again. This will produce a new CID.

However, instead of minting a new NFT, the same NFT will be used, but transferred to a new UTxO. This ensures that the on-chain data reference does not change, making it useful if other protocols or smart-contracts are explicitly using the idenfitier.

## Delete
Once traceability data is no longer needed, it is possible to also delete the on-chain reference. This is done by simply spending the UTxO, this will burn the NFT, thus effectively deleting the reference from the blockchain.

## Glossary
1. **IPFS:** Inter-Planetary File System, a network used for storing data.
2. **UTxO:** Unpsent Transaction Output, a particular accounting model for a blockchain used for representing state.
3. **Datum:** Arbitrary data associated with an UTxO.
4. **CID:** Content Identifier, a reference to data, usually the output of a particular hash function applied to the data.
5. **NFT:** Non-Fungeable Token, a token with unique identifier and total amount of 1.