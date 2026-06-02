import { Module } from '@nestjs/common'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'
import { LLMModule } from '../llm/llm.module'
import { ToolsModule } from '../tools/tools.module'
import { StreamingModule } from '../streaming/streaming.module'

@Module({
  imports: [LLMModule, ToolsModule, StreamingModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
