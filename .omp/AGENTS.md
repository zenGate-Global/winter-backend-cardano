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

**There is no continuous integration.** The only workflow is a manual deploy,
and its pull-request trigger is commented out. An agent working here **is** the
gate.

**The gate is `npx tsc --noEmit` and nothing else.** `pnpm lint` exits 2 without
reading a source file, because ESLint 10 needs a flat config that this repository
does not have. `pnpm test` finds zero specs. Never report either as evidence.

**The deployed service is public and unauthenticated, and it signs with a live
wallet mnemonic.** That combination is why the boundaries in the root file are
strict.

**The repository is public.** Record an invariant in a tracked file. Report a
working attack in chat.

## Model routing

`.omp/config.yml` pins four roles and inherits the rest from global. Use
`omp config get modelRoles --json` for live values.

Every agent references a role, never a model identifier.

- `task` is the lead role for `winter-implementer`, copied verbatim from global.
- `mechanic` is the prewalk hand-off target.
- `smol` runs the scout.
- `advisor` stays on the OpenAI family, because cross-family disagreement is the
  point of an advisor.

**A deliberate divergence from global and from the sibling repositories.** Global
`smol` and `mechanic` both lead with Meta Muse Spark on the **contributor tier**,
where Meta can train on prompts and completions. The siblings accept that,
because their secrets are rotatable keys and URLs.

This repository holds a **wallet mnemonic**, and its reading agents walk the
wallet loading path and the signing path. Both roles therefore lead with the
**standard tier** `meta-muse/muse-spark-1.2`, which is the same model with no
training rights. It costs only the contributor discount.
