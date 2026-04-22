// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import type { AnalysisResult } from '../../agent/core/orchestratorTypes';
import type { PreparedRuntimeContext } from './runtimeContextBuilder';

export type RuntimeMode = PreparedRuntimeContext['decisionContext']['mode'];

export interface RuntimeModeExecutionRequest {
  runtimeContext: PreparedRuntimeContext;
  query: string;
  sessionId: string;
  traceId: string;
}

export interface RuntimeModeHandler {
  supports(mode: RuntimeMode): boolean;
  execute(request: RuntimeModeExecutionRequest): Promise<AnalysisResult>;
}

export interface RuntimeModeHandlerRegistrationOptions {
  prepend?: boolean;
}
