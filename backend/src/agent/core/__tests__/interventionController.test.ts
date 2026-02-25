import { describe, expect, it } from '@jest/globals';
import { InterventionController, type InterventionOption } from '../interventionController';

const DEFAULT_OPTIONS: InterventionOption[] = [
  {
    id: 'continue',
    label: 'Continue',
    description: 'Continue analysis',
    action: 'continue',
    recommended: true,
  },
  {
    id: 'abort',
    label: 'Abort',
    description: 'Abort analysis',
    action: 'abort',
  },
];

describe('InterventionController session scoping', () => {
  it('reports no pending intervention for unknown session', () => {
    const controller = new InterventionController();
    expect(controller.hasPendingIntervention('missing-session')).toBe(false);
  });

  it('does not resolve interventions across sessions when expectedSessionId is provided', () => {
    const controller = new InterventionController();

    const s1Intervention = controller.createAgentIntervention(
      'session-1',
      'Need user confirmation for session 1',
      DEFAULT_OPTIONS,
      {}
    );
    const s2Intervention = controller.createAgentIntervention(
      'session-2',
      'Need user confirmation for session 2',
      DEFAULT_OPTIONS,
      {}
    );

    const directive = controller.handleUserDecision(
      {
        interventionId: s2Intervention.id,
        action: 'continue',
      },
      'session-1'
    );

    expect(directive.action).toBe('abort');
    expect(directive.reason).toContain('未找到对应的干预请求');

    // Session-2 pending intervention should remain untouched.
    expect(controller.getPendingIntervention('session-2')?.id).toBe(s2Intervention.id);
    // Session-1 pending intervention should also remain untouched.
    expect(controller.getPendingIntervention('session-1')?.id).toBe(s1Intervention.id);
  });
});
