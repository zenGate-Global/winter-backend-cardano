# Sticky rules: Winter Cardano Backend

This service holds a **live, spendable Cardano wallet mnemonic**, and the
deployed API is **public and unauthenticated**. A mistake here can spend real
funds or mint a duplicate token that cannot be recalled.

- **Never read `.env` or any `.env.*` file.** `.env.example` is safe.
  - Never print `process.env` as a whole, and never print a mnemonic or a key.
  - Treat `docker compose config` and `docker inspect` as commands that print
    secrets.
- **You are the gate.** There is no continuous integration. Nothing runs on a
  pull request. Run the type check and report exactly what it printed.
  - **There are no tests.** Never write that tests pass. The one file under
    `test/` asserts a route that the app does not declare.
  - `pnpm lint` carries `--fix` and rewrites files. Use check-only mode to look.
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
- **Never turn on the inert validation as a one-line fix.** Two separate defects
  hide behind it, and a partial fix rejects every live caller.
- **`SUCCESS` means submitted, not confirmed.** Nothing waits for a block.
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
