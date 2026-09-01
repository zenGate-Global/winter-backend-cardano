import assert from 'node:assert/strict';
import { ChildProcess, execFile, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import type {
  ConstructorOptions as PgBossConstructorOptions,
  Job,
  PgBoss as PgBossClient,
} from 'pg-boss';
import { TX_QUEUE_NAME } from './palmyra-queue.types';
import {
  TX_QUEUE_CREATE_OPTIONS,
  TX_QUEUE_WORK_OPTIONS,
} from './palmyra-queue.service';
const execFileAsync = promisify(execFile);
declare const __filename: string;
const currentFile =
  typeof __filename !== 'undefined' ? __filename : process.argv[1];
const IMAGE = 'postgres:16-alpine';
const PASSWORD = 'heartbeat-ownership-proof';

const QUEUE_MONITOR_INTERVAL_SECONDS = 1;
const PGBOSS_SUPERVISE_INTERVAL_SECONDS = 60;
const FIRST_RETRY_BACKOFF_MAX_SECONDS = Math.min(
  TX_QUEUE_CREATE_OPTIONS.retryDelayMax,
  TX_QUEUE_CREATE_OPTIONS.retryDelay * 2,
);
const LEASE_OBSERVATION_MS =
  (TX_QUEUE_CREATE_OPTIONS.heartbeatSeconds +
    QUEUE_MONITOR_INTERVAL_SECONDS +
    TX_QUEUE_WORK_OPTIONS.pollingIntervalSeconds +
    1) *
  1000;
const REDELIVERY_BOUND_MS =
  (TX_QUEUE_CREATE_OPTIONS.heartbeatSeconds +
    PGBOSS_SUPERVISE_INTERVAL_SECONDS +
    FIRST_RETRY_BACKOFF_MAX_SECONDS +
    TX_QUEUE_WORK_OPTIONS.pollingIntervalSeconds +
    1) *
  1000;

type Role = 'A' | 'B';
type ChildCommand = { type: 'enqueue'; jobId: string } | { type: 'stop' };
type ChildMessage =
  | { type: 'ready'; role: Role }
  | { type: 'enqueued'; jobId: string }
  | { type: 'received'; role: Role; jobId: string }
  | { type: 'fatal'; role: Role; message: string };
type Connection = PgBossConstructorOptions & {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
};
type JobRow = {
  id: string;
  name: string;
  state: string;
  retry_count: number;
  completed_on: Date | null;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function sendToParent(message: ChildMessage): void {
  if (!process.send) throw new Error('worker requires an IPC channel');
  process.send(message);
}

async function runWorker(role: Role, connection: Connection): Promise<void> {
  const { PgBoss } = await import('pg-boss');
  const boss: PgBossClient = new PgBoss(connection);
  boss.on('error', () =>
    sendToParent({ type: 'fatal', role, message: 'pg-boss emitted an error' }),
  );
  await boss.start();
  await boss.createQueue(TX_QUEUE_NAME, TX_QUEUE_CREATE_OPTIONS);
  await boss.work<{ proof: true }>(
    TX_QUEUE_NAME,
    TX_QUEUE_WORK_OPTIONS,
    async (jobs) => {
      const [job] = jobs as unknown as Job<{ proof: true }>[];
      assert(job, `${role} received an empty job batch`);
      sendToParent({ type: 'received', role, jobId: job.id });
      if (role === 'A') await new Promise<never>(() => undefined);
    },
  );
  process.on('message', (command: ChildCommand) => {
    void (async () => {
      if (command.type === 'enqueue') {
        const result = await boss.send(
          TX_QUEUE_NAME,
          { proof: true },
          { id: command.jobId },
        );
        assert.equal(result, command.jobId);
        sendToParent({ type: 'enqueued', jobId: command.jobId });
        return;
      }
      await boss.stop({ graceful: true, timeout: 5000 });
      process.exit(0);
    })().catch((error: unknown) => {
      sendToParent({
        type: 'fatal',
        role,
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
  });
  sendToParent({ type: 'ready', role });
}

function spawnWorker(role: Role, connection: Connection): ChildProcess {
  return fork(
    currentFile,
    [
      `--worker=${role}`,
      `--connection=${Buffer.from(JSON.stringify(connection)).toString('base64url')}`,
    ],
    {
      cwd: process.cwd(),
      execArgv: ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    },
  );
}

function waitForMessage(
  child: ChildProcess,
  predicate: (message: ChildMessage) => boolean,
  timeoutMs: number,
): Promise<ChildMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('timed out waiting for worker message')),
      timeoutMs,
    );
    const onMessage = (value: unknown) => {
      const message = value as ChildMessage;
      if (message.type === 'fatal') {
        finish(new Error(`${message.role}: ${message.message}`));
      } else if (predicate(message)) {
        finish(undefined, message);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(
          `worker exited before its message: code=${code} signal=${signal}`,
        ),
      );
    const finish = (error?: Error, message?: ChildMessage) => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(message as ChildMessage);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('timed out waiting for worker exit'));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once('exit', onExit);
  });
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync('docker', [
        'exec',
        container,
        'pg_isready',
        '-U',
        'postgres',
      ]);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error('disposable Postgres did not become ready');
}

async function waitForCompleted(
  pool: Pool,
  schema: string,
  jobId: string,
): Promise<JobRow> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await pool.query<JobRow>(
      `SELECT id, name, state, retry_count, completed_on FROM "${schema}".job WHERE id = $1`,
      [jobId],
    );
    if (result.rows[0]?.state === 'completed') return result.rows[0];
    await delay(250);
  }
  throw new Error('job did not reach completed state');
}

async function runParent(): Promise<void> {
  assert.equal(TX_QUEUE_CREATE_OPTIONS.policy, 'singleton');
  assert.equal(TX_QUEUE_WORK_OPTIONS.localConcurrency, 1);
  const suffix = randomUUID().replaceAll('-', '');
  const container = `winter-heartbeat-${suffix}`;
  const schema = `heartbeat_${suffix}`;
  const jobId = randomUUID();
  const breakOwnership = process.argv.includes('--break-ownership');
  let pool: Pool | undefined;
  let workerA: ChildProcess | undefined;
  let workerB: ChildProcess | undefined;
  const receipts: Array<{ role: Role; jobId: string; at: number }> = [];
  const recordReceipt = (value: unknown) => {
    const message = value as ChildMessage;
    if (message.type === 'received')
      receipts.push({ ...message, at: Date.now() });
  };
  try {
    await execFileAsync('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--env',
      `POSTGRES_PASSWORD=${PASSWORD}`,
      '--publish',
      '127.0.0.1::5432',
      IMAGE,
    ]);
    await waitForPostgres(container);
    const { stdout } = await execFileAsync('docker', [
      'port',
      container,
      '5432/tcp',
    ]);
    const port = Number(stdout.trim().split(':').at(-1));
    assert(
      Number.isInteger(port) && port > 0,
      `invalid Postgres port: ${stdout.trim()}`,
    );
    const bossConnection: Connection = {
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      password: PASSWORD,
      schema,
      application_name: 'winter-heartbeat-ownership-proof',
      monitorIntervalSeconds: QUEUE_MONITOR_INTERVAL_SECONDS,
      maintenanceIntervalSeconds: 2,
    };
    pool = new Pool({
      host: bossConnection.host,
      port: bossConnection.port,
      database: bossConnection.database,
      user: bossConnection.user,
      password: bossConnection.password,
    });
    const connection = bossConnection;
    workerA = spawnWorker('A', connection);
    workerA.on('message', recordReceipt);
    await waitForMessage(
      workerA,
      (message) => message.type === 'ready',
      30_000,
    );
    const enqueued = waitForMessage(
      workerA,
      (message) => message.type === 'enqueued',
      10_000,
    );
    const receivedByA = waitForMessage(
      workerA,
      (message) => message.type === 'received' && message.role === 'A',
      10_000,
    );
    workerA.send({ type: 'enqueue', jobId } satisfies ChildCommand);
    const enqueueMessage = await enqueued;
    const firstReceipt = await receivedByA;
    assert.equal(
      enqueueMessage.type === 'enqueued' && enqueueMessage.jobId,
      jobId,
    );
    assert.equal(firstReceipt.type === 'received' && firstReceipt.jobId, jobId);
    workerB = spawnWorker('B', connection);
    workerB.on('message', recordReceipt);
    await waitForMessage(
      workerB,
      (message) => message.type === 'ready',
      30_000,
    );
    const receiptTimeoutMs = breakOwnership
      ? REDELIVERY_BOUND_MS
      : LEASE_OBSERVATION_MS + REDELIVERY_BOUND_MS;
    const receivedByB = waitForMessage(
      workerB,
      (message) => message.type === 'received' && message.role === 'B',
      receiptTimeoutMs,
    );
    if (breakOwnership)
      assert(workerA.kill('SIGSTOP'), 'failed to disable A heartbeat refresh');
    const overlap = await Promise.race([
      receivedByB.then(() => true),
      delay(breakOwnership ? REDELIVERY_BOUND_MS : LEASE_OBSERVATION_MS).then(
        () => false,
      ),
    ]);
    assert.equal(
      workerA.exitCode,
      null,
      'A exited during ownership observation',
    );
    assert.equal(
      workerA.signalCode,
      null,
      'A was killed during ownership observation',
    );
    assert.equal(
      overlap,
      false,
      'B received the job while A remained alive beyond the heartbeat lease',
    );
    const heartbeat = await pool.query<{ heartbeat_on: Date | null }>(
      `SELECT heartbeat_on FROM "${schema}".job WHERE id = $1`,
      [jobId],
    );
    assert(heartbeat.rows[0]?.heartbeat_on instanceof Date);
    const staleDeadline =
      heartbeat.rows[0].heartbeat_on.getTime() +
      TX_QUEUE_CREATE_OPTIONS.heartbeatSeconds * 1000;
    if (!breakOwnership) {
      workerA.kill('SIGKILL');
      const exit = await waitForExit(workerA, 10_000);
      assert.equal(exit.signal, 'SIGKILL');
    }
    const secondReceipt = await receivedByB;
    assert.equal(secondReceipt.type, 'received');
    assert.equal(
      secondReceipt.type === 'received' && secondReceipt.jobId,
      jobId,
    );
    assert(
      receipts.find((receipt) => receipt.role === 'B')!.at >= staleDeadline,
      'B received the job before A heartbeat became stale',
    );
    assert.equal(receipts.filter((receipt) => receipt.role === 'A').length, 1);
    assert.equal(receipts.filter((receipt) => receipt.role === 'B').length, 1);
    const row = await waitForCompleted(pool, schema, jobId);
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${schema}".job WHERE name = $1`,
      [TX_QUEUE_NAME],
    );
    assert.equal(count.rows[0]?.count, '1');
    assert.equal(row.id, jobId);
    assert.equal(row.name, TX_QUEUE_NAME);
    assert.equal(row.state, 'completed');
    assert.equal(row.retry_count, 1);
    assert(row.completed_on instanceof Date);
    await delay((TX_QUEUE_WORK_OPTIONS.pollingIntervalSeconds + 1) * 1000);
    assert.equal(receipts.filter((receipt) => receipt.role === 'B').length, 1);
    console.log(`A received ${jobId} once and blocked`);
    console.log(`B received ${jobId} once after A's stale heartbeat`);
    console.log(`job ${jobId} completed after one retry`);
    console.log('heartbeat ownership proof passed');
  } finally {
    for (const worker of [workerA, workerB]) {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        worker.kill('SIGKILL');
        await waitForExit(worker, 5000).catch(() => undefined);
      }
    }
    if (pool) {
      await pool
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
    await execFileAsync('docker', ['rm', '--force', container]).catch(
      () => undefined,
    );
  }
}

const role = parseArgument('worker') as Role | undefined;
if (role) {
  const encodedConnection = parseArgument('connection');
  assert(encodedConnection, 'worker connection is required');
  const connection = JSON.parse(
    Buffer.from(encodedConnection, 'base64url').toString('utf8'),
  ) as Connection;
  void runWorker(role, connection).catch((error: unknown) => {
    sendToParent({
      type: 'fatal',
      role,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
} else {
  void runParent().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
