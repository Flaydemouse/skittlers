const data = new Map();
export function getStore() {
  return {
    async get(k) { return data.has(k) ? JSON.parse(data.get(k)) : null; },
    async setJSON(k, v) { data.set(k, JSON.stringify(v)); },
  };
}
