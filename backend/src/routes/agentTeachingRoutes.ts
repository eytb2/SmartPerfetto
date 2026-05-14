// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import { requireRequestContext } from '../middleware/auth';
import { sendResourceNotFound } from '../services/resourceOwnership';
import { RenderingPipelineTeachingService } from '../services/renderingPipelineTeachingService';
import { readTraceMetadataForContext } from '../services/traceMetadataStore';
import { getTraceProcessorService } from '../services/traceProcessorService';

export function registerTeachingRoutes(router: express.Router): void {
  router.post('/teaching/pipeline', async (req, res) => {
    try {
      const {
        traceId,
        packageName,
        processName,
        selectionContext,
        visibleWindow,
        startTs,
        endTs,
      } = req.body;

      if (!traceId) {
        return res.status(400).json({
          success: false,
          error: 'traceId is required',
        });
      }

      if (!await readTraceMetadataForContext(traceId, requireRequestContext(req))) {
        return sendResourceNotFound(res, 'Trace not found in backend');
      }

      const traceProcessorService = getTraceProcessorService();
      const trace = traceProcessorService.getTrace(traceId);
      if (!trace) {
        return res.status(404).json({
          success: false,
          error: 'Trace not found in backend',
          hint: 'Please upload the trace to the backend first',
          code: 'TRACE_NOT_UPLOADED',
        });
      }

      console.log(`[AgentRoutes] Teaching pipeline request for trace: ${traceId}`);
      const service = new RenderingPipelineTeachingService(traceProcessorService);
      const response = await service.analyze({
        traceId,
        packageName,
        processName,
        selectionContext,
        visibleWindow,
        startTs,
        endTs,
      });

      console.log(
        `[AgentRoutes] Teaching pipeline detected: ${response.detection.primaryPipelineId} ` +
        `(${(response.detection.primaryConfidence * 100).toFixed(1)}%), ` +
        `${response.observedFlow?.events.length || 0} observed events`
      );
      res.json(response);
    } catch (error: any) {
      console.error('[AgentRoutes] Teaching pipeline error:', error);
      console.error('[AgentRoutes] Stack trace:', error.stack);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to detect pipeline',
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      });
    }
  });
}
