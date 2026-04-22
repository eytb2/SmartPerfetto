// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { PrincipleDefinition } from '../contracts/policy';
import { isPrincipleDefinition } from '../contracts/policy';
import { createDefaultPrinciples } from './principleSchema';

export class PrincipleRegistry {
  private principles: Map<string, PrincipleDefinition>;

  constructor(seed: PrincipleDefinition[] = createDefaultPrinciples()) {
    this.principles = new Map();

    for (const principle of seed) {
      this.upsert(principle);
    }
  }

  listAll(): PrincipleDefinition[] {
    return Array.from(this.principles.values()).sort((a, b) => b.priority - a.priority);
  }

  listActive(): PrincipleDefinition[] {
    return this.listAll().filter(principle => principle.status === 'active');
  }

  get(principleId: string): PrincipleDefinition | null {
    return this.principles.get(principleId) || null;
  }

  upsert(principle: unknown): void {
    if (!isPrincipleDefinition(principle)) {
      throw new Error('Invalid principle payload');
    }

    this.principles.set(principle.id, {
      ...principle,
      scope: [...principle.scope],
      conditions: principle.conditions.map(condition => ({
        ...condition,
        value: Array.isArray(condition.value) ? [...condition.value] : condition.value,
      })),
      effects: principle.effects.map(effect => ({ ...effect })),
    });
  }

  remove(principleId: string): boolean {
    return this.principles.delete(principleId);
  }

  clear(): void {
    this.principles.clear();
  }
}
