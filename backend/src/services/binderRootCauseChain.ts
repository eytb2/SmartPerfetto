// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Binder Victim → Server Root-cause Chain (Spark Plan 12)
 *
 * Joins client-side and server-side binder transactions and walks the chain
 * back to the deepest blocker, producing a `BinderRootCauseChainContract`.
 *
 * Inputs are deliberately minimal: a flat list of hops keyed by transaction
 * id, plus per-hop `blockedOn` strings the caller derives from
 * thread_state aggregations. The walker just sequences hops and picks the
 * leaf when one exists; otherwise it marks the chain truncated rather than
 * inventing a root cause.
 */

import {
  makeSparkProvenance,
  type BinderChainHop,
  type BinderRootCauseChainContract,
} from '../types/sparkContracts';

export interface BinderHopInput {
  step: number;
  side: 'client' | 'server';
  pid: number;
  tid: number;
  process?: string;
  thread?: string;
  method?: string;
  startNs: number;
  endNs: number;
  blockedOn?: string;
  evidenceArtifactId?: string;
}

export interface BuildBinderChainOptions {
  victim: BinderHopInput;
  /** Server-side hops in step order (closest hop first). */
  chain: BinderHopInput[];
}

function toHop(input: BinderHopInput): BinderChainHop {
  return {
    step: input.step,
    side: input.side,
    pid: input.pid,
    tid: input.tid,
    range: {startNs: input.startNs, endNs: input.endNs},
    ...(input.process ? {process: input.process} : {}),
    ...(input.thread ? {thread: input.thread} : {}),
    ...(input.method ? {method: input.method} : {}),
    ...(input.blockedOn ? {blockedOn: input.blockedOn} : {}),
    ...(input.evidenceArtifactId
      ? {evidence: {artifactId: input.evidenceArtifactId}}
      : {}),
  };
}

/**
 * Build the full chain. The deepest hop becomes `rootCause`; if every hop
 * is blocked on something but there is still a downstream hop pending,
 * the contract is marked truncated.
 */
export function buildBinderRootCauseChain(
  options: BuildBinderChainOptions,
): BinderRootCauseChainContract {
  const sortedChain = options.chain.slice().sort((a, b) => a.step - b.step);
  const chain = sortedChain.map(toHop);
  const victim = toHop(options.victim);

  let rootCause: BinderChainHop | undefined;
  let truncated = false;

  if (chain.length > 0) {
    const last = chain[chain.length - 1];
    if (last.blockedOn) {
      // The leaf still blocks on something; without further hops we cannot
      // claim a definitive root cause.
      truncated = true;
    } else {
      rootCause = last;
    }
  } else {
    // Nothing on the server side — the chain itself is incomplete.
    truncated = true;
  }

  return {
    ...makeSparkProvenance({
      source: 'binder-root-cause',
      ...(truncated ? {unsupportedReason: 'chain truncated; root cause not resolvable'} : {}),
    }),
    victim,
    chain,
    ...(rootCause ? {rootCause} : {}),
    ...(truncated ? {truncated: true} : {}),
    coverage: [{sparkId: 7, planId: '12', status: 'implemented'}],
  };
}
