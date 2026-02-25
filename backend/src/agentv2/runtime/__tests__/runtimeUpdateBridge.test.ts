import { describe, expect, it } from '@jest/globals';
import { InterventionController } from '../../../agent/core/interventionController';
import type { StreamingUpdate } from '../../../agent/types';
import { RuntimeUpdateBridge } from '../runtimeUpdateBridge';

describe('RuntimeUpdateBridge intervention forwarding', () => {
  it('forwards intervention lifecycle events with snake_case event names', () => {
    const controller = new InterventionController({
      confidenceThreshold: 0.5,
      timeoutThresholdMs: 120000,
      userResponseTimeoutMs: 60000,
      autoIntervention: true,
    });

    const updates: StreamingUpdate[] = [];
    const bridge = new RuntimeUpdateBridge((update) => updates.push(update));
    bridge.bindInterventionForwarding(controller);

    const intervention = controller.createAgentIntervention(
      'session-1',
      'Need explicit user confirmation',
      [
        {
          id: 'continue',
          label: 'Continue',
          description: 'Continue analysis',
          action: 'continue',
          recommended: true,
        },
      ],
      {
        progressSummary: 'waiting for approval',
      }
    );

    const requiredUpdate = updates.find((update) => update.type === 'intervention_required');
    expect(requiredUpdate).toBeDefined();
    expect(requiredUpdate?.content?.interventionId).toBe(intervention.id);

    controller.handleUserDecision({
      interventionId: intervention.id,
      action: 'continue',
    });

    const resolvedUpdate = updates.find((update) => update.type === 'intervention_resolved');
    expect(resolvedUpdate).toBeDefined();
    expect(resolvedUpdate?.content?.interventionId).toBe(intervention.id);
    expect(resolvedUpdate?.content?.directive?.action).toBe('continue');
  });
});
