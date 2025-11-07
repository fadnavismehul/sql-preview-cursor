/* Minimal connectivity probes for Presto/Trino via Porta.
 * Reads env from .env.local if present (gitignored) and process.env.
 * Usage:
 *   1) copy env.example to .env.local and fill PRESTO_PASSWORD
 *   2) npm run probe
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { Trino, BasicAuth } from 'trino-client';

function loadDotEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) {
    return;
  }
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*[#;]/.test(line)) {
      continue;
    }
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) {
      continue;
    }
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadDotEnvLocal();

const host = process.env.PRESTO_HOST || 'localhost';
const port = Number(process.env.PRESTO_PORT || 443);
const user = process.env.PRESTO_USER || 'user';
const password = process.env.PRESTO_PASSWORD || '';
const catalog = process.env.PRESTO_CATALOG || 'hive';
const schema = process.env.PRESTO_SCHEMA || 'default';
const ssl = String(process.env.PRESTO_SSL || 'true') === 'true';
const sslVerify = String(process.env.PRESTO_SSL_VERIFY || 'true') === 'true';
const testSql = process.env.PRESTO_TEST_SQL || 'select 1';

const server = `${ssl ? 'https' : 'http'}://${host}:${port}`;
const statementUrl = `${server}/v1/statement`;

const httpsAgent = ssl ? new https.Agent({ rejectUnauthorized: sslVerify }) : undefined;
const authHeader = password
  ? 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
  : undefined;

function trinoHeaders() {
  const h = {
    'Content-Type': 'text/plain; charset=utf-8',
    Accept: 'application/json',
    'User-Agent': 'sql-preview-probe/1.0',
    'X-Trino-User': user,
    'X-Trino-Catalog': catalog,
    'X-Trino-Schema': schema,
    'X-Trino-Source': 'probe',
    // Presto compat
    'X-Presto-User': user,
    'X-Presto-Catalog': catalog,
    'X-Presto-Schema': schema,
    'X-Presto-Source': 'probe',
  };
  if (authHeader) {
    h['Authorization'] = authHeader;
  }
  return h;
}

async function probeAxios(label, sql, extraHeaders = {}, setContentLength = false) {
  const data = Buffer.from(sql, 'utf8');
  const headers = { ...trinoHeaders(), ...extraHeaders };
  if (setContentLength) {
    headers['Content-Length'] = String(data.length);
  }
  const cfg = { headers, httpsAgent, validateStatus: () => true, maxRedirects: 0 };
  const res = await axios.post(statementUrl, data, cfg);
  return { label, status: res.status, data: res.data };
}

function probeHttps(label, sql) {
  const data = Buffer.from(sql, 'utf8');
  const headers = trinoHeaders();
  headers['Content-Length'] = String(data.length);
  return new Promise((resolve, reject) => {
    const req = https.request(
      statementUrl,
      { method: 'POST', headers, agent: httpsAgent, rejectUnauthorized: sslVerify },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ label, status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ label, status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function probeTrinoClient(label, sql) {
  const opts = {
    server,
    user,
    catalog,
    schema,
    ...(ssl ? { ssl: { rejectUnauthorized: sslVerify } } : {}),
  };
  if (password) {
    opts.auth = new BasicAuth(user, password);
  }
  const client = Trino.create(opts);
  const iter = await client.query(sql);
  const first = await iter.next();
  return { label, status: 200, data: first.value };
}

(async () => {
  const sql = testSql;
  const tests = [
    () => probeAxios('axios:basic', sql),
    () => probeAxios('axios:explicit-content-length', sql, {}, true),
    () => probeAxios('axios:trailing-newline', sql + '\n'),
    () => probeHttps('https:manual', sql),
    () => probeTrinoClient('trino-client', sql),
  ];

  for (const t of tests) {
    try {
      const r = await t();
      console.log('---', r.label, r.status);
      if (typeof r.data === 'string') {
        console.log(r.data.slice(0, 400));
      } else {
        console.log(JSON.stringify(r.data, null, 2).slice(0, 1200));
      }
    } catch (e) {
      console.log('---', 'error in test', e && e.message ? e.message : e);
    }
  }
})();
