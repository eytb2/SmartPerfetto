// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, expect, it } from '@jest/globals';
import {
  sanitizeDisplayConfigForRuntime,
  validateSkillDisplayContract,
} from '../displayContractValidator';
import type { SkillDefinition } from '../types';

const baseSkill = (overrides: Partial<SkillDefinition> & Record<string, unknown> = {}): SkillDefinition & Record<string, unknown> => ({
  name: 'display_contract_test',
  type: 'composite',
  version: '1.0',
  meta: {
    display_name: 'Display Contract Test',
    description: 'Display contract validator test skill',
  },
  steps: [],
  ...overrides,
});

describe('displayContractValidator', () => {
  it('accepts valid root, output, and step display configs', () => {
    const skill = baseSkill({
      display: {
        layer: 'overview',
        level: 'summary',
        format: 'summary',
      },
      output: {
        display: {
          layer: 'diagnosis',
          level: 'hidden',
          format: 'metric',
        },
      } as any,
      steps: [
        {
          id: 'valid_step',
          type: 'atomic',
          sql: 'select 1',
          display: {
            layer: 'list',
            level: 'detail',
            format: 'table',
            columns: [
              'process_name',
              {
                name: 'duration_ns',
                type: 'duration',
                format: 'duration_ms',
                clickAction: 'navigate_range',
                unit: 'ns',
                width: 'medium',
              },
            ],
            metadataFields: ['process_name'],
          },
        } as any,
      ],
    });

    expect(validateSkillDisplayContract(skill)).toEqual([]);
  });

  it('reports invalid layer, level, and format values', () => {
    const skill = baseSkill({
      display: {
        layer: 'number',
        level: 'list',
        format: 'grid',
      } as any,
      output: {
        display: {
          layer: 'detail',
          level: 'overview',
        },
      } as any,
      steps: [
        {
          id: 'bad_step',
          type: 'atomic',
          sql: 'select 1',
          display: {
            layer: 'duration',
            level: 'frame',
            format: 'cards',
          },
        } as any,
      ],
    });

    const paths = validateSkillDisplayContract(skill).map(issue => issue.path);

    expect(paths).toEqual(expect.arrayContaining([
      'display.layer',
      'display.level',
      'display.format',
      'output.display.layer',
      'output.display.level',
      'steps[0].display.layer',
      'steps[0].display.level',
      'steps[0].display.format',
    ]));
  });

  it('walks nested parallel and conditional steps', () => {
    const skill = baseSkill({
      steps: [
        {
          id: 'parallel_step',
          type: 'parallel',
          steps: [
            {
              id: 'nested_bad',
              type: 'atomic',
              sql: 'select 1',
              display: { layer: 'bytes' },
            },
          ],
        } as any,
        {
          id: 'conditional_step',
          type: 'conditional',
          conditions: [
            {
              if: 'true',
              then: {
                id: 'then_bad',
                type: 'atomic',
                sql: 'select 1',
                display: { level: 'overview' },
              },
            },
          ],
          else: {
            id: 'else_bad',
            type: 'atomic',
            sql: 'select 1',
            display: { format: 'grid' },
          },
        } as any,
      ],
    });

    const issues = validateSkillDisplayContract(skill);

    expect(issues.map(issue => issue.stepId)).toEqual(expect.arrayContaining([
      'nested_bad',
      'then_bad',
      'else_bad',
    ]));
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining([
      'steps[0].steps[0].display.layer',
      'steps[1].conditions[0].then.display.level',
      'steps[1].else.display.format',
    ]));
  });

  it('validates column and metadata field shapes', () => {
    const skill = baseSkill({
      steps: [
        {
          id: 'bad_columns',
          type: 'atomic',
          sql: 'select 1',
          display: {
            columns: [
              '',
              42,
              { label: 'Missing name' },
              {
                name: 'ts',
                type: 'integer',
                format: 'bad_format',
                clickAction: 'jump',
                unit: 'minute',
                width: 'huge',
              },
            ],
            metadataFields: ['ok', 1],
          },
        } as any,
      ],
    });

    const paths = validateSkillDisplayContract(skill).map(issue => issue.path);

    expect(paths).toEqual(expect.arrayContaining([
      'steps[0].display.columns[0]',
      'steps[0].display.columns[1]',
      'steps[0].display.columns[2].name',
      'steps[0].display.columns[3].type',
      'steps[0].display.columns[3].format',
      'steps[0].display.columns[3].clickAction',
      'steps[0].display.columns[3].unit',
      'steps[0].display.columns[3].width',
      'steps[0].display.metadataFields[1]',
    ]));
  });

  it('sanitizes invalid runtime display configs before DataEnvelope conversion', () => {
    const { config, issues } = sanitizeDisplayConfigForRuntime({
      layer: 'number',
      level: 'list',
      format: 'grid',
      columns: [
        'ts',
        '',
        {
          name: 'duration_ns',
          type: 'integer',
          format: 'bad_format',
          clickAction: 'jump',
          unit: 'minute',
          width: 'huge',
        },
        { label: 'Missing name' },
      ],
      metadataFields: ['ts', 7],
    } as any, {
      stepId: 'bad_step',
      defaultLayer: 'list',
      defaultLevel: 'detail',
      defaultFormat: 'table',
    });

    expect(config.layer).toBe('list');
    expect(config.level).toBe('detail');
    expect(config.format).toBe('table');
    expect(config.columns).toEqual([
      { name: 'ts' },
      { name: 'duration_ns' },
    ]);
    expect(config.metadataFields).toEqual(['ts']);
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining([
      'display.layer',
      'display.level',
      'display.format',
      'display.columns[1]',
      'display.columns[2].type',
      'display.columns[2].format',
      'display.columns[2].clickAction',
      'display.columns[2].unit',
      'display.columns[2].width',
      'display.columns[3].name',
      'display.metadataFields[1]',
    ]));
  });
});
