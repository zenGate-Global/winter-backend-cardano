# /check: the gate

This repository has no continuous integration. Nothing runs on a pull request
and nothing runs on a push. This command is the gate.

## Steps

Run each step from the repository root. Report what each one printed. On a
failure, show the output and stop. Do not commit.

1. `npx tsc --noEmit` - **the only step that can fail on a defect.** It passes
   clean on `main`, so any output is yours.
2. `pnpm build` - `nest build`. Run it when the change touches module wiring or
   a decorator, because the compiler and the Nest builder do not agree in every
   case.
3. `pnpm docs-lint` - the ASD-STE100 check, only when the change touches
   `AGENTS.md`, `CLAUDE.md`, or prose under `.omp/`.

## What this command must never claim

- **Never write that tests pass.** `pnpm test` finds zero specs and exits 1. The
  one file under `test/` asserts a route that the app does not declare.
- **Never run `pnpm lint` and report a clean result.** ESLint 10 needs a flat
  `eslint.config.*` file and this repository has only `.eslintrc.js`, so the
  command exits 2 before it reads a source file. Zero errors means zero files
  read. The command also carries `--fix`, so it will rewrite files if the config
  is ever repaired.
- **Never treat a clean type check as a review.** It cannot see a leaked secret,
  a double submit, a wrong array pairing, or a schema change.

## After the gate

Run `winter-reviewer` for a change that touches a transaction, the queue, an
entity, or one of the three endpoints Palmyra Pro consumes. The gate sees none of
those.
