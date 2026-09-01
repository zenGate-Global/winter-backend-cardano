import { BadRequestException } from '@nestjs/common';
import { LosslessNumber } from 'lossless-json';

export const IPFS_CANONICAL_BODY = Symbol('ipfsCanonicalBody');

const MAX_CANONICAL_BYTES = 50 * 1024 * 1024;
const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_TOKENS = 200_000;
const MAX_TOKEN_BYTES = 1024 * 1024;
const MAX_NUMBER_LENGTH = 1_024;

export type IpfsRequestBody = {
  [IPFS_CANONICAL_BODY]?: Buffer;
};

function canonicalNumber(value: string): string {
  if (value.length > MAX_NUMBER_LENGTH) {
    throw new BadRequestException('JSON number is too long');
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new BadRequestException('Invalid JSON number');
  const [, sign, integer, fraction = '', rawExponent = '0'] = match;
  if (rawExponent.length > 7) {
    throw new BadRequestException('JSON number exponent is too large');
  }
  const parsedExponent = Number(rawExponent);
  if (
    !Number.isSafeInteger(parsedExponent) ||
    Math.abs(parsedExponent) > 1_000_000
  ) {
    throw new BadRequestException('JSON number exponent is too large');
  }
  let digits = (integer + fraction).replace(/^0+/, '');
  if (digits === '') return '0';
  let exponent = parsedExponent - fraction.length;
  const trailingZeros = digits.match(/0+$/)?.[0].length ?? 0;
  if (trailingZeros) {
    digits = digits.slice(0, -trailingZeros);
    exponent += trailingZeros;
  }
  return `${sign}${digits}${exponent === 0 ? '' : `e${exponent}`}`;
}

export function canonicalJson(value: unknown): string {
  let nodes = 0;
  const serialize = (item: unknown, depth: number): string => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new BadRequestException('JSON structure is too complex');
    }
    if (item === null || typeof item === 'boolean') return String(item);
    if (typeof item === 'string') return JSON.stringify(item);
    if (item instanceof LosslessNumber) return canonicalNumber(item.value);
    if (typeof item === 'number' && Number.isFinite(item)) {
      return canonicalNumber(String(item));
    }
    if (Array.isArray(item)) {
      return (
        '[' + item.map((entry) => serialize(entry, depth + 1)).join(',') + ']'
      );
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return (
        '{' +
        Object.keys(record)
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) + ':' + serialize(record[key], depth + 1),
          )
          .join(',') +
        '}'
      );
    }
    throw new BadRequestException('Unsupported JSON value');
  };
  const result = serialize(value, 0);
  if (Buffer.byteLength(result) > MAX_CANONICAL_BYTES) {
    throw new BadRequestException('Canonical JSON is too large');
  }
  return result;
}

function scanJson(text: string): unknown {
  let index = 0;
  let nodes = 0;
  let tokens = 0;
  let outputBytes = 0;

  const fail = (): never => {
    throw new BadRequestException('Invalid JSON body');
  };
  const addOutput = (bytes: number): void => {
    outputBytes += bytes;
    if (outputBytes > MAX_CANONICAL_BYTES) {
      throw new BadRequestException('Canonical JSON is too large');
    }
  };
  const countToken = (start: number, output: string): void => {
    if (++tokens > MAX_JSON_TOKENS) {
      throw new BadRequestException('JSON structure is too complex');
    }
    if (Buffer.byteLength(text.slice(start, index)) > MAX_TOKEN_BYTES) {
      throw new BadRequestException('JSON token is too long');
    }
    addOutput(Buffer.byteLength(output));
  };
  const whitespace = (): void => {
    while (
      text[index] === ' ' ||
      text[index] === '\n' ||
      text[index] === '\r' ||
      text[index] === '\t'
    ) {
      index++;
    }
  };
  const stringToken = (): string => {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '"') {
        const raw = text.slice(start, index);
        let decoded!: string;
        try {
          decoded = JSON.parse(raw) as string;
        } catch {
          fail();
        }
        countToken(start, JSON.stringify(decoded));
        return decoded;
      }
      if (char === '\\') {
        const escape = text[index++];
        if (escape === 'u') {
          if (!/^[\da-fA-F]{4}$/.test(text.slice(index, index + 4))) fail();
          index += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          fail();
        }
      } else if (char.charCodeAt(0) < 0x20) {
        fail();
      }
      if (index - start > MAX_TOKEN_BYTES) {
        throw new BadRequestException('JSON token is too long');
      }
    }
    return fail();
  };
  const numberToken = (): LosslessNumber => {
    const start = index;
    if (text[index] === '-') index++;
    if (text[index] === '0') {
      index++;
      if (/\d/.test(text[index] ?? '')) fail();
    } else {
      if (!/[1-9]/.test(text[index] ?? '')) fail();
      while (/\d/.test(text[index] ?? '')) index++;
    }
    if (text[index] === '.') {
      index++;
      if (!/\d/.test(text[index] ?? '')) fail();
      while (/\d/.test(text[index] ?? '')) index++;
    }
    if (text[index] === 'e' || text[index] === 'E') {
      index++;
      if (text[index] === '+' || text[index] === '-') index++;
      if (!/\d/.test(text[index] ?? '')) fail();
      while (/\d/.test(text[index] ?? '')) index++;
    }
    const raw = text.slice(start, index);
    countToken(start, canonicalNumber(raw));
    return new LosslessNumber(raw);
  };
  const literal = (value: 'true' | 'false' | 'null'): boolean | null => {
    const start = index;
    if (text.slice(index, index + value.length) !== value) fail();
    index += value.length;
    countToken(start, value);
    return value === 'null' ? null : value === 'true';
  };
  const value = (depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new BadRequestException('JSON structure is too complex');
    }
    whitespace();
    if (text[index] === '{') return object(depth);
    if (text[index] === '[') return array(depth);
    if (text[index] === '"') return stringToken();
    if (text[index] === 't') return literal('true');
    if (text[index] === 'f') return literal('false');
    if (text[index] === 'n') return literal('null');
    return numberToken();
  };
  const object = (depth: number): Record<string, unknown> => {
    index++;
    addOutput(1);
    whitespace();
    const keys = new Set<string>();
    const record = Object.create(null) as Record<string, unknown>;
    if (text[index] === '}') {
      index++;
      addOutput(1);
      return record;
    }
    while (true) {
      if (text[index] !== '"') fail();
      const key = stringToken();
      if (keys.has(key)) throw new BadRequestException('Duplicate JSON key');
      keys.add(key);
      whitespace();
      if (text[index++] !== ':') fail();
      addOutput(1);
      Object.defineProperty(record, key, {
        value: value(depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      whitespace();
      const separator = text[index++];
      if (separator === '}') {
        addOutput(1);
        return record;
      }
      if (separator !== ',') fail();
      addOutput(1);
      whitespace();
    }
  };
  const array = (depth: number): unknown[] => {
    index++;
    addOutput(1);
    whitespace();
    const entries: unknown[] = [];
    if (text[index] === ']') {
      index++;
      addOutput(1);
      return entries;
    }
    while (true) {
      entries.push(value(depth + 1));
      whitespace();
      const separator = text[index++];
      if (separator === ']') {
        addOutput(1);
        return entries;
      }
      if (separator !== ',') fail();
      addOutput(1);
      whitespace();
    }
  };

  whitespace();
  const parsed = value(0);
  whitespace();
  if (index !== text.length) fail();
  return parsed;
}

export function prepareIpfsBody(raw: Buffer): {
  body: unknown;
  canonical: Buffer;
} {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new BadRequestException('Invalid JSON body');
  }
  const lossless = scanJson(text);
  try {
    const canonical = Buffer.from(canonicalJson(lossless));
    return { body: JSON.parse(text) as unknown, canonical };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Invalid JSON body');
  }
}
