/**
 * Test Command
 *
 * Tests skill execution against a trace file.
 */

import { Command } from 'commander';
import path from 'path';

// ANSI color codes
const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

/**
 * Test command
 */
export const testCommand = new Command('test')
  .description('Test skill execution against a trace file')
  .argument('<skillId>', 'Skill ID to test')
  .requiredOption('-t, --trace <path>', 'Path to trace file (.perfetto-trace)')
  .option('-p, --package <name>', 'Package name filter')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (skillId: string, options: { trace: string; package?: string; verbose?: boolean }) => {
    console.log(colors.bold('\nSmartPerfetto Skill Tester\n'));

    const tracePath = path.resolve(options.trace);

    console.log(`Skill:   ${colors.cyan(skillId)}`);
    console.log(`Trace:   ${colors.gray(tracePath)}`);
    if (options.package) {
      console.log(`Package: ${colors.gray(options.package)}`);
    }
    console.log('');

    try {
      // Dynamic imports to avoid loading heavy dependencies at CLI startup
      const { skillRegistry, initializeSkills } = await import('../../services/skillEngine/skillLoader');
      const { SkillExecutor } = await import('../../services/skillEngine/skillExecutor');
      const { getTraceProcessorService } = await import('../../services/traceProcessorService');

      // Initialize
      console.log(colors.gray('Initializing skill registry...'));
      await initializeSkills();

      // Check if skill exists
      const skill = skillRegistry.getSkill(skillId);
      if (!skill) {
        console.log(colors.red(`\nSkill not found: ${skillId}`));
        console.log(colors.gray('\nAvailable skills:'));
        const allSkills = skillRegistry.getAllSkills();
        for (const s of allSkills) {
          console.log(`  - ${s.id}`);
        }
        process.exit(1);
      }

      console.log(colors.gray('Loading trace file...'));

      // Create trace processor and load trace
      const traceProcessor = getTraceProcessorService();

      // Load the trace file directly from path
      const traceId = await traceProcessor.loadTraceFromFilePath(tracePath);

      console.log(colors.gray(`Trace loaded with ID: ${traceId}`));

      // Detect vendor
      console.log(colors.gray('Detecting vendor...'));
      const vendorResult = await skillRegistry.detectVendor(traceProcessor, traceId);
      console.log(`Vendor:  ${colors.cyan(vendorResult.vendor)} (${vendorResult.confidence} confidence)`);
      console.log('');

      // Execute skill
      console.log(colors.bold('Executing skill...\n'));
      const startTime = Date.now();

      const executor = new SkillExecutor(traceProcessor);
      const result = await executor.execute(skillId, traceId, options.package, vendorResult.vendor);

      const executionTime = Date.now() - startTime;

      // Display results
      console.log(colors.bold('Results:\n'));

      if (result.success) {
        console.log(`Status: ${colors.green('SUCCESS')}`);
      } else {
        console.log(`Status: ${colors.red('FAILED')}`);
      }

      console.log(`Time:   ${executionTime}ms`);
      console.log('');

      // Display sections
      if (options.verbose) {
        console.log(colors.bold('Sections:'));
        for (const [sectionId, sectionData] of Object.entries(result.sections)) {
          const data = sectionData as { title?: string; rowCount?: number; data?: any[] };
          console.log(`\n  ${colors.cyan(sectionId)}:`);
          console.log(`    Title: ${data.title || 'N/A'}`);
          console.log(`    Rows:  ${data.rowCount || (data.data ? data.data.length : 0)}`);

          if (data.data && data.data.length > 0) {
            console.log('    Sample:');
            const sample = data.data.slice(0, 3);
            for (const row of sample) {
              console.log(`      ${JSON.stringify(row).substring(0, 100)}...`);
            }
          }
        }
        console.log('');
      } else {
        console.log(colors.bold('Sections:'));
        for (const [sectionId, sectionData] of Object.entries(result.sections)) {
          const data = sectionData as { rowCount?: number; data?: any[] };
          const rowCount = data.rowCount || (data.data ? data.data.length : 0);
          console.log(`  ${sectionId}: ${rowCount} rows`);
        }
        console.log('');
      }

      // Display diagnostics
      if (result.diagnostics.length > 0) {
        console.log(colors.bold('Diagnostics:'));
        for (const diag of result.diagnostics) {
          const severityColor =
            diag.severity === 'critical' ? colors.red :
            diag.severity === 'warning' ? colors.yellow :
            colors.blue;
          console.log(`  ${severityColor(`[${diag.severity.toUpperCase()}]`)} ${diag.message}`);
          if (diag.suggestions && diag.suggestions.length > 0) {
            for (const suggestion of diag.suggestions) {
              console.log(`    - ${suggestion}`);
            }
          }
        }
        console.log('');
      }

      // Display summary
      console.log(colors.bold('Summary:'));
      console.log(colors.gray(result.summary));

      // Cleanup
      await traceProcessor.deleteTrace(traceId);

      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.log(colors.red(`\nError: ${error.message}`));
      if (options.verbose) {
        console.log(colors.gray(error.stack));
      }
      process.exit(1);
    }
  });
