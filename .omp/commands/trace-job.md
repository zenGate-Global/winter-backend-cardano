# /trace-job: follow one job through the queue

A job id is the same value in three places: the `check` primary key, the pg-boss
job id, and the `id` inside the payload. This command traces one job by reading
code, not by touching a database.

## Arguments

- `$ARGUMENTS`: the job id, or the symptom, for example `stuck in QUEUED`.

## The path

Walk it in order and cite `file:line` at each step.

1. **Controller.** A fresh uuid is created per request. It is not an idempotency
   key, so the same body posted twice creates two jobs and mints twice.
2. **Dry run.** The service builds **and signs** a transaction with submit off,
   then discards it. A `200` means it built once.
3. **Check row, then enqueue.** Two different connection pools and two different
   transactions. They can diverge. A row with no job stays `PENDING` forever, and
   nothing reconciles it.
4. **Consumer.** It sets the status, then rebuilds from scratch and submits.
5. **Terminal write.** `SUCCESS` and the hash, then a secondary table write.

## What each state really means

- `PENDING` means waiting in the queue.
- `QUEUED` means actively submitting to Cardano. The names read backwards.
- `SUCCESS` means submitted, not confirmed. Nothing waits for a block.
- `ERROR` **with a valid 64-character hash means the transaction succeeded** and
  a later database write failed. The hash survives the overwrite.

## Common symptoms

- **Stuck in `QUEUED` for many retries.** The handler died, or a bounded retry loop exhausted attempts. There is no reaper and no timeout sweep. The check table has no timestamp columns, so age is not visible.
- **Nothing moves at all.** Production runs with a minimum of zero instances, and
  the worker runs in process. With no instance alive, nothing polls.
- **`ERROR` right after a mint.** A recreate or a spend needs a `transaction` row
  that only a mint creates. A missing row throws after a successful submit.
- **Two tokens with one name.** A retry rebuilt and re-submitted. Look for the
  heuristic that retries on a hash that is not a string, or that holds the text
  `bad request`.

## Rules

Read-only. Never connect to a production database, and never read `.env`. Report
what the code proves, and say plainly when a symptom needs data you cannot see.
