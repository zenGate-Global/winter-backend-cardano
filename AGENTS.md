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

1. **There is no continuous integration.** The only workflow is a manual deploy.
   The `pull_request` trigger is commented out. Nothing runs on a pull request
   and nothing runs on a push. **You are the gate.**
2. **There are no tests.** `pnpm test` finds zero specs. The one end-to-end test
   asserts a route that the app does not declare, so it cannot pass.
3. **The deployed service is public and unauthenticated.** The deploy grants
   `roles/run.invoker` to `allUsers`, and CORS allows every origin. There is no
   guard, no API key, and no rate limit on any route.

Points 1 and 3 together mean an unreviewed change reaches a public endpoint that
spends from a funded wallet.

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
| [`docs/versions/v1.0.0/deployment/`](docs/versions/v1.0.0/deployment/) | local, Google Cloud, cost | `google-cloud.mdx` is badly stale |
| [`docs/versions/v1.0.0/best-practices/`](docs/versions/v1.0.0/best-practices/) | operations advice | heavily stale |
| [`docs/versions/v1.0.0/faqs/`](docs/versions/v1.0.0/faqs/) | questions | current |
| [`docs/versions/v1.0.0/templates/`](docs/versions/v1.0.0/templates/) | metadata examples | wrong format |
| [`docs/versions/v1.0.0/API-Playground/`](docs/versions/v1.0.0/API-Playground/) | the OpenAPI file | hand-written, and it drifts |

### Documents you must not trust

An agent that reads `docs/` for context will reason confidently about systems
that do not exist. Check each of these against the source before you use it.

- **Every mention of Redis.** The queue moved to pg-boss in `9c7dfcd`. Four
  documents still tell an operator to provision Memorystore, to back up Redis,
  and to watch Redis connectivity.
- **Every mention of Maestro or NFT.Storage.** The real providers are Blockfrost
  and Pinata.
- **The three metadata templates.** They show a pre-EPCIS shape that a later
  change replaced. The Bruno collection holds the correct shape.
- **The status values in the first-record guide.** It names `queued`, `minted`,
  and `failed`. The real enum is `PENDING`, `QUEUED`, `SUCCESS`, and `ERROR`.
- **The `POSTGRES_SYNC=false` rule in best practices.** The deploy sets it to
  `true` for every environment, including production.
- **The `waitForTx` advice in best practices.** No such call exists here. The
  service marks a job `SUCCESS` immediately after it submits, with no wait for a
  confirmation.

### Two vocabularies that look like one

`docs/base/events/` describes the **Winter protocol**, which UTxO boxes a
supply-chain shape consumes and produces. `src/ipfs/dto/metadata.dto.ts`
describes the **EPCIS payload**, the JSON a caller uploads. Nothing in the code
links them, and the backend never reads the EPCIS `type` to pick a code path.

An error declaration is an EPCIS **field**, not a sixth event type, although the
protocol documentation gives it its own page. Keep the two vocabularies apart.

## Commands

```sh
corepack enable         # pnpm is pinned. npm and yarn will refuse to install.
pnpm install --frozen-lockfile
npx tsc --noEmit        # THE GATE. It passes clean today.
pnpm build              # nest build
pnpm start:dev          # watch mode
docker compose up --build
pnpm docs-lint          # prose check, scoped
```

**The type check is the only working automatic signal in this repository.** It
passes clean on `main`. Run it and report exactly what it printed.

**`pnpm lint` does not lint.** ESLint 10 needs a flat `eslint.config.*` file,
and this repository has only the legacy `.eslintrc.js`. The command exits 2
before it reads one source file. Zero errors and zero warnings mean nothing here.
The `eslint-disable` comment in the queue consumer stopped working at the ESLint
bump. Six lint packages are installed and all of them are dead weight.

**`pnpm test` finds no tests** and exits 1. Never write that tests pass. The one
file under `test/` asserts `GET /` returns `Hello World!`, and `AppController`
declares no routes, so it cannot pass. It also needs a live database, a mnemonic,
and a Blockfrost key to reach the assertion.

CAUTION: `pnpm lint` carries `--fix`, so it will rewrite files if the config is
ever repaired. Use check-only mode when you only want to look.

CAUTION: `pnpm format` covers `src/` and `test/` only. It does not touch `docs/`
or the root configuration files.

**A new dependency can fail to install for a reason that looks unrelated.**
`pnpm-workspace.yaml` sets a seven-day quarantine on newly published versions.
The `@meshsdk/*` packages are the only exception.

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
- **A `POST` builds and signs a transaction before it answers.** The request
  path runs a full dry run, then discards it and enqueues. The consumer rebuilds
  from scratch. A `200` means it built once, not that it will succeed.
- **`SUCCESS` means submitted, not confirmed.** Nothing waits for a block.
- **`src/palmyra/palymra.utxo.service.ts` is misspelled on purpose now.** The
  builder imports the misspelled path. Rename it only together with its importer.
- **Configuration is read three ways:** through `ConfigService`, through the
  thunks in `src/constants.ts`, and through bare `process.env`. There is no
  validated schema and no startup check, so a missing variable crashes with a
  type error rather than a readable message.

## Known defects

These are real, unfixed, and verified against the source. Do not report them as
new, and do not copy the patterns. This repository is public, so this section
records rules and invariants. Report a working attack in chat, not here.

### Chain correctness

- **A retry re-builds and re-submits, so it can mint twice.** The consumer
  retries on a heuristic: the returned hash is not a string, or it holds the
  text `bad request`. A rebuild picks different wallet inputs, so a second,
  distinct token can appear with the same name. A correct fix submits once, then
  verifies by hash.
- **`recreateCommodity` can pair a data reference with the wrong UTxO.** The
  library groups the input references by transaction hash and returns them in
  its own order. The builder then pairs by index. Both length guards still pass,
  because the count is right. The result is wrong data written into an on-chain
  datum, with no error at any layer. It bites when the caller does not sort the
  array first.
- **Nothing reserves a UTxO.** The queue policy is the only guard. The design
  chains each job onto the previous unconfirmed change output, and the mempool
  view behind it is unpaginated and does not filter its own outputs against its
  own inputs.
- **The two-ADA balance check is a false green light.** A real build needs
  collateral, a fee output, and minimum ADA. The check also counts token-bearing
  UTxOs, while collateral selection needs pure ADA.
- **One retry loop can never end.** The wallet UTxO loop increments its counter
  only on the success branch, so a persistent Blockfrost failure spins forever.
  The job never resolves, and the queue expiry then re-dispatches it.

### Configuration

- **Nothing checks `NETWORK` against `BLOCKFROST_KEY`.** They are two unlinked
  sources of truth. `NETWORK` decides key derivation, the fee address, and the
  contract address. The Blockfrost key prefix decides which chain is queried and
  submitted to. A mismatch attempts a real submission against the wrong chain.
  Nothing writes the resolved network into a startup log line.
- **`--min-instances` is 0 for production.** The queue worker runs in process.
  When the service scales to zero, queued jobs stop moving until an unrelated
  request wakes an instance.
- **`.dockerignore` does not exclude `.env`.** The line carries a trailing
  comment, and Docker does not strip one, so the pattern matches nothing. A local
  `docker build` copies `.env` into the image. Continuous integration is safe,
  because `.env` is absent there.
- **The container runs the development start command.** It deletes the built
  output and recompiles the whole project on every cold start.

### API and validation

- **Validation is off, by design in one place and by accident in two.** The
  upload body is typed as a union, which erases to `Object`, so the global pipe
  skips it and the whole metadata file is dead at run time. The UTxO arrays carry
  no element type, so their decorators never run. **A partial fix breaks live
  callers**, because the UTxO hash length is declared as 62 and a real hash is
  64.
- **The 32-byte token name limit exists in no code.** A character count is not a
  byte count, so the obvious fix is also wrong.
- **Several handlers put raw upstream error text into the response body.** A
  `BadRequestException` with an object first argument returns that object
  verbatim. An `HttpException` with a `cause` option does not. The two look alike
  and behave in opposite ways.
- **`GET /check`, `GET /transactions`, and `GET /deployments` are unpaginated
  full-table dumps**, and the check rows hold stringified internal errors.
- **`status = ERROR` with a valid transaction id means the transaction
  succeeded.** Several paths write `SUCCESS` and the hash, then fail a later
  database write and overwrite the status. The hash survives.

### Logging

- **There is no redaction.** The logger has no `redact` option and no custom
  serializer. Every inbound request header is logged verbatim.
- **A raw error object logged from a direct HTTP client will leak the Blockfrost
  key.** Nothing in this repository stops it. What stops it today is that the
  vendor rethrows a string rather than the original error. That is a vendor
  detail in a beta dependency, not a guarantee.
- **The mint path logs the full signed transaction at info level**, twice per
  request. Several bare `console.log` calls bypass the logger and dump wallet
  UTxOs and unsigned transactions.
- **`pino-pretty` is the transport in every environment**, so the log platform
  cannot read the severity and alerting on level does not work.

### Clean

No secret was ever committed. A sweep of all 23 references found no `.env` file,
no key, no token, and no large blob. Keep it that way.

## The wire contract

Palmyra Pro consumes this API from another repository. Three shapes are a
contract, not an implementation detail.

- `POST /ipfs`, `POST /palmyra/tokenizeCommodity`, and `GET /check/{id}`.
- The literal string `SUCCESS`. The consumer polls for it.
- `metadataReference` arrives as a **bare CID with no `ipfs://` prefix**, even
  though a guide says the prefix is required. Code that starts to require the
  prefix will break production.

Ask before you change any of the three.

## Writing rules

New prose follows ASD-STE100 Simplified Technical English. `pnpm docs-lint` runs
`scripts/ste-check.py`.

**No tooling enforces this on a pull request, because this repository has no
continuous integration.** Run the check yourself.

**The scope is deliberate.** It covers `AGENTS.md`, `CLAUDE.md`, and the prose
under `.omp/`. It does **not** cover `README.md` or `docs/`, which publish to an
external site and carry a different voice. Widen the scope only as a deliberate
pass.

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
