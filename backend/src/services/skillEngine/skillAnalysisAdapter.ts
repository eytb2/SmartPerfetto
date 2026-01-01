/**
 * Skill Analysis Adapter
 *
 * Bridges the gap between the HTTP API and the SkillExecutor.
 * Provides intent detection, skill execution, and result conversion.
 */

import {
  SkillExecutor,
  SkillExecutionResult,
  LoadedSkill,
  VendorDetectionResult,
} from './index';
import { skillRegistry } from './skillLoader';
import { TraceProcessorService } from '../traceProcessorService';
import { PerfettoSqlRequest, PerfettoSqlResponse, PerfettoSkillType } from '../../types/perfettoSql';

// =============================================================================
// Types
// =============================================================================

export interface SkillAnalysisRequest {
  traceId: string;
  skillId?: string;
  question?: string;
  packageName?: string;
}

export interface SkillAnalysisResponse {
  skillId: string;
  skillName: string;
  success: boolean;
  sections: Record<string, any>;
  diagnostics: Array<{
    id: string;
    severity: string;
    message: string;
    suggestions?: string[];
  }>;
  summary: string;
  executionTimeMs: number;
  vendor?: string;
}

export interface SkillListItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category?: string;
  type?: string;
  keywords: string[];
  hasVendorOverrides: boolean;
}

// =============================================================================
// Skill to PerfettoSkillType Mapping
// =============================================================================

const SKILL_TYPE_MAP: Record<string, PerfettoSkillType> = {
  startup_analysis: PerfettoSkillType.STARTUP,
  scrolling_analysis: PerfettoSkillType.SCROLLING,
  navigation_analysis: PerfettoSkillType.NAVIGATION,
  click_response_analysis: PerfettoSkillType.CLICK_RESPONSE,
  memory_analysis: PerfettoSkillType.MEMORY,
  cpu_analysis: PerfettoSkillType.CPU,
  binder_analysis: PerfettoSkillType.BINDER,
  surfaceflinger_analysis: PerfettoSkillType.SURFACE_FLINGER,
};

// =============================================================================
// Skill Analysis Adapter
// =============================================================================

export class SkillAnalysisAdapter {
  private traceProcessor: TraceProcessorService;
  private executor: SkillExecutor;

  constructor(traceProcessor: TraceProcessorService) {
    this.traceProcessor = traceProcessor;
    this.executor = new SkillExecutor(traceProcessor);
  }

  /**
   * Ensure the skill registry is initialized
   */
  async ensureInitialized(): Promise<void> {
    await skillRegistry.initialize();
  }

  /**
   * Detect intent from a natural language question
   * Returns the best matching skill ID or null if no match
   */
  detectIntent(question: string): string | null {
    const matches = skillRegistry.findMatchingSkills(question);

    if (matches.length === 0) {
      return null;
    }

    // Return the first (best) match
    return matches[0].id;
  }

  /**
   * Detect vendor from trace data
   */
  async detectVendor(traceId: string): Promise<VendorDetectionResult> {
    return skillRegistry.detectVendor(this.traceProcessor, traceId);
  }

  /**
   * Execute a skill by ID
   */
  async executeSkill(
    skillId: string,
    traceId: string,
    packageName?: string,
    vendor?: string
  ): Promise<SkillExecutionResult> {
    // Auto-detect vendor if not provided
    let detectedVendor = vendor;
    if (!detectedVendor) {
      const vendorResult = await this.detectVendor(traceId);
      detectedVendor = vendorResult.vendor;
    }

    return this.executor.execute(skillId, traceId, packageName, detectedVendor);
  }

  /**
   * Analyze a trace using the skill system
   * This is the main entry point for skill-based analysis
   */
  async analyze(request: SkillAnalysisRequest): Promise<SkillAnalysisResponse> {
    await this.ensureInitialized();

    const { traceId, skillId, question, packageName } = request;

    // Determine which skill to use
    let targetSkillId = skillId;
    if (!targetSkillId && question) {
      targetSkillId = this.detectIntent(question) || undefined;
    }

    if (!targetSkillId) {
      return {
        skillId: 'unknown',
        skillName: 'Unknown',
        success: false,
        sections: {},
        diagnostics: [{
          id: 'no_skill_match',
          severity: 'warning',
          message: 'No matching skill found for the given question',
          suggestions: [
            'Try using keywords like: startup, scrolling, memory, cpu, binder',
            'Use a specific skill ID with the skillId parameter',
          ],
        }],
        summary: 'Could not determine which skill to use',
        executionTimeMs: 0,
      };
    }

    // Get skill info
    const skill = skillRegistry.getSkill(targetSkillId);
    if (!skill) {
      return {
        skillId: targetSkillId,
        skillName: targetSkillId,
        success: false,
        sections: {},
        diagnostics: [{
          id: 'skill_not_found',
          severity: 'critical',
          message: `Skill not found: ${targetSkillId}`,
        }],
        summary: `Skill not found: ${targetSkillId}`,
        executionTimeMs: 0,
      };
    }

    // Detect vendor
    const vendorResult = await this.detectVendor(traceId);

    // Execute the skill
    const result = await this.executor.execute(
      targetSkillId,
      traceId,
      packageName,
      vendorResult.vendor
    );

    return {
      skillId: targetSkillId,
      skillName: skill.definition.meta.display_name,
      success: result.success,
      sections: result.sections,
      diagnostics: result.diagnostics,
      summary: result.summary,
      executionTimeMs: result.executionTimeMs,
      vendor: vendorResult.vendor !== 'unknown' ? vendorResult.vendor : undefined,
    };
  }

  /**
   * Convert a PerfettoSqlRequest to skill analysis and return PerfettoSqlResponse
   * This provides backward compatibility with existing API
   */
  async analyzeWithLegacyFormat(request: PerfettoSqlRequest): Promise<PerfettoSqlResponse> {
    const skillRequest: SkillAnalysisRequest = {
      traceId: request.traceId,
      question: request.question,
      packageName: request.packageName,
    };

    const result = await this.analyze(skillRequest);

    // Convert to PerfettoSqlResponse format
    const analysisType = SKILL_TYPE_MAP[result.skillId] || result.skillId;

    // Collect all rows from sections
    // Note: Regular steps have { data: [...] }, for_each steps have [{ itemIndex, item, data: [...] }, ...]
    const allRows: any[] = [];
    for (const [sectionId, sectionData] of Object.entries(result.sections)) {
      if (!sectionData) continue;

      if (Array.isArray(sectionData)) {
        // For_each step result: array of {itemIndex, item, data, rowCount}
        for (const itemResult of sectionData) {
          if (itemResult && Array.isArray(itemResult.data)) {
            allRows.push(...itemResult.data);
          }
        }
      } else if (sectionData.data && Array.isArray(sectionData.data)) {
        // Regular step result: {title, data, rowCount, sql}
        allRows.push(...sectionData.data);
      }
    }

    return {
      analysisType,
      sql: '', // Skills use multiple SQLs, not a single one
      rows: allRows,
      rowCount: allRows.length,
      summary: result.summary,
      details: {
        skillId: result.skillId,
        skillName: result.skillName,
        sections: result.sections,
        diagnostics: result.diagnostics,
        vendor: result.vendor,
      },
      error: result.success ? undefined : result.diagnostics[0]?.message,
    };
  }

  /**
   * Get list of all available skills
   */
  async listSkills(): Promise<SkillListItem[]> {
    await this.ensureInitialized();

    const skills = skillRegistry.getAllSkills();

    return skills.map((skill: LoadedSkill) => {
      const triggers = skill.definition.triggers;
      const keywords = Array.isArray(triggers.keywords)
        ? triggers.keywords
        : [...(triggers.keywords.zh || []), ...(triggers.keywords.en || [])];

      return {
        id: skill.id,
        name: skill.definition.name,
        displayName: skill.definition.meta.display_name,
        description: skill.definition.meta.description,
        category: skill.definition.category,
        type: skill.definition.type,
        keywords,
        hasVendorOverrides: skill.overrides && skill.overrides.length > 0,
      };
    });
  }

  /**
   * Get detailed information about a specific skill
   */
  async getSkillDetail(skillId: string): Promise<LoadedSkill | null> {
    await this.ensureInitialized();
    return skillRegistry.getSkill(skillId) || null;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let adapterInstance: SkillAnalysisAdapter | null = null;

export function getSkillAnalysisAdapter(traceProcessor: TraceProcessorService): SkillAnalysisAdapter {
  if (!adapterInstance) {
    adapterInstance = new SkillAnalysisAdapter(traceProcessor);
  }
  return adapterInstance;
}

export function createSkillAnalysisAdapter(traceProcessor: TraceProcessorService): SkillAnalysisAdapter {
  return new SkillAnalysisAdapter(traceProcessor);
}
