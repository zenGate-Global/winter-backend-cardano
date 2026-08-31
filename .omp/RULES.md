# Sticky rules: Winter Cardano Backend

This service holds a **live, spendable Cardano wallet mnemonic**. The deployed
API is reachable from the internet and protected by `x-api-key`. The process
refuses to start without `WINTER_API_KEY`. A mistake here can spend real funds
or mint a duplicate token that cannot be recalled.

- **Never read `.env` or any `.env.*` file.** `.env.example` is safe.
  - Never print `process.env` as a whole, and never print a mnemonic or a key.
  - Treat `docker compose config` and `docker inspect` as commands that print
    secrets.
- **You are the gate.** No build, no type check and no test runs on a pull
  request. CodeQL runs through GitHub default setup and never builds the project.
  Run the type check and the lint, and report exactly what they printed.
  - **There are no tests.** `pnpm test` finds zero specs. Never write that tests
    pass.
  - `pnpm lint` is check-only and passes. `pnpm lint:fix` rewrites files.
  - Three check scripts cover the recreate pairing and the reconciliation paths.
    Two of them need a live database and a Blockfrost key. Never weaken one to
    make it pass.
- **Never point a local run at mainnet or at a funded wallet.** Use a test
  network.
- **Never change an entity file casually.** `POSTGRES_SYNC=true` runs in
  production and there are no migrations, so the schema follows the entity on
  the next deploy. -> repo-root `AGENTS.md`
- **Never change the queue policy or the local concurrency.** One queue, a
  singleton policy, and a concurrency of one are the only guard against two
  builds that select the same wallet UTxOs.
  - The queue options apply on first creation only. Editing them changes nothing
    on an existing database.
- **Never change consumed response contracts.** Keep `POST /ipfs` and
  `GET /check/{id}` shapes stable. `GET /check` adds nullable confirmation.
  Tokenize, recreate, and spend return 202 Accepted. They include a dynamic
  Location `/check/{id}`, Retry-After, and an operation body. The body contains
  message, id, status, and statusUrl. Palmyra Pro polls for CONFIRMED as final
  and legacy SUCCESS stays readable.
- **Production and staging must keep one resident instance.** Their queue worker and reconciler run inside the process.
- **An `Idempotency-Key` binds to its request fingerprint.** A replay with another body must return 409. A null legacy fingerprint must not cause 409.
- **`POST /ipfs` validates only its envelope.** It validates `logTime` and the
  non-empty `events` array. It must not validate event content owned by Palmyra
  Pro.
- **Never bump one of the three coupled pins alone.** `@meshsdk/core`,
  `@meshsdk/core-csl`, and `@zengate/winter-cardano-mesh` move together.
- **Never let a reference-script output fund a transaction.** Spending it
  destroys the deployment and breaks every later recreate and spend. Mesh
  `1.9.1` also under-prices such an input and the node rejects the transaction.
  `getConfirmedFundingUtxos` drops any UTxO that carries `scriptRef` or `scriptHash`.
  Never remove that filter to reclaim the locked ADA.
- **Never let a post-submit step downgrade a row to ERROR.** Write SUBMITTED
  after a hash-matched submit. Do this before deployment or bookkeeping. A
  caller polls for SUBMITTED and then CONFIRMED. An ERROR after mint submission
  causes another mint.
- **Never call `TxParser.parse` without held UTxOs.** It resolves outrefs through
  Blockfrost, which knows only confirmed transactions.
- **The evaluator receives no held UTxOs.** It resolves every input through
  Blockfrost. Every builder must expose only confirmed funding and collateral
  UTxOs.
- **Read the mempool before the wallet UTxO snapshot.** The inverse order can
  label an input confirmed after its pending spend confirms.
- **Never treat confirmed-funding insufficiency as terminal before the final
  queue attempt.** Wrap Mesh's exact insufficient-value error as a typed
  funding deferral.
- **Never remove the evaluator from `EventFactory`.** Without it every redeemer
  declares mem 7,000,000, and two of those exceed the preview cap.
- **Never treat a pg-boss `send` that returns null as a failure.** That null is
  its deduplication answer for a job id that is already queued.
- **Never change `CheckService.create` back to `save`.** `save` issues an UPDATE
  when the primary key exists, which resets a finished row to PENDING and hides
  a replay. The insert must conflict so the replay is detected.
- **Never trust an ERROR or QUEUED row that holds a transaction hash.** The
  hash is written before submit. The consumer mempool check and
  `PalmyraReconcilerService` check such rows against the chain. New code can
  promote ambiguous rows only to SUBMITTED. CONFIRMED requires depth,
  `valid_contract`, block cross-check, and a transaction re-read. Tokenize also
  requires provenance proof. Never infer expiry from elapsed time.
- **Never enable the inert validation as a one-line fix.** Two defects hide
  behind it. A partial fix rejects every live caller.
- **`SUCCESS` is legacy submitted.** New code never writes SUCCESS. Keep it readable. `SUBMITTED` means accepted. `CONFIRMED` means depth-proved and for tokenize provenance-proved. Only CONFIRMED is final.
- **Never assume one contract address covers every commodity.** Library 3.0.0
  contains the silent trace validators. The script hash and address changed.
  A commodity minted before 3.0.0 stays at the old address and needs 2.0.1 to
  spend. `deployment.scriptHash` identifies the validator for a row. A null
  value means the old verbose validator and provenance must use the historical
  output address. It must not use the current contract address or hard-coded
  output 0.
- **A submitted job is idempotent.** The service stores the transaction hash and
  signed CBOR before submission in `Check.txid` and nullable `Check.signedTx`.
  - A retry resubmits the stored bytes and must never rebuild.
- **Yaci devnet covers mint, recreate, and commodity details.** Use a URL-shaped
  `BLOCKFROST_KEY` for its Blockfrost-compatible API. Yaci cannot verify spend
  or mempool chaining.
- **Never "clean up" an import, an override, or a flag that looks redundant.**
  The root `AGENTS.md` lists what is load-bearing. The `.js` extensions, the
  bare `src/` imports, the dynamic pg-boss import, the misspelled UTxO file, the
  repeated deploy flags, and the Mesh override all read as defects and are not.
- Never run the deploy workflow or any `gcloud` write.
- Never add a `Co-Authored-By` line or any AI attribution to a commit message or
  a pull request. Never write an em dash. The history has neither.
- **The default branch is `main`, and the repository is public.** Never commit to
  `main` directly, and never `git commit` or `git push` without explicit user
  consent in the current chat.
- **Never publish an exploit recipe in a tracked file.** This repository is
  public. Record a rule and an invariant. Report a working attack in chat.
- **Never write SUBMITTED or CONFIRMED in Phase1 and never downgrade a row that holds one.**
  The generic update must reject those literals and a confirmation write.
  It must keep a SUBMITTED or CONFIRMED row from moving to another status.

## Text

Follow ASD-STE100 Simplified Technical English for new prose. The repo-root
`AGENTS.md` holds the full rules and explains why the gate skips `README.md` and
`docs/`.

- Must use only these modals: can, will, must.
- Must never write `should`, `would`, `may`, `might`, or `could`.
- Must never write a contraction or a semicolon in prose.
- Must keep an instruction to 20 words, and a description to 25 words.
- Must run `pnpm docs-lint` before a commit that touches gated prose.
