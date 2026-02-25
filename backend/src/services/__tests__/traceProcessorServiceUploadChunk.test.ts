import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { TraceProcessorService } from '../traceProcessorService';

describe('TraceProcessorService chunk upload offsets', () => {
  it('writes chunks to the expected byte offset', async () => {
    const uploadDir = path.join(os.tmpdir(), `trace-upload-offset-${uuidv4()}`);
    fs.mkdirSync(uploadDir, { recursive: true });

    try {
      const service = new TraceProcessorService(uploadDir);
      const traceId = await service.initializeUpload('offset.trace', 8);

      await Promise.all([
        service.uploadChunk(traceId, Buffer.from('CD'), 2),
        service.uploadChunk(traceId, Buffer.from('AB'), 0),
        service.uploadChunk(traceId, Buffer.from('GH'), 6),
        service.uploadChunk(traceId, Buffer.from('EF'), 4),
      ]);

      const tracePath = path.join(uploadDir, `${traceId}.trace`);
      const data = fs.readFileSync(tracePath);
      expect(data.toString('utf8')).toBe('ABCDEFGH');
    } finally {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
  });
});
