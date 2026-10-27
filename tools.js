// The tools Claude can use: find stores, see products, search, place order.
import { z } from 'zod';
import * as api from './nearle.js';
import * as cat from './catalog.js';

const rs = (n) => `₹${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '')}`;
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const cidOf = (extra) => extra?.authInfo?.extra?.customerId;
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

const item = (p) => ({
  productid: p.productid,
  name: p.name,
  unit: p.unit || undefined,
  price: rs(p.price),
  mrp: p.discount ? rs(p.cost) : undefined,
  image: p.image || undefined,
});

export function registerTools(server) {
  server.registerTool(
    'list_stores',
    {
      title: 'List nearby Nearle stores',
      description: 'Lists Nearle Daily stores that deliver to the customer, nearest first, with open/closed status and categories.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      const list = await cat.stores(cidOf(extra));
      return ok(list.map((s) => ({
        store_id: s.tenantid, name: s.name, area: s.area, open: s.open,
        distance_km: s.km ?? undefined, delivery_charge: rs(s.charge),
        categories: s.categories.slice(0, 12),
      })));
    },
  );

  server.registerTool(
    'browse_store',
    {
      title: 'Browse a store',
      description: 'Shows a store\'s categories, or the products in one category. Use store name or store_id.',
      inputSchema: {
        store: z.string().describe('Store name or store_id'),
        category: z.string().optional().describe('Category name to list products of'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ store, category }, extra) => {
      const s = await cat.findStore(cidOf(extra), store);
      if (!s) return fail(`No store matches "${store}". Call list_stores.`);
      const secs = await cat.sections(s);
      if (!category) {
        return ok({ store_id: s.tenantid, store: s.name, open: s.open,
          categories: secs.map((x) => ({ name: x.name, products: x.products.length })) });
      }
      const q = category.toLowerCase();
      const sec = secs.find((x) => x.name.toLowerCase() === q) ?? secs.find((x) => x.name.toLowerCase().includes(q));
      if (!sec) return fail(`No category "${category}" in ${s.name}. Categories: ${secs.map((x) => x.name).join(', ')}`);
      return ok({ store_id: s.tenantid, store: s.name, category: sec.name,
        products: sec.products.filter((p) => p.available).slice(0, 40).map(item) });
    },
  );

  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description: 'Searches products by name in all open nearby stores (or one store) and returns matches cheapest first, with store_id and productid for ordering. Pass several item names to search a whole list at once.',
      inputSchema: {
        items: z.array(z.string()).min(1).max(10).describe('Item names, e.g. ["tomato", "milk 500ml"]'),
        store: z.string().optional().describe('Only search this store (name or store_id)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ items, store }, extra) => {
      const cid = cidOf(extra);
      let s = null;
      if (store) {
        s = await cat.findStore(cid, store);
        if (!s) return fail(`No store matches "${store}". Call list_stores.`);
      }
      const results = {};
      for (const q of items) {
        const hits = await cat.search(cid, q, s);
        results[q] = hits.slice(0, 8).map((p) => ({ store_id: p.tenantid, store: p.store, ...item(p) }));
      }
      return ok(results);
    },
  );

  server.registerTool(
    'place_order',
    {
      title: 'Place order (Cash on Delivery)',
      description:
        'Orders products from ONE store, delivered to the customer\'s saved address in the earliest slot, Cash on Delivery. ' +
        'First call with confirm=false to get the bill, show it to the user, and only after they clearly say yes call again with confirm=true.',
      inputSchema: {
        store_id: z.number().int().describe('store_id from search_products / list_stores'),
        items: z.array(z.object({
          productid: z.number().int(),
          qty: z.number().int().min(1).max(50),
        })).min(1).max(40),
        confirm: z.boolean().default(false).describe('false = show bill only; true = place the order'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ store_id, items, confirm }, extra) => {
      const cid = cidOf(extra);
      const s = await cat.storeById(cid, store_id);
      if (!s) return fail('Unknown store_id. Call list_stores.');
      if (!s.open) return fail(`${s.name} is closed now. Pick another store.`);

      const all = await cat.products(s);
      const lines = [];
      for (const it of items) {
        const p = all.find((x) => x.productid === it.productid);
        if (!p) return fail(`Product ${it.productid} is not in ${s.name}. Search again.`);
        if (!p.available) return fail(`${p.name} is out of stock at ${s.name}.`);
        lines.push({ p, qty: it.qty });
      }

      const addr = await cat.homeAddress(cid);
      if (!addr) return fail('No saved delivery address on the Nearle account. Add one in the Nearle app.');
      if (s.km != null && s.km > 5) return fail(`${s.name} is ${s.km} km away — outside the 5 km delivery area.`);

      const slotList = await api.slots(s.tenantid, s.locationid);
      const slot = slotList[0];
      if (!slot) return fail(`${s.name} has no delivery slots now.`);

      const subtotal = lines.reduce((t, l) => t + l.p.price * l.qty, 0);
      const tax = lines.reduce((t, l) => t + l.p.tax * l.qty, 0);
      const total = subtotal + tax + s.charge;
      const bill = {
        store: s.name,
        items: lines.map((l) => ({ name: l.p.name, unit: l.p.unit, qty: l.qty, amount: rs(l.p.price * l.qty) })),
        subtotal: rs(subtotal),
        tax: tax ? rs(tax) : undefined,
        delivery: rs(s.charge),
        total: rs(total),
        payment: 'Cash on Delivery',
        address: [addr.doorno, addr.address].filter(Boolean).join(', '),
        slot: `${slot.istomorrow ? 'Tomorrow' : slot.slotdate} ${slot.starttime}–${slot.endtime}`,
      };
      if (!confirm) return ok({ ...bill, next: 'Show this bill. Call again with confirm=true only after the user says yes.' });

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
        return ok({ placed: true, ...bill, message: 'Order placed! Track it in the Nearle app.' });
      }
      if (status === 'insufficient_stock') return fail('Some items just went out of stock. Search again.');
      return fail(`Order was not accepted (status: ${status || 'no response'}). Try again or use the Nearle app.`);
    },
  );
}

/** "YYYY-MM-DD HH:mm:ss" in India time. */
function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
