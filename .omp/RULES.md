# Sticky rules: Winter Cardano Backend

This service holds a **live, spendable Cardano wallet mnemonic**. The deployed
API is reachable from the internet and protected by `x-api-key`. The process
refuses to start without `WINTER_API_KEY`. A mistake here can spend real funds
or mint a duplicate token that cannot be recalled.

- **Never read `.env` or any `.env.*` file.** `.env.example` is safe.
  - Never print `process.env` as a whole, and never print a mnemonic or a key.
  - Treat `docker compose config` and `docker inspect` as commands that print
    secrets.
- **You are the gate.** There is no continuous integration. Nothing runs on a
  pull request. Run the type check and report exactly what it printed.
  - **There are no tests.** `pnpm test` finds zero specs. Never write that tests
    pass.
  - `pnpm lint` is check-only.
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
- **Never change the shape of `POST /ipfs`, `POST /palmyra/tokenizeCommodity`,
  or `GET /check/{id}`.** Palmyra Pro consumes them, and it polls for the literal
  string `SUCCESS`.
- **Never bump one of the three coupled pins alone.** `@meshsdk/core`,
  `@meshsdk/core-csl`, and `@zengate/winter-cardano-mesh` move together.
- **Never let a reference-script output fund a transaction.** Spending it
  destroys the deployment and breaks every later recreate and spend. Mesh
  `1.9.1` also under-prices such an input and the node rejects the transaction.
  `getFundingUtxos` drops any UTxO that carries `scriptRef` or `scriptHash`.
  Never remove that filter to reclaim the locked ADA.
- **Never let a post-submit step downgrade a row to ERROR.** Write SUCCESS as
  soon as `submitTx` returns. A caller polls for SUCCESS, so an ERROR on a
  landed mint makes it retry and mint a second token.
- **Never call `TxParser.parse` or the evaluator without the UTxOs you hold.**
  Both re-resolve outrefs through Blockfrost, which knows only confirmed
  transactions, so a chained build fails after it already succeeded.
- **Never remove the evaluator from `EventFactory`.** Without it every redeemer
  declares mem 7,000,000, and two of those exceed the preview cap.
- **Never treat a pg-boss `send` that returns null as a failure.** That null is
  its deduplication answer for a job id that is already queued.
- **Never change `CheckService.create` back to `save`.** `save` issues an UPDATE
  when the primary key exists, which resets a finished row to PENDING and hides
  a replay. The insert must conflict so the replay is detected.
- **Never trust an ERROR row that holds a transaction hash.** The hash is
  written before the submit. `PalmyraReconcilerService` sweeps such rows against
  the chain and promotes the ones that landed. Never widen its candidate query
  to include a row already marked `[chain-checked]`, or a genuine failure is
  looked up for ever.
- **Never turn on the inert validation as a one-line fix.** Two separate defects
  hide behind it, and a partial fix rejects every live caller.
- **`SUCCESS` means submitted, not confirmed.** Nothing waits for a block.
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

## Text

Follow ASD-STE100 Simplified Technical English for new prose. The repo-root
`AGENTS.md` holds the full rules and explains why the gate skips `README.md` and
`docs/`.

- Must use only these modals: can, will, must.
- Must never write `should`, `would`, `may`, `might`, or `could`.
- Must never write a contraction or a semicolon in prose.
- Must keep an instruction to 20 words, and a description to 25 words.
- Must run `pnpm docs-lint` before a commit that touches gated prose.
