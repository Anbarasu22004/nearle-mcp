// Stores + products with a short cache, and search across all stores.
// Everything customer-specific is keyed by customer id.
import * as api from './nearle.js';

const TTL = 5 * 60 * 1000;
const cache = new Map(); // key → { at, value }

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

/** Delivery address = primary saved address (else the first). */
export async function homeAddress(cid) {
  return cached(`addr:${cid}`, async () => {
    const list = await api.addresses(cid);
    return list.find((a) => a.primary) ?? list[0] ?? null;
  });
}

export async function stores(cid) {
  return cached(`stores:${cid}`, async () => {
    const a = await homeAddress(cid);
    const list = await api.stores(cid, a?.latitude, a?.longitude);
    const lat = Number(a?.latitude), lng = Number(a?.longitude);
    for (const s of list) {
      s.km = lat && lng && s.latitude && s.longitude ? +km(lat, lng, s.latitude, s.longitude).toFixed(1) : null;
    }
    return list.sort((x, y) => (y.open - x.open) || ((x.km ?? 99) - (y.km ?? 99)));
  });
}

export async function storeById(cid, id) {
  return (await stores(cid)).find((s) => s.tenantid === Number(id)) ?? null;
}

export async function findStore(cid, nameOrId) {
  const all = await stores(cid);
  const q = `${nameOrId}`.toLowerCase().trim();
  return (
    all.find((s) => `${s.tenantid}` === q) ??
    all.find((s) => s.name.toLowerCase() === q) ??
    all.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase())) ??
    null
  );
}

// Products are the same for every customer → shared cache.
export async function sections(store) {
  return cached(`sec:${store.tenantid}:${store.locationid}`, () => api.storeSections(store));
}

export async function products(store) {
  return (await sections(store)).flatMap((s) => s.products);
}

/** Search one item name across the customer's open stores. Cheapest first. */
export async function search(cid, query, store = null) {
  const words = norm(query).split(' ').filter((w) => w.length > 1);
  if (!words.length) return [];
  const targets = store ? [store] : (await stores(cid)).filter((s) => s.open);
  const lists = await Promise.all(targets.map((s) => products(s).catch(() => [])));
  const hits = [];
  lists.forEach((list, i) => {
    for (const p of list) {
      if (!p.available || !p.price) continue;
      const name = norm(p.name);
      const score = words.filter((w) => name.includes(w) || name.includes(w.replace(/s$/, ''))).length;
      if (score === words.length || (words.length > 2 && score >= words.length - 1)) {
        hits.push({ ...p, store: targets[i].name, score });
      }
    }
  });
  return hits.sort((a, b) => b.score - a.score || a.price - b.price).slice(0, 15);
}

const norm = (s) => `${s}`.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function km(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
