/**
 * Strategy Registry
 *
 * Manages the collection of available analysis strategies and provides
 * query-based matching to select the appropriate strategy.
 */

import { StagedAnalysisStrategy } from './types';
import { scrollingStrategy } from './scrollingStrategy';
import { sceneReconstructionQuickStrategy, sceneReconstructionStrategy } from './sceneReconstructionStrategy';

/**
 * Registry that holds all available staged analysis strategies.
 * Strategies are matched against user queries in registration order.
 */
export class StrategyRegistry {
  private strategies: StagedAnalysisStrategy[] = [];

  /**
   * Register a new strategy. Strategies are matched in registration order,
   * so register more specific strategies before general ones.
   */
  register(strategy: StagedAnalysisStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Find the first strategy whose trigger matches the given query.
   * Returns null if no strategy matches (analysis falls through to generic path).
   */
  match(query: string): StagedAnalysisStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.trigger(query)) {
        return strategy;
      }
    }
    return null;
  }

  /** Get all registered strategies (for debugging/introspection) */
  getAll(): StagedAnalysisStrategy[] {
    return [...this.strategies];
  }
}

/**
 * Create a pre-configured strategy registry with all built-in strategies.
 */
export function createStrategyRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();
  // Register strategies in order of specificity (more specific first)
  registry.register(scrollingStrategy);
  registry.register(sceneReconstructionQuickStrategy);
  // Scene reconstruction is a catch-all for overview queries
  registry.register(sceneReconstructionStrategy);
  return registry;
}
