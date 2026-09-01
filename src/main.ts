import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { PORT } from './constants';
import { json, raw, urlencoded } from 'express';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { matchesApiKey } from './api-key.guard';
import { IPFS_CANONICAL_BODY, prepareIpfsBody } from './ipfs/lossless-json';

export function parseIpfsJson(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!Buffer.isBuffer(req.body)) {
    next();
    return;
  }
  try {
    const { body, canonical } = prepareIpfsBody(req.body);
    (req as unknown as Record<symbol, Buffer>)[IPFS_CANONICAL_BODY] = canonical;
    req.body = body;
    next();
  } catch (error) {
    next(
      error instanceof BadRequestException
        ? error
        : new BadRequestException('Invalid JSON body'),
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const apiKey = Buffer.from(
    app.get(ConfigService).getOrThrow('WINTER_API_KEY'),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!matchesApiKey(apiKey, req.get('x-api-key'))) {
      res.status(403).json({ statusCode: 403, message: 'Forbidden resource' });
      return;
    }
    next();
  });
  app.use('/ipfs', raw({ limit: '50mb', type: 'application/json' }));
  app.use('/ipfs', parseIpfsJson);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Set up global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // Automatically transform payloads to DTO instances
      whitelist: true, // Strip properties that do not have any decorators
      forbidNonWhitelisted: true, // Throw an error if non-whitelisted properties are provided
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Winter Backend')
    .setDescription('Winter Backend Documentation')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(PORT());
}
if (require.main === module) void bootstrap();
