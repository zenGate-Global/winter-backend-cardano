# /check: the gate

No build, no type check and no test runs on a pull request. CodeQL runs through
GitHub default setup and never builds the project. This command is the gate.

## Steps

Run each step from the repository root. Report what each one printed. On a
failure, show the output and stop. Do not commit.

1. `pnpm exec tsc --noEmit` - it prints nothing on success.
2. `pnpm lint` - check-only, and it passes today, so a failure is a regression
   the change introduced.
3. `pnpm build` - `nest build`. Run it when the change touches module wiring or
   a decorator, because the compiler and the Nest builder do not agree in every
   case.
4. `pnpm docs-lint` - the ASD-STE100 check, only when the change touches
   `AGENTS.md`, `CLAUDE.md`, or prose under `.omp/`.
5. `pnpm run check:recreate-alignment` - offline, and it covers the recreate
   pairing. Run `check:reconcile-exhausted` and `check:reconciler` too when the
   change touches settlement, and give each a confirmed transaction hash. Both
   need a live database and a Blockfrost key.

## What this command must never claim

- **Never write that tests pass.** `pnpm test` finds zero specs and exits 1, and
  the `test/` directory no longer exists.
- **Never treat a clean type check as a review.** It cannot see a leaked secret
  or a double submit. It cannot see a wrong pairing or a schema change.
- **Never run `pnpm lint:fix` as part of the gate.** It rewrites files.

## After the gate

Run `winter-reviewer` for a change that touches a transaction, the queue, an
entity, or one of the three endpoints Palmyra Pro consumes. The gate sees none of
those.
