const statusLog = document.getElementById('statusLog');
const workspaceRows = document.getElementById('workspaceRows');
const tenantLine = document.getElementById('tenantLine');
const providerLine = document.getElementById('providerLine');

function log(message) {
  statusLog.textContent = `${new Date().toISOString()}  ${message}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || body.details || `${response.status} ${response.statusText}`);
  }
  return body;
}

function parseJsonField(value, label) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function jsonCode(value) {
  const code = document.createElement('code');
  code.textContent = value ? JSON.stringify(value) : '{}';
  return code;
}

function renderSummary(summary) {
  const tenant = summary.tenant;
  tenantLine.textContent = tenant
    ? `${tenant.id} / ${tenant.status}`
    : 'Tenant metadata has not been created yet';
  document.getElementById('workspaceCount').textContent = String(summary.counts.workspaces);
  document.getElementById('userCount').textContent = String(summary.counts.users);
  document.getElementById('membershipCount').textContent = String(summary.counts.memberships);
  document.getElementById('providerCount').textContent = String(summary.counts.providers);
  providerLine.textContent = `Workspace provider API: ${summary.providerManagement.workspaceEndpointTemplate}`;

  workspaceRows.replaceChildren();
  for (const workspace of summary.workspaces) {
    const row = document.createElement('tr');
    for (const text of [
      workspace.id,
      workspace.name,
      String(workspace.memberCount),
      String(workspace.traceCount),
      String(workspace.providerCount),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    }
    const quotaCell = document.createElement('td');
    quotaCell.appendChild(jsonCode(workspace.quotaPolicy));
    row.appendChild(quotaCell);
    const retentionCell = document.createElement('td');
    retentionCell.appendChild(jsonCode(workspace.retentionPolicy));
    row.appendChild(retentionCell);
    workspaceRows.appendChild(row);
  }
}

async function refresh() {
  const summary = await api('/api/tenant/admin/summary');
  renderSummary(summary);
  log('Refreshed admin control plane');
}

document.getElementById('refreshButton').addEventListener('click', () => {
  refresh().catch(error => log(error.message));
});

document.getElementById('workspaceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/tenant/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: form.get('workspaceId'),
        name: form.get('name'),
      }),
    });
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    log(error.message);
  }
});

document.getElementById('policyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const workspaceId = String(form.get('workspaceId') || '').trim();
  try {
    await api(`/api/tenant/workspaces/${encodeURIComponent(workspaceId)}/policies`, {
      method: 'PATCH',
      body: JSON.stringify({
        quotaPolicy: parseJsonField(String(form.get('quotaPolicy') || ''), 'quotaPolicy'),
        retentionPolicy: parseJsonField(String(form.get('retentionPolicy') || ''), 'retentionPolicy'),
      }),
    });
    await refresh();
  } catch (error) {
    log(error.message);
  }
});

document.getElementById('memberForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const workspaceId = String(form.get('workspaceId') || '').trim();
  const userId = String(form.get('userId') || '').trim();
  try {
    await api(
      `/api/tenant/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          email: form.get('email'),
          role: form.get('role'),
        }),
      },
    );
    await refresh();
  } catch (error) {
    log(error.message);
  }
});

refresh().catch(error => log(error.message));
