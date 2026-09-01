import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { join } from 'node:path';
import * as ts from 'typescript';

const sourcePathText = join(process.cwd(), 'src/app.module.ts');
const sourceText = readFileSync(sourcePathText, 'utf8');
const sourceFile = ts.createSourceFile(
  sourcePathText,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
);

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression {
  const match = object.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) && item.name.getText(sourceFile) === name,
  );
  assert(match, `Missing ${name} logger option`);
  return match.initializer;
}

let cloudSeverityNode: ts.ObjectLiteralExpression | undefined;
let pinoHttpNode: ts.ObjectLiteralExpression | undefined;

sourceFile.forEachChild(function visit(node): void {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(sourceFile) === 'cloudSeverity'
  ) {
    assert(node.initializer && ts.isObjectLiteralExpression(node.initializer));
    cloudSeverityNode = node.initializer;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(sourceFile) === 'LoggerModule.forRoot'
  ) {
    const params = node.arguments[0];
    assert(params && ts.isObjectLiteralExpression(params));
    const option = property(params, 'pinoHttp');
    assert(ts.isObjectLiteralExpression(option));
    pinoHttpNode = option;
  }
  ts.forEachChild(node, visit);
});

assert(cloudSeverityNode, 'Missing explicit Cloud severity map');
assert(pinoHttpNode, 'Missing pinoHttp logger options');

function evaluate<T>(
  node: ts.Expression,
  scope: Record<string, unknown> = {},
): T {
  const names = Object.keys(scope);
  return Function(
    ...names,
    `return (${node.getText(sourceFile)});`,
  )(...Object.values(scope)) as T;
}

async function main(): Promise<void> {
  const cloudSeverity = evaluate<Record<string, string>>(cloudSeverityNode!);
  assert.deepEqual(cloudSeverity, {
    trace: 'DEBUG',
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARNING',
    error: 'ERROR',
    fatal: 'CRITICAL',
  });

  const deployedOptions = evaluate<Record<string, any>>(pinoHttpNode!, {
    cloudSeverity,
    process: { env: { K_SERVICE: 'winter' } },
  });
  const localOptions = evaluate<Record<string, any>>(pinoHttpNode!, {
    cloudSeverity,
    process: { env: {} },
  });
  assert.equal(localOptions.transport?.target, 'pino-pretty');
  assert.equal(deployedOptions.transport, undefined);
  assert.equal(typeof deployedOptions.customLogLevel, 'function');

  const response = (statusCode: number) => ({ statusCode });
  assert.equal(deployedOptions.customLogLevel({}, response(200)), 'info');
  assert.equal(deployedOptions.customLogLevel({}, response(404)), 'info');
  assert.equal(deployedOptions.customLogLevel({}, response(500)), 'error');
  assert.equal(
    deployedOptions.customLogLevel({}, response(200), new Error('thrown')),
    'error',
  );

  const raw: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      raw.push(String(chunk));
      callback();
    },
  });
  const requireFromLogger = createRequire(join(process.cwd(), 'package.json'));
  const pinoHttp = requireFromLogger('pino-http') as (
    options: Record<string, unknown>,
    stream: Writable,
  ) => (req: unknown, res: unknown, next: () => void) => void;
  const middleware = pinoHttp(deployedOptions, stream);
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = Number(req.url?.slice(1));
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object' && 'port' in address);
  assert(typeof address.port === 'number');
  const port = address.port;
  const secret = 'proof-api-key-secret';
  for (const status of [200, 404, 500]) {
    const result = await fetch(`http://127.0.0.1:${port}/${status}`, {
      headers: { 'x-api-key': secret },
    });
    assert.equal(result.status, status);
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const logs = raw
    .flatMap((chunk) => chunk.trim().split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
  const mapped = logs.map((entry) => {
    assert(
      entry &&
        typeof entry === 'object' &&
        'req' in entry &&
        'severity' in entry,
    );
    const reqField = entry.req;
    assert(reqField && typeof reqField === 'object' && 'url' in reqField);
    const url = reqField.url;
    const severity = entry.severity;
    return [url, severity];
  });
  assert.deepEqual(mapped, [
    ['/200', 'INFO'],
    ['/404', 'INFO'],
    ['/500', 'ERROR'],
  ]);
  const serialized = raw.join('');
  assert(!serialized.includes(secret), 'API key leaked in HTTP log');
  assert(
    serialized.includes('[redacted]'),
    'HTTP log did not contain redaction marker',
  );

  console.log('Logging severity and redaction checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
