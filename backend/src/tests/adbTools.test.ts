const mockDetectAdbContext = jest.fn();
const mockAdb = {
  shell: jest.fn<Promise<string>, [string, string, any]>(),
  getDeviceInfo: jest.fn<Promise<any>, [string]>(),
};

jest.mock('../services/adb', () => ({
  detectAdbContext: (...args: any[]) => mockDetectAdbContext(...args),
  getAdbService: () => mockAdb,
}));

import type { AgentToolContext } from '../agent/types/agentProtocol';
import { getAdbAgentTools } from '../agent/agents/tools/adbTools';

describe('adb agent tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function baseContext(): AgentToolContext {
    return {
      sessionId: 's1',
      traceId: 't1',
      traceProcessorService: undefined,
      additionalContext: {
        adb: { mode: 'read_only' },
      },
    };
  }

  test('adb_shell allows safe read-only commands', async () => {
    mockDetectAdbContext.mockResolvedValueOnce({
      mode: 'read_only',
      enabled: true,
      availability: { installed: true, devices: [], selectedSerial: 'ABC' },
      warnings: [],
    });
    mockAdb.shell.mockResolvedValueOnce('ok');

    const adbShell = getAdbAgentTools().find((t) => t.name === 'adb_shell')!;
    const result = await adbShell.execute({ command: 'getprop ro.build.fingerprint' }, baseContext());

    expect(result.success).toBe(true);
    expect(mockAdb.shell).toHaveBeenCalledWith('ABC', 'getprop ro.build.fingerprint', expect.any(Object));
  });

  test('adb_shell rejects unsafe read-only commands', async () => {
    mockDetectAdbContext.mockResolvedValueOnce({
      mode: 'read_only',
      enabled: true,
      availability: { installed: true, devices: [], selectedSerial: 'ABC' },
      warnings: [],
    });

    const adbShell = getAdbAgentTools().find((t) => t.name === 'adb_shell')!;
    const result = await adbShell.execute({ command: 'getprop; rm -rf /' }, baseContext());

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('只读模式拒绝执行');
    expect(mockAdb.shell).not.toHaveBeenCalled();
  });

  test('adb_shell allows more commands in full mode', async () => {
    mockDetectAdbContext.mockResolvedValueOnce({
      mode: 'full',
      enabled: true,
      availability: { installed: true, devices: [], selectedSerial: 'ABC' },
      warnings: [],
    });
    mockAdb.shell.mockResolvedValueOnce('hi');

    const adbShell = getAdbAgentTools().find((t) => t.name === 'adb_shell')!;
    const ctx = baseContext();
    (ctx.additionalContext as any).adb = { mode: 'full' };

    const result = await adbShell.execute({ command: 'echo hi' }, ctx);
    expect(result.success).toBe(true);
    expect((result.data as any).output).toContain('hi');
  });

  test('adb_get_device_info redacts props by default', async () => {
    mockDetectAdbContext.mockResolvedValueOnce({
      mode: 'read_only',
      enabled: true,
      availability: { installed: true, devices: [], selectedSerial: 'ABC' },
      warnings: [],
    });
    mockAdb.getDeviceInfo.mockResolvedValueOnce({
      serial: 'ABC',
      model: 'Pixel',
      props: { a: 'b' },
    });

    const tool = getAdbAgentTools().find((t) => t.name === 'adb_get_device_info')!;
    const result = await tool.execute({}, baseContext());

    expect(result.success).toBe(true);
    expect((result.data as any).props).toBeUndefined();
  });
});

