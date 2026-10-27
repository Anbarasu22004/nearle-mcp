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
};
