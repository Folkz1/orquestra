/**
 * Orquestra API Client
 * All operations the AI agent can perform on the Orquestra backend.
 */

import { ORQUESTRA_API, ORQUESTRA_TOKEN } from './config';

async function api(path: string, options: RequestInit = {}) {
  const url = `${ORQUESTRA_API}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${ORQUESTRA_TOKEN}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Orquestra API ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Tasks ──────────────────────────────────────────────────────────

export async function listTasks(params: {
  status?: string;
  assigned_to?: string;
  project_id?: string;
} = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.assigned_to) qs.set('assigned_to', params.assigned_to);
  if (params.project_id) qs.set('project_id', params.project_id);
  const q = qs.toString();
  return api(`/api/tasks${q ? '?' + q : ''}`);
}

export async function createTask(data: {
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  project_id?: string;
  assigned_to?: string;
}) {
  return api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: data.title,
      description: data.description || null,
      priority: data.priority || 'medium',
      status: data.status || 'backlog',
      project_id: data.project_id || null,
      assigned_to: data.assigned_to || 'diego',
      source: 'auto',
    }),
  });
}

export async function updateTask(taskId: string, data: {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
}) {
  return api(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(taskId: string) {
  return api(`/api/tasks/${taskId}`, { method: 'DELETE' });
}

export async function getTaskStats() {
  return api('/api/tasks/stats');
}

// ─── Contacts ───────────────────────────────────────────────────────

export async function listContacts(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return api(`/api/contacts${qs}`);
}

export async function updateContact(contactId: string, data: {
  name?: string;
  company?: string;
  pipeline_stage?: string;
  engagement_score?: number;
  next_action?: string;
  monthly_revenue?: string;
  notes?: string;
  tags?: string[];
}) {
  return api(`/api/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Projects ───────────────────────────────────────────────────────

export async function listProjects() {
  return api('/api/projects');
}

// ─── Proposals ──────────────────────────────────────────────────────

export async function listProposals(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return api(`/api/proposals${qs}`);
}

export async function updateProposal(proposalId: string, data: {
  status?: string;
  title?: string;
}) {
  return api(`/api/proposals/${proposalId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Messages ───────────────────────────────────────────────────────

export async function getConversation(contactId: string) {
  return api(`/api/messages/conversation/${contactId}`);
}

export async function listMessages(params: { contact_id?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.contact_id) qs.set('contact_id', params.contact_id);
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return api(`/api/messages${q ? '?' + q : ''}`);
}

// ─── Recordings ─────────────────────────────────────────────────────

export async function listRecordings() {
  return api('/api/recordings');
}

// ─── Memory ─────────────────────────────────────────────────────────

export async function searchMemory(query: string, limit = 10) {
  return api(`/api/memory/search?query=${encodeURIComponent(query)}&limit=${limit}`);
}

export async function ingestMemory(content: string, sourceType: string, summary?: string) {
  return api('/api/memory/ingest', {
    method: 'POST',
    body: JSON.stringify({
      content,
      source_type: sourceType,
      summary: summary || content.slice(0, 200),
    }),
  });
}

// ─── WhatsApp ───────────────────────────────────────────────────────

export async function sendWhatsAppMessage(phone: string, text: string) {
  // Use the Orquestra backend to send (it handles Evolution API)
  return api('/api/messages/send-text', {
    method: 'POST',
    body: JSON.stringify({ phone, text }),
  });
}

// ─── Briefs ─────────────────────────────────────────────────────────

export async function getLatestBrief() {
  const briefs = await api('/api/briefs?limit=1');
  return briefs?.[0] || null;
}

// ─── Proactive Bot ──────────────────────────────────────────────────

export async function triggerProactive() {
  return api('/api/proactive/trigger', { method: 'POST' });
}
