// In-memory stand-in for Netlify Blobs, used by the local preview server.
const stores = new Map();
export function getStore({ name }) {
  if (!stores.has(name)) stores.set(name, new Map());
  const data = stores.get(name);
  return {
    async get(k) { return data.has(k) ? JSON.parse(data.get(k)) : null; },
    async setJSON(k, v) { data.set(k, JSON.stringify(v)); },
    async delete(k) { data.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...data.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
