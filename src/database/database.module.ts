import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: configService.get('POSTGRES_PORT'),
        database: configService.get('POSTGRES_DB'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        autoLoadEntities: true,
        synchronize:
          configService.get('POSTGRES_SYNC').toString().toLowerCase() ===
          'true',
        logging:
          configService.get('POSTGRES_LOGGING').toString().toLowerCase() ===
          'true',
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
