/**
 * Skill Engine Type Definitions
 *
 * Types for the configurable skill system that allows experts to define
 * analysis workflows in YAML files.
 */

// =============================================================================
// Skill Definition Types
// =============================================================================

export interface SkillMeta {
  display_name: string;
  description: string;
  icon?: string;
  tags?: string[];
  vendor?: string;
  os?: string;
}

export interface SkillTriggers {
  keywords: {
    zh?: string[];
    en?: string[];
  } | string[];
  patterns?: string[];
}

export interface SkillPrerequisites {
  required_tables?: string[];
  optional_tables?: string[];
  modules?: string[];
}

export interface SkillStep {
  id: string;
  name: string;
  description?: string;
  sql: string;
  required?: boolean;
  optional?: boolean;
  for_each?: string;
  requires?: string[];
  save_as?: string;
  on_empty?: string;
}

export interface ThresholdLevel {
  min?: number;
  max?: number;
  label?: string;
  color?: string;
}

export interface SkillThreshold {
  unit?: string;
  description?: string;
  levels: {
    excellent?: ThresholdLevel;
    good?: ThresholdLevel;
    warning?: ThresholdLevel;
    critical?: ThresholdLevel;
  };
  suggestions?: {
    [level: string]: string;
  };
}

export interface OutputField {
  key: string;
  label: string;
  unit?: string;
  evaluate?: boolean;
}

export interface OutputSection {
  id: string;
  title: string;
  type: 'summary' | 'table' | 'timeline' | 'pie_chart' | 'bar_chart' | 'grouped_table' | 'status';
  from?: string;
  fields: OutputField[];
  limit?: number;
  group_by?: string;
  show_when?: string;
  evaluate?: string;
}

export interface SkillDiagnostic {
  id: string;
  condition: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  suggestions?: string[];
}

export interface SkillReference {
  title: string;
  url: string;
}

export interface SkillLayer {
  id: string;
  name: string;
  description?: string;
  depends_on?: string;
  iterate_over?: string;
  steps: SkillStep[];
}

export interface SkillDefinition {
  name: string;
  version: string;
  type?: string;
  category?: string;
  priority?: string;
  sop_doc?: string;
  analysis_mode?: 'hierarchical' | 'sequential';

  meta: SkillMeta;
  triggers: SkillTriggers;
  prerequisites?: SkillPrerequisites;
  steps?: SkillStep[];  // For flat structure (startup skill)
  layers?: SkillLayer[]; // For hierarchical structure (scrolling skill)
  thresholds?: Record<string, SkillThreshold>;
  output?: {
    title?: string;
    sections: OutputSection[];
  };
  diagnostics?: SkillDiagnostic[];
  references?: SkillReference[];
}

// =============================================================================
// Vendor Override Types
// =============================================================================

export interface VendorSignature {
  pattern: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface VendorOverride {
  extends: string;
  version: string;
  meta: SkillMeta;

  vendor_detection?: {
    signatures: VendorSignature[];
  };

  additional_steps?: SkillStep[];
  thresholds_override?: Record<string, Partial<SkillThreshold>>;
  additional_diagnostics?: SkillDiagnostic[];
  additional_output_sections?: OutputSection[];
}

// =============================================================================
// Runtime Types
// =============================================================================

export interface LoadedSkill {
  id: string;
  definition: SkillDefinition;
  sopContent?: string;
  overrides: VendorOverride[];
  filePath: string;
}

export interface SkillExecutionContext {
  traceId: string;
  packageName?: string;
  vendor?: string;
  variables: Record<string, any>;
  results: Record<string, any>;
}

export interface SkillExecutionResult {
  skillId: string;
  success: boolean;
  sections: Record<string, any>;
  diagnostics: {
    id: string;
    severity: string;
    message: string;
    suggestions?: string[];
  }[];
  summary: string;
  executionTimeMs: number;
}

// =============================================================================
// Vendor Detection
// =============================================================================

export type VendorType = 'oppo' | 'vivo' | 'xiaomi' | 'honor' | 'transsion' | 'mtk' | 'qualcomm' | 'unknown';

export interface VendorDetectionResult {
  vendor: VendorType;
  confidence: 'high' | 'medium' | 'low';
  matchedPatterns: string[];
}
