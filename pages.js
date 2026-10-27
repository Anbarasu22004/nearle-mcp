// Public pages the connector directories ask for: /privacy and /help.
import { config } from './config.js';

const UPDATED = '27 October 2026';

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Nearle Daily</title>
<style>
:root{--ink:#1d1630;--muted:#5f5872;--brand:#662582;--soft:#f6f1f9;--line:#e8def0}
@media (prefers-color-scheme:dark){:root{--ink:#f3eef8;--muted:#b9b0c8;--soft:#1c1622;--line:#3a3044}body{background:#141018}}
*{box-sizing:border-box}body{margin:0;font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#fff}
header{background:var(--brand);color:#fff;padding:28px 16px}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header .wrap{display:flex;align-items:center;gap:14px;padding:0}
header img{width:48px;height:48px;border-radius:12px;background:#fff}
header h1{margin:0;font-size:24px}header p{margin:2px 0 0;opacity:.85;font-size:14px}
main{padding:24px 0 48px}h2{font-size:19px;margin:28px 0 8px}
p,li{color:var(--muted)}strong{color:var(--ink)}a{color:var(--brand)}
code{background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:14px;word-break:break-all}
.box{background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:12px 0}
footer{border-top:1px solid var(--line);padding:18px 0;color:var(--muted);font-size:13px}
</style></head><body>
<header><div class="wrap"><img src="/logo.png" alt=""><div><h1>${title}</h1><p>Nearle Daily for Claude and ChatGPT</p></div></div></header>
<main class="wrap">${body}</main>
<footer class="wrap">Nearle Daily · <a href="/help">Help</a> · <a href="/privacy">Privacy</a> · <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></footer>
</body></html>`;
}

export function privacyPage() {
  return shell('Privacy Policy', `
<p>Last updated: ${UPDATED}</p>
<p>This policy covers the <strong>Nearle Daily connector</strong>, which lets you search nearby Nearle stores and place
Cash on Delivery orders from AI assistants such as Claude and ChatGPT. It works with your existing Nearle account.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Mobile number</strong>: to send a one-time password (OTP) and find your Nearle account.</li>
<li><strong>Your Nearle customer ID</strong>: kept inside the sign-in token so the connector can act for your account.</li>
<li><strong>Saved delivery address, name and phone</strong>: read from your Nearle account when you search or order, to find nearby stores and deliver the order.</li>
<li><strong>What you search for and order</strong>: the item names, store and quantities the assistant sends to the connector.</li>
</ul>
<p>We do <strong>not</strong> collect payment card or bank details (orders are Cash on Delivery), and we do not read or store your
conversations with the assistant. We only receive the specific requests the assistant sends to our tools.</p>

<h2>How we use it</h2>
<ul>
<li>To sign you in, show stores and products, compare prices, prepare the bill and place the orders you confirm.</li>
<li>Orders are created in Nearle exactly like orders from the Nearle app, and the store is notified to prepare them.</li>
</ul>
<p>We do not sell your data, use it for advertising, or build profiles from it.</p>

<h2>Storage and retention</h2>
<ul>
<li>The connector has <strong>no database</strong>. Sign-in tokens are signed and stored by the assistant app, not by us. They expire after 1 day (access) and 6 months (refresh), or sooner if you disconnect.</li>
<li>Store and product lists are cached in memory for about 5 minutes for speed, and nothing else is kept after a request.</li>
<li>OTPs are never stored. Only a one-way check value is kept inside the login page for 5 minutes.</li>
<li>Orders you place are kept in your Nearle account under the Nearle app's normal terms.</li>
</ul>

<h2>Who we share it with</h2>
<ul>
<li><strong>Nearle</strong> (our own systems) for your account, stores, products and orders.</li>
<li><strong>Partner stores</strong> receive your order, name, phone and delivery address to fulfil it, as with app orders.</li>
<li><strong>LionSMS</strong>, our SMS provider, receives your mobile number to deliver the OTP.</li>
<li><strong>Our hosting provider</strong> runs the connector server.</li>
<li>The <strong>AI assistant</strong> you use (for example Claude by Anthropic or ChatGPT by OpenAI) sees the tool results shown in your chat, under its own privacy policy.</li>
</ul>

<h2>Your choices</h2>
<ul>
<li>Disconnect Nearle Daily any time in your assistant's connector settings. This ends the connector's access.</li>
<li>To access, correct or delete your Nearle account data, email us at <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>.</li>
</ul>

<h2>Security</h2>
<p>All traffic uses HTTPS. Sign-in uses OAuth 2.0 with an SMS OTP, and every order needs your confirmation before it is placed.</p>

<h2>Contact</h2>
<p>Questions about this policy: <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p>`);
}

export function helpPage() {
  const url = `${config.publicUrl}/mcp`;
  return shell('Help', `
<p>Nearle Daily lets you order groceries from nearby Nearle stores in Coimbatore by chatting with an AI assistant.
Ask in plain words: the assistant finds products, compares prices across stores and places a
<strong>Cash on Delivery</strong> order to your saved Nearle address after you confirm.</p>

<h2>Before you start</h2>
<ul>
<li>A Nearle account with at least one saved delivery address. Sign up in the Nearle app.</li>
<li>Your mobile number for the OTP sign-in.</li>
</ul>

<h2>Connect in Claude</h2>
<ol>
<li>Open <strong>Settings → Connectors</strong>. Find <strong>Nearle Daily</strong>, or choose <strong>Add custom connector</strong> and use <code>${url}</code>.</li>
<li>Click <strong>Connect</strong>, enter your mobile number, then the OTP.</li>
<li>In a chat, make sure Nearle Daily is turned on in the tools menu.</li>
</ol>

<h2>Connect in ChatGPT</h2>
<ol>
<li>Open <strong>Settings → Apps &amp; Connectors</strong> and turn on Developer mode under Advanced settings.</li>
<li>Click <strong>Create</strong>. Use connector URL <code>${url}</code> with authentication <strong>OAuth</strong>.</li>
<li>Sign in with your mobile number and OTP.</li>
</ol>

<h2>Things to ask</h2>
<div class="box">
<p>“Show Nearle stores near me”<br>
“Where is tomato and onion cheapest?”<br>
“What vegetables does R Mart have?”<br>
“Order 1 kg tomato and 2 milk packets from Nearle”</p>
</div>

<h2>Tools</h2>
<ul>
<li><strong>List nearby stores</strong> (read-only): open stores near your address, nearest first.</li>
<li><strong>Browse a store</strong> (read-only): categories and products of one store.</li>
<li><strong>Search products</strong> (read-only): finds items across stores, cheapest first.</li>
<li><strong>Place order</strong> (write): shows the bill first, then places a Cash on Delivery order only after you confirm.</li>
</ul>

<h2>Good to know</h2>
<ul>
<li>One store per order. Delivery uses the store's earliest available slot.</li>
<li>Track and manage your orders in the Nearle app.</li>
<li>To disconnect, remove Nearle Daily in your assistant's connector settings.</li>
</ul>

<h2>Support</h2>
<p>Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>. See also our <a href="/privacy">Privacy Policy</a>.</p>`);
}
