import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // CORS
  app.enableCors({ origin: true })

  // Global prefix
  app.setGlobalPrefix('api')

  const port = process.env.PORT ?? 3001
  await app.listen(port)
  console.log(`[NestServer] Running on http://localhost:${port}`)
}

bootstrap()
