// Proves the POST /ipfs envelope validates the wire contract without touching
// the events it carries.
//
// The global pipe runs with whitelist and forbidNonWhitelisted, which strip or
// reject any property that no decorator declares. That behavior applies to the
// validated class only. IpfsEnvelopeDto declares events with @IsObject({ each:
// true }) and deliberately without @ValidateNested and without @Type, so
// class-validator never recreates an element and never walks into one. The keys
// inside an event therefore survive untouched.
//
// Palmyra Pro is the only caller of this route and it sends arbitrary EPCIS
// shapes inside events. A change that strips or rejects a nested key breaks
// every upload, so this check fails when the envelope starts recursing.
import assert from 'node:assert/strict';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { IpfsEnvelopeDto } from './dto/ipfs-envelope.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const meta = {
  type: 'body' as const,
  metatype: IpfsEnvelopeDto,
  data: '',
};

async function accepts(body: unknown): Promise<IpfsEnvelopeDto> {
  return (await pipe.transform(body, meta)) as IpfsEnvelopeDto;
}

async function rejects(body: unknown): Promise<string> {
  try {
    await pipe.transform(body, meta);
  } catch (error) {
    // ValidationPipe throws BadRequestException. The per-field messages live in
    // the response body, never in Error.message, which stays generic.
    const res =
      error instanceof HttpException ? error.getResponse() : String(error);
    return typeof res === 'string' ? res : JSON.stringify(res);
  }
  throw new Error(`expected a rejection for ${JSON.stringify(body)}`);
}

async function main(): Promise<void> {
  // The real Palmyra Pro body: an envelope plus one deeply nested event that
  // declares none of its keys to the DTO.
  const event = {
    type: 'ObjectEvent',
    eventTime: '2026-08-26T00:00:00.000Z',
    bizStep: 'urn:epcglobal:cbv:bizstep:commissioning',
    ilmd: { District: 'Nyeri', Quality: 'AA', nested: { deep: [1, 2, 3] } },
    epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
  };
  const out = await accepts({
    logTime: '2026-08-26T00:00:00.000Z',
    events: [event],
  });

  assert.equal(out.events.length, 1, 'the event must survive');
  assert.deepEqual(
    out.events[0],
    event,
    'nested event keys must not be stripped or reordered',
  );
  assert.equal(
    JSON.stringify(out.events[0]),
    JSON.stringify(event),
    'the event must round-trip byte for byte',
  );

  // A second event and a larger batch stay acceptable.
  const many = await accepts({
    logTime: '2026-08-26T00:00:00Z',
    events: Array.from({ length: 1000 }, () => event),
  });
  assert.equal(many.events.length, 1000, 'a full batch must be accepted');

  // The envelope itself is now enforced.
  const noTime = await rejects({ events: [event] });
  assert.match(noTime, /logTime/, 'a missing logTime must be named');

  const badTime = await rejects({ logTime: 'yesterday', events: [event] });
  assert.match(badTime, /logTime/, 'a non ISO-8601 logTime must be named');

  const dateOnly = await rejects({ logTime: '2026-08-26', events: [event] });
  assert.match(dateOnly, /logTime/, 'a date without a time must be rejected');

  const empty = await rejects({ logTime: '2026-08-26T00:00:00Z', events: [] });
  assert.match(empty, /events/, 'an empty events array must be named');

  const notObjects = await rejects({
    logTime: '2026-08-26T00:00:00Z',
    events: ['a string is not an event'],
  });
  assert.match(notObjects, /events/, 'a non-object event must be named');

  const tooMany = await rejects({
    logTime: '2026-08-26T00:00:00Z',
    events: Array.from({ length: 1001 }, () => event),
  });
  assert.match(tooMany, /events/, 'an oversized batch must be named');

  const extra = await rejects({
    logTime: '2026-08-26T00:00:00Z',
    events: [event],
    surprise: true,
  });
  assert.match(extra, /surprise/, 'an undeclared envelope key must be named');

  console.log('ipfs envelope check passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
