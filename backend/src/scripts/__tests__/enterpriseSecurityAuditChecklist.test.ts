// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import path from 'path';
import { ENTERPRISE_SECURITY_AUDIT_CHECKLIST } from '../enterpriseSecurityAuditChecklist';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const README_PATH = 'docs/features/enterprise-multi-tenant/README.md';
const SECURITY_AUDIT_DOC_PATH = 'docs/features/enterprise-multi-tenant/security-audit.md';

const EXPECTED_IDS = [
  'id-enumeration-trace-session-report',
  'cross-tenant-owner-guard',
  'provider-management-permission',
  'report-read-permission',
  'memory-admin-permission',
] as const;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('enterprise security audit checklist', () => {
  it('keeps the §0.5.9 audit scope explicit', () => {
    expect(ENTERPRISE_SECURITY_AUDIT_CHECKLIST.map(item => item.id)).toEqual(EXPECTED_IDS);
    expect(new Set(ENTERPRISE_SECURITY_AUDIT_CHECKLIST.map(item => item.auditArea)).size).toBe(EXPECTED_IDS.length);
  });

  it('keeps README status and document registration synchronized', () => {
    const readme = readRepoFile(README_PATH);

    expect(readme).toContain('- [x] 5.9 安全审计：ID 枚举、跨 tenant、无权限 provider/report/memory 访问');
    expect(readme).toContain(`- [x] \`${SECURITY_AUDIT_DOC_PATH}\``);
    expect(readme).toContain('ID 枚举');
    expect(readme).toContain('跨 tenant');
    expect(readme).toContain('无权限 provider/report/memory 访问');
  });

  it('verifies every audit item against source-level evidence', () => {
    for (const item of ENTERPRISE_SECURITY_AUDIT_CHECKLIST) {
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const evidence of item.evidence) {
        const evidencePath = path.join(REPO_ROOT, evidence.file);
        expect(fs.existsSync(evidencePath)).toBe(true);

        const content = readRepoFile(evidence.file);
        for (const pattern of evidence.patterns) {
          expect(content).toContain(pattern);
        }
      }
    }
  });

  it('keeps the security audit document synchronized with the contract', () => {
    const doc = readRepoFile(SECURITY_AUDIT_DOC_PATH);

    for (const item of ENTERPRISE_SECURITY_AUDIT_CHECKLIST) {
      expect(doc).toContain(item.id);
      expect(doc).toContain(item.auditArea);
      expect(doc).toContain(item.requiredInvariant);
    }
    expect(doc).toContain('cd backend && npx jest --runInBand src/scripts/__tests__/enterpriseSecurityAuditChecklist.test.ts');
  });
});
