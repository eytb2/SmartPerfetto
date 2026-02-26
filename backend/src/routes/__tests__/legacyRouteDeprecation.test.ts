import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createLegacyRouteDeprecationRouter } from '../legacyRouteDeprecation';

describe('legacyRouteDeprecation', () => {
  it('returns 410 and migration payload for any method/path', async () => {
    const app = express();
    app.use(
      '/api/ai',
      createLegacyRouteDeprecationRouter({
        legacyBasePath: '/api/ai',
        replacementMethod: 'POST',
        replacementPath: '/api/agent/analyze',
      })
    );

    const response = await request(app)
      .post('/api/ai/analyze')
      .send({ query: 'test' });

    expect(response.status).toBe(410);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('LEGACY_ROUTE_DEPRECATED');
    expect(response.body.replacement).toEqual({
      method: 'POST',
      path: '/api/agent/analyze',
    });
    expect(response.body.legacy.basePath).toBe('/api/ai');
  });
});
