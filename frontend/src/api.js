const BASE_URL = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('orquestra_token') || '';
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
export function getProjects() {
  return request('/api/projects');
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

// Sync
export function syncProjects() {
  return request('/api/sync/projects', {
    method: 'POST',
  });
}

// Notion
export function getNotionDatabases() {
  return request('/api/notion/databases');
}

export function importNotion(data) {
  return request('/api/notion/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getNotionStatus() {
  return request('/api/notion/status');
}

export function getWarTasks() {
  return request('/api/notion/war-tasks');
}
