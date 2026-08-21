# /audit-endpoint: review one HTTP route

The deployed service is public and unauthenticated, and it signs with a live
wallet. Every route is reachable by anyone. This command audits one route, or
every route when you name none.

## Arguments

- `$ARGUMENTS`: the route, for example `palmyra/tokenizeCommodity` or `ipfs`.
  With no argument, audit every controller under `src/`.

## Steps

Read the controller, its DTOs, and the service it calls. Answer each question
with a `file:line` citation.

1. **What does the route cost an attacker, and what does it cost the owner?**
   Name the upstream spend: ADA from the wallet, a Pinata pin, or a Blockfrost
   call. There is no rate limit and no quota anywhere.
2. **Does validation actually run?** A decorator is not a check.
   - Only a controller `@Body()` parameter passes the global pipe.
   - A union type erases to `Object`, and the pipe skips it.
   - An array without an element type is never descended into, so its element
     decorators are dead.
   - `whitelist` and `forbidNonWhitelisted` apply to the top level only.
   Say which decorators execute and which do not.
3. **Is every identifier format-checked**, not merely typed? A CID, a token
   name, a transaction hash, an address, and a job id are all plain strings
   today. A length in characters is not a length in bytes.
4. **Does the error path return upstream text?** A `BadRequestException` with an
   object first argument returns that object verbatim, including a `cause`. An
   `HttpException` with a `cause` option does not. Check which form is used.
5. **Does the handler log a raw error object?** There is no redaction, so an
   error that carries a request configuration writes the API key to the log.
6. **Does the route submit, or does it enqueue?** A `POST` here builds and signs
   a transaction inside the request, then discards it and enqueues. Say which
   part is synchronous.
7. **Is the response shape a wire contract?** `POST /ipfs`,
   `POST /palmyra/tokenizeCommodity`, and `GET /check/{id}` are consumed by
   Palmyra Pro, which polls for the literal string `SUCCESS`.
8. **Does the route return a whole table?** Three routes do, unpaginated, and one
   of them exposes stringified internal errors.

## Output

List each finding with its severity, its `file:line`, what it costs, and the
concrete fix. Say plainly when a route is clean. Never edit in this command.

**This repository is public.** Write the invariant and the fix. Do not write a
working attack into a tracked file.
