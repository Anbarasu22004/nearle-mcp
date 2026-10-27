// Calls Nearle's existing APIs — the same ones the Nearle app uses.
import { config } from './config.js';

const TIMEOUT = 20000;

async function http(method, url, { body, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text, _status: res.status };
    }
  } finally {
    clearTimeout(t);
  }
}

const f = (p) => `${config.fiestaBase}/${p}`;
const num = (v) => (typeof v === 'number' ? v : Number.parseFloat(v ?? '') || 0);
const int = (v) => (v == null || v === '' ? null : Number.parseInt(v, 10));

// ── Customer ──────────────────────────────────────────────────────────────

/** Same login call the app makes with the mobile number → customerId or null. */
export async function loginByPhone(phone) {
  const r = await http('POST', f('customers/login'), {
    body: { contactno: phone, configid: 2, devicetype: 'claude', customertoken: '', deviceid: 'claude-connector' },
  });
  const id = int(r?.details?.customerid);
  return r?.status !== false && id ? id : null;
}

export async function profile(customerId) {
  const r = await http('GET', `${f('customers/getbyid/')}?customerid=${customerId}`);
  const d = r?.details ?? r?.data ?? {};
  return {
    name: `${d.firstname ?? ''} ${d.lastname ?? ''}`.trim(),
    phone: d.contactno ?? '',
  };
}

export async function addresses(customerId) {
  const r = await http('GET', `${f('customers/getcustomerlocation')}?customerid=${customerId}`, {
    headers: config.hasuraSecret ? { 'x-hasura-admin-secret': config.hasuraSecret } : {},
  });
  const list = r?.customerlocations ?? r?.details ?? r?.data ?? [];
  return (Array.isArray(list) ? list : []).map((l) => ({
    locationid: int(l.locationid),
    customerid: int(l.customerid) ?? customerId,
    doorno: l.doorno ?? '',
    address: l.address ?? '',
    suburb: l.suburb ?? '',
    city: l.city ?? '',
    landmark: l.landmark ?? '',
    latitude: `${l.latitude ?? ''}`,
    longitude: `${l.longitude ?? ''}`,
    primary: `${l.primaryaddress}` === '1' || l.primaryaddress === true,
  }));
}

// ── Stores & products ─────────────────────────────────────────────────────

export async function stores(customerId, lat, lng) {
  const r = await http(
    'GET',
    `${f('tenants/getcustomertenants')}?customerid=${customerId}&tenant=0&latitude=${lat ?? ''}&longitude=${lng ?? ''}&categoryid=0`,
  );
  const list = Array.isArray(r?.details) ? r.details : [];
  return list
    .filter((t) => t.tenantid != null)
    .map((t) => ({
      tenantid: int(t.tenantid),
      locationid: int(t.locationid),
      categoryid: int(t.categoryid) ?? 0,
      applocationid: int(t.applocationid),
      name: (t.tenantname ?? 'Store').trim(),
      area: (t.locationname ?? t.suburb ?? '').trim(),
      address: t.address ?? '',
      city: t.city ?? '',
      phone: t.primarycontact ?? '',
      token: t.tenanttoken ?? '',
      charge: num(t.tenantcharge),
      open: t.isopen !== false,
      latitude: num(t.latitude),
      longitude: num(t.longitude),
      categories: (t.productsubcategory ?? [])
        .map((c) => (c.subcategoryname ?? c.subcatname ?? '').trim())
        .filter(Boolean),
    }));
}

/** A store's products grouped by category. */
export async function storeSections(store) {
  const r = await http(
    'GET',
    `${f('products/getproductsbysubcategory')}?categoryid=${store.categoryid}&tenantid=${store.tenantid}&locationid=${store.locationid}`,
  );
  const details = r?.status === true ? r?.data?.details ?? [] : [];
  return details.map((sec) => ({
    name: sec.subcategoryname ?? 'Other',
    products: (sec.products ?? []).map((p) => product(p, store, sec.subcategoryname)),
  })).filter((s) => s.products.length);
}

/** Vector/label search across stores (scan/lookup). Label-only works too. */
export async function lookup(customerId, label, lat, lng, tenantIds) {
  const r = await http('POST', f('scan/lookup'), {
    body: {
      customerid: customerId,
      label,
      latitude: lat ?? 0,
      longitude: lng ?? 0,
      tenantids: tenantIds,
      limit: 0,
      imagevector: [],
      textvector: [],
    },
  });
  const out = [];
  for (const s of r?.details?.stores ?? []) {
    for (const o of s.options ?? []) {
      if (o.available === false) continue;
      out.push({ ...o, tenantid: o.tenantid ?? s.tenantid, locationid: o.locationid ?? s.locationid });
    }
  }
  return out;
}

export function product(p, store, category = '') {
  const cost = num(p.productcost ?? p.retailprice ?? p.price);
  const discount = num(p.discountvalue ?? p.discount);
  const price = discount > 0 && discount < cost ? cost - discount : cost;
  const unit = (p.productunittext ?? `${p.unitvalue ?? ''} ${p.productunit ?? p.size ?? ''}`).trim();
  return {
    productid: int(p.productid),
    name: (p.productname ?? '').trim(),
    image: p.productimage ?? p.image ?? '',
    cost,
    discount: price < cost ? discount : 0,
    price,
    tax: num(p.taxamount),
    unit,
    unitvalue: p.unitvalue ?? '',
    productunit: p.productunit ?? '',
    categoryid: int(p.categoryid) ?? store.categoryid,
    subcategoryid: int(p.subcategoryid),
    category,
    stock: p.productstock ?? p.stock ?? null,
    available: `${p.productstatus ?? ''}`.toLowerCase() !== 'outofstock',
    tenantid: store.tenantid,
    locationid: store.locationid,
  };
}

// ── Checkout ──────────────────────────────────────────────────────────────

export async function slots(tenantid, locationid) {
  const r = await http('GET', `${f('deliveryslots/available')}?tenantid=${tenantid}&locationid=${locationid}`);
  return (Array.isArray(r?.details) ? r.details : [])
    .filter((s) => s.deliveryslotid != null && s.slotdate)
    .map((s) => ({
      deliveryslotid: int(s.deliveryslotid),
      name: s.name ?? '',
      starttime: s.starttime ?? '',
      endtime: s.endtime ?? '',
      slotdate: s.slotdate,
      istomorrow: s.istomorrow === true,
    }));
}

export async function createOrder(order) {
  const r = await http('POST', config.orderUrl, { body: { orders: order } });
  return `${r?.status ?? ''}`.toLowerCase();
}

export async function notifyStore(store, customerName) {
  if (!store.token) return;
  try {
    await http('POST', config.notifyUrl, {
      body: {
        token: [store.token],
        notification: {
          title: 'Nearle Deals - New Order',
          body: `A new order has been placed successfully by ${customerName || 'a customer'}!`,
          sound: 'ring',
          type: 'tojoin',
        },
      },
    });
  } catch {}
}
