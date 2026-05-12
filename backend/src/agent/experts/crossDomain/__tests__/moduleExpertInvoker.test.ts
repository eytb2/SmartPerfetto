// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {ModuleExpertInvoker} from '../moduleExpertInvoker';
import {layeredResultToEnvelopes} from '../../../../types/dataContract';

describe('ModuleExpertInvoker display layers', () => {
  it('preserves diagnosis display results when building layered output', () => {
    const invoker = Object.create(ModuleExpertInvoker.prototype) as any;

    const layered = invoker.buildLayeredSkillResult(
      'module_skill',
      'Module Skill',
      [
        {
          stepId: 'root_cause',
          title: 'Root Cause',
          level: 'detail',
          layer: 'diagnosis',
          format: 'table',
          data: {
            columns: ['cause'],
            rows: [['main thread blocked']],
          },
        },
      ],
      [],
      12,
    );

    expect(layered.layers.diagnosis?.root_cause).toMatchObject({
      stepId: 'root_cause',
      layer: 'diagnosis',
    });

    const envelopes = layeredResultToEnvelopes(layered);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].display.layer).toBe('diagnosis');
    expect(envelopes[0].display.level).toBe('detail');
  });
});
