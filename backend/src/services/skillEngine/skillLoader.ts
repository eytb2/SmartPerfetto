/**
 * Skill Loader
 *
 * Loads skill definitions from YAML files and manages the skill registry.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  SkillDefinition,
  VendorOverride,
  LoadedSkill,
  VendorType,
  VendorDetectionResult,
} from './types';

// =============================================================================
// Constants
// =============================================================================

const SKILLS_DIR = path.join(__dirname, '../../../skills');
const BASE_DIR = path.join(SKILLS_DIR, 'base');
const VENDORS_DIR = path.join(SKILLS_DIR, 'vendors');
const CUSTOM_DIR = path.join(SKILLS_DIR, 'custom');

// =============================================================================
// Skill Registry
// =============================================================================

class SkillRegistry {
  private skills: Map<string, LoadedSkill> = new Map();
  private vendorOverrides: Map<string, Map<VendorType, VendorOverride>> = new Map();
  private initialized = false;

  /**
   * Initialize the skill registry by loading all skills
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[SkillLoader] Initializing skill registry...');
    console.log(`[SkillLoader] Skills directory: ${SKILLS_DIR}`);

    // Check if skills directory exists
    if (!fs.existsSync(SKILLS_DIR)) {
      console.warn(`[SkillLoader] Skills directory not found: ${SKILLS_DIR}`);
      this.initialized = true;
      return;
    }

    // Load base skills
    await this.loadBaseSkills();

    // Load vendor overrides
    await this.loadVendorOverrides();

    // Load custom skills
    await this.loadCustomSkills();

    this.initialized = true;
    console.log(`[SkillLoader] Loaded ${this.skills.size} skills`);
  }

  /**
   * Load base skills from the base directory
   */
  private async loadBaseSkills(): Promise<void> {
    if (!fs.existsSync(BASE_DIR)) {
      console.warn(`[SkillLoader] Base skills directory not found: ${BASE_DIR}`);
      return;
    }

    const files = fs.readdirSync(BASE_DIR);

    for (const file of files) {
      if (file.endsWith('.skill.yaml') || file.endsWith('.skill.yml')) {
        try {
          const filePath = path.join(BASE_DIR, file);
          const skill = await this.loadSkillFile(filePath);

          if (skill) {
            // Try to load corresponding SOP document
            const sopDocPath = skill.definition.sop_doc
              ? path.join(BASE_DIR, skill.definition.sop_doc)
              : null;

            if (sopDocPath && fs.existsSync(sopDocPath)) {
              skill.sopContent = fs.readFileSync(sopDocPath, 'utf-8');
            }

            this.skills.set(skill.id, skill);
            console.log(`[SkillLoader] Loaded base skill: ${skill.id}`);
          }
        } catch (error: any) {
          console.error(`[SkillLoader] Failed to load skill ${file}:`, error.message);
        }
      }
    }
  }

  /**
   * Load vendor overrides
   */
  private async loadVendorOverrides(): Promise<void> {
    if (!fs.existsSync(VENDORS_DIR)) {
      console.warn(`[SkillLoader] Vendors directory not found: ${VENDORS_DIR}`);
      return;
    }

    const vendors = fs.readdirSync(VENDORS_DIR);

    for (const vendor of vendors) {
      const vendorPath = path.join(VENDORS_DIR, vendor);

      if (!fs.statSync(vendorPath).isDirectory()) {
        continue;
      }

      const files = fs.readdirSync(vendorPath);

      for (const file of files) {
        if (file.endsWith('.override.yaml') || file.endsWith('.override.yml')) {
          try {
            const filePath = path.join(vendorPath, file);
            const override = await this.loadOverrideFile(filePath);

            if (override) {
              // Get the base skill name from 'extends' field
              const baseSkillName = override.extends.replace('base/', '');

              if (!this.vendorOverrides.has(baseSkillName)) {
                this.vendorOverrides.set(baseSkillName, new Map());
              }

              this.vendorOverrides.get(baseSkillName)!.set(vendor as VendorType, override);
              console.log(`[SkillLoader] Loaded vendor override: ${vendor}/${file}`);
            }
          } catch (error: any) {
            console.error(`[SkillLoader] Failed to load override ${file}:`, error.message);
          }
        }
      }
    }
  }

  /**
   * Load custom skills
   */
  private async loadCustomSkills(): Promise<void> {
    if (!fs.existsSync(CUSTOM_DIR)) {
      return; // Custom directory is optional
    }

    const files = fs.readdirSync(CUSTOM_DIR);

    for (const file of files) {
      if (file.endsWith('.skill.yaml') || file.endsWith('.skill.yml')) {
        try {
          const filePath = path.join(CUSTOM_DIR, file);
          const skill = await this.loadSkillFile(filePath);

          if (skill) {
            // Prefix custom skills to avoid conflicts
            skill.id = `custom_${skill.id}`;
            this.skills.set(skill.id, skill);
            console.log(`[SkillLoader] Loaded custom skill: ${skill.id}`);
          }
        } catch (error: any) {
          console.error(`[SkillLoader] Failed to load custom skill ${file}:`, error.message);
        }
      }
    }
  }

  /**
   * Load a single skill file
   */
  private async loadSkillFile(filePath: string): Promise<LoadedSkill | null> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const definition = yaml.load(content) as SkillDefinition;

    if (!definition || !definition.name) {
      console.warn(`[SkillLoader] Invalid skill file: ${filePath}`);
      return null;
    }

    return {
      id: definition.name,
      definition,
      overrides: [],
      filePath,
    };
  }

  /**
   * Load a vendor override file
   */
  private async loadOverrideFile(filePath: string): Promise<VendorOverride | null> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const override = yaml.load(content) as VendorOverride;

    if (!override || !override.extends) {
      console.warn(`[SkillLoader] Invalid override file: ${filePath}`);
      return null;
    }

    return override;
  }

  /**
   * Get a skill by ID
   */
  getSkill(skillId: string): LoadedSkill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get vendor override for a skill
   */
  getVendorOverride(skillId: string, vendor: VendorType): VendorOverride | undefined {
    return this.vendorOverrides.get(skillId)?.get(vendor);
  }

  /**
   * Find skills matching a query
   */
  findMatchingSkills(query: string): LoadedSkill[] {
    const matches: LoadedSkill[] = [];
    const queryLower = query.toLowerCase();

    for (const skill of this.skills.values()) {
      const triggers = skill.definition.triggers;

      // Check keywords
      const keywords = Array.isArray(triggers.keywords)
        ? triggers.keywords
        : [...(triggers.keywords.zh || []), ...(triggers.keywords.en || [])];

      for (const keyword of keywords) {
        if (queryLower.includes(keyword.toLowerCase())) {
          matches.push(skill);
          break;
        }
      }

      // Check patterns
      if (triggers.patterns && !matches.includes(skill)) {
        for (const pattern of triggers.patterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(query)) {
              matches.push(skill);
              break;
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }
    }

    return matches;
  }

  /**
   * Detect vendor from trace content
   */
  async detectVendor(traceProcessor: any, traceId: string): Promise<VendorDetectionResult> {
    const vendorPatterns: Record<VendorType, string[]> = {
      oppo: ['ColorOS', 'OPPO', 'HyperBoost', 'oplus'],
      vivo: ['OriginOS', 'vivo', 'Jovi', 'funtouch'],
      xiaomi: ['MIUI', 'miui', 'xiaomi', 'Xiaomi', 'HyperOS'],
      honor: ['MagicOS', 'honor', 'Honor', 'TurboX'],
      transsion: ['Transsion', 'TECNO', 'Infinix', 'itel'],
      mtk: ['MTK', 'MediaTek', 'MTKFB'],
      qualcomm: ['QTI', 'Qualcomm', 'Adreno', 'Snapdragon'],
      unknown: [],
    };

    const matchedPatterns: string[] = [];
    let detectedVendor: VendorType = 'unknown';
    let confidence: 'high' | 'medium' | 'low' = 'low';

    try {
      // Query for vendor-specific slices
      const sql = `
        SELECT DISTINCT name
        FROM slice
        WHERE name GLOB '*ColorOS*'
           OR name GLOB '*OPPO*'
           OR name GLOB '*oplus*'
           OR name GLOB '*OriginOS*'
           OR name GLOB '*vivo*'
           OR name GLOB '*MIUI*'
           OR name GLOB '*xiaomi*'
           OR name GLOB '*MagicOS*'
           OR name GLOB '*honor*'
           OR name GLOB '*MTK*'
           OR name GLOB '*QTI*'
        LIMIT 20
      `;

      const result = await traceProcessor.query(traceId, sql);

      if (result.rows && result.rows.length > 0) {
        for (const row of result.rows) {
          const sliceName = row[0] as string;

          for (const [vendor, patterns] of Object.entries(vendorPatterns)) {
            for (const pattern of patterns) {
              if (sliceName.includes(pattern)) {
                matchedPatterns.push(sliceName);

                if (detectedVendor === 'unknown') {
                  detectedVendor = vendor as VendorType;
                }
              }
            }
          }
        }

        // Determine confidence based on number of matches
        if (matchedPatterns.length >= 5) {
          confidence = 'high';
        } else if (matchedPatterns.length >= 2) {
          confidence = 'medium';
        }
      }
    } catch (error: any) {
      console.error('[SkillLoader] Vendor detection failed:', error.message);
    }

    return {
      vendor: detectedVendor,
      confidence,
      matchedPatterns,
    };
  }

  /**
   * Reload all skills (useful for development)
   */
  async reload(): Promise<void> {
    this.skills.clear();
    this.vendorOverrides.clear();
    this.initialized = false;
    await this.initialize();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const skillRegistry = new SkillRegistry();

/**
 * Initialize the skill registry
 */
export async function initializeSkills(): Promise<void> {
  await skillRegistry.initialize();
}

/**
 * Get the skill registry instance
 */
export function getSkillRegistry(): SkillRegistry {
  return skillRegistry;
}
