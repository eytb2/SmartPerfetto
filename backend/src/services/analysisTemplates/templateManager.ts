/**
 * 分析模板管理器
 * 根据用户问题自动选择合适的分析模板
 */

import { TraceProcessorService } from '../traceProcessorService';
import { FourQuadrantAnalyzer, FourQuadrantResult } from './fourQuadrantAnalysis';
import { CpuCoreAnalyzer, CpuCoreDistribution } from './cpuCoreAnalysis';
import { FrameStatsAnalyzer, FrameStatsResult } from './frameStatsAnalysis';

export type AnalysisTemplateName =
  | 'four_quadrant'
  | 'cpu_core_distribution'
  | 'frame_stats'
  | 'custom';

export interface AnalysisTemplateResult {
  templateName: AnalysisTemplateName;
  data: FourQuadrantResult | CpuCoreDistribution | FrameStatsResult | any;
  summary: string;
}

export interface TemplateSelectionContext {
  question: string;
  traceId: string;
  metadata?: {
    hasFrameData?: boolean;
    hasSchedData?: boolean;
    processNames?: string[];
  };
}

export class AnalysisTemplateManager {
  private fourQuadrantAnalyzer: FourQuadrantAnalyzer;
  private cpuCoreAnalyzer: CpuCoreAnalyzer;
  private frameStatsAnalyzer: FrameStatsAnalyzer;

  constructor(private traceProcessor: TraceProcessorService) {
    this.fourQuadrantAnalyzer = new FourQuadrantAnalyzer(traceProcessor);
    this.cpuCoreAnalyzer = new CpuCoreAnalyzer(traceProcessor);
    this.frameStatsAnalyzer = new FrameStatsAnalyzer(traceProcessor);
  }

  /**
   * 根据用户问题自动选择并执行分析模板
   */
  async analyzeWithAutoTemplate(
    context: TemplateSelectionContext
  ): Promise<AnalysisTemplateResult | null> {
    const templateName = this.selectTemplate(context.question);

    if (templateName === 'custom') {
      return null; // 需要自定义 SQL
    }

    try {
      const result = await this.executeTemplate(templateName, context);
      return {
        templateName,
        data: result,
        summary: this.generateSummary(templateName, result),
      };
    } catch (error: any) {
      console.error(`Failed to execute template ${templateName}:`, error);
      return null;
    }
  }

  /**
   * 根据问题选择合适的模板
   */
  private selectTemplate(question: string): AnalysisTemplateName {
    const questionLower = question.toLowerCase();

    // 四大象限分析
    if (
      questionLower.includes('四大象限') ||
      questionLower.includes('binder') ||
      questionLower.includes('lock') ||
      questionLower.includes('io') ||
      (questionLower.includes('耗时') && questionLower.includes('分布')) ||
      questionLower.includes('时间占比')
    ) {
      return 'four_quadrant';
    }

    // CPU 核心分布
    if (
      questionLower.includes('cpu') ||
      questionLower.includes('核心') ||
      questionLower.includes('大核') ||
      questionLower.includes('小核') ||
      questionLower.includes('big core') ||
      questionLower.includes('little core')
    ) {
      return 'cpu_core_distribution';
    }

    // 帧率统计
    if (
      questionLower.includes('fps') ||
      questionLower.includes('帧率') ||
      questionLower.includes('掉帧') ||
      questionLower.includes('jank') ||
      questionLower.includes('卡顿') ||
      questionLower.includes('流畅') ||
      questionLower.includes('frame')
    ) {
      return 'frame_stats';
    }

    // 默认返回自定义
    return 'custom';
  }

  /**
   * 执行指定的分析模板
   */
  private async executeTemplate(
    templateName: AnalysisTemplateName,
    context: TemplateSelectionContext
  ): Promise<any> {
    switch (templateName) {
      case 'four_quadrant':
        return await this.executeFourQuadrant(context);

      case 'cpu_core_distribution':
        return await this.executeCpuCoreDistribution(context);

      case 'frame_stats':
        return await this.executeFrameStats(context);

      default:
        throw new Error(`Unknown template: ${templateName}`);
    }
  }

  private async executeFourQuadrant(
    context: TemplateSelectionContext
  ): Promise<FourQuadrantResult> {
    // 从问题中提取参数（简单实现）
    // TODO: 使用 AI 提取更精确的参数
    return await this.fourQuadrantAnalyzer.analyze(context.traceId);
  }

  private async executeCpuCoreDistribution(
    context: TemplateSelectionContext
  ): Promise<CpuCoreDistribution> {
    // 需要找到主线程的 utid
    // 简单实现：查找第一个进程的主线程
    const mainThreadUtid = await this.findMainThread(context.traceId);

    if (!mainThreadUtid) {
      throw new Error('Could not find main thread');
    }

    return await this.cpuCoreAnalyzer.analyze(context.traceId, mainThreadUtid);
  }

  private async executeFrameStats(
    context: TemplateSelectionContext
  ): Promise<FrameStatsResult> {
    // 尝试使用 actual_frame_timeline_slice
    try {
      return await this.frameStatsAnalyzer.analyze(context.traceId);
    } catch (error) {
      // 降级到基于 slice 的分析
      console.warn('Frame timeline not available, falling back to slice-based analysis');

      // 需要找到进程名
      const processName = await this.findMainProcess(context.traceId);
      return await this.frameStatsAnalyzer.analyzeFromSlices(
        context.traceId,
        processName || 'unknown'
      );
    }
  }

  /**
   * 查找主线程 utid
   */
  private async findMainThread(traceId: string): Promise<number | null> {
    try {
      const query = `
        SELECT utid
        FROM thread
        WHERE name = 'main' OR tid = pid
        LIMIT 1
      `;

      const result = await this.traceProcessor.query(traceId, query);
      if (result && result.rows && result.rows.length > 0) {
        return result.rows[0][0] as number;
      }
    } catch (error) {
      console.error('Failed to find main thread:', error);
    }
    return null;
  }

  /**
   * 查找主进程名称
   */
  private async findMainProcess(traceId: string): Promise<string | null> {
    try {
      const query = `
        SELECT name
        FROM process
        WHERE name IS NOT NULL
        ORDER BY upid
        LIMIT 1
      `;

      const result = await this.traceProcessor.query(traceId, query);
      if (result && result.rows && result.rows.length > 0) {
        return result.rows[0][0] as string;
      }
    } catch (error) {
      console.error('Failed to find main process:', error);
    }
    return null;
  }

  /**
   * 生成分析摘要
   */
  private generateSummary(templateName: AnalysisTemplateName, data: any): string {
    switch (templateName) {
      case 'four_quadrant':
        return this.summarizeFourQuadrant(data as FourQuadrantResult);

      case 'cpu_core_distribution':
        return this.summarizeCpuCoreDistribution(data as CpuCoreDistribution);

      case 'frame_stats':
        return this.summarizeFrameStats(data as FrameStatsResult);

      default:
        return 'Analysis completed';
    }
  }

  private summarizeFourQuadrant(result: FourQuadrantResult): string {
    const { summary } = result;
    const sorted = [...summary.breakdown].sort((a, b) => b.durationMs - a.durationMs);
    const top = sorted[0];

    return `总时长 ${summary.totalMs.toFixed(2)}ms，其中 ${this.getCategoryLabel(top.category)} 占比最高（${top.percentage.toFixed(1)}%，${top.durationMs.toFixed(2)}ms）`;
  }

  private summarizeCpuCoreDistribution(result: CpuCoreDistribution): string {
    const { summary } = result;

    return `大核使用 ${summary.bigCorePercentage.toFixed(1)}%（${summary.bigCoreMs.toFixed(2)}ms），小核使用 ${summary.littleCorePercentage.toFixed(1)}%（${summary.littleCoreMs.toFixed(2)}ms）`;
  }

  private summarizeFrameStats(result: FrameStatsResult): string {
    const { summary, percentiles } = result;

    return `平均帧率 ${summary.avgFps.toFixed(1)} FPS，掉帧率 ${summary.jankPercentage.toFixed(1)}%（${summary.jankCount}/${summary.totalFrames} 帧），P95延迟 ${percentiles.p95Ms.toFixed(2)}ms`;
  }

  private getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      binder: 'Binder调用',
      lock: 'Lock等待',
      io: 'IO操作',
      computation: 'CPU计算',
    };
    return labels[category] || category;
  }
}
