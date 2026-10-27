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

// Products seen in search results (some come from the lookup API and are not
// in the store's category list), so place_order can find them again.
const seenProducts = new Map();
function remember(p, s) {
  seenProducts.set(`${s.tenantid}:${p.productid}`, p);
  if (seenProducts.size > 5000) seenProducts.delete(seenProducts.keys().next().value);
}

export async function findProduct(store, productid) {
  const list = await products(store);
  return list.find((x) => x.productid === productid) ?? seenProducts.get(`${store.tenantid}:${productid}`) ?? null;
}

// Local names people type → spellings used in product names.
const ALIASES = [
  ['tomato', 'thakkali'], ['onion', 'vengayam', 'pyaz'], ['potato', 'urulai', 'aloo'],
  ['curd', 'dahi', 'yogurt', 'yoghurt'], ['chilli', 'chili', 'mirchi', 'milagai'],
  ['coriander', 'dhania', 'kothamalli', 'cilantro'], ['rice', 'arisi'], ['ghee', 'nei'],
  ['milk', 'paal'], ['oil', 'ennai'], ['mint', 'pudina', 'pudhina'], ['banana', 'vazhai', 'vazhaipazham'],
  ['egg', 'eggs', 'muttai'], ['brinjal', 'eggplant', 'kathirikai'], ['lady finger', 'ladies finger', 'okra', 'vendakkai'],
];

function terms(query) {
  const q = norm(query);
  for (const group of ALIASES) {
    if (group.some((a) => q.includes(a))) {
      // keep extra words the user typed (e.g. "tomato 1kg" → size isn't a name word)
      return group.map((a) => [a]);
    }
  }
  return [q.split(' ').filter((w) => w.length > 1 && !/^\d+(kg|g|gm|ml|l|ltr|pcs)?$/.test(w))];
}

function matches(name, alts) {
  const n = norm(name);
  return alts.some((words) => words.length && words.every((w) => n.includes(w) || (w.endsWith('s') && n.includes(w.slice(0, -1)))));
}

/** Search one item across the customer's open stores (or one store). Cheapest first.
 *  Same as the app: local catalogue match + the scan/lookup search API. */
export async function search(cid, query, store = null) {
  const alts = terms(query);
  if (!alts[0]?.length) return [];
  const all = await stores(cid);
  const targets = store ? [store] : all.filter((s) => s.open).slice(0, 10);
  const [lists, looked] = await Promise.all([
    Promise.all(targets.map((s) => products(s).catch(() => []))),
    lookupOffers(cid, query, store ? [store] : all.filter((s) => s.open)),
  ]);

  const hits = [];
  const seen = new Set();
  const add = (p, s) => {
    const k = `${p.productid}:${s.tenantid}`;
    if (!p.productid || !p.available || !p.price || seen.has(k)) return;
    seen.add(k);
    remember(p, s);
    hits.push({ ...p, store: s.name, storeKm: s.km });
  };
  lists.forEach((list, i) => list.forEach((p) => matches(p.name, alts) && add(p, targets[i])));
  // The search API can return loose matches, so use it only when the store lists had none.
  if (!hits.length) for (const { p, s } of looked) add(p, s);
  return hits.sort((a, b) => a.price - b.price).slice(0, 15);
}

async function lookupOffers(cid, query, allowed) {
  try {
    const a = await homeAddress(cid);
    const opts = await api.lookup(cid, query, Number(a?.latitude) || 0, Number(a?.longitude) || 0, allowed.map((s) => s.tenantid));
    const out = [];
    for (const o of opts) {
      const s = allowed.find((x) => `${x.tenantid}` === `${o.tenantid}` && `${x.locationid}` === `${o.locationid}`)
        ?? allowed.find((x) => `${x.tenantid}` === `${o.tenantid}`);
      if (s) out.push({ p: api.product(o, s), s });
    }
    return out;
  } catch {
    return [];
  }
}

const norm = (s) => `${s}`.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function km(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
