/* Probe that mirrors the extension's execution path:
 *  - POST /v1/statement with Trino + Presto headers (HTTPS + Basic Auth)
 *  - Follow nextUri with axios GET until either no nextUri or PRESTO_MAX_ROWS reached
 *  - Print summary + first few rows
 * Usage:
 *   1) Copy env.example -> .env.local and fill PRESTO_PASSWORD
 *   2) npm run probe:extension
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';

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
const testSql = (process.env.PRESTO_TEST_SQL || 'select 1').trim();
const maxRows = Number(process.env.PRESTO_MAX_ROWS || 500);

const server = `${ssl ? 'https' : 'http'}://${host}:${port}`;
const statementUrl = `${server}/v1/statement`;
const httpsAgent = ssl ? new https.Agent({ rejectUnauthorized: sslVerify }) : undefined;
const basicAuth = password
  ? 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
  : undefined;

function makeHeaders() {
  const h = {
    'Content-Type': 'text/plain; charset=utf-8',
    Accept: 'application/json',
    'User-Agent': 'sql-preview-probe/extension-path',
    'X-Trino-User': user,
    'X-Trino-Catalog': catalog,
    'X-Trino-Schema': schema,
    'X-Trino-Source': 'sql-preview',
    'X-Presto-User': user,
    'X-Presto-Catalog': catalog,
    'X-Presto-Schema': schema,
    'X-Presto-Source': 'sql-preview',
  };
  if (basicAuth) {
    h['Authorization'] = basicAuth;
  }
  return h;
}

async function run() {
  const sql = testSql;
  console.log('POST', statementUrl, 'sql=', sql.replace(/\s+/g, ' ').slice(0, 120));
  const initial = await axios.post(statementUrl, sql, {
    headers: makeHeaders(),
    ...(httpsAgent ? { httpsAgent } : {}),
  });
  const data = initial.data;

  let columns = data.columns || null;
  const rows = [];
  if (Array.isArray(data.data)) {
    rows.push(...data.data);
  }
  let nextUri = data.nextUri;
  let pages = 1;

  while (nextUri && rows.length < maxRows) {
    pages++;
    const resp = await axios.get(nextUri, {
      headers: basicAuth ? { Authorization: basicAuth } : {},
      ...(httpsAgent ? { httpsAgent } : {}),
      validateStatus: () => true,
    });
    if (resp.status >= 400) {
      throw new Error(`GET ${nextUri} -> ${resp.status}`);
    }
    const page = resp.data;
    if (!columns && page.columns) {
      columns = page.columns;
    }
    if (Array.isArray(page.data)) {
      rows.push(...page.data);
    }
    nextUri = page.nextUri;
  }

  console.log('queryId:', data.id || 'n/a');
  console.log('pages:', pages, 'rowsFetched:', rows.length, 'hasColumns:', !!columns);
  if (columns && rows.length > 0) {
    const header = columns.map(c => c.name).join(', ');
    console.log('columns:', header);
    console.log('firstRow:', JSON.stringify(rows[0]));
  }
}

run().catch(err => {
  console.error('Probe failed:', err && err.message ? err.message : err);
  process.exit(1);
});
