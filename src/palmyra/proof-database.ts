import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

type ProofDatabase = {
  dataSource: DataSource;
  schema: string;
  close: () => Promise<void>;
};

type DatabaseTarget = {
  url: string;
  container?: string;
};

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function safeExternalUrl(raw: string): string {
  const url = new URL(raw);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'proof database URL must use PostgreSQL',
  );
  assert.ok(
    localHosts.has(url.hostname),
    'proof database URL must use an explicit local host',
  );
  assert.ok(
    !['', '/', '/postgres', '/template0', '/template1'].includes(url.pathname),
    'proof database URL must name a disposable non-default database',
  );
  for (const key of ['schema', 'search_path', 'options']) {
    assert.equal(
      url.searchParams.has(key),
      false,
      `proof database URL must not set ${key}`,
    );
  }
  return url.toString();
}

function startContainer(prefix: string): DatabaseTarget {
  const container = `${prefix}-${randomUUID()}`;
  execFileSync('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_USER=wt',
    '-e',
    'POSTGRES_PASSWORD=wt',
    '-e',
    'POSTGRES_DB=wt',
    '-P',
    'postgres:17.4',
  ]);
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'wt']);
      const mapping = execFileSync('docker', ['port', container, '5432'], {
        encoding: 'utf8',
      });
      const port = mapping.match(/:(\d+)\s*$/m)?.[1];
      assert.ok(port, 'docker did not publish the PostgreSQL port');
      return {
        url: `postgresql://wt:wt@127.0.0.1:${port}/wt`,
        container,
      };
    } catch (error) {
      lastError = error;
      execFileSync('sleep', ['0.5']);
    }
  }
  execFileSync('docker', ['rm', '-f', container]);
  throw new Error('PostgreSQL container did not become ready', {
    cause: lastError,
  });
}

export async function openProofDatabase(
  entities: unknown[],
  envNames: string[],
  prefix: string,
): Promise<ProofDatabase> {
  const configured = envNames
    .map((name) => process.env[name])
    .find((value): value is string => Boolean(value));
  const target = configured
    ? { url: safeExternalUrl(configured) }
    : startContainer(prefix);
  const schema = `proof_${randomUUID().replaceAll('-', '_')}`;
  const admin = new DataSource({ type: 'postgres', url: target.url });
  let dataSource: DataSource | undefined;

  try {
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url: target.url,
      schema,
      entities: entities as any,
      synchronize: true,
      extra: { options: `-c search_path=${schema}` },
    });
    await dataSource.initialize();
    const [{ current_schema: activeSchema }] = (await dataSource.query(
      'SELECT current_schema()',
    )) as Array<{ current_schema: string }>;
    assert.equal(
      activeSchema,
      schema,
      'proof database must use its UUID schema',
    );

    return {
      dataSource,
      schema,
      close: async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
        if (admin.isInitialized) await admin.destroy();
        const cleanup = new DataSource({ type: 'postgres', url: target.url });
        try {
          await cleanup.initialize();
          await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          if (cleanup.isInitialized) await cleanup.destroy();
          if (target.container) {
            execFileSync('docker', ['rm', '-f', target.container]);
          }
        }
      },
    };
  } catch (error) {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    if (target.container)
      execFileSync('docker', ['rm', '-f', target.container]);
    throw error;
  }
}
