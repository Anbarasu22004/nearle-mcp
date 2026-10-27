// The tools Claude can use. Each returns text for Claude plus `structuredContent`
// that the Nearle card (widget.html) draws with photos, prices and buttons.
import fs from 'node:fs';
import { z } from 'zod';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { config } from './config.js';
import * as api from './nearle.js';
import * as cat from './catalog.js';

const UI = 'ui://nearle/shop-v1';
const ui = { ui: { resourceUri: UI } };

const money = (n) => Math.round(n * 100) / 100;
const rs = (n) => `₹${money(n).toFixed(2).replace(/\.00$/, '')}`;
const cidOf = (extra) => extra?.authInfo?.extra?.customerId;

const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
const result = (forClaude, card) => ({
  content: [{ type: 'text', text: JSON.stringify(forClaude) }],
  structuredContent: card,
});

/** Product photo through our own server (the card may only load from our origin). */
const img = (url) => (url && /^https?:\/\//i.test(url) ? `${config.publicUrl}/img?u=${encodeURIComponent(url)}` : '');

const cardItem = (p, s) => ({
  productid: p.productid,
  store_id: s.tenantid,
  store: s.name,
  name: p.name,
  unit: p.unit || '',
  price: money(p.price),
  mrp: p.discount ? money(p.cost) : null,
  image: img(p.image),
});

const claudeItem = (p, s) => ({
  productid: p.productid,
  store_id: s.tenantid,
  store: s.name,
  name: p.name,
  unit: p.unit || undefined,
  price: rs(p.price),
  mrp: p.discount ? rs(p.cost) : undefined,
});

// ── The card (MCP App) ────────────────────────────────────────────────────

function widgetHtml() {
  const bundlePath = new URL(import.meta.resolve('@modelcontextprotocol/ext-apps/app-with-deps'));
  let bundle = fs.readFileSync(bundlePath, 'utf8');
  // Inline the SDK: drop its final `export {...}` and keep the names we use.
  const m = bundle.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error('Unexpected ext-apps bundle format');
  const names = Object.fromEntries(m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)).map(([a, b]) => [b ?? a, a]));
  bundle = bundle.slice(0, m.index) +
    `\nconst __NearleApp=${names.App},__applyDocumentTheme=${names.applyDocumentTheme},` +
    `__applyHostStyleVariables=${names.applyHostStyleVariables},__applyHostFonts=${names.applyHostFonts};\n`;
  const html = fs.readFileSync(new URL('./widget.html', import.meta.url), 'utf8');
  return html.split('__BASE__').join(config.publicUrl).replace('__APP_BUNDLE__', () => bundle.replace(/<\/script/gi, '<\\/script'));
}

let HTML = null;

// ── Tools ─────────────────────────────────────────────────────────────────

export function registerTools(server) {
  HTML ??= widgetHtml();

  registerAppResource(server, 'Nearle shop card', UI, { description: 'Nearle products, cart and order card' }, async () => ({
    contents: [{
      uri: UI,
      mimeType: RESOURCE_MIME_TYPE,
      text: HTML,
      _meta: { ui: { csp: { resourceDomains: [config.publicUrl] }, prefersBorder: true } },
    }],
  }));

  registerAppTool(
    server,
    'list_stores',
    {
      title: 'List nearby Nearle stores',
      description: 'Lists Nearle Daily stores that deliver to the customer, nearest first, with open/closed status and categories. The user sees them as cards.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: ui,
    },
    async (_args, extra) => {
      const list = await cat.stores(cidOf(extra));
      const stores = list.map((s) => ({
        store_id: s.tenantid, name: s.name, area: s.area, open: s.open,
        distance_km: s.km ?? undefined, delivery_charge: money(s.charge),
        categories: s.categories.slice(0, 12),
      }));
      return result(stores, { view: 'stores', stores });
    },
  );

  registerAppTool(
    server,
    'browse_store',
    {
      title: 'Browse a store',
      description: 'Shows a store\'s categories, or the products in one category (with photos and Add buttons). Use store name or store_id.',
      inputSchema: {
        store: z.string().describe('Store name or store_id'),
        category: z.string().optional().describe('Category name to list products of'),
      },
      annotations: { readOnlyHint: true },
      _meta: ui,
    },
    async ({ store, category }, extra) => {
      const s = await cat.findStore(cidOf(extra), store);
      if (!s) return fail(`No store matches "${store}". Call list_stores.`);
      const secs = await cat.sections(s);
      const storeInfo = { store_id: s.tenantid, name: s.name, open: s.open };
      if (!category) {
        const categories = secs.map((x) => ({ name: x.name, count: x.products.filter((p) => p.available).length }));
        return result({ ...storeInfo, categories }, { view: 'categories', store: storeInfo, categories });
      }
      const q = category.toLowerCase();
      const sec = secs.find((x) => x.name.toLowerCase() === q) ?? secs.find((x) => x.name.toLowerCase().includes(q));
      if (!sec) return fail(`No category "${category}" in ${s.name}. Categories: ${secs.map((x) => x.name).join(', ')}`);
      const items = sec.products.filter((p) => p.available && p.price).slice(0, 30);
      return result(
        { ...storeInfo, category: sec.name, products: items.map((p) => claudeItem(p, s)) },
        { view: 'products', subtitle: `${s.name} · ${sec.name}`, store: storeInfo,
          groups: [{ title: sec.name, items: items.map((p) => cardItem(p, s)) }] },
      );
    },
  );

  registerAppTool(
    server,
    'search_products',
    {
      title: 'Search products',
      description: 'Searches products by name in all open nearby stores (or one store), cheapest first, and shows them to the user as photo cards with Add buttons and a cart. ' +
        'Pass every item of a shopping list at once. Returns store_id and productid for place_order.',
      inputSchema: {
        items: z.array(z.string()).min(1).max(10).describe('Item names, e.g. ["tomato", "milk 500ml"]'),
        store: z.string().optional().describe('Only search this store (name or store_id)'),
      },
      annotations: { readOnlyHint: true },
      _meta: ui,
    },
    async ({ items, store }, extra) => {
      const cid = cidOf(extra);
      let only = null;
      if (store) {
        only = await cat.findStore(cid, store);
        if (!only) return fail(`No store matches "${store}". Call list_stores.`);
      }
      const all = await cat.stores(cid);
      const byId = new Map(all.map((s) => [s.tenantid, s]));
      const found = await Promise.all(items.map((q) => cat.search(cid, q, only)));
      const forClaude = {};
      const groups = items.map((q, i) => {
        const hits = found[i].slice(0, 8);
        forClaude[q] = hits.map((p) => claudeItem(p, byId.get(p.tenantid) ?? { tenantid: p.tenantid, name: p.store }));
        return { title: q, items: hits.map((p) => cardItem(p, byId.get(p.tenantid) ?? { tenantid: p.tenantid, name: p.store })) };
      });
      return result(
        { results: forClaude, note: 'The user sees these as cards with Add buttons and can order from the card.' },
        { view: 'products', subtitle: only ? only.name : 'Cheapest first across nearby stores', groups },
      );
    },
  );

  registerAppTool(
    server,
    'place_order',
    {
      title: 'Place order (Cash on Delivery)',
      description:
        'Orders products from ONE store, delivered to the customer\'s saved address in the earliest slot, Cash on Delivery. ' +
        'First call with confirm=false to show the bill card, and only after the user clearly says yes call again with confirm=true. ' +
        'If the user already placed the order from the card, do not place it again.',
      inputSchema: {
        store_id: z.number().int().describe('store_id from search_products / list_stores'),
        items: z.array(z.object({
          productid: z.number().int(),
          qty: z.number().int().min(1).max(50),
        })).min(1).max(40),
        confirm: z.boolean().default(false).describe('false = show bill only; true = place the order'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: ui,
    },
    async ({ store_id, items, confirm }, extra) => {
      const cid = cidOf(extra);
      const s = await cat.storeById(cid, store_id);
      if (!s) return fail('Unknown store_id. Call list_stores.');
      if (!s.open) return fail(`${s.name} is closed now. Pick another store.`);

      const lines = [];
      for (const it of items) {
        const p = await cat.findProduct(s, it.productid);
        if (!p) return fail(`Product ${it.productid} is not in ${s.name}. Search again.`);
        if (!p.available) return fail(`${p.name} is out of stock at ${s.name}.`);
        lines.push({ p, qty: it.qty });
      }

      const addr = await cat.homeAddress(cid);
      if (!addr) return fail('No saved delivery address on your Nearle account. Add one in the Nearle app.');
      if (s.km != null && s.km > 5) return fail(`${s.name} is ${s.km} km away — outside the 5 km delivery area.`);

      const slot = (await api.slots(s.tenantid, s.locationid))[0];
      if (!slot) return fail(`${s.name} has no delivery slots now.`);

      const subtotal = lines.reduce((t, l) => t + l.p.price * l.qty, 0);
      const tax = lines.reduce((t, l) => t + l.p.tax * l.qty, 0);
      const total = subtotal + tax + s.charge;
      const bill = {
        store: s.name,
        items: lines.map((l) => ({ name: l.p.name, unit: l.p.unit, qty: l.qty, amount: money(l.p.price * l.qty), image: img(l.p.image) })),
        subtotal: money(subtotal),
        tax: tax ? money(tax) : 0,
        delivery: money(s.charge),
        total: money(total),
        payment: 'Cash on Delivery',
        address: [addr.doorno, addr.address].filter(Boolean).join(', '),
        slot: slotLabel(slot),
      };
      const forClaude = { ...bill, items: bill.items.map(({ image, ...l }) => ({ ...l, amount: rs(l.amount) })),
        subtotal: rs(subtotal), total: rs(total), delivery: rs(s.charge) };
      const cards = lines.map((l) => ({ ...cardItem(l.p, s), qty: l.qty }));

      if (!confirm) {
        return result(
          { ...forClaude, next: 'The user sees this bill with a Place order button. If they say yes in chat instead, call again with confirm=true.' },
          { view: 'bill', bill, cards, order: { store_id, items } },
        );
      }

      const who = await api.profile(cid);
      const now = istNow();
      const status = await api.createOrder({
        applocationid: s.applocationid,
        applocation: '',
        tenantid: s.tenantid,
        partnerid: 60,
        locationid: s.locationid,
        categoryid: lines[0].p.categoryid,
        subcategoryid: lines[0].p.subcategoryid,
        moduleid: 2,
        configid: 1,
        orderdate: now,
        deliverydate: now,
        orderstatus: 'created',
        deliverycharge: s.charge,
        customerid: cid,
        pickupcustomer: s.name,
        pickupcontactno: s.phone,
        pickupaddress: s.address,
        pickuplocationid: s.locationid,
        pickupcity: s.city,
        deliverycustomer: who.name,
        deliverycontactno: who.phone,
        deliveryaddress: addr.address,
        deliverylocationid: addr.locationid,
        deliverylat: addr.latitude,
        deliverylong: addr.longitude,
        paymenttype: 42, // Cash on Delivery
        deliveryslotid: slot.deliveryslotid,
        deliveryslotdate: slot.slotdate,
        items: lines.map((l) => ({
          productid: l.p.productid,
          productname: l.p.name,
          productdescription: '',
          orderqty: l.qty,
          price: l.p.cost,
          discount: 0,
          tax,
          tenantfee: s.charge,
          unitid: Number.parseInt(l.p.unitvalue, 10) || 1,
          unitname: `${l.p.productunit || 'unit'}`.split('.').pop(),
          productsumprice: total,
        })),
      });

      if (status === 'accepted') {
        api.notifyStore(s, who.name);
        return result({ placed: true, ...forClaude, message: 'Order placed. Track it in the Nearle app.' }, { view: 'placed', bill });
      }
      if (status === 'insufficient_stock') return fail('Some items just went out of stock. Search again.');
      return fail(`The order was not accepted (status: ${status || 'no response'}). Try again or use the Nearle app.`);
    },
  );
}

/** "Today, 12 PM – 3 PM" */
function slotLabel(s) {
  const t = (x) => {
    const [h, m] = `${x}`.split(':').map(Number);
    if (Number.isNaN(h)) return x;
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 || 12;
    return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
  };
  const today = istNow().slice(0, 10);
  const day = s.slotdate?.slice(0, 10) === today ? 'Today' : s.istomorrow ? 'Tomorrow' : s.slotdate;
  return `${day}, ${t(s.starttime)} – ${t(s.endtime)}`;
}

/** "YYYY-MM-DD HH:mm:ss" in India time. */
function istNow() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}
