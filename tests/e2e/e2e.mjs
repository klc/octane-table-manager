// Browser and API checks against a running test app (see run.sh). Exits 1 if any check fails.
import { chromium } from 'playwright-core';

const APP = process.env.OTM_E2E_URL ?? 'http://localhost:8097';
const BASE = APP + '/octane-table-manager';
let failed = 0;
const check = (name, ok, extra = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
};

// --- API: pagination must not depend on which worker answers (4 workers, parallel requests) ---
const page_ = async offset => (await (await fetch(`${BASE}/fetch?table=users&offset=${offset}`, { headers: { Connection: 'close' } })).json()).rows.map(r => r._i);
const pages = await Promise.all([0, 50, 100, 150, 200, 250].map(page_));
const keys = pages.flat();
check('parallel pages across workers', JSON.stringify(pages.map(p => p.length)) === '[50,50,50,50,30,0]' && new Set(keys).size === 230,
    JSON.stringify(pages.map(p => p.length)));

// Fill the tiny table until Swoole refuses a row, for the capacity warning.
await fetch(APP + '/otm-e2e/fill/tiny');

// --- Browser ---
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
const patches = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.method() === 'PATCH') patches.push(r.postData()); });

const vm = () => page.evaluate(() => {
    const p = document.querySelector('#app')._vnode.component.proxy;
    return { table: p.tableData?.table?.name, rows: p.tableData?.rows?.length ?? null, uniq: new Set((p.tableData?.rows ?? []).map(r => r._i)).size,
             hasMore: p.tableData?.hasMore, search: p.searchKey, modal: p.newItem.modalVisible };
});
const waitTable = name => page.waitForFunction(n => document.querySelector('#app')._vnode.component.proxy.tableData?.table?.name === n, name);
const open = async name => { await page.locator('.p-panelmenu a', { hasText: name }).first().click(); await waitTable(name); };
const toast = async () => { const t = page.locator('.p-toast-message').last(); await t.waitFor({ timeout: 5000 }); return (await t.innerText()).replace(/\s+/g, ' ').trim(); };
const clearToasts = () => page.evaluate(() => document.querySelectorAll('.p-toast-message').forEach(e => e.remove()));
// Same-origin call through the page's axios, so session and XSRF cookies go along like in the UI.
const api = (method, url, data) => page.evaluate(async ([m, u, d]) => {
    try { const r = await window.axios({ method: m, url: baseUrl + u, data: d }); return [r.status, r.data]; }
    catch (e) { return [e.response?.status, e.response?.data?.message]; }
}, [method, url, data]);

await page.goto(BASE);
await page.locator('.p-badge').first().waitFor();

const badgeClass = name => page.locator('.p-panelmenu a', { hasText: name }).locator('.p-badge').getAttribute('class');
check('full table gets a red badge', (await badgeClass('tiny')).includes('p-badge-danger'));
check('roomy table has no warning', !/p-badge-(danger|warn)/.test(await badgeClass('users')));
check('sidebar badge count/limit', (await page.locator('.p-panelmenu a', { hasText: 'users' }).locator('.p-badge').innerText()) === '230/2048');

await open('users');
check('headers show config definitions', (await page.locator('thead').innerText()).replace(/\s+/g, ' ').includes('age [int] score [float] bio [string]'));
check('answering server is shown', /Server: \S+/.test(await page.locator('.p-panel').first().innerText()));
check('icon font loaded', await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.includes('primeicons') && f.status === 'loaded'); }));

// Load More to the end; the table stays mounted
const tableEl = await page.locator('.p-datatable').elementHandle();
while ((await vm()).hasMore) {
    const before = (await vm()).rows;
    await page.getByRole('button', { name: 'Load More' }).click();
    await page.waitForFunction(b => { const t = document.querySelector('#app')._vnode.component.proxy.tableData; return t.rows.length > b || !t.hasMore; }, before);
}
let s = await vm();
check('Load More reaches all 230 rows once', s.rows === 230 && s.uniq === 230, JSON.stringify(s));
check('Load More hidden at the end', await page.getByRole('button', { name: 'Load More' }).count() === 0);
check('table not remounted by Load More', await tableEl.evaluate(e => e.isConnected));
check('page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

// Delete in place
await clearToasts();
await page.locator('tbody tr').first().locator('button').click();
await page.getByRole('button', { name: 'Delete' }).click();
const del = await toast();
s = await vm();
check('delete keeps the loaded rows', s.rows === 229, `toast="${del}"`);

// Cell editing
const cell = (row, col) => page.locator('tbody tr').nth(row).locator('td').nth(col);
const editor = () => page.locator('tbody input, tbody textarea').first();
await cell(1, 1).click();
await editor().press('Enter');
await page.waitForTimeout(400);
check('unchanged cell sends no PATCH', patches.length === 0);
const newName = 'edited ' + Date.now() % 10000;
await cell(1, 1).click();
await editor().fill(newName);
await editor().press('Enter');
await page.waitForTimeout(600);
check('changed cell sends one PATCH', patches.length === 1 && patches[0].includes(newName));
await cell(1, 3).click();
await editor().fill('');
await editor().pressSequentially('3.14159');
await editor().press('Enter');
await page.waitForTimeout(600);
check('float keeps its decimals', (patches[1] ?? '').includes('3.14159'));

// Search
await clearToasts();
await page.getByPlaceholder('Index Search').fill('does-not-exist');
await page.locator('button:has(.pi-search)').click();
const nf = await toast();
s = await vm();
check('failed search keeps the table', nf.includes('not found') && s.rows === 229, `toast="${nf}"`);
await page.getByPlaceholder('Index Search').fill('u7');
await page.locator('button:has(.pi-search)').click();
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 1);
check('search hides Load More', await page.getByRole('button', { name: 'Load More' }).count() === 0);
await open('ints');
check('switching table clears the search', (await vm()).search === null);

// New item dialog
await open('users');
await clearToasts();
await page.locator('button:has(.pi-plus)').click();
await page.locator('#_i').fill('u10');
await page.locator('#name').fill('dup');
await page.getByRole('button', { name: 'Save' }).click();
const dup = await toast();
check('existing index: 409, dialog stays open', dup.includes('already exists') && (await vm()).modal === true, `toast="${dup}"`);
await page.locator('#_i').fill('new-' + Date.now());
await clearToasts();
await page.getByRole('button', { name: 'Save' }).click();
const saved = await toast();
check('new item saved, dialog closes', saved.includes('successful') && (await vm()).modal === false, `toast="${saved}"`);
await page.locator('button:has(.pi-plus)').click();
check('dialog starts empty', (await page.locator('#_i').inputValue()) === '');
await page.keyboard.press('Escape');

// API through the browser session
check('index over 63 bytes -> 422', (await api('post', '/store', { table: 'users', index: 'x'.repeat(64), data: { name: 'x' } }))[0] === 422);
check('value over the column size -> 422', (await api('patch', '/update', { table: 'users', index: 'u2', field: 'name', value: 'ş'.repeat(40) }))[0] === 422);
check('index "0" can be found', (await api('post', '/store', { table: 'nosize', index: '0', data: { v: 5 } }))[0] === 200
    && (await api('get', '/fetch?table=nosize&index=0'))[1]?.rows?.length === 1);
// From outside the browser: no session, no token, no Sec-Fetch-Site (Laravel 13 lets same-origin browser requests through on that header).
const csrf = (await fetch(BASE + '/store', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status;
check('foreign POST without XSRF token -> 419', csrf === 419, String(csrf));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
