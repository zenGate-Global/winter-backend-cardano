import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { PORT } from './constants';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

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
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(PORT());
}
bootstrap();
