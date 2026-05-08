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
});
