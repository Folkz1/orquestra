const BASE_URL = import.meta.env.VITE_API_URL || '';

export const API_BASE_URL = BASE_URL;

function getToken() {
  return localStorage.getItem('orquestra_token') || '';
}

export function getAuthToken() {
  return getToken();
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}: ${res.statusText}`);
    error.status = res.status;
    try {
      error.data = await res.json();
    } catch {
      // response may not be JSON
    }
    throw error;
  }

  // Handle 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

// Health
export function getHealth() {
  return request('/api/health');
}

// Projects
export function getProjects(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const qs = query.toString();
  return request(`/api/projects${qs ? '?' + qs : ''}`);
}

export function getProjectOptions() {
  return request('/api/projects/options');
}

export function createProject(data) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProject(id, data) {
  return request(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteProject(id) {
  return request(`/api/projects/${id}`, {
    method: 'DELETE',
  });
}

// Contacts
export function getContacts() {
  return request('/api/contacts');
}

export function updateContact(id, data) {
  return request(`/api/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Messages
export function getMessages(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const qs = query.toString();
  return request(`/api/messages${qs ? '?' + qs : ''}`);
}

export function getConversation(contactId) {
  return request(`/api/messages/conversation/${contactId}`);
}

export function getConversations(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const qs = query.toString();
  return request(`/api/messages/conversations${qs ? '?' + qs : ''}`);
}

export function getConversationContext(contactId) {
  return request(`/api/messages/conversation/${contactId}/context`);
}

export function markConversationRead(contactId) {
  return request(`/api/messages/read/${contactId}`, {
    method: 'POST',
  });
}

export function sendChatMessage(data) {
  return request('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getReplySuggestion(contactId) {
  return request(`/api/messages/conversation/${contactId}/reply-suggestion`, {
    method: 'POST',
  });
}

export function createPushSubscription(data) {
  return request('/api/realtime/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deletePushSubscription(endpoint) {
  return request(`/api/realtime/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
  });
}

// Recordings
export function uploadRecording(file, title, projectId) {
  const formData = new FormData();
  formData.append('file', file);
  if (title) formData.append('title', title);
  if (projectId) formData.append('project_id', projectId);

  return request('/api/recordings/upload', {
    method: 'POST',
    body: formData,
  });
}

export function getRecordings() {
  return request('/api/recordings');
}

export function getRecording(id) {
  return request(`/api/recordings/${id}`);
}

// Briefs
export function getBriefs() {
  return request('/api/briefs');
}

export function getBrief(id) {
  return request(`/api/briefs/${id}`);
}

export function generateBrief() {
  return request('/api/briefs/generate', {
    method: 'POST',
  });
}

// Proactive Bot
export function triggerProactive() {
  return request('/api/proactive/trigger', {
    method: 'POST',
  });
}

// Sync
export function syncProjects() {
  return request('/api/sync/projects', {
    method: 'POST',
  });
}

// Tasks (Kanban)
export function getTasks(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const qs = query.toString();
  return request(`/api/tasks${qs ? '?' + qs : ''}`);
}

export function createTask(data) {
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTask(id, data) {
  return request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteTask(id) {
  return request(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
}

export function getTaskStats() {
  return request('/api/tasks/stats');
}

// Proposals
export function getProposals(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const qs = query.toString();
  return request(`/api/proposals${qs ? '?' + qs : ''}`);
}

export function createProposal(data) {
  return request('/api/proposals', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProposal(id, data) {
  return request(`/api/proposals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteProposal(id) {
  return request(`/api/proposals/${id}`, {
    method: 'DELETE',
  });
}

export function getProposalPublic(slug) {
  return fetch(`${BASE_URL}/api/proposals/public/${slug}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export function addProposalComment(slug, data) {
  return fetch(`${BASE_URL}/api/proposals/public/${slug}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export function deleteProposalComment(slug, commentId) {
  return fetch(`${BASE_URL}/api/proposals/public/${slug}/comments/${commentId}`, {
    method: 'DELETE',
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return null;
  });
}

export function trackProposalEvent(slug, data) {
  return fetch(`${BASE_URL}/api/proposals/public/${slug}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).catch(() => {}); // Silent fail - analytics should never break UX
}

// ─── Scheduled Messages ─────────────────────────────────────────────

export function getScheduledMessages(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const qs = query.toString();
  return request(`/api/scheduled-messages${qs ? '?' + qs : ''}`);
}

export function createScheduledMessage(data) {
  return request('/api/scheduled-messages', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateScheduledMessage(id, data) {
  return request(`/api/scheduled-messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteScheduledMessage(id) {
  return request(`/api/scheduled-messages/${id}`, {
    method: 'DELETE',
  });
}

export function retryScheduledMessage(id) {
  return request(`/api/scheduled-messages/${id}/retry`, {
    method: 'POST',
  });
}

export function getProposalAnalytics(id) {
  return request(`/api/proposals/${id}/analytics`);
}

export function getDeliveryReport(proposalId) {
  return request(`/api/proposals/${proposalId}/delivery-report`);
}

export function generateDeliveryReport(proposalId) {
  return request(`/api/proposals/${proposalId}/delivery-report`, {
    method: 'POST',
  });
}

export function updateDeliveryReport(reportId, data) {
  return request(`/api/delivery-reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function getDeliveryReports() {
  return request('/api/delivery-reports');
}

// Client Success / AI Suggestions
export function getContactSuggestions(contactId) {
  return request(`/api/contacts/${contactId}/suggestions`);
}

// YouTube Analytics
export function getYouTubeChannelStats(projectName = 'GuyFolkz') {
  return request(`/api/youtube/channel/stats?project_name=${encodeURIComponent(projectName)}`);
}

export function getYouTubeVideos(maxResults = 50, projectName = 'GuyFolkz') {
  return request(`/api/youtube/videos?max_results=${maxResults}&project_name=${encodeURIComponent(projectName)}`);
}

export function getYouTubeVideoDetail(videoId, projectName = 'GuyFolkz') {
  return request(`/api/youtube/video/${videoId}?project_name=${encodeURIComponent(projectName)}`);
}

export function getYouTubeAnalyticsHistory(limit = 30) {
  return request(`/api/youtube/analytics?limit=${limit}`);
}

export function saveYouTubeAnalytics(data) {
  return request('/api/youtube/analytics', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// YouTube Upload & Publish
export function uploadYouTubeVideo(formData, projectName = 'GuyFolkz') {
  return request(`/api/youtube/upload?project_name=${encodeURIComponent(projectName)}`, {
    method: 'POST',
    body: formData,
  });
}

export function publishYouTubeVideo(videoId, projectName = 'GuyFolkz') {
  return request(`/api/youtube/video/${videoId}/publish?project_name=${encodeURIComponent(projectName)}`, {
    method: 'POST',
  });
}

export function scheduleYouTubeVideo(videoId, publishAt, projectName = 'GuyFolkz') {
  return request(`/api/youtube/video/${videoId}/schedule?project_name=${encodeURIComponent(projectName)}`, {
    method: 'POST',
    body: JSON.stringify({ publish_at: publishAt }),
  });
}

export function updateYouTubeVideoMetadata(videoId, data, projectName = 'GuyFolkz') {
  return request(`/api/youtube/video/${videoId}?project_name=${encodeURIComponent(projectName)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getYouTubeStrategy(projectName = 'GuyFolkz') {
  return request(`/api/youtube/strategy?project_name=${encodeURIComponent(projectName)}`);
}

export function saveYouTubeStrategy(strategy, projectName = 'GuyFolkz') {
  return request(`/api/youtube/strategy?project_name=${encodeURIComponent(projectName)}`, {
    method: 'PUT',
    body: JSON.stringify({ strategy }),
  });
}

export function getYouTubeWorkspace(projectName = 'GuyFolkz') {
  return request(`/api/youtube/workspace?project_name=${encodeURIComponent(projectName)}`);
}

// Credentials Portal
export function getCredentialLinks() {
  return request('/api/credentials/links');
}

export function createCredentialLink(data) {
  return request('/api/credentials/links', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getProjectCredentials(projectId) {
  return request(`/api/credentials/project/${projectId}/masked`);
}

// Client Portal
export function getClientPortalLinks() {
  return request('/api/client-portal/links');
}

export function createClientPortalLink(data) {
  return request('/api/client-portal/links', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function bulkCreateActiveClientPortalLinks(data = {}) {
  return request('/api/client-portal/links/bulk-active', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateClientPortalLink(id, data) {
  return request(`/api/client-portal/links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function requestClientPortalFeedback(id, data) {
  return request(`/api/client-portal/links/${id}/request-feedback`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteClientPortalLink(id) {
  return request(`/api/client-portal/links/${id}`, {
    method: 'DELETE',
  });
}

// ─── Social Publishing ─────────────────────────────────────────────

export function getSocialPlatforms() {
  return fetch(`${BASE_URL}/api/social/platforms`).then(r => r.json());
}

export function getSocialAccounts(projectName = 'GuyFolkz') {
  return request(`/api/social/accounts?project_name=${encodeURIComponent(projectName)}`);
}

export function disconnectSocialAccount(platform, projectName = 'GuyFolkz') {
  return request(`/api/social/accounts/${platform}?project_name=${encodeURIComponent(projectName)}`, {
    method: 'DELETE',
  });
}

export function startSocialOAuth(platform, projectName = 'GuyFolkz') {
  return request(`/api/social/oauth/${platform}/authorize?project_name=${encodeURIComponent(projectName)}`);
}

export function publishToSocial(data) {
  return request('/api/social/publish', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function publishUploadToSocial(formData) {
  return request('/api/social/publish/upload', {
    method: 'POST',
    body: formData,
  });
}

// ─── Subscriptions ─────────────────────────────────────────────────────────

export function getSubscriptionsDashboard() {
  return request('/api/subscriptions/summary/dashboard');
}

export function listSubscriptions(status) {
  const q = status ? `?status=${status}` : '';
  return request(`/api/subscriptions${q}`);
}

export function createSubscription(data) {
  return request('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSubscription(id, data) {
  return request(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteSubscription(id) {
  return request(`/api/subscriptions/${id}`, { method: 'DELETE' });
}

export function registerSubscriptionPayment(subId, data) {
  return request(`/api/subscriptions/${subId}/payments`, { method: 'POST', body: JSON.stringify(data) });
}

export function triggerSubscriptionAlerts() {
  return request('/api/subscriptions/alerts/check', { method: 'POST' });
}
