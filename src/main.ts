import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { WinstonModule } from 'nest-winston';
import winston, { createLogger } from 'winston';

export const logz = createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, context, timestamp }) => {
          return `${timestamp}|${level}|${context}: ${message}`;
        }),
      ),
      handleExceptions: true
    }),
  ],
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      instance: logz,
    })
  })

  const port = process.env.PORT || 3000
  logz.info(`Listening on ${port}`)

  await app.listen(port)
}

bootstrap()
