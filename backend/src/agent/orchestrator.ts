import {
  OrchestratorAgent,
  OrchestratorResult,
  OrchestratorOptions,
  OrchestratorTrace,
  Intent,
  AnalysisPlan,
  AnalysisTask,
  AnalysisContext,
  ExpertAgent,
  ExpertResult,
  AgentThought,
} from './types';
import { LLMClient } from './agents/baseExpertAgent';
import { getAgentTraceRecorder } from './traceRecorder';

export class PerfettoOrchestratorAgent implements OrchestratorAgent {
  private experts: Map<string, ExpertAgent> = new Map();
  private llm: LLMClient;
  private traceProcessor: any;
  private traceProcessorService: any;
  private currentTraceId: string | null = null;
  private enableTraceRecording: boolean = true;

  constructor(llm: LLMClient, options?: { enableTraceRecording?: boolean }) {
    this.llm = llm;
    this.enableTraceRecording = options?.enableTraceRecording ?? true;
  }

  registerExpert(expert: ExpertAgent): void {
    this.experts.set(expert.config.name, expert);
  }

  setTraceProcessor(tp: any): void {
    this.traceProcessor = tp;
    this.experts.forEach(expert => {
      if ('setTraceProcessor' in expert) {
        (expert as any).setTraceProcessor(tp);
      }
    });
  }

  setTraceProcessorService(service: any, traceId: string): void {
    this.traceProcessorService = service;
    this.currentTraceId = traceId;
    this.experts.forEach(expert => {
      if ('setTraceProcessorService' in expert) {
        (expert as any).setTraceProcessorService(service, traceId);
      }
    });
  }

  async handleQuery(query: string, traceId: string, options?: OrchestratorOptions): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const trace: OrchestratorTrace = {
      query,
      intent: { primaryGoal: '', aspects: [], expectedOutputType: 'diagnosis', complexity: 'simple' },
      plan: { tasks: [], estimatedDuration: 0, parallelizable: false },
      expertTraces: [],
      synthesisThought: { step: 0, observation: '', reasoning: '', decision: '', confidence: 0 },
      totalDuration: 0,
      totalLLMCalls: 0,
    };

    const streamCallback = options?.streamingCallback;

    try {
      streamCallback?.({ type: 'progress', content: 'Understanding intent...', timestamp: Date.now() });
      const intent = await this.understandIntent(query);
      trace.intent = intent;

      streamCallback?.({ type: 'thought', content: { intent }, timestamp: Date.now() });

      streamCallback?.({ type: 'progress', content: 'Planning analysis...', timestamp: Date.now() });
      const context: AnalysisContext = { traceId };
      const plan = await this.planAnalysis(intent, context);
      trace.plan = plan;

      const expertResults: ExpertResult[] = [];
      const tasks = plan.tasks || [];
      
      for (const task of tasks) {
        streamCallback?.({ type: 'progress', content: `Executing: ${task.objective}`, timestamp: Date.now() });
        
        const expert = this.selectExpert(task);
        if (!expert) {
          continue;
        }

        const taskContext: AnalysisContext = {
          ...context,
          ...task.context,
          previousFindings: expertResults.flatMap(r => r.findings.map(f => f.title)),
        };

        const result = await expert.analyze(taskContext);
        expertResults.push(result);
        trace.expertTraces.push(result.trace);

        for (const finding of result.findings) {
          streamCallback?.({ type: 'finding', content: finding, timestamp: Date.now() });
        }

        if (this.hasEnoughInformation(expertResults, intent)) {
          break;
        }
      }

      streamCallback?.({ type: 'progress', content: 'Synthesizing conclusion...', timestamp: Date.now() });
      const synthesizedAnswer = await this.synthesize(expertResults, intent);

      trace.synthesisThought = {
        step: 1,
        observation: `Analyzed ${expertResults.length} expert results with ${expertResults.reduce((sum, r) => sum + r.findings.length, 0)} findings`,
        reasoning: 'Combining expert insights into a coherent answer',
        decision: 'conclude',
        confidence: this.calculateOverallConfidence(expertResults),
      };

      trace.totalDuration = Date.now() - startTime;

      streamCallback?.({ type: 'conclusion', content: synthesizedAnswer, timestamp: Date.now() });

      const result: OrchestratorResult = {
        intent,
        plan,
        expertResults,
        synthesizedAnswer,
        confidence: this.calculateOverallConfidence(expertResults),
        executionTimeMs: Date.now() - startTime,
        trace,
      };

      if (this.enableTraceRecording) {
        const recorder = getAgentTraceRecorder();
        recorder.record(query, traceId, trace, result.confidence);
      }

      return result;
    } catch (error: any) {
      trace.totalDuration = Date.now() - startTime;
      return {
        intent: trace.intent,
        plan: trace.plan,
        expertResults: [],
        synthesizedAnswer: `Analysis failed: ${error.message}`,
        confidence: 0,
        executionTimeMs: Date.now() - startTime,
        trace,
      };
    }
  }

  async understandIntent(query: string): Promise<Intent> {
    const prompt = `Analyze this user query about Android performance trace analysis:

Query: "${query}"

Determine:
1. What is the primary goal? (e.g., "find why app is slow", "analyze frame drops")
2. What aspects need to be analyzed? (e.g., ["scrolling", "cpu", "memory"])
3. What type of output is expected? (diagnosis, comparison, timeline, or summary)
4. How complex is this query? (simple, moderate, or complex)

Respond in JSON format:
{
  "primaryGoal": "the main objective",
  "aspects": ["aspect1", "aspect2"],
  "expectedOutputType": "diagnosis|comparison|timeline|summary",
  "complexity": "simple|moderate|complex"
}`;

    return this.llm.completeJSON<Intent>(prompt);
  }

  async planAnalysis(intent: Intent, context: AnalysisContext): Promise<AnalysisPlan> {
    const availableExperts = Array.from(this.experts.values())
      .filter(e => e.canHandle(intent))
      .map(e => ({ name: e.config.name, domain: e.config.domain, description: e.config.description }));

    if (availableExperts.length === 0) {
      return { tasks: [], estimatedDuration: 0, parallelizable: false };
    }

    const prompt = `Plan the analysis for this intent:

Intent: ${JSON.stringify(intent)}

Available expert agents:
${availableExperts.map(e => `- ${e.name}: ${e.description}`).join('\n')}

Create an analysis plan with specific tasks. Each task should be assigned to an expert.

Respond in JSON format:
{
  "tasks": [
    {
      "id": "task_1",
      "expertAgent": "ExpertName",
      "objective": "what this task should accomplish",
      "dependencies": [],
      "priority": 1
    }
  ],
  "estimatedDuration": 5000,
  "parallelizable": false
}`;

    const plan = await this.llm.completeJSON<AnalysisPlan>(prompt);
    
    plan.tasks = (plan.tasks || []).map(task => ({
      ...task,
      context: { ...context },
    }));

    return plan;
  }

  selectExpert(task: AnalysisTask): ExpertAgent | undefined {
    const expert = this.experts.get(task.expertAgent);
    if (!expert) {
      return this.experts.values().next().value;
    }
    return expert;
  }

  async synthesize(results: ExpertResult[], intent: Intent): Promise<string> {
    if (results.length === 0) {
      return 'No analysis results available. Please check if the trace contains the expected data.';
    }

    const allFindings = results.flatMap(r => r.findings);
    const allDiagnostics = results.flatMap(r => r.diagnostics);
    const allSuggestions = results.flatMap(r => r.suggestions);

    const prompt = `Synthesize analysis results into a clear, actionable conclusion.

User's Goal: ${intent.primaryGoal}

Findings:
${allFindings.map(f => `- [${f.severity}] ${f.title}: ${f.description}`).join('\n') || 'No significant findings'}

Diagnostics:
${allDiagnostics.filter(d => d.matched).map(d => `- ${d.message}`).join('\n') || 'No issues detected'}

Suggestions:
${allSuggestions.map(s => `- ${s}`).join('\n') || 'No specific suggestions'}

Write a concise summary (2-3 paragraphs) that:
1. Directly addresses the user's goal
2. Highlights the most important findings
3. Provides actionable next steps

Use clear, professional language. Be specific about performance numbers when available.`;

    return this.llm.complete(prompt);
  }

  private hasEnoughInformation(results: ExpertResult[], intent: Intent): boolean {
    const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    if (intent.complexity === 'simple' && totalFindings >= 2 && avgConfidence >= 0.7) {
      return true;
    }
    if (intent.complexity === 'moderate' && totalFindings >= 5 && avgConfidence >= 0.6) {
      return true;
    }
    
    return false;
  }

  private calculateOverallConfidence(results: ExpertResult[]): number {
    if (results.length === 0) return 0;
    return results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  }
}

export function createOrchestrator(llm: LLMClient): PerfettoOrchestratorAgent {
  return new PerfettoOrchestratorAgent(llm);
}
