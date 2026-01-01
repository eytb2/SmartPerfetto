/**
 * Skill Loader v2.0
 *
 * 加载 v2 格式的 skill 文件
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { SkillDefinitionV2 } from './types_v2';

// =============================================================================
// Skill Registry V2
// =============================================================================

class SkillRegistryV2 {
  private skills: Map<string, SkillDefinitionV2> = new Map();
  private initialized = false;

  /**
   * 加载所有 v2 skills
   */
  async loadSkills(skillsDir: string): Promise<void> {
    if (this.initialized) return;

    console.log(`[SkillLoaderV2] Loading skills from: ${skillsDir}`);

    // 加载原子 skills
    const atomicDir = path.join(skillsDir, 'v2', 'atomic');
    if (fs.existsSync(atomicDir)) {
      await this.loadSkillsFromDir(atomicDir);
    }

    // 加载组合 skills
    const compositeDir = path.join(skillsDir, 'v2', 'composite');
    if (fs.existsSync(compositeDir)) {
      await this.loadSkillsFromDir(compositeDir);
    }

    this.initialized = true;
    console.log(`[SkillLoaderV2] Loaded ${this.skills.size} skills`);
  }

  /**
   * 从目录加载 skills
   */
  private async loadSkillsFromDir(dir: string): Promise<void> {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (!file.endsWith('.skill.yaml') && !file.endsWith('.skill.yml')) {
        continue;
      }

      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const skill = yaml.load(content) as SkillDefinitionV2;

        if (skill && skill.name) {
          this.skills.set(skill.name, skill);
          console.log(`[SkillLoaderV2] Loaded skill: ${skill.name} (${skill.type})`);
        }
      } catch (error: any) {
        console.error(`[SkillLoaderV2] Failed to load ${file}:`, error.message);
      }
    }
  }

  /**
   * 获取 skill
   */
  getSkill(name: string): SkillDefinitionV2 | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有 skills
   */
  getAllSkills(): SkillDefinitionV2[] {
    return Array.from(this.skills.values());
  }

  /**
   * 根据关键词匹配 skill
   */
  findMatchingSkill(question: string): SkillDefinitionV2 | undefined {
    const lowerQuestion = question.toLowerCase();

    for (const skill of this.skills.values()) {
      if (!skill.triggers) continue;

      // 检查关键词
      const keywords = skill.triggers.keywords;
      if (keywords) {
        let keywordList: string[] = [];

        if (Array.isArray(keywords)) {
          keywordList = keywords;
        } else {
          keywordList = [
            ...(keywords.zh || []),
            ...(keywords.en || []),
          ];
        }

        for (const keyword of keywordList) {
          if (lowerQuestion.includes(keyword.toLowerCase())) {
            return skill;
          }
        }
      }

      // 检查模式
      if (skill.triggers.patterns) {
        for (const pattern of skill.triggers.patterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(question)) {
              return skill;
            }
          } catch {
            // 无效的正则表达式，跳过
          }
        }
      }
    }

    return undefined;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// 单例
export const skillRegistryV2 = new SkillRegistryV2();

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 确保 skill registry 已初始化
 */
export async function ensureSkillRegistryV2Initialized(): Promise<void> {
  if (skillRegistryV2.isInitialized()) return;

  const skillsDir = path.resolve(__dirname, '../../../skills');
  await skillRegistryV2.loadSkills(skillsDir);
}

/**
 * 获取默认的 skills 目录
 */
export function getSkillsDir(): string {
  return path.resolve(__dirname, '../../../skills');
}
