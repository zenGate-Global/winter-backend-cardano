# Winter Cardano Backend: agent context (omp native)

This is the native (`.omp/`, priority 100) context file for the repo. It is a
thin pointer. The repo-root `AGENTS.md` holds the rules and the boundaries, and
it is imported inline below.

@../AGENTS.md

---

omp-specific extras layered on top of the canonical guide:

- **Sticky rules**: `.omp/RULES.md`. Always in context.
- **Slash commands**: `.omp/commands/`: `/check` runs the gate.
  `/audit-endpoint` reviews one route against cost, validation, and leakage.
  `/trace-job` follows a job through the queue.
- **Agents**: `.omp/agents/`:
  - `winter-implementer`: careful multi-file implementer on `@task`, with a
    prewalk into `@mechanic`. A transaction, the queue, an entity, and a consumed
    endpoint are **not** mechanical tails.
  - `winter-reviewer`: read-only review. Findings go in its `output` schema,
    not through a tool. The `report_finding` tool was removed in omp 17.2.x.
  - `winter-scout`: cheap wide scout, `@smol`, verbatim reads.
  - `chain-authority`: read-only authority on the Cardano side. Consult it
    before changing anything that builds, signs, or submits.
- **Skills**: `.omp/skills/`: `repo-explorer` only.
  `engineering-conventions` autoloads from global on the two heavyweight agents.

**No `golang-*` skills and no `aiken` skill.** This is a TypeScript service, and
the validators live inside an npm package, not in an Aiken repository here.

## The facts that shape everything

**No build, no type check and no test runs on a pull request.** The only workflow
in the repository is a manual deploy, and its pull-request trigger is commented
out. CodeQL runs through GitHub default setup, so no file for it exists here, and
it never builds the project. An agent working here **is** the gate.

**The gates are `pnpm exec tsc --noEmit` and `pnpm lint`, and both pass.**
`pnpm test` finds zero specs, so never report a test as evidence. Three check
scripts cover the recreate pairing and the reconciliation paths, and two of them
need a live database and a Blockfrost key.

**The deployed service is reachable from the internet and protected by `x-api-key`.** It signs with a live wallet mnemonic. That combination is why the boundaries in the root file are strict. The process refuses to start without `WINTER_API_KEY`.

**The repository is public.** Record an invariant in a tracked file. Report a working attack in chat.


## Model routing

`.omp/config.yml` pins four roles and inherits the rest from global. Use
`omp config get modelRoles --json` for live values.

Every agent references a role, never a model identifier.

- `task` is the lead role for `winter-implementer`, copied verbatim from global.
- `mechanic` is the prewalk hand-off target.
- `smol` runs the scout.
- `advisor` stays on the OpenAI family, because cross-family disagreement is the
  point of an advisor.

CAUTION: `smol` and `mechanic` both lead with Meta Muse Spark on the
**contributor tier**, where Meta can train on prompts and completions. That
matches global and every sibling repository.

This repository holds a **wallet mnemonic**, and its reading agents walk the
wallet loading path and the signing path. The mnemonic never enters a prompt,
because `.omp/RULES.md` forbids reading `.env` and forbids printing
`process.env`. What the tier sees is source code, and this repository is public.

Standard tier `meta-muse/muse-spark-1.2` is the same model with no training
rights, and it is a one-line swap in `.omp/config.yml`.
