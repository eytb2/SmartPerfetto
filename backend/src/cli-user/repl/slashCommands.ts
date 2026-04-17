// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Slash-command parser for the REPL.
 *
 * Surface kept intentionally small for PR3:
 *   /load <path>      load a trace and start a new session
 *   /ask <query>      run another turn on the current session
 *   /resume <id>      switch to an existing session
 *   /report [--open]  show / open the current session's HTML report
 *   /focus            summarise the current session
 *   /clear            clear the terminal scrollback
 *   /help | /?        show the slash-command reference
 *   /exit | /quit     leave the REPL
 *
 * Lines without a leading `/` are treated as `/ask <line>` — typing your
 * question without any prefix is the common path, so make it free.
 */

export type ParsedCommand =
  | { kind: 'load'; path: string }
  | { kind: 'ask'; query: string }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'report'; open: boolean }
  | { kind: 'focus' }
  | { kind: 'clear' }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'noop' }
  | { kind: 'unknown'; command: string }
  | { kind: 'usage'; command: string; hint: string };

export function parseSlashCommand(rawLine: string): ParsedCommand {
  const line = rawLine.trim();
  if (line.length === 0) return { kind: 'noop' };

  if (!line.startsWith('/')) {
    return { kind: 'ask', query: line };
  }

  // Split only on the first whitespace so argument text can contain spaces.
  const spaceIdx = line.search(/\s/);
  const command = (spaceIdx === -1 ? line.slice(1) : line.slice(1, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim();

  switch (command) {
    case 'load': {
      if (!rest) return { kind: 'usage', command, hint: '/load <trace-path>' };
      return { kind: 'load', path: rest };
    }
    case 'ask': {
      if (!rest) return { kind: 'usage', command, hint: '/ask <question>' };
      return { kind: 'ask', query: rest };
    }
    case 'resume': {
      if (!rest) return { kind: 'usage', command, hint: '/resume <sessionId>' };
      return { kind: 'resume', sessionId: rest };
    }
    case 'report': {
      // /report alone prints the path; /report --open also opens it.
      const open = /(^|\s)--open(\s|$)/.test(rest);
      return { kind: 'report', open };
    }
    case 'focus':
      return { kind: 'focus' };
    case 'clear':
      return { kind: 'clear' };
    case 'help':
    case '?':
      return { kind: 'help' };
    case 'exit':
    case 'quit':
      return { kind: 'exit' };
    default:
      return { kind: 'unknown', command };
  }
}

export const SLASH_HELP = [
  '  /load <trace>       load a trace and start a new session',
  '  /ask <question>     ask a follow-up on the current session',
  '  <question>          shorthand for /ask (slash not required)',
  '  /resume <id>        switch to a different existing session',
  '  /report [--open]    show or open the current session\'s HTML report',
  '  /focus              summarize the current session',
  '  /clear              clear the terminal',
  '  /help               this help',
  '  /exit               leave the REPL (or press Ctrl+C twice)',
].join('\n');
