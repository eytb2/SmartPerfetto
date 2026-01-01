/**
 * Validate Command
 *
 * Validates skill YAML files for syntax and semantic correctness.
 */

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { SkillDefinition, SkillStep } from '../../services/skillEngine/types';

// ANSI color codes (fallback for chalk ESM issues)
const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SKILLS_DIR = path.join(__dirname, '../../../skills');

/**
 * Validate a skill definition
 */
function validateSkillDefinition(skill: SkillDefinition, filePath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!skill.name) {
    errors.push('Missing required field: name');
  }
  if (!skill.version) {
    errors.push('Missing required field: version');
  }
  if (!skill.meta) {
    errors.push('Missing required field: meta');
  } else {
    if (!skill.meta.display_name) {
      errors.push('Missing required field: meta.display_name');
    }
    if (!skill.meta.description) {
      errors.push('Missing required field: meta.description');
    }
  }
  if (!skill.triggers) {
    errors.push('Missing required field: triggers');
  } else {
    if (!skill.triggers.keywords || (Array.isArray(skill.triggers.keywords) && skill.triggers.keywords.length === 0)) {
      warnings.push('No keywords defined in triggers');
    }
  }
  if (!skill.steps || skill.steps.length === 0) {
    errors.push('Missing required field: steps (at least one step is required)');
  }

  // Validate steps
  if (skill.steps) {
    const stepIds = new Set<string>();
    const savedVariables = new Set<string>();

    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const stepPath = `steps[${i}]`;

      // Required step fields
      if (!step.id) {
        errors.push(`${stepPath}: Missing required field: id`);
      } else {
        if (stepIds.has(step.id)) {
          errors.push(`${stepPath}: Duplicate step id: ${step.id}`);
        }
        stepIds.add(step.id);
      }

      if (!step.name) {
        errors.push(`${stepPath}: Missing required field: name`);
      }

      if (!step.sql) {
        errors.push(`${stepPath}: Missing required field: sql`);
      } else {
        // Validate SQL syntax (basic checks)
        const sqlErrors = validateSql(step.sql, step.id);
        errors.push(...sqlErrors.map(e => `${stepPath}: ${e}`));

        // Validate variable references
        const varRefs = extractVariableReferences(step.sql);
        for (const ref of varRefs) {
          if (ref.startsWith('prev.') || ref.startsWith('item.')) {
            // These are valid context references
            continue;
          }
          if (ref !== 'package' && ref !== 'vendor' && !savedVariables.has(ref.split('.')[0])) {
            warnings.push(`${stepPath}: Variable reference '${ref}' may not be defined`);
          }
        }
      }

      // Track saved variables
      if (step.save_as) {
        savedVariables.add(step.save_as);
      }

      // Validate for_each references
      if (step.for_each && !savedVariables.has(step.for_each)) {
        errors.push(`${stepPath}: for_each references undefined variable: ${step.for_each}`);
      }
    }
  }

  // Validate thresholds
  if (skill.thresholds) {
    for (const [name, threshold] of Object.entries(skill.thresholds)) {
      if (!threshold.levels) {
        warnings.push(`thresholds.${name}: Missing levels definition`);
      }
    }
  }

  // Validate diagnostics
  if (skill.diagnostics) {
    for (let i = 0; i < skill.diagnostics.length; i++) {
      const diag = skill.diagnostics[i];
      if (!diag.id) {
        errors.push(`diagnostics[${i}]: Missing required field: id`);
      }
      if (!diag.condition) {
        errors.push(`diagnostics[${i}]: Missing required field: condition`);
      }
      if (!diag.severity) {
        errors.push(`diagnostics[${i}]: Missing required field: severity`);
      }
      if (!diag.message) {
        errors.push(`diagnostics[${i}]: Missing required field: message`);
      }
    }
  }

  return {
    file: filePath,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Basic SQL validation
 */
function validateSql(sql: string, stepId: string): string[] {
  const errors: string[] = [];

  // Check for common SQL issues
  if (sql.includes('GROUP_CONCAT') && !sql.toLowerCase().includes('group by')) {
    errors.push('GROUP_CONCAT used without GROUP BY clause');
  }

  // Check for unbalanced parentheses
  const openParens = (sql.match(/\(/g) || []).length;
  const closeParens = (sql.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push(`Unbalanced parentheses: ${openParens} open, ${closeParens} close`);
  }

  // Check for unterminated strings
  const singleQuotes = (sql.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    errors.push('Unterminated string literal (odd number of single quotes)');
  }

  return errors;
}

/**
 * Extract variable references from SQL
 */
function extractVariableReferences(sql: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const refs: string[] = [];
  let match;

  while ((match = regex.exec(sql)) !== null) {
    refs.push(match[1]);
  }

  return refs;
}

/**
 * Validate a single skill file
 */
function validateFile(filePath: string): ValidationResult {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const skill = yaml.load(content) as SkillDefinition;

    if (!skill) {
      return {
        file: filePath,
        valid: false,
        errors: ['Failed to parse YAML: empty or invalid content'],
        warnings: [],
      };
    }

    return validateSkillDefinition(skill, filePath);
  } catch (error: any) {
    return {
      file: filePath,
      valid: false,
      errors: [`Failed to parse YAML: ${error.message}`],
      warnings: [],
    };
  }
}

/**
 * Find all skill files
 */
function findSkillFiles(dir: string, pattern: string | RegExp): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findSkillFiles(fullPath, pattern));
    } else if (entry.isFile() && entry.name.match(pattern)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Validate command
 */
export const validateCommand = new Command('validate')
  .description('Validate skill YAML files')
  .argument('[skillId]', 'Specific skill ID to validate (optional)')
  .option('-a, --all', 'Validate all skills including vendor overrides')
  .option('-v, --verbose', 'Show detailed validation output')
  .action((skillId: string | undefined, options: { all?: boolean; verbose?: boolean }) => {
    console.log(colors.bold('\nSmartPerfetto Skill Validator\n'));

    let files: string[] = [];

    if (skillId) {
      // Validate specific skill
      const baseFile = path.join(SKILLS_DIR, 'base', `${skillId}.skill.yaml`);
      if (fs.existsSync(baseFile)) {
        files.push(baseFile);
      } else {
        console.log(colors.red(`Skill not found: ${skillId}`));
        process.exit(1);
      }
    } else {
      // Validate all skills
      files = findSkillFiles(path.join(SKILLS_DIR, 'base'), /\.skill\.ya?ml$/);

      if (options.all) {
        files.push(...findSkillFiles(path.join(SKILLS_DIR, 'vendors'), /\.override\.ya?ml$/));
        files.push(...findSkillFiles(path.join(SKILLS_DIR, 'custom'), /\.skill\.ya?ml$/));
      }
    }

    if (files.length === 0) {
      console.log(colors.yellow('No skill files found.'));
      process.exit(0);
    }

    console.log(`Found ${files.length} skill file(s) to validate.\n`);

    let totalErrors = 0;
    let totalWarnings = 0;
    let validCount = 0;

    for (const file of files) {
      const result = validateFile(file);
      const relativePath = path.relative(SKILLS_DIR, file);

      if (result.valid) {
        console.log(`${colors.green('PASS')} ${relativePath}`);
        validCount++;
      } else {
        console.log(`${colors.red('FAIL')} ${relativePath}`);
      }

      if (options.verbose || result.errors.length > 0) {
        for (const error of result.errors) {
          console.log(`  ${colors.red('ERROR:')} ${error}`);
        }
      }

      if (options.verbose || result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(`  ${colors.yellow('WARNING:')} ${warning}`);
        }
      }

      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;

      if (result.errors.length > 0 || result.warnings.length > 0) {
        console.log('');
      }
    }

    // Summary
    console.log(colors.bold('\nSummary:'));
    console.log(`  Files:    ${files.length}`);
    console.log(`  Passed:   ${colors.green(String(validCount))}`);
    console.log(`  Failed:   ${colors.red(String(files.length - validCount))}`);
    console.log(`  Errors:   ${totalErrors > 0 ? colors.red(String(totalErrors)) : '0'}`);
    console.log(`  Warnings: ${totalWarnings > 0 ? colors.yellow(String(totalWarnings)) : '0'}`);

    process.exit(totalErrors > 0 ? 1 : 0);
  });
