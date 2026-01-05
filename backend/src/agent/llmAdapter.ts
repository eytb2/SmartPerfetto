/**
 * LLM Client Adapter for Agent System
 * 
 * Bridges the agent's LLMClient interface with existing AI services (DeepSeek, OpenAI, etc.)
 */

import OpenAI from 'openai';
import { LLMClient } from './agents/baseExpertAgent';

export interface LLMAdapterConfig {
  provider: 'deepseek' | 'openai' | 'mock';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Creates an LLMClient that uses the DeepSeek API
 */
export function createDeepSeekLLMClient(config?: Partial<LLMAdapterConfig>): LLMClient {
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY;
  const baseUrl = config?.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = config?.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const temperature = config?.temperature ?? 0.3;
  const maxTokens = config?.maxTokens ?? 4000;

  if (!apiKey) {
    console.warn('[LLMAdapter] DeepSeek API key not found, using mock client');
    return createMockLLMClient();
  }

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
  });

  return {
    async complete(prompt: string): Promise<string> {
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        });
        return completion.choices[0]?.message?.content || '';
      } catch (error: any) {
        console.error('[LLMAdapter] DeepSeek API error:', error.message);
        throw new Error(`LLM completion failed: ${error.message}`);
      }
    },

    async completeJSON<T>(prompt: string): Promise<T> {
      const jsonPrompt = `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.`;
      
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: jsonPrompt }],
          temperature: 0.1,
          max_tokens: maxTokens,
        });

        const content = completion.choices[0]?.message?.content || '{}';
        return parseJSONResponse<T>(content);
      } catch (error: any) {
        console.error('[LLMAdapter] DeepSeek JSON completion error:', error.message);
        throw new Error(`LLM JSON completion failed: ${error.message}`);
      }
    },
  };
}

/**
 * Creates an LLMClient that uses the OpenAI API
 */
export function createOpenAILLMClient(config?: Partial<LLMAdapterConfig>): LLMClient {
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
  const model = config?.model || process.env.OPENAI_MODEL || 'gpt-4';
  const temperature = config?.temperature ?? 0.3;
  const maxTokens = config?.maxTokens ?? 4000;

  if (!apiKey) {
    console.warn('[LLMAdapter] OpenAI API key not found, using mock client');
    return createMockLLMClient();
  }

  const client = new OpenAI({ apiKey });

  return {
    async complete(prompt: string): Promise<string> {
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        });
        return completion.choices[0]?.message?.content || '';
      } catch (error: any) {
        console.error('[LLMAdapter] OpenAI API error:', error.message);
        throw new Error(`LLM completion failed: ${error.message}`);
      }
    },

    async completeJSON<T>(prompt: string): Promise<T> {
      const jsonPrompt = `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.`;
      
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: jsonPrompt }],
          temperature: 0.1,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        });

        const content = completion.choices[0]?.message?.content || '{}';
        return JSON.parse(content) as T;
      } catch (error: any) {
        console.error('[LLMAdapter] OpenAI JSON completion error:', error.message);
        throw new Error(`LLM JSON completion failed: ${error.message}`);
      }
    },
  };
}

export function createMockLLMClient(): LLMClient {
  return {
    async complete(prompt: string): Promise<string> {
      console.log('[MockLLM] Received prompt:', prompt.substring(0, 100) + '...');
      
      if (prompt.includes('synthesize') || prompt.includes('conclusion')) {
        return `Based on the analysis, the trace shows moderate scrolling performance with some jank frames detected. 
The main issues appear to be:
1. Main thread blocking during list scrolling
2. Some binder calls taking longer than expected
3. CPU frequency throttling during sustained scrolling

Recommendations:
- Consider moving heavy operations to background threads
- Optimize RecyclerView binding operations
- Review binder transaction frequency`;
      }

      if (prompt.includes('think') || prompt.includes('next step')) {
        return `I should analyze the frame data to identify the root cause of jank. 
The most important metrics are main thread utilization and binder call patterns.`;
      }

      return 'Analysis complete. No significant issues detected.';
    },

    async completeJSON<T>(prompt: string): Promise<T> {
      console.log('[MockLLM] Received JSON prompt:', prompt.substring(0, 100) + '...');
      
      if (prompt.includes('Plan the analysis') || prompt.includes('Create an analysis plan')) {
        return {
          tasks: [
            {
              id: 'task_1',
              expertAgent: 'ScrollingExpert',
              objective: 'Analyze frame performance and identify jank causes',
              dependencies: [],
              priority: 1,
            },
          ],
          estimatedDuration: 5000,
          parallelizable: false,
        } as T;
      }

      if (prompt.includes('Analyze this user query') || prompt.includes('primaryGoal')) {
        return {
          primaryGoal: 'analyze scrolling performance',
          aspects: ['scrolling', 'jank', 'frame_drops'],
          expectedOutputType: 'diagnosis',
          complexity: 'moderate',
        } as T;
      }

      if (prompt.includes('Select which tool') || prompt.includes('Available tools')) {
        return {
          toolCalls: [
            { toolName: 'execute_sql', params: { sql: 'SELECT COUNT(*) as total_frames FROM actual_frame_timeline_slice' } }
          ],
        } as T;
      }

      if (prompt.includes('Analyze this tool result') || prompt.includes('Extract findings')) {
        return {
          findings: [
            {
              category: 'performance',
              severity: 'warning',
              title: 'Jank frames detected',
              description: 'Analysis found jank frames in the trace',
              evidence: ['mock evidence'],
            },
          ],
        } as T;
      }

      if (prompt.includes('generate actionable suggestions') || prompt.includes('Generate conclusion')) {
        return {
          suggestions: ['Optimize main thread operations', 'Review binder call patterns'],
          diagnostics: [
            {
              id: 'diag_jank',
              condition: 'jank_rate > 5%',
              matched: true,
              message: 'Jank rate exceeds acceptable threshold',
              suggestions: ['Profile main thread', 'Check for blocking operations'],
            },
          ],
        } as T;
      }

      if (prompt.includes('decide what to do next') || prompt.includes('what should be the next action')) {
        return {
          observation: 'Initial analysis state, need to gather frame data',
          reasoning: 'Should query frame statistics to understand jank severity',
          decision: 'tool_call',
          confidence: 0.3,
        } as T;
      }

      return {} as T;
    },
  };
}

/**
 * Creates the appropriate LLMClient based on configuration or environment
 */
export function createLLMClient(config?: LLMAdapterConfig): LLMClient {
  const provider = config?.provider || (process.env.AI_SERVICE as LLMAdapterConfig['provider']) || 'deepseek';

  switch (provider) {
    case 'deepseek':
      return createDeepSeekLLMClient(config);
    case 'openai':
      return createOpenAILLMClient(config);
    case 'mock':
      return createMockLLMClient();
    default:
      console.warn(`[LLMAdapter] Unknown provider '${provider}', using mock client`);
      return createMockLLMClient();
  }
}

function stripMarkdownCodeBlock(content: string): string {
  if (!content.startsWith('```')) return content;
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : content;
}

function extractJSONFromText(content: string): string {
  if (content.startsWith('{') || content.startsWith('[')) return content;
  const match = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return match ? match[1] : content;
}

function parseJSONResponse<T>(content: string): T {
  let cleanContent = content.trim();
  cleanContent = stripMarkdownCodeBlock(cleanContent);
  cleanContent = extractJSONFromText(cleanContent);

  try {
    return JSON.parse(cleanContent) as T;
  } catch (error) {
    console.error('[LLMAdapter] Failed to parse JSON:', cleanContent.substring(0, 200));
    throw new Error(`Invalid JSON response: ${(error as Error).message}`);
  }
}

export default createLLMClient;
