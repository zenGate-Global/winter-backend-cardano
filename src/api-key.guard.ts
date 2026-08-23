import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

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
    const provided = Buffer.from(
      context.switchToHttp().getRequest<Request>().get('x-api-key') ?? '',
    );
    return (
      provided.length === this.apiKey.length &&
      timingSafeEqual(provided, this.apiKey)
    );
  }
}
