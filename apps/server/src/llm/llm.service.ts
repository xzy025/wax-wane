import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'

export type LLMProvider = 'openai' | 'anthropic' | 'mimo' | 'gemini'

export interface LLMPreset {
  id: string
  provider: LLMProvider
  apiUrl: string
  apiKey: string
  model: string
}

@Injectable()
export class LLMService {
  constructor(private configService: ConfigService) {}

  private getPresets(): Record<string, LLMPreset> {
    return {
      default: {
        id: 'default',
        provider: 'mimo',
        apiUrl: this.configService.get('LLM_API_URL', 'https://token-plan-cn.xiaomimimo.com/v1'),
        apiKey: this.configService.get('LLM_API_KEY', ''),
        model: this.configService.get('LLM_MODEL', 'mimo-v2.5-pro'),
      },
      claude: {
        id: 'claude',
        provider: 'anthropic',
        apiUrl: this.configService.get('CLAUDE_API_URL', 'https://api.anthropic.com'),
        apiKey: this.configService.get('CLAUDE_API_KEY', ''),
        model: this.configService.get('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
      },
      codex: {
        id: 'codex',
        provider: 'openai',
        apiUrl: this.configService.get('OPENAI_API_URL', 'https://api.openai.com/v1'),
        apiKey: this.configService.get('OPENAI_API_KEY', ''),
        model: this.configService.get('OPENAI_MODEL', 'gpt-4o'),
      },
      gemini: {
        id: 'gemini',
        provider: 'gemini',
        apiUrl: this.configService.get('GEMINI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        apiKey: this.configService.get('GEMINI_API_KEY', ''),
        model: this.configService.get('GEMINI_MODEL', 'gemini-2.5-flash'),
      },
    }
  }

  getPreset(id?: string): LLMPreset {
    const presets = this.getPresets()
    return presets[id || 'default'] || presets.default
  }

  createLLM(id?: string, options?: { streaming?: boolean }): ChatOpenAI | ChatAnthropic {
    const preset = this.getPreset(id)
    const streaming = options?.streaming ?? true

    switch (preset.provider) {
      case 'anthropic':
        return new ChatAnthropic({
          anthropicApiUrl: preset.apiUrl,
          anthropicApiKey: preset.apiKey,
          model: preset.model,
          streaming,
          maxTokens: 4096,
        })

      case 'openai':
      case 'mimo':
      case 'gemini':
      default:
        return new ChatOpenAI({
          openAIApiKey: preset.apiKey,
          modelName: preset.model,
          configuration: { baseURL: preset.apiUrl },
          streaming,
          maxTokens: 4096,
        })
    }
  }
}
