import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
export function matchesApiKey(expected: Buffer, provided?: string): boolean {
  const candidate = Buffer.from(provided ?? '');
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKey: Buffer;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>('WINTER_API_KEY');
    if (!raw || raw.trim() === '') {
      throw new Error('WINTER_API_KEY is required but is unset or empty');
    }
    this.apiKey = Buffer.from(raw);
  }

  canActivate(context: ExecutionContext): boolean {
    return matchesApiKey(
      this.apiKey,
      context.switchToHttp().getRequest<Request>().get('x-api-key'),
    );
  }
}
