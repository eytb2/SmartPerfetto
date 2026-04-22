// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

const mockAdb = {
  getVersion: jest.fn<Promise<string | null>, []>(),
  listDevices: jest.fn<Promise<any[]>, []>(),
  getDeviceInfo: jest.fn<Promise<any>, [string]>(),
  getAdbPath: jest.fn<string, []>(() => 'adb'),
};

jest.mock('../services/adb/adbService', () => ({
  getAdbService: () => mockAdb,
}));

import { detectAdbContext } from '../services/adb/adbContextDetector';

describe('detectAdbContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns installed=false when adb is missing', async () => {
    mockAdb.getVersion.mockResolvedValueOnce(null);

    const ctx = await detectAdbContext(undefined, undefined, 'trace-1');
    expect(ctx.availability.installed).toBe(false);
    expect(ctx.enabled).toBe(false);
  });

  test('auto mode enables when fingerprint matches', async () => {
    mockAdb.getVersion.mockResolvedValueOnce('Android Debug Bridge version 1.0.41');
    mockAdb.listDevices.mockResolvedValueOnce([{ serial: 'ABC', state: 'device' }]);
    mockAdb.getDeviceInfo.mockResolvedValueOnce({
      serial: 'ABC',
      buildFingerprint: 'fp1',
      model: 'Pixel',
    });

    const traceProcessorService = {
      query: jest.fn(async () => ({
        columns: ['name', 'value'],
        rows: [['android_build_fingerprint', 'fp1']],
      })),
    };

    const ctx = await detectAdbContext(undefined, traceProcessorService, 'trace-1');
    expect(ctx.availability.installed).toBe(true);
    expect(ctx.availability.selectedSerial).toBe('ABC');
    expect(ctx.traceMatch?.status).toBe('match');
    expect(ctx.enabled).toBe(true);
  });

  test('auto mode disables when fingerprint mismatches', async () => {
    mockAdb.getVersion.mockResolvedValueOnce('Android Debug Bridge version 1.0.41');
    mockAdb.listDevices.mockResolvedValueOnce([{ serial: 'ABC', state: 'device' }]);
    mockAdb.getDeviceInfo.mockResolvedValueOnce({
      serial: 'ABC',
      buildFingerprint: 'fp1',
      model: 'Pixel',
    });

    const traceProcessorService = {
      query: jest.fn(async () => ({
        columns: ['name', 'value'],
        rows: [['android_build_fingerprint', 'fp2']],
      })),
    };

    const ctx = await detectAdbContext(undefined, traceProcessorService, 'trace-1');
    expect(ctx.traceMatch?.status).toBe('mismatch');
    expect(ctx.enabled).toBe(false);
    expect(ctx.warnings.some((w) => w.includes('不匹配'))).toBe(true);
  });

  test('read_only mode enables even when fingerprint mismatches', async () => {
    mockAdb.getVersion.mockResolvedValueOnce('Android Debug Bridge version 1.0.41');
    mockAdb.listDevices.mockResolvedValueOnce([{ serial: 'ABC', state: 'device' }]);
    mockAdb.getDeviceInfo.mockResolvedValueOnce({
      serial: 'ABC',
      buildFingerprint: 'fp1',
      model: 'Pixel',
    });

    const traceProcessorService = {
      query: jest.fn(async () => ({
        columns: ['name', 'value'],
        rows: [['android_build_fingerprint', 'fp2']],
      })),
    };

    const ctx = await detectAdbContext({ mode: 'read_only' }, traceProcessorService, 'trace-1');
    expect(ctx.enabled).toBe(true);
  });

  test('auto mode disables when multiple devices and no serial', async () => {
    mockAdb.getVersion.mockResolvedValueOnce('Android Debug Bridge version 1.0.41');
    mockAdb.listDevices.mockResolvedValueOnce([
      { serial: 'ABC', state: 'device' },
      { serial: 'DEF', state: 'device' },
    ]);

    const ctx = await detectAdbContext(undefined, undefined, 'trace-1');
    expect(ctx.availability.selectedSerial).toBeUndefined();
    expect(ctx.enabled).toBe(false);
    expect(ctx.warnings.some((w) => w.includes('多个设备'))).toBe(true);
  });
});

