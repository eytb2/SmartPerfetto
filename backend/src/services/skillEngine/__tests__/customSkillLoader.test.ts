// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { SkillRegistry } from '../skillLoader';

describe('custom skill loading', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-custom-skills-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads skills from the custom directory after admin writes', async () => {
    const customDir = path.join(tmpDir, 'custom');
    await fs.mkdir(customDir, { recursive: true });
    await fs.writeFile(
      path.join(customDir, 'workspace_jank.skill.yaml'),
      [
        'name: workspace_jank',
        'version: "1"',
        'meta:',
        '  display_name: Workspace Jank',
        '  description: Local custom skill',
        'steps:',
        '  - id: rows',
        '    type: atomic',
        '    sql: SELECT 1 AS value',
        '',
      ].join('\n'),
      'utf-8',
    );

    const registry = new SkillRegistry();
    await registry.loadSkills(tmpDir);

    expect(registry.getSkill('workspace_jank')).toMatchObject({
      name: 'workspace_jank',
      version: '1',
      meta: {
        display_name: 'Workspace Jank',
      },
    });
  });

  it('loads comparison skills from the comparison directory', async () => {
    const comparisonDir = path.join(tmpDir, 'comparison');
    await fs.mkdir(comparisonDir, { recursive: true });
    await fs.writeFile(
      path.join(comparisonDir, 'multi_trace_result_comparison.skill.yaml'),
      [
        'name: multi_trace_result_comparison',
        'version: "1"',
        'type: comparison',
        'meta:',
        '  display_name: Multi Trace Result Comparison',
        '  description: Compares persisted analysis results',
        'source: analysis_result_snapshot',
        'comparison:',
        '  source: analysis_result_snapshot',
        '  operation: build_comparison_matrix',
        '  output_contract: ComparisonMatrix',
        '',
      ].join('\n'),
      'utf-8',
    );

    const registry = new SkillRegistry();
    await registry.loadSkills(tmpDir);

    expect(registry.getSkill('multi_trace_result_comparison')).toMatchObject({
      name: 'multi_trace_result_comparison',
      type: 'comparison',
      source: 'analysis_result_snapshot',
      comparison: {
        operation: 'build_comparison_matrix',
        output_contract: 'ComparisonMatrix',
      },
    });
  });

  it('records display contract issues from vendor override additional steps', async () => {
    const vendorDir = path.join(tmpDir, 'vendors', 'xiaomi');
    await fs.mkdir(vendorDir, { recursive: true });
    await fs.writeFile(
      path.join(vendorDir, 'startup.override.yaml'),
      [
        'extends: composite/startup_analysis',
        'version: "1"',
        'meta:',
        '  vendor: xiaomi',
        '  display_name: Xiaomi Startup Override',
        '  description: Vendor-specific startup checks',
        'vendor_detection:',
        '  signatures:',
        '    - pattern: Xiaomi',
        '      confidence: high',
        'additional_steps:',
        '  - id: vendor_rows',
        '    name: Vendor Rows',
        '    type: atomic',
        '    sql: SELECT 1 AS value',
        '    display:',
        '      layer: duration',
        '      level: list',
        '',
      ].join('\n'),
      'utf-8',
    );

    const registry = new SkillRegistry();
    await registry.loadSkills(tmpDir);

    const issues = registry.getDisplayContractIssues();
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'startup_analysis@xiaomi:startup.override',
          stepId: 'vendor_rows',
          path: 'steps[0].display.layer',
          value: 'duration',
        }),
        expect.objectContaining({
          skillName: 'startup_analysis@xiaomi:startup.override',
          stepId: 'vendor_rows',
          path: 'steps[0].display.level',
          value: 'list',
        }),
      ]),
    );
  });

  it('validates programmatically upserted skills and deduplicates repeated issues', () => {
    const registry = new SkillRegistry();
    const generatedSkill = {
      name: 'generated_display_bad',
      version: '1',
      meta: {
        display_name: 'Generated Display Bad',
        description: 'Generated runtime skill',
      },
      steps: [
        {
          id: 'rows',
          type: 'atomic',
          sql: 'SELECT 1 AS value',
          display: {
            layer: 'bytes',
          },
        },
      ],
    } as any;

    registry.upsertSkill(generatedSkill);
    registry.upsertSkill(generatedSkill);

    const issues = registry.getDisplayContractIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      skillName: 'generated_display_bad',
      stepId: 'rows',
      path: 'steps[0].display.layer',
      value: 'bytes',
    });
  });
});
