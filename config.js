// Settings from environment / .env (see .env.example).
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env('PORT', '3333')),
  // Public https address. Render sets RENDER_EXTERNAL_URL automatically.
  publicUrl: env('PUBLIC_URL', env('RENDER_EXTERNAL_URL', 'http://localhost:3333')).replace(/\/+$/, ''),
  // Signs login tokens. Long random text; changing it logs everyone out.
  secretKey: env('SECRET_KEY'),
  fiestaBase: env('FIESTA_BASE', 'https://fiesta.nearle.app/live/api/v1/mob').replace(/\/+$/, ''),
  orderUrl: env('ORDER_URL', 'https://queue.workolik.com/live/api/v1/mob/orders/createorder'),
  notifyUrl: env('NOTIFY_URL', 'https://jupiter.nearle.app/live/api/v1/utils/notifyadmin'),
  hasuraSecret: env('HASURA_SECRET', ''),
  // OTP by SMS — same LionSMS account and DLT template as the app.
  // If LIONSMS_KEY is empty, login falls back to mobile number only (testing).
  sms: {
    url: env('LIONSMS_URL', 'https://msg.lionsms.com/api/smsapi'),
    key: env('LIONSMS_KEY'),
    sender: env('LIONSMS_SENDER', 'NEARLE'),
    templateId: env('LIONSMS_TEMPLATE_ID', '1107174712357438611'),
    route: env('LIONSMS_ROUTE', '7'),
    suffix: env('LIONSMS_SUFFIX', ''),
  },
  // Test login for app reviewers (Anthropic / OpenAI): this number + this OTP, no SMS sent.
  reviewPhone: env('REVIEW_PHONE'),
  reviewOtp: env('REVIEW_OTP'),
  supportEmail: env('SUPPORT_EMAIL', 'support@nearle.app'),
};
