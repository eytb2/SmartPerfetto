import { getToolRegistry } from '../toolRegistry';
import { sqlExecutorTool } from './sqlExecutor';
import { frameAnalyzerTool } from './frameAnalyzer';
import { dataStatsTool } from './dataStats';
import { skillInvokerTool } from './skillInvoker';

export function registerCoreTools(): void {
  const registry = getToolRegistry();

  registry.register(sqlExecutorTool);
  registry.register(frameAnalyzerTool);
  registry.register(dataStatsTool);
  registry.register(skillInvokerTool);

  console.log(`[Agent] Registered ${registry.list().length} core tools`);
}

export { sqlExecutorTool } from './sqlExecutor';
export { frameAnalyzerTool } from './frameAnalyzer';
export { dataStatsTool } from './dataStats';
export { skillInvokerTool, getAvailableSkillIds, getSkillIdForSceneType } from './skillInvoker';
