/**
 * Skill Executor
 *
 * Executes skill definitions against trace data.
 */

import {
  SkillDefinition,
  SkillStep,
  SkillLayer,
  SkillExecutionContext,
  SkillExecutionResult,
  VendorOverride,
  LoadedSkill,
} from './types';
import { skillRegistry } from './skillLoader';

// =============================================================================
// Variable Substitution
// =============================================================================

/**
 * Substitute variables in SQL query
 */
function substituteVariables(sql: string, context: SkillExecutionContext): string {
  let result = sql;

  // Substitute ${package} - use '*' wildcard if not provided (matches all packages)
  if (context.packageName) {
    result = result.replace(/\$\{package\}/g, context.packageName);
  } else {
    // No package specified - replace with wildcard to match all
    // This makes "WHERE package GLOB '${package}*'" become "WHERE package GLOB '*'"
    result = result.replace(/\$\{package\}/g, '');
  }

  // Substitute ${vendor}
  if (context.vendor) {
    result = result.replace(/\$\{vendor\}/g, context.vendor);
  }

  // Substitute ${item.xxx} for for_each loops
  if (context.variables.item) {
    const item = context.variables.item;
    result = result.replace(/\$\{item\.(\w+)\}/g, (match, key) => {
      return item[key] !== undefined ? String(item[key]) : match;
    });

    // Also substitute direct references like ${session_start_ts} from item
    // This supports scrolling.skill.yaml style: ${session_start_ts} instead of ${item.session_start_ts}
    for (const [key, value] of Object.entries(item)) {
      if (value !== undefined && value !== null) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
      }
    }
  }

  // Substitute ${prev.xxx} for previous step results
  if (context.variables.prev) {
    const prev = context.variables.prev;
    result = result.replace(/\$\{prev\.(\w+)\}/g, (match, key) => {
      return prev[key] !== undefined ? String(prev[key]) : match;
    });
  }

  // Substitute saved results ${stepId.xxx}
  // Regular step result: { title, data: [...], rowCount, sql }
  // For_each step result: [{ itemIndex, item, data: [...], rowCount }, ...]
  for (const [stepId, stepResult] of Object.entries(context.results)) {
    if (typeof stepResult === 'object' && stepResult !== null) {
      let firstRow: any = null;

      if (Array.isArray(stepResult)) {
        // For_each result - get first row from current item or first item
        const currentItemIndex = context.variables.item?.startup_id !== undefined
          ? stepResult.findIndex(r => r.item?.startup_id === context.variables.item?.startup_id)
          : 0;
        const itemResult = stepResult[currentItemIndex >= 0 ? currentItemIndex : 0];
        firstRow = itemResult?.data?.[0];
      } else {
        // Regular step result
        firstRow = stepResult.data?.[0];
      }

      if (firstRow && typeof firstRow === 'object') {
        result = result.replace(new RegExp(`\\$\\{${stepId}\\.(\\w+)\\}`, 'g'), (match, key) => {
          return firstRow[key] !== undefined ? String(firstRow[key]) : match;
        });
      }
    }
  }

  // Substitute saved variables from save_as ${varName.xxx}
  // These are stored in context.variables and can be:
  // - For regular steps: array of row objects
  // - For for_each steps: array of first rows from each iteration
  for (const [varName, varValue] of Object.entries(context.variables)) {
    // Skip special variables like 'item', 'prev'
    if (varName === 'item' || varName === 'prev') continue;

    if (Array.isArray(varValue) && varValue.length > 0) {
      let targetRow: any = null;

      // For for_each context, try to find matching item by startup_id or use first
      if (context.variables.item?.startup_id !== undefined) {
        // Find the row that matches current item's startup_id
        targetRow = varValue.find(row =>
          row && typeof row === 'object' && row.startup_id === context.variables.item?.startup_id
        );
      }

      // Fallback to first row
      if (!targetRow && varValue[0] && typeof varValue[0] === 'object') {
        targetRow = varValue[0];
      }

      if (targetRow) {
        result = result.replace(new RegExp(`\\$\\{${varName}\\.(\\w+)\\}`, 'g'), (match, key) => {
          return targetRow[key] !== undefined ? String(targetRow[key]) : match;
        });

        // Also substitute direct column references like ${vsync_period_ns}
        // This supports scrolling.skill.yaml style where refresh_rate step saves
        // variables that are referenced directly as ${vsync_period_ns}
        for (const [colName, colValue] of Object.entries(targetRow)) {
          if (colValue !== undefined && colValue !== null) {
            result = result.replace(new RegExp(`\\$\\{${colName}\\}`, 'g'), String(colValue));
          }
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Skill Executor
// =============================================================================

export class SkillExecutor {
  private traceProcessor: any;

  constructor(traceProcessor: any) {
    this.traceProcessor = traceProcessor;
  }

  /**
   * Execute a skill against trace data
   */
  async execute(
    skillId: string,
    traceId: string,
    packageName?: string,
    vendor?: string
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    // Get the skill
    const skill = skillRegistry.getSkill(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        sections: {},
        diagnostics: [{
          id: 'skill_not_found',
          severity: 'critical',
          message: `Skill not found: ${skillId}`,
        }],
        summary: `Skill not found: ${skillId}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Get vendor override if applicable
    let definition = skill.definition;
    if (vendor && vendor !== 'unknown') {
      const override = skillRegistry.getVendorOverride(skillId, vendor as any);
      if (override) {
        definition = this.mergeOverride(definition, override);
        console.log(`[SkillExecutor] Applied vendor override: ${vendor}`);
      }
    }

    // Create execution context
    const context: SkillExecutionContext = {
      traceId,
      packageName,
      vendor,
      variables: {},
      results: {},
    };

    const sections: Record<string, any> = {};
    const diagnostics: any[] = [];

    try {
      // Load required modules
      if (definition.prerequisites?.modules) {
        for (const module of definition.prerequisites.modules) {
          try {
            await this.traceProcessor.query(traceId, `INCLUDE PERFETTO MODULE ${module};`);
            console.log(`[SkillExecutor] Loaded module: ${module}`);
          } catch (e: any) {
            console.warn(`[SkillExecutor] Module not available: ${module}`);
          }
        }
      }

      // Collect all steps to execute
      // Support both flat structure (steps) and hierarchical structure (layers)
      const allSteps = this.collectAllSteps(definition, context);
      console.log(`[SkillExecutor] Total steps to execute: ${allSteps.length}`);

      for (const step of allSteps) {
        console.log(`[SkillExecutor] ========== Starting step: ${step.id} (for_each: ${step.for_each || 'none'}) ==========`);
        try {
          const stepResult = await this.executeStep(step, context);

          if (stepResult) {
            const resultInfo = Array.isArray(stepResult)
              ? `for_each result with ${stepResult.length} items`
              : `regular result with ${stepResult.data?.length || 0} rows`;
            console.log(`[SkillExecutor] Step ${step.id} completed: ${resultInfo}`);
            sections[step.id] = stepResult;
            context.results[step.id] = stepResult;

            // Save as variable if specified
            if (step.save_as) {
              // For for_each steps, stepResult is an array of {itemIndex, item, data, rowCount}
              // For regular steps, stepResult is {title, data, rowCount, sql}
              if (Array.isArray(stepResult)) {
                // For for_each: save array of first rows from each iteration
                // IMPORTANT: Merge the original item data (contains startup_id, etc.) with query result
                // This allows subsequent steps with requires: [...] to match by startup_id
                const savedData = stepResult
                  .filter(r => r.data && r.data.length > 0)
                  .map(r => ({
                    ...r.item,      // Original item data (e.g., startup_id, package, ts)
                    ...r.data[0],   // Query result data (e.g., utid, tid)
                  }));
                context.variables[step.save_as] = savedData;
                console.log(`[SkillExecutor] Saved ${step.save_as}: ${JSON.stringify(savedData).substring(0, 200)}`);
              } else {
                context.variables[step.save_as] = stepResult.data;
                console.log(`[SkillExecutor] Saved ${step.save_as}: ${JSON.stringify(stepResult.data).substring(0, 200)}`);
              }
            }
          } else {
            console.log(`[SkillExecutor] Step ${step.id} returned no data (null or empty)`);
            if (step.required) {
              // Required step returned no data
              diagnostics.push({
                id: `${step.id}_no_data`,
                severity: 'warning',
                message: step.on_empty || `Step "${step.name}" returned no data`,
              });
            }
          }
        } catch (stepError: any) {
          console.error(`[SkillExecutor] Step ${step.id} failed:`, stepError.message);

          if (step.required) {
            diagnostics.push({
              id: `${step.id}_failed`,
              severity: 'critical',
              message: `Step "${step.name}" failed: ${stepError.message}`,
            });
          }
        }
      }

      // Run diagnostics
      if (definition.diagnostics) {
        for (const diagnostic of definition.diagnostics) {
          const triggered = this.evaluateDiagnostic(diagnostic, context);
          if (triggered) {
            diagnostics.push({
              id: diagnostic.id,
              severity: diagnostic.severity,
              message: this.substituteMessage(diagnostic.message, context),
              suggestions: diagnostic.suggestions,
            });
          }
        }
      }

      // Generate summary
      const summary = this.generateSummary(definition, sections, diagnostics);

      // Log final sections
      console.log(`[SkillExecutor] ========== Skill execution complete ==========`);
      console.log(`[SkillExecutor] Total sections: ${Object.keys(sections).length}`);
      for (const [sectionId, sectionData] of Object.entries(sections)) {
        if (Array.isArray(sectionData)) {
          console.log(`[SkillExecutor] Section ${sectionId}: for_each with ${sectionData.length} items`);
        } else if (sectionData && (sectionData as any).data) {
          console.log(`[SkillExecutor] Section ${sectionId}: ${(sectionData as any).data?.length || 0} rows`);
        } else {
          console.log(`[SkillExecutor] Section ${sectionId}: no data`);
        }
      }

      return {
        skillId,
        success: true,
        sections,
        diagnostics,
        summary,
        executionTimeMs: Date.now() - startTime,
      };

    } catch (error: any) {
      console.error(`[SkillExecutor] Skill execution failed:`, error.message);

      return {
        skillId,
        success: false,
        sections,
        diagnostics: [{
          id: 'execution_failed',
          severity: 'critical',
          message: `Skill execution failed: ${error.message}`,
        }],
        summary: `Skill execution failed: ${error.message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: SkillStep,
    context: SkillExecutionContext
  ): Promise<any> {
    // Check if this is a for_each step
    if (step.for_each) {
      return this.executeForEachStep(step, context);
    }

    // Substitute variables in SQL
    const sql = substituteVariables(step.sql, context);
    console.log(`[SkillExecutor] Executing step ${step.id}`);
    console.log(`[SkillExecutor] SQL (first 300 chars):`, sql.replace(/\s+/g, ' ').substring(0, 300));

    // Execute query
    const result = await this.traceProcessor.query(context.traceId, sql);

    if (result.error) {
      if (step.optional) {
        console.log(`[SkillExecutor] Optional step ${step.id} failed:`, result.error);
        return null;
      }
      throw new Error(result.error);
    }

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    // Convert rows to objects
    const data = this.rowsToObjects(result.columns, result.rows);

    return {
      title: step.name,
      data,
      rowCount: data.length,
      sql,
    };
  }

  /**
   * Execute a for_each step
   */
  private async executeForEachStep(
    step: SkillStep,
    context: SkillExecutionContext
  ): Promise<any[]> {
    const iterableKey = step.for_each!;

    // Debug: Log all available variables and results
    console.log(`[SkillExecutor] for_each lookup for "${iterableKey}":`);
    console.log(`[SkillExecutor]   Available variables: ${Object.keys(context.variables).join(', ') || 'none'}`);
    console.log(`[SkillExecutor]   Available results: ${Object.keys(context.results).join(', ') || 'none'}`);

    const iterable = context.variables[iterableKey] || context.results[iterableKey]?.data;

    if (!iterable || !Array.isArray(iterable)) {
      console.warn(`[SkillExecutor] for_each target not found: ${iterableKey}`);
      console.warn(`[SkillExecutor]   context.variables["${iterableKey}"]:`, context.variables[iterableKey]);
      console.warn(`[SkillExecutor]   context.results["${iterableKey}"]:`, context.results[iterableKey]);
      return [];
    }

    console.log(`[SkillExecutor] Found ${iterable.length} items to iterate over`);

    const results: any[] = [];

    for (let i = 0; i < iterable.length; i++) {
      const item = iterable[i];

      // Set item in context
      context.variables.item = item;

      // Substitute variables in SQL
      const sql = substituteVariables(step.sql, context);
      console.log(`[SkillExecutor] Executing step ${step.id} for item ${i + 1}/${iterable.length}`);
      console.log(`[SkillExecutor] Item data:`, JSON.stringify(item).substring(0, 200));
      console.log(`[SkillExecutor] SQL (first 300 chars):`, sql.replace(/\s+/g, ' ').substring(0, 300));

      try {
        const result = await this.traceProcessor.query(context.traceId, sql);

        if (result.error) {
          console.log(`[SkillExecutor] Step ${step.id} query error:`, result.error);
        } else if (!result.rows || result.rows.length === 0) {
          console.log(`[SkillExecutor] Step ${step.id} returned 0 rows`);
        } else {
          console.log(`[SkillExecutor] Step ${step.id} returned ${result.rows.length} rows`);
        }

        if (!result.error && result.rows && result.rows.length > 0) {
          const data = this.rowsToObjects(result.columns, result.rows);
          results.push({
            itemIndex: i,
            item,
            data,
            rowCount: data.length,
          });
        }
      } catch (e: any) {
        if (!step.optional) {
          console.error(`[SkillExecutor] for_each step ${step.id} failed for item ${i}:`, e.message);
        }
      }
    }

    // Clear item from context
    delete context.variables.item;

    return results;
  }

  /**
   * Merge vendor override into skill definition
   */
  private mergeOverride(base: SkillDefinition, override: VendorOverride): SkillDefinition {
    const merged = { ...base };

    // Merge meta
    merged.meta = { ...base.meta, ...override.meta };

    // Add additional steps
    if (override.additional_steps) {
      merged.steps = [...(base.steps || []), ...override.additional_steps];
    }

    // Merge thresholds
    if (override.thresholds_override && base.thresholds) {
      merged.thresholds = { ...base.thresholds };
      for (const [key, value] of Object.entries(override.thresholds_override)) {
        if (merged.thresholds[key]) {
          merged.thresholds[key] = {
            ...merged.thresholds[key],
            ...value,
            levels: {
              ...merged.thresholds[key].levels,
              ...(value.levels || {}),
            },
          };
        }
      }
    }

    // Add additional diagnostics
    if (override.additional_diagnostics) {
      merged.diagnostics = [...(base.diagnostics || []), ...override.additional_diagnostics];
    }

    // Add additional output sections
    if (override.additional_output_sections && merged.output) {
      merged.output.sections = [...merged.output.sections, ...override.additional_output_sections];
    }

    return merged;
  }

  /**
   * Evaluate a diagnostic condition
   */
  private evaluateDiagnostic(diagnostic: any, context: SkillExecutionContext): boolean {
    // TODO: Implement condition evaluation
    // For now, return false (no diagnostics triggered)
    return false;
  }

  /**
   * Substitute variables in message string
   */
  private substituteMessage(message: string, context: SkillExecutionContext): string {
    // Simple variable substitution
    return message.replace(/\$\{(\w+)\}/g, (match, key) => {
      return context.variables[key] !== undefined ? String(context.variables[key]) : match;
    });
  }

  /**
   * Generate summary from results
   */
  private generateSummary(
    definition: SkillDefinition,
    sections: Record<string, any>,
    diagnostics: any[]
  ): string {
    const lines: string[] = [];

    lines.push(`=== ${definition.meta.display_name} ===\n`);

    // Add section summaries
    for (const [sectionId, section] of Object.entries(sections)) {
      if (section && section.title) {
        lines.push(`【${section.title}】`);

        if (Array.isArray(section.data)) {
          lines.push(`  共 ${section.data.length} 条数据`);
        } else if (Array.isArray(section)) {
          // for_each results
          lines.push(`  共 ${section.length} 组数据`);
        }

        lines.push('');
      }
    }

    // Add diagnostics
    if (diagnostics.length > 0) {
      lines.push('【诊断结果】');
      for (const diag of diagnostics) {
        const icon = diag.severity === 'critical' ? '❌' :
                    diag.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`  ${icon} ${diag.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Convert row arrays to objects
   */
  private rowsToObjects(columns: string[], rows: any[][]): Record<string, any>[] {
    return rows.map(row => {
      const obj: Record<string, any> = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
  }

  /**
   * Collect all steps from definition
   * Supports both flat structure (steps) and hierarchical structure (layers)
   */
  private collectAllSteps(definition: SkillDefinition, context: SkillExecutionContext): SkillStep[] {
    // If definition has flat steps, return them directly
    if (definition.steps && definition.steps.length > 0) {
      console.log(`[SkillExecutor] Using flat steps structure, ${definition.steps.length} steps`);
      return definition.steps;
    }

    // If definition has layers, collect steps from all layers
    if (definition.layers && definition.layers.length > 0) {
      console.log(`[SkillExecutor] Using hierarchical layers structure, ${definition.layers.length} layers`);
      const allSteps: SkillStep[] = [];

      for (const layer of definition.layers) {
        console.log(`[SkillExecutor] Processing layer: ${layer.id} (${layer.name})`);

        // Check if layer depends on previous data
        if (layer.depends_on) {
          const dependencyData = context.variables[layer.depends_on] || context.results[layer.depends_on];
          if (!dependencyData) {
            console.log(`[SkillExecutor] Skipping layer ${layer.id}: dependency ${layer.depends_on} not found`);
            continue;
          }
        }

        // If layer has iterate_over, set for_each on all steps
        if (layer.iterate_over) {
          for (const step of layer.steps) {
            // Clone the step and set for_each
            const iteratedStep: SkillStep = {
              ...step,
              for_each: step.for_each || layer.iterate_over,
            };
            allSteps.push(iteratedStep);
          }
        } else {
          // Add steps directly
          allSteps.push(...layer.steps);
        }
      }

      console.log(`[SkillExecutor] Collected ${allSteps.length} steps from layers`);
      return allSteps;
    }

    console.warn(`[SkillExecutor] No steps or layers found in skill definition`);
    return [];
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSkillExecutor(traceProcessor: any): SkillExecutor {
  return new SkillExecutor(traceProcessor);
}
