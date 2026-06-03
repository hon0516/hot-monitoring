const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || '请求失败');
  }

  return payload;
}

export const api = {
  getKeywords: () => request('/api/keywords'),
  createKeyword: (data) => request('/api/keywords', { method: 'POST', body: JSON.stringify(data) }),
  updateKeyword: (id, data) => request(`/api/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKeyword: (id) => request(`/api/keywords/${id}`, { method: 'DELETE' }),
  getHotspots: (params = {}) => request(`/api/hotspots?${new URLSearchParams(params).toString()}`),
  getHotspot: (id) => request(`/api/hotspots/${id}`),
  getSummary: () => request('/api/hotspots/summary'),
  runSearch: () => request('/api/hotspots/search', { method: 'POST', body: JSON.stringify({}) }),
  getSearchStatus: () => request('/api/hotspots/search/status'),
  exploreHotspots: (query) =>
    request('/api/hotspots/explore', { method: 'POST', body: JSON.stringify({ query }) }),
  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getNotifications: () => request('/api/notifications'),
  getHealth: () => request('/api/health')
};

export { API_BASE };
