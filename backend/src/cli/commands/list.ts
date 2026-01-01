/**
 * List Command
 *
 * Lists all available skills with their details.
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';

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

const SKILLS_DIR = path.join(__dirname, '../../../skills');

/**
 * List command
 */
export const listCommand = new Command('list')
  .description('List all available skills')
  .option('-v, --verbose', 'Show detailed information')
  .option('--json', 'Output in JSON format')
  .action(async (options: { verbose?: boolean; json?: boolean }) => {
    try {
      // Dynamic import to avoid loading heavy dependencies
      const { skillRegistry, initializeSkills } = await import('../../services/skillEngine/skillLoader');

      // Initialize
      if (!options.json) {
        console.log(colors.gray('Loading skills...'));
      }
      await initializeSkills();

      const skills = skillRegistry.getAllSkills();

      if (options.json) {
        // JSON output
        const output = skills.map(skill => ({
          id: skill.id,
          name: skill.definition.name,
          version: skill.definition.version,
          displayName: skill.definition.meta.display_name,
          description: skill.definition.meta.description,
          category: skill.definition.category,
          type: skill.definition.type,
          stepsCount: skill.definition.steps?.length ||
            skill.definition.layers?.reduce((sum, l) => sum + l.steps.length, 0) || 0,
          hasVendorOverrides: skill.overrides && skill.overrides.length > 0,
          hasSOP: !!skill.sopContent,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Human-readable output
      console.log(colors.bold('\nSmartPerfetto Skills\n'));
      console.log(`Found ${colors.cyan(String(skills.length))} skills\n`);

      // Group by category
      const byCategory = new Map<string, typeof skills>();
      for (const skill of skills) {
        const category = skill.definition.category || 'other';
        if (!byCategory.has(category)) {
          byCategory.set(category, []);
        }
        byCategory.get(category)!.push(skill);
      }

      // Print by category
      for (const [category, categorySkills] of byCategory.entries()) {
        console.log(colors.bold(`${category.toUpperCase()}:`));

        for (const skill of categorySkills) {
          const def = skill.definition;
          const hasOverrides = skill.overrides && skill.overrides.length > 0;
          const hasSOP = !!skill.sopContent;

          // Skill header
          console.log(`\n  ${colors.cyan(skill.id)}`);
          console.log(`    ${def.meta.display_name} v${def.version}`);
          console.log(`    ${colors.gray(def.meta.description)}`);

          if (options.verbose) {
            // Steps (support both flat and layered structure)
            const allSteps = def.steps || [];
            const layerSteps = def.layers?.flatMap(l => l.steps) || [];
            const steps = allSteps.length > 0 ? allSteps : layerSteps;
            console.log(`    Steps: ${steps.length}${def.layers ? ` (in ${def.layers.length} layers)` : ''}`);
            for (const step of steps) {
              console.log(`      - ${step.id}: ${step.name}`);
            }

            // Keywords
            const triggers = def.triggers;
            const keywords = Array.isArray(triggers.keywords)
              ? triggers.keywords
              : [...(triggers.keywords.zh || []), ...(triggers.keywords.en || [])];
            console.log(`    Keywords: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? '...' : ''}`);

            // Thresholds
            if (def.thresholds) {
              console.log(`    Thresholds: ${Object.keys(def.thresholds).join(', ')}`);
            }

            // Diagnostics
            if (def.diagnostics) {
              console.log(`    Diagnostics: ${def.diagnostics.length}`);
            }
          }

          // Status indicators
          const indicators: string[] = [];
          if (hasOverrides) indicators.push(colors.yellow('vendor-overrides'));
          if (hasSOP) indicators.push(colors.green('sop'));
          if (indicators.length > 0) {
            console.log(`    [${indicators.join('] [')}]`);
          }
        }

        console.log('');
      }

      // Vendor overrides summary
      const vendorsDir = path.join(SKILLS_DIR, 'vendors');
      if (fs.existsSync(vendorsDir)) {
        const vendors = fs.readdirSync(vendorsDir).filter(f =>
          fs.statSync(path.join(vendorsDir, f)).isDirectory()
        );

        if (vendors.length > 0) {
          console.log(colors.bold('Vendor Overrides:'));
          for (const vendor of vendors) {
            const vendorPath = path.join(vendorsDir, vendor);
            const overrideFiles = fs.readdirSync(vendorPath).filter(f => f.endsWith('.override.yaml'));
            if (overrideFiles.length > 0) {
              console.log(`  ${colors.cyan(vendor)}: ${overrideFiles.length} override(s)`);
            }
          }
          console.log('');
        }
      }

      // Custom skills
      const customDir = path.join(SKILLS_DIR, 'custom');
      if (fs.existsSync(customDir)) {
        const customFiles = fs.readdirSync(customDir).filter(f => f.endsWith('.skill.yaml'));
        if (customFiles.length > 0) {
          console.log(colors.bold('Custom Skills:'));
          console.log(`  ${customFiles.length} custom skill(s)`);
          console.log('');
        }
      }

    } catch (error: any) {
      console.log(colors.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });
