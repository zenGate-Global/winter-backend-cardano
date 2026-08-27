# Winter Cardano Backend

NestJS 11 service on Node 22 and pnpm 10. It writes EPCIS supply-chain records
to IPFS through Pinata, then mints a Cardano NFT that points at the record. The
chain work runs through `@zengate/winter-cardano-mesh`, and the queue is pg-boss
inside the same Postgres database.

**This service holds a live, spendable Cardano wallet.**
`ZENGATE_WALLET_MNEMONIC` is loaded into two long-lived singletons, and every
mint spends real ADA from it.

The default branch is `main`. **The repository is public.**

## Read this before you change anything

Three facts shape every decision here, and none of them is visible from a single
file.

1. **No build, no type check and no test runs on a pull request.** The only
   workflow in the repository is a manual deploy, and its `pull_request` trigger
   is commented out. CodeQL runs through GitHub default setup, which is why no
   file for it exists here, and it is the only automatic check. It reads for
   vulnerable patterns and it never builds the project. **You are the gate.**
2. **There are no tests.** `pnpm test` finds zero specs. Three check scripts
   cover the paths that matter most, and two of them need a live database.
3. **The deployed service is public at the network layer and protected by a
   shared-secret guard.** Every request must send `x-api-key`. The process
   refuses to start without `WINTER_API_KEY`.

Points 1 and 3 mean an unreviewed change reaches a public service that spends
from a funded wallet.

## Documentation map

`docs/` holds 45 files and it publishes to an external site. An edit there
changes a public page. There is no index, so use this table.

| Area | Covers | Trust |
|---|---|---|
| [`docs/base/introduction/`](docs/base/introduction/) | what the Winter protocol is | current |
| [`docs/base/events/`](docs/base/events/) | the on-chain event shapes | current, but see the vocabulary warning below |
| [`docs/base/guides/`](docs/base/guides/) | how it works, glossary, first record | mostly current |
| [`docs/base/changelog/`](docs/base/changelog/) | release notes | stale by omission |
| [`docs/versions/v1.0.0/setup/`](docs/versions/v1.0.0/setup/) | setup, environment, Bruno | `environment.mdx` is current |
| [`docs/versions/v1.0.0/deployment/`](docs/versions/v1.0.0/deployment/) | local, Google Cloud, cost | current |
| [`docs/versions/v1.0.0/best-practices/`](docs/versions/v1.0.0/best-practices/) | operations advice | current |
| [`docs/versions/v1.0.0/faqs/`](docs/versions/v1.0.0/faqs/) | questions | current |
| [`docs/versions/v1.0.0/templates/`](docs/versions/v1.0.0/templates/) | metadata examples | wrong format |
| [`docs/versions/v1.0.0/API-Playground/`](docs/versions/v1.0.0/API-Playground/) | the OpenAPI file | hand-written, and it drifts |

### Documents you must not trust

An agent that reads `docs/` for context will reason confidently about systems
that do not exist. Check each of these against the source before you use it.

- **The three metadata templates.** They show a pre-EPCIS shape that a later
  change replaced. The Bruno collection holds the correct shape.

### Two vocabularies that look like one

`docs/base/events/` describes the **Winter protocol**, which UTxO boxes a
supply-chain shape consumes and produces. `src/ipfs/dto/metadata.dto.ts`
describes the **EPCIS payload**, the JSON a caller uploads. Nothing in the code
links them, and the backend never reads the EPCIS `type` to pick a code path.

An error declaration is an EPCIS **field**, not a sixth event type, although the
protocol documentation gives it its own page. Keep the two vocabularies apart.

## Commands

```sh
corepack enable         # pnpm is pinned through packageManager.
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit  # THE GATE. It prints nothing on success.
pnpm build              # nest build
pnpm start:dev          # watch mode
docker compose up --build
pnpm docs-lint          # prose check, scoped
```

**The type check and the lint are the working automatic signals.** Both pass
clean. Run them and report exactly what they printed. There are still no tests.

**`pnpm lint` is a check-only command and it passes.** ESLint 10 uses
`eslint.config.mjs`. Seven lint packages are direct development dependencies.
Five provide the flat configuration imports. `no-unused-vars` honors a leading
underscore, so a parameter an interface forces on an unused body stays named
`_args`.

**`pnpm test` finds no tests** and exits 1. Never write that tests pass. The
`test/` directory is gone, along with the one file that asserted `GET /` returns
`Hello World!` against a controller that declares no routes.

**Three check scripts stand in for the missing tests.** `check:recreate-alignment`
runs offline. `check:reconcile-exhausted` and `check:reconciler` need a live
database and a Blockfrost key, and each takes a confirmed transaction hash as its
first argument. Each one fails when the logic it covers is reverted, so treat a
pass as meaningful and never weaken one to make it green.

CAUTION: `pnpm lint:fix` carries `--fix` and rewrites files. Run `pnpm lint`
for check-only inspection.

CAUTION: `pnpm format` covers `src/` only. It does not touch `docs/` or the root
configuration files.

**A new dependency can fail to install for a reason that looks unrelated.**
`pnpm-workspace.yaml` sets a seven-day quarantine on newly published versions.
The `@zengate/*` and `@meshsdk/*` packages are the only exceptions.

## Facts you must hold while you edit

- **The mnemonic is the crown jewel.** It is read at construction time in the
  palmyra service and in the queue consumer. In production it comes from Secret
  Manager. Locally it comes from `.env`, which the compose file mounts into both
  containers. Never print `process.env` whole, and never write a debug script
  that dumps the wallet or the event factory.
- **Three npm pins move together.** `@meshsdk/core`, `@meshsdk/core-csl`, and
  `@zengate/winter-cardano-mesh` are pinned to exact versions, and a pnpm
  override forces the winter library onto the same Mesh build. Bumping one of
  the three alone will desync the peer graph.
- **The contract address changed at library 3.0.0.** That release ships the
  silent trace validators, so the script hash, the contract address and the
  minting policy id are all new. The logic is unchanged, because a verbose
  rebuild of the same contract source reproduces the 2.0.1 bytecode byte for
  byte. A commodity minted before 3.0.0 stays at the old address, and it needs
  2.0.1 to spend. Never assume one address covers every commodity.

  |Network|Before 3.0.0|From 3.0.0|
  |---|---|---|
  |mainnet|`addr1wx0u9dyeeex4nsgp6pk3qaq92s5ap3xc56edsk3hlgdhjnce8qkjd`|`addr1w8dmzvsy5mhpx4x5leggtk96yvvrftmfsp7z3jxu20623gsrv9np4`|
  |preview|`addr_test1wph2wcr4ysaen987g87magjh96l2ymvrgyvnu6yjvrtahdqu7qvqy`|`addr_test1wpfc7e7zqlqtra8hnyq7k0hh3rdwjm7m0fnzuyqjl0xxt3gatmv8f`|
- **`deployment.scriptHash` names the validator that a row serves.** The column
  is nullable, so a row written before this change reads null. A null value
  means the old verbose validator.
- **Mesh `1.9.1` mis-prices a funding input that carries a script.** The
  builder records the script size on the input and leaves
  `minFeeRefScriptCostPerByte` out of the fee, so the node rejects the
  transaction with `FeeTooSmallUTxO`. One preview mint fell short by 65911
  lovelace, which is the 4402 byte script at 15 lovelace a byte. The defect is
  narrow. A **reference** input is priced correctly, so recreate and spend are
  not affected. `getFundingUtxos` removes the one case that triggers it, and
  mint, recreate, a two-UTxO recreate and spend all pass on `1.9.1` on the
  preview network. `beta.104` and `1.9.0` price the funding input correctly.
- **Production and staging must keep one resident instance.** The queue worker
  and reconciler run inside the process.
- **The queue is one queue with a singleton policy and a local concurrency of
  one.** That is a correctness constraint, not a performance setting. It is the
  only thing that stops two builds from selecting the same wallet UTxOs.
- **The queue options apply once.** pg-boss creates the queue row on first boot
  and ignores the options afterward. Editing the options block and deploying
  changes nothing on an existing database.
- **`POSTGRES_SYNC=true` runs in production and there are no migrations.**
  Editing an entity file mutates the production schema on the next deploy, with
  no review and no rollback. Turning the flag off is not a safe hardening step,
  because nothing else creates the tables.
- **A `POST` builds a transaction before it answers.** The request path runs a
  dry run and enqueues the job. The consumer signs and submits.
- **`SUCCESS` means submitted, not confirmed.** Nothing waits for a block.
- **A submitted job is idempotent.** The service stores the transaction hash
  and signed CBOR in `Check.txid` and the nullable `Check.signedTx` column before
  submission. A retry resubmits those bytes and must never rebuild.
- **An idempotency key binds to its request fingerprint.** A replay with a
  different body must return 409. A null fingerprint on an old row must not
  cause 409.
- **`POST /ipfs` validates only its envelope.** It validates `logTime` and the
  non-empty `events` array. It must not validate event content that Palmyra Pro
  owns.
- **Queue status names are inverted.** `PENDING` waits in pg-boss. `QUEUED`
  means that the consumer actively builds and submits. Both are non-terminal.
- **`src/palmyra/palymra.utxo.service.ts` is misspelled on purpose now.** The
  builder imports the misspelled path. Rename it only together with its importer.
- **Configuration has a startup check.** It names missing required variables,
  validates the network, and never logs a key.
- **The container starts `node dist/main`.** It uses the compiled output and
  does not compile during a cold start.
- **Yaci devnet covers mint, recreate, and commodity details.** Use a URL-shaped
  `BLOCKFROST_KEY` for its Blockfrost-compatible API. Yaci cannot verify spend
  or mempool chaining.
- **Phase1 keeps future confirmation columns dormant.** The `Check` table has nullable `confirmation` and `lastChainCheckAt`. No Phase1 path writes `SUBMITTED` or `CONFIRMED` or `confirmation`. The generic update rejects those literals and a `confirmation` write. It protects a row that holds `SUBMITTED` or `CONFIRMED` from downgrade. New rows hold `PENDING` then `QUEUED` then `SUCCESS` or `ERROR`. A `CONFIRMED` row remains readable with its evidence after rollback.

## Known defects

These rules and remaining defects are verified against the source. Do not
report them as new, and do not copy defective patterns. This repository is
public, so record rules and invariants here. Report a working attack in chat.

### Chain correctness

- **A submitted transaction must never be rebuilt.** A retry resubmits the
  stored signed CBOR, which preserves the transaction hash and asset identity.
- **A multi-UTxO recreate needs `@zengate/winter-cardano-mesh` 2.0.1 or later.**
  Before that the library called `requiredSignerHash` inside its per-event loop,
  so N events put the same key hash N times into the `required_signers` CBOR
  set. Conway enforces set uniqueness and the node rejected every such
  transaction. The backend carried a hex splice to remove the duplicates. That
  splice is deleted, and a two-UTxO recreate is proven on the preview network.
- **`recreateCommodity` aligns data references by UTxO identity, not position.**
  2.0.1 returns the fetched UTxOs in the order the caller asked for, so a
  positional pair is correct today. `alignRecreateDataReferences` stays because
  it is invariant to that contract. A wrong pair still builds, still submits and
  still succeeds, and it writes one commodity data reference into another
  commodity datum, where nothing can undo it.
- **A reference-script output must never fund a transaction.**
  `DEPLOYER_ADDRESS` is the service wallet, so the deployed reference script
  lands in the funding UTxO set, and Mesh coin selection spends it. Every later
  recreate and spend then fails with `BadInputsUTxO` until an operator deletes
  the deployment row and pays about 20 ADA again. `getFundingUtxos` drops any
  UTxO that carries `scriptRef` or `scriptHash`. This is a guard, not a cure.
  The cure is a deployer address that the service does not fund from.
- **Nothing reserves a UTxO.** The queue policy is the only guard. The design
  chains each job onto the previous unconfirmed change output. `mempoolAll`
  auto-paginates, but it sees only Blockfrost submissions. Selection must filter
  pending outputs that another pending transaction spends.
- **A fixed ADA balance gate cannot prove a build will work.** Mesh performs
  coin selection and checks collateral for the actual transaction.
- **The wallet UTxO retry loop is bounded.** Every failed fetch increments the
  counter and delays the next attempt.
- **Every parser and evaluator call must receive the UTxOs the caller already
  holds.** `TxParser.parse` and the evaluator both re-resolve every input,
  collateral and reference outref through Blockfrost, and Blockfrost knows only
  confirmed transactions. Without the second argument a build that chains onto
  an unconfirmed change output fails, even though the build itself succeeded.
  That capped mint throughput at the number of confirmed wallet UTxOs.
- **Throughput is bounded by the count of confirmed pure-ADA wallet UTxOs.**
  Each mint consumes one and returns change that is unconfirmed for one block.
  A burst deeper than that count is rejected at the request path with 502, or
  it waits for the pg-boss retry. Keep the wallet split into many UTxOs.
- **A failure before a transaction reaches the network must return to the
  queue.** Nothing was submitted, so a retry cannot double spend or double
  mint. The queue worker marks the row ERROR only on the final attempt.
  Measured on the preview network, a 40-deep burst settles every enqueued job.
- **A row that says ERROR while holding a transaction hash is not trusted.**
  The hash is written before the submit, so such a row can describe a
  transaction that reached the chain. Three layers settle it: the retry
  resubmits the stored bytes and looks the hash up, the final attempt looks the
  hash up before it writes ERROR, and `PalmyraReconcilerService` sweeps on an
  interval for anything the first two missed because the provider was down.
  A promotion to SUCCESS is idempotent, so two instances sweeping is harmless.
  `RECONCILE_INTERVAL_SECONDS` defaults to 300 and 0 switches the sweep off.
  The sweep runs in process, so a service scaled to zero reconciles nothing
  until a request wakes it.
- **The sweep marks a row after it looks it up.** `check` carries no timestamp,
  so the marker is the only bound on rework. An absent transaction is looked up
  twice, spaced by the interval, and then written off with `[chain-checked]`.
  Never widen the candidate query to include a marked row.
- **Record success before bookkeeping after submit.** A deployment write or
  parse failure after `submitTx` must not change a submitted transaction to
  ERROR. Callers poll for SUBMITTED and then CONFIRMED. An ERROR after mint
  submission causes another mint. The worker writes SUBMITTED after hash
  comparison and before deployment or transaction bookkeeping.
- **SUBMITTED never provides chain evidence.** The worker stores the expected
  txid and signedTx before submit. It compares the `submitTx` result with
  `resolveTxHash`. Only a match changes the status to SUBMITTED. Mempool or
  chain recovery can promote ambiguous rows only to SUBMITTED.
- **CONFIRMED requires direct Blockfrost canonical-chain proof.** The reconciler
  uses `BlockFrostAPI` methods `txs`, `blocksLatest`, `blocks`, and `txsUtxos`.
  It does not use Mesh `fetchTxInfo`. It validates the hash, block, height,
  slot, time, and `valid_contract` and requires `valid_contract` true. It
  cross-checks the block hash, height, slot, and time and re-reads the
  transaction before the commit. A 404 or provider error stops confirmation.
  Elapsed absence never proves final state.
- **Depth is successor blocks.** depth equals latest height minus tx block height, tip inclusion is 0. Required depth comes from CHAIN_CONFIRMATION_DEPTH when set, strictly parsed as positive safe integer, otherwise cached genesis security_param. A later configuration change must not change an earlier CONFIRMED row.
- **Tokenize provenance comes from the historical output.** The reconciler
  reads `txsUtxos` and requires exactly one matching output. The output must
  contain quantity 1 for `policyId` plus `assetNameHex`. Its datum data
  reference hex must equal the stored CID bytes. The reconciler uses that
  output address and `output_index`. It never recomputes the contract address
  or hard-codes output 0. The output can be spent.
- **Legacy SUCCESS stays readable.** New code never writes SUCCESS. The reconciler includes SUCCESS rows with valid txid and null confirmation for lazy confirmation, but never bulk-relabels them. A valid deep enough legacy row can move directly to CONFIRMED after provenance proof.
- **Confirmation is atomic and terminal.** The conditional write matches the
  id, expected txid, null confirmation, and eligible status. It sets status,
  confirmation, and error together. CONFIRMED is never overwritten. Stored
  depth is the observation at `confirmedAt`.
- **An evaluator must be wired into `EventFactory`.** Without one every redeemer declares the fixed default budget of mem 7,000,000. Two of those reach the preview cap of 17,500,000, so a two-commodity spend and a three-commodity recreate are both rejected with `ExUnitsTooBigUTxO`. Measured on chain, the real cost is 17 to 56 times smaller than the default.

### Configuration

- **Production and staging deploy with `--min-instances` set to 1.** Their queue
  worker and reconciler stay active without an incoming request.

- **The UTxO hash decorator requires 64 characters.** The former rule required
  62 characters. Correcting it was safe because nested validation did not run
  on array elements.
- **The 32-byte token name limit exists downstream and at the API boundary.** `@meshsdk/common` enforces the ledger limit. The DTO reports an early error.
- **Handlers return stable error messages.** They retain raw upstream details only as error causes for server logs.
- **`GET /check`, `GET /transactions`, and `GET /deployments` paginate.** Keep bounded page sizes on all three routes.
- **The three Palmyra operation endpoints return 202 Accepted.** This applies
  to tokenize, recreate, and spend. Each response has a dynamic Location
  `/check/{id}` and Retry-After. The body contains message, id, status, and
  statusUrl. An idempotent replay returns the current status and keeps the
  existing id. The request thread performs only deterministic DTO validation
  and fingerprint checks. The serialized worker performs build and enrichment.
- **Confirmation is exposed as a nullable object.** `GET /check` keeps existing
  fields. It adds `confirmation` with network, txid, blockHash, blockHeight, and
  slot. It also contains depth, requiredDepth, confirmedAt, and nullable
  provenance. Provenance is null for non-tokenize operations. The response
  excludes signedTx and requestFingerprint.
- **A later database error must not overwrite `CONFIRMED` or `SUBMITTED`.** A confirmed transaction is final evidence. A submitted transaction awaits confirmation.

### Logging

- **Inbound request logs redact `x-api-key`.** Keep secrets out of every other
  log field.
- **A raw direct HTTP client error can leak the Blockfrost key.** The redaction
  covers the inbound API key header, not provider request configuration.
- **The mint path does not log signed transactions.** Do not log wallet UTxOs,
  unsigned transactions, signed CBOR, or raw transaction objects.
- **`pino-pretty` is the transport in every environment**, so the log platform
  cannot read the severity and alerting on level does not work.

### Clean

No secret was ever committed. A sweep of all 23 references found no `.env` file,
no key, no token, and no large blob. Keep it that way.

## Things that look wrong and are not

Each of these reads like a defect and is load-bearing. Changing one breaks the
build or the deploy. Leave them alone.

- **The repeated `--set-env-vars` and `--set-secrets` flags merge.** They do not
  overwrite each other. Consolidating them into one flag is a no-op that breaks
  any value that holds a comma.
- **The queue singleton policy is correct.** It limits active jobs, not queued
  jobs. It is the only guard against two builds that select the same wallet
  UTxOs.
- **The `.js` extensions inside TypeScript imports are load-bearing.** The module
  setting is `nodenext` and the output is CommonJS. The mixed style compiles
  today. Do not clean it up.
- **The bare `src/`-rooted imports resolve through `baseUrl`.** They work, and
  they break under a bundler or a paths change. Do not convert them casually.
- **pg-boss is loaded with a dynamic import on purpose.** It is a module interop
  workaround. A static import breaks the build.
- **The misspelled UTxO service file name is load-bearing.** The builder imports
  the misspelled path. Rename it only together with its importer.
- **Two of the four dependency overrides have no recorded reason.** The Mesh
  override is load-bearing, because the library pins a different build and two
  copies break every `instanceof` check. The `undici` pin caps the major version
  at 6. Do not bump it to 7 without finding out why the cap exists.

## Errors that mislead

- **`Converting circular structure to JSON` from a chain call is not your bug.**
  The provider tries to serialize the request object when there is no response,
  so every transient Blockfrost outage surfaces with that message and hides the
  real cause. Look at the network, not at the application code.
- **A `TypeError` about reading a property of `undefined` inside a build usually
  means an empty UTxO set.** The most common cause is a network and key
  mismatch.
- **A missing environment variable crashes at bootstrap with a type error**,
  because the constants file casts rather than checks. Read the variable name in
  the stack, not the message.

## The wire contract

Palmyra Pro consumes this API from another repository. Three shapes are a
contract, not an implementation detail.

- `POST /ipfs`, `POST /palmyra/tokenizeCommodity`, and `GET /check/{id}`.
- The literal string `SUCCESS`. The consumer polls for it.
- `metadataReference` arrives as a **bare CID with no `ipfs://` prefix**, even
  though a guide says the prefix is required. Code that starts to require the
  prefix will break production.
- **The optional `Idempotency-Key` request header.** A caller that sends one
  gets the same job for every repeat of that key on that route, so a retry of a
  request whose response was lost cannot mint a second token. A caller that
  sends nothing behaves exactly as before, so this is additive. The key is
  scoped per route, holds 255 characters or fewer, and a longer one returns 400.
  Three layers enforce it: the derived job id, the `check` primary key, and the
  pg-boss job id. Six simultaneous repeats return one id and mint one token.

Ask before you change any of the three.

## Writing rules

New prose follows ASD-STE100 Simplified Technical English. `pnpm docs-lint` runs
`scripts/ste-check.py`.

**No tooling enforces this on a pull request, because this repository has no
continuous integration.** Run the check yourself.

**The scope is deliberate.** It covers these four path groups: `AGENTS.md`,
`CLAUDE.md`, `.omp/RULES.md`, and `.omp/agents` plus `.omp/commands` and the
top-level `.omp/AGENTS.md`. It does not cover `README.md`, `docs/`, or
`.omp/skills/`.

Tier one rules:

- Keep an instruction to 20 words. Keep a description to 25 words.
- Write one instruction per sentence, in the imperative mood.
- Keep one topic per paragraph, and six sentences or less.
- Use only these modals: can, will, must. Never write `should`, `would`, `may`,
  `might`, or `could`. For a requirement write must.
- Use simple tenses. Never write the present perfect, for example `has completed`.
- Never write a verb form that ends in `-ing` as a clause, for example `, making`.
- Never write a contraction or a semicolon in prose. Keep the articles and `that`.
- Put the condition before the command, and the warning before its risk.
- Delete empty words, for example `simply`, `robust`, and `leverage`.
- Write American spelling.

**Tier two covers chat replies to a human.** Apply the word rules and the modal
rules only. Do not count sentences.

## Conventions

- Conventional Commits, scoped where it helps. Follow the recent history, not
  the older bare subjects. Recent merges are squash merges.
- Branch as `<handle>/<slug>`, or `<handle>/<tracker-key>-<slug>`. Open a pull
  request into `main`.
- Never add a `Co-Authored-By` line, or any AI attribution. The history has none
  across every reference.
- Never write an em dash. The history and the documents have none.
- One directory per feature, with `x.module.ts`, `x.controller.ts`,
  `x.service.ts`, `entities/x.entity.ts`, and `dto/<kebab-name>.dto.ts`.
- Prettier with single quotes and trailing commas. TypeScript is loose on
  purpose: only `strictNullChecks` is on.
- The job interfaces in `src/types/job.dto.ts` use lowerCamelCase names. Match
  that file rather than fixing it piecemeal.

## Sibling repositories

Winter belongs to the **Palmyra** product line. It is not part of `palm_portal`,
which is the PALM staking and emissions product on a different chain.

| Repository | Relation |
|---|---|
| [`zenGate-Global/winter-backend-cardano`](https://github.com/zenGate-Global/winter-backend-cardano) | this repository |

The on-chain validators live inside the `@zengate/winter-cardano-mesh` npm
package, not in this repository and not in a sibling. `EventFactory` is the whole
chain surface.

A local checkout of any other repository is a convenience, not a guarantee. Use
the `repo-explorer` skill in `.omp/skills/` to fetch one into the shared cache.
Never write that a fact is unknown because a path is absent.

## Boundaries

**Never**
- Read or print `.env` or any `.env.*` file. `.env.example` is safe.
- Print a mnemonic, a key, or `process.env` as a whole. Treat
  `docker compose config` and `docker inspect` as commands that print secrets.
- Point a local run at mainnet, or at a funded wallet. Use a test network.
- Run the deploy workflow, or any `gcloud` write.
- Claim that tests pass, or that a change is verified without a real command
  output.
- Add a `Co-Authored-By` line, an AI attribution, or an em dash.
- Commit to `main` directly.

**Ask first**
- Any change to `POST /ipfs`, `POST /palmyra/tokenizeCommodity`, or
  `GET /check/{id}`, which Palmyra Pro consumes.
- Any change to an entity file, because the production schema follows it.
- Any change to the queue policy, the local concurrency, or the retry settings.
- Any bump of the three coupled Mesh and winter pins.
- Turning on the validation that is currently inert. Two separate defects hide
  behind it, and a partial fix breaks live callers.
- Any edit to `.github/workflows/`, which holds the deploy and the secret wiring.
- Any edit under `docs/`, which publishes to a public site.

**Always**
- Run the type check and report exactly what it printed.
- Format only the files you touched.
- Say plainly when something is unverified.
