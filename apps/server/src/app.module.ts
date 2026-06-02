import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentModule } from './agent/agent.module'
import { DatabaseModule } from './database/database.module'
import { RedisModule } from './common/redis.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    DatabaseModule,
    RedisModule,
    AgentModule,
  ],
})
export class AppModule {}
