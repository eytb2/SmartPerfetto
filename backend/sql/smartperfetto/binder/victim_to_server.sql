-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2024-2026 Gracker (Chris)
-- This file is part of SmartPerfetto. See LICENSE for details.
--
-- smartperfetto.binder.victim_to_server
--
-- Returns binder transactions in a victim → server pair shape so the
-- root-cause chain analysis can join across processes without
-- re-implementing transaction matching for every skill that needs it.
--
-- Source of truth: `android_binder_txns` from `android.binder`, which
-- already pairs each client txn with its server reply (Codex review
-- spotted that android_binder_client_server_breakdown does not expose
-- process/thread/method/aidl_name).

INCLUDE PERFETTO MODULE android.binder;

CREATE PERFETTO VIEW smartperfetto_binder_victim_to_server AS
SELECT
  client_ts,
  client_dur AS client_dur_ns,
  client_pid,
  client_tid,
  client_process,
  client_thread,
  aidl_name AS client_method,
  server_ts,
  server_dur AS server_dur_ns,
  server_pid,
  server_tid,
  server_process,
  server_thread,
  is_sync,
  binder_txn_id,
  binder_reply_id
FROM android_binder_txns;
