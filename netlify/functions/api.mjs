// Sleeping Fox: server for the shop page, with its data in Netlify Blobs.
//   GET  /api/state                 catalogue + page settings (public)
//   PUT  /api/state                 save them (admin)
//   POST /api/login                 check the admin user and password
//   POST /api/img  ·  GET /api/img/<id>   store / serve images
//   GET  /api/config                public settings for the page (Google sign-in client id)
//   POST /api/auth/register|login|google  customer accounts
//   POST /api/order                 a customer sends an order (public; linked to the account when signed in)
//   GET  /api/orders                every order (admin)       GET /api/my/orders   the customer's own
//   PATCH|DELETE /api/orders/<id>   change status / delete (admin)
//   POST /api/orders/<id>/msg|seen  chat on an order (admin or the customer who placed it)
import { getStore } from "@netlify/blobs";
import { createHash, createHmac, timingSafeEqual, randomUUID, randomBytes, scryptSync } from "node:crypto";

const API = { "x-sf-api": "1" };
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...API, "content-type": "application/json", "cache-control": "no-store", ...extra } });
const clip = (v, n = 300) => String(v ?? "").slice(0, n);
const STATUSES = { nuevo: "Nuevo", confirmado: "Confirmado", produccion: "En producción", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };

const ADMIN_USER = () => (process.env.ADMIN_USER || "Mari").trim().toLowerCase();
const ADMIN_PASS = () => process.env.ADMIN_PASSWORD || "Gael123";
const SECRET = () => process.env.SESSION_SECRET || "sf-session:" + ADMIN_PASS() + ":" + (process.env.SITE_ID || "local");
const sha = (s) => createHash("sha256").update(String(s)).digest();
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

function isAdmin(req) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let raw; try { raw = Buffer.from(h.slice(6), "base64").toString("utf8"); } catch { return false; }
  const i = raw.indexOf(":"); if (i < 0) return false;
  return raw.slice(0, i).trim().toLowerCase() === ADMIN_USER() && timingSafeEqual(sha(raw.slice(i + 1)), sha(ADMIN_PASS()));
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + createHmac("sha256", SECRET()).update(body).digest("base64url");
}
function customer(req) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const [body, sig] = h.slice(7).split(".");
  if (!body || !sig || !same(sig, createHmac("sha256", SECRET()).update(body).digest("base64url"))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const userKey = (email) => "users/" + createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
const session = (u) => ({ token: sign({ uid: u.uid, name: u.name, email: u.email, exp: Date.now() + 30 * 864e5 }), user: { uid: u.uid, name: u.name, email: u.email } });
const hashPass = (pass, salt) => scryptSync(pass, salt, 32).toString("hex");

async function allOrders(store) {
  const { blobs } = await store.list({ prefix: "orders/" });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 500);
  return (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const store = getStore({ name: "sleeping-fox", consistency: "strong" });
  const body = async () => { try { return await req.json(); } catch { return null; } };

  // ---- catalogue
  if (path === "state") {
    if (req.method === "GET") { const d = await store.get("state", { type: "json" }); return d ? json(d) : json({}, 404); }
    if (req.method === "PUT") {
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
      const d = await body();
      if (!d || typeof d.settings !== "object" || !Array.isArray(d.products)) return json({ error: "bad shape" }, 400);
      const prev = await store.get("state", { type: "json" });
      if (prev) await store.setJSON("state-previous", prev);
      await store.setJSON("state", { settings: d.settings, products: d.products, savedAt: new Date().toISOString() });
      return json({ ok: true });
    }
  }
  if (path === "login" && req.method === "POST") return isAdmin(req) ? json({ ok: true }) : json({ error: "unauthorized" }, 401);
  if (path === "config" && req.method === "GET") return json({ google: process.env.GOOGLE_CLIENT_ID || "" });

  // ---- images
  if (path === "img" && req.method === "POST") {
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(await req.text());
    if (!m) return json({ error: "not an image" }, 400);
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 5 * 1024 * 1024) return json({ error: "too large" }, 413);
    const key = "img/" + randomUUID();
    await store.set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { metadata: { type: m[1].toLowerCase() } });
    return json({ url: "/api/" + key });
  }
  if (path.startsWith("img/") && req.method === "GET") {
    const hit = await store.getWithMetadata(path, { type: "arrayBuffer" });
    if (!hit) return new Response("not found", { status: 404, headers: API });
    return new Response(hit.data, { headers: { ...API, "content-type": hit.metadata?.type || "image/webp", "cache-control": "public, max-age=31536000, immutable" } });
  }

  // ---- customer accounts
  if (path === "auth/register" && req.method === "POST") {
    const d = (await body()) || {};
    const email = clip(d.email, 120).trim().toLowerCase(), name = clip(d.name, 60).trim(), pass = String(d.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pass.length < 6 || pass.length > 200) return json({ error: "invalid" }, 400);
    const key = userKey(email);
    if (await store.get(key, { type: "json" })) return json({ error: "exists" }, 409);
    const salt = randomBytes(16).toString("hex");
    const u = { uid: key.slice(6, 26), email, name: name || email.split("@")[0], salt, hash: hashPass(pass, salt), created: new Date().toISOString() };
    await store.setJSON(key, u);
    return json(session(u));
  }
  if (path === "auth/login" && req.method === "POST") {
    const d = (await body()) || {};
    const email = clip(d.email, 120).trim().toLowerCase();
    const u = email ? await store.get(userKey(email), { type: "json" }) : null;
    if (!u || !u.hash || !same(hashPass(String(d.password || ""), u.salt), u.hash)) return json({ error: "unauthorized" }, 401);
    return json(session(u));
  }
  if (path === "auth/google" && req.method === "POST") {
    const cid = process.env.GOOGLE_CLIENT_ID;
    const d = (await body()) || {};
    if (!cid || !d.credential) return json({ error: "google not configured" }, 400);
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(d.credential));
    const g = r.ok ? await r.json() : null;
    if (!g || g.aud !== cid || !/accounts\.google\.com$/.test(g.iss || "") || String(g.email_verified) !== "true" || !g.email) return json({ error: "unauthorized" }, 401);
    const key = userKey(g.email);
    let u = await store.get(key, { type: "json" });
    if (!u) u = { uid: key.slice(6, 26), email: g.email.toLowerCase(), name: clip(g.name || g.email.split("@")[0], 60), created: new Date().toISOString() };
    u.google = g.sub;
    await store.setJSON(key, u);
    return json(session(u));
  }

  // ---- orders
  if (path === "order" && req.method === "POST") {
    const text = await req.text();
    if (text.length > 60000) return json({ error: "too large" }, 413);
    let o; try { o = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
    const who = customer(req);
    const items = (Array.isArray(o.items) ? o.items : []).slice(0, 100).map((i) => ({ title: clip(i.title, 120), garment: clip(i.garment, 40), color: clip(i.color, 40), size: clip(i.size, 12), qty: Math.max(1, Math.min(999, parseInt(i.qty) || 1)), pers: clip(i.pers, 160), price: Math.max(0, +i.price || 0) }));
    const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, 300).map((r) => ({ n: clip(r.n, 60), num: clip(r.num, 4), s: clip(r.s, 8) }));
    if (!items.length && !rows.length) return json({ error: "empty" }, 400);
    const id = Date.now().toString(36) + "-" + randomUUID().slice(0, 6);
    const rec = { id, at: new Date().toISOString(), status: "nuevo", type: o.type === "equipo" ? "equipo" : "pedido",
      uid: who ? who.uid : "", email: who ? who.email : "", name: clip(o.name, 80) || (who ? who.name : ""), phone: clip(o.phone, 40),
      club: clip(o.club, 80), design: clip(o.design, 120), garment: clip(o.garment, 40), color: clip(o.color, 40),
      dest: clip(o.dest, 120), note: clip(o.note, 800), ship: clip(o.ship, 160), total: Math.max(0, +o.total || 0), items, rows, msgs: [], unreadAdmin: 0, unreadClient: 0 };
    await store.setJSON("orders/" + id, rec);
    return json({ ok: true, id });
  }
  if (path === "orders" && req.method === "GET") {
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
    return json(await allOrders(store));
  }
  if (path === "my/orders" && req.method === "GET") {
    const who = customer(req);
    if (!who) return json({ error: "unauthorized" }, 401);
    return json((await allOrders(store)).filter((o) => o.uid === who.uid));
  }
  const om = /^orders\/([a-z0-9-]{4,40})(?:\/(msg|seen))?$/.exec(path);
  if (om) {
    const key = "orders/" + om[1], rec = await store.get(key, { type: "json" });
    if (!rec) return json({ error: "not found" }, 404);
    const admin = isAdmin(req), who = customer(req), owner = !!(who && rec.uid && who.uid === rec.uid);
    if (!om[2]) {
      if (!admin) return json({ error: "unauthorized" }, 401);
      if (req.method === "DELETE") { await store.delete(key); return json({ ok: true }); }
      if (req.method === "PATCH") {
        const d = (await body()) || {};
        if (STATUSES[d.status] && d.status !== rec.status) {
          rec.status = d.status;
          rec.msgs = (rec.msgs || []).concat({ from: "sistema", text: "Tu pedido pasó a «" + STATUSES[d.status] + "».", at: new Date().toISOString() }).slice(-300);
          if (rec.uid) rec.unreadClient = (rec.unreadClient || 0) + 1;
          await store.setJSON(key, rec);
        }
        return json(rec);
      }
    }
    if (req.method === "POST" && (admin || owner)) {
      if (om[2] === "seen") { if (admin) rec.unreadAdmin = 0; else rec.unreadClient = 0; await store.setJSON(key, rec); return json({ ok: true }); }
      if (om[2] === "msg") {
        const d = (await body()) || {}, text = clip(d.text, 1000).trim();
        if (!text) return json({ error: "empty" }, 400);
        rec.msgs = (rec.msgs || []).concat({ from: admin ? "admin" : "cliente", text, at: new Date().toISOString() }).slice(-300);
        if (admin) rec.unreadClient = (rec.unreadClient || 0) + 1; else rec.unreadAdmin = (rec.unreadAdmin || 0) + 1;
        await store.setJSON(key, rec);
        return json(rec);
      }
    }
    return json({ error: "unauthorized" }, 401);
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: "/api/*" };
