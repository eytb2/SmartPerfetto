// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {describe, it, expect} from '@jest/globals';
import {buildBinderRootCauseChain} from '../binderRootCauseChain';

describe('buildBinderRootCauseChain', () => {
  it('selects the deepest unblocked hop as rootCause', () => {
    const c = buildBinderRootCauseChain({
      victim: {
        step: 0,
        side: 'client',
        pid: 1234,
        tid: 1234,
        process: 'com.example.app',
        thread: 'main',
        startNs: 100,
        endNs: 500,
      },
      chain: [
        {step: 1, side: 'server', pid: 1000, tid: 1042, startNs: 110, endNs: 480, blockedOn: 'lock'},
        {step: 2, side: 'server', pid: 1000, tid: 1500, startNs: 120, endNs: 470},
      ],
    });
    expect(c.rootCause?.step).toBe(2);
    expect(c.truncated).toBeUndefined();
  });

  it('marks truncated when every server hop is still blocked on something', () => {
    const c = buildBinderRootCauseChain({
      victim: {step: 0, side: 'client', pid: 1, tid: 1, startNs: 0, endNs: 1},
      chain: [
        {step: 1, side: 'server', pid: 2, tid: 2, startNs: 0, endNs: 1, blockedOn: 'lock'},
      ],
    });
    expect(c.truncated).toBe(true);
    expect(c.rootCause).toBeUndefined();
    expect(c.unsupportedReason).toBeDefined();
  });

  it('marks truncated when the chain is empty', () => {
    const c = buildBinderRootCauseChain({
      victim: {step: 0, side: 'client', pid: 1, tid: 1, startNs: 0, endNs: 1},
      chain: [],
    });
    expect(c.truncated).toBe(true);
  });

  it('preserves evidenceArtifactId on hops', () => {
    const c = buildBinderRootCauseChain({
      victim: {step: 0, side: 'client', pid: 1, tid: 1, startNs: 0, endNs: 1, evidenceArtifactId: 'art-victim'},
      chain: [
        {step: 1, side: 'server', pid: 2, tid: 2, startNs: 0, endNs: 1, evidenceArtifactId: 'art-server'},
      ],
    });
    expect(c.victim.evidence?.artifactId).toBe('art-victim');
    expect(c.chain[0].evidence?.artifactId).toBe('art-server');
  });
});
