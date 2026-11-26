// Browser and API checks against a running test app (see run.sh). Exits 1 if any check fails.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const APP = process.env.OTM_E2E_URL ?? 'http://localhost:8097';
const BASE = APP + '/octane-table-manager';
let failed = 0;
const check = (name, ok, extra = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
};

// --- Read-only mode (run.sh starts the app with OTM_READ_ONLY=true and passes "read-only") ---
if (process.argv[2] === 'read-only') {
    const browser = await chromium.launch({ channel: process.env.PW_CHANNEL, headless: true });
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.locator('.p-panelmenu a', { hasText: 'users' }).first().click();
    await page.locator('tbody tr').first().waitFor();
    const call = (m, u, d) => page.evaluate(async ([m, u, d]) => { try { return (await window.axios({ method: m, url: baseUrl + u, data: d })).status; } catch (e) { return e.response?.status; } }, [m, u, d]);
    check('read-only: reading works', await call('get', '/fetch?table=users') === 200);
    check('read-only: update -> 403', await call('patch', '/update', { table: 'users', index: 'u1', field: 'name', value: 'x' }) === 403);
    check('read-only: store -> 403', await call('post', '/store', { table: 'users', index: 'ro', data: { name: 'x' } }) === 403);
    check('read-only: delete -> 403', await call('delete', '/delete?table=users&index=u1') === 403);
    check('read-only: clear table -> 403', await call('delete', '/truncate?table=users') === 403);
    check('read-only: export still works', await call('get', '/export?table=users') === 200);
    check('read-only: no add or delete buttons', await page.locator('button:has(.pi-plus), button:has(.pi-trash)').count() === 0);
    await page.locator('tbody tr').first().locator('td').nth(1).click();
    check('read-only: cells do not open an editor', await page.locator('tbody input, tbody textarea').count() === 0);
    check('read-only: label shown', await page.getByText('Read-only').count() === 1);
    await browser.close();
    process.exit(failed ? 1 : 0);
}

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
const sidebar = () => page.locator('.p-panelmenu a').allInnerTexts().then(t => t.map(x => x.split('\n')[0].trim()));
await page.getByPlaceholder('Filter tables').fill('IN');
check('table filter (case-insensitive)', JSON.stringify(await sidebar()) === '["tiny","ints"]', JSON.stringify(await sidebar()));
await page.getByPlaceholder('Filter tables').fill('');
await page.locator('button[title^="Sort by usage"]').click();
check('sort by usage puts the fullest first', (await sidebar())[0] === 'tiny', JSON.stringify(await sidebar()));
await page.locator('button[title^="Sort by usage"]').click();
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
await api('post', '/store', { table: 'nosize', index: 'k[1]', data: { v: 1 } });
await api('post', '/store', { table: 'nosize', index: 'k1', data: { v: 2 } });
const exactBracket = (await api('get', '/fetch?table=nosize&index=' + encodeURIComponent('k[1]')))[1]?.rows?.map(r => r._i);
const patternK = (await api('get', '/fetch?table=nosize&index=' + encodeURIComponent('k*')))[1]?.rows?.map(r => r._i).sort();
check('a key containing [ ] is found as itself, k* is still a pattern', JSON.stringify(exactBracket) === '["k[1]"]' && JSON.stringify(patternK) === '["k1","k[1]"]',
    JSON.stringify([exactBracket, patternK]));
const csrf = (await fetch(BASE + '/store', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status;
check('foreign POST without XSRF token -> 419', csrf === 419, String(csrf));

// --- Octane's cache table ---
await open('octane:cache');
const cacheRow = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.find(r => r._i === 'e2e-key'));
check('octane:cache lists the raw serialized value', cacheRow?.value === 's:5:"hello";', JSON.stringify(cacheRow));
check('octane:cache has no edit controls', await page.locator('button:has(.pi-plus), button:has(.pi-trash), button[title="Clear table"]').count() === 0
    && await page.getByText('Read-only').count() === 1);
check('octane:cache refuses writes', (await api('patch', '/update', { table: 'octane:cache', index: 'e2e-key', field: 'value', value: 'x' }))[0] === 403
    && (await api('delete', '/truncate?table=octane:cache'))[0] === 403);

// --- Export and clear ---
const exported = await (await fetch(`${BASE}/export?table=users`)).json();
const usersNow = (await (await fetch(`${BASE}/fetch?table=users`)).json()).stats.num;
check('JSON export has every row', exported.length === usersNow && exported.every(r => r._index && 'name' in r), `${exported.length}/${usersNow}`);
const csvRes = await fetch(`${BASE}/export?table=users&format=csv`);
const csvLines = (await csvRes.text()).trim().split('\n');
check('CSV export: header + every row, as a download', csvLines[0] === '_index,name,age,score,bio' && csvLines.length === usersNow + 1
    && /attachment; filename=users\.csv/.test(csvRes.headers.get('content-disposition')), csvLines[0]);
await open('nosize');
await clearToasts();
await page.locator('button[title="Clear table"]').click();
await page.getByRole('button', { name: 'Clear table' }).last().click();
const cleared = await toast();
await waitTable('nosize');
check('clear table empties it', /rows deleted/.test(cleared) && (await (await fetch(`${BASE}/fetch?table=nosize`)).json()).stats.num === 0, cleared);

// --- Live view ---
await open('users');
const liveReqs = [];
page.on('request', r => { if (r.url().includes('keys')) liveReqs.push(r.url()); });
const firstKeys = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.slice(0, 2).map(r => r._i));
await page.getByRole('button', { name: 'Live' }).click();
const liveName = 'live ' + Date.now() % 10000;
await api('patch', '/update', { table: 'users', index: firstKeys[0], field: 'name', value: liveName });
await api('delete', `/delete?table=users&index=${firstKeys[1]}`);
await page.waitForTimeout(4500);
const liveRows = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.map(r => [r._i, r.name]));
check('live view picks up a change made elsewhere', liveRows.some(([k, n]) => k === firstKeys[0] && n === liveName));
check('live view drops a row deleted elsewhere', !liveRows.some(([k]) => k === firstKeys[1]) && liveRows.length === 49, String(liveRows.length));
check('live view reads rows by key, not by walking the table', liveReqs.length >= 1 && liveReqs.every(u => !u.includes('offset')));
await page.getByRole('button', { name: 'Live' }).click();
const after = liveReqs.length;
await page.waitForTimeout(2500);
check('live view stops when turned off', liveReqs.length === after);

// --- Change log ---
const secret = 'audit-' + Date.now();
await api('patch', '/update', { table: 'users', index: 'u2', field: 'bio', value: secret });
const logLines = readFileSync(process.env.OTM_E2E_LOG, 'utf8').split('\n').filter(l => l.includes('Octane table changed'));
check('changes are logged with table, index and field', /"action":"update","table":"users","index":"u2","field":"bio"/.test(logLines.at(-1) ?? ''), logLines.at(-1));
check('logged changes leave the value out', logLines.every(l => !l.includes(secret)));

// --- JSON cells ---
await open('docs');
await page.locator('tbody button:has(.pi-code)').click();
const shown = await page.locator('.p-dialog pre').innerText();
check('JSON view is indented and keeps the digits', shown.includes('"id": 12345678901234567890,') && shown.includes('"price": 1.50,'), shown.slice(0, 60));
await page.keyboard.press('Escape');
const jsonCell = page.locator('tbody tr').first().locator('td').nth(1);
const sent = patches.length;
await jsonCell.click();
check('JSON editor opens indented', (await page.locator('tbody textarea').inputValue()).includes('\n  "name": "old"'));
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('opening and leaving a JSON cell sends nothing', patches.length === sent);
await jsonCell.click();
await page.locator('tbody textarea').fill((await page.locator('tbody textarea').inputValue()).replace('"old"', '"new"'));
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
check('edited JSON is saved compact with exact digits', patches.length === sent + 1
    && JSON.parse(patches.at(-1)).value === '{"id":12345678901234567890,"price":1.50,"name":"new","note":"a {b} [c]","tags":[]}', patches.at(-1));
await clearToasts();
await jsonCell.click();
await page.locator('tbody textarea').fill('{"broken": ');
await page.keyboard.press('Tab');
check('invalid JSON is refused', (await toast()).includes('Not valid JSON') && patches.length === sent + 1);

// --- Pattern and column filters (on fresh data) ---
await fetch(APP + '/otm-e2e/seed');
const get = async qs => (await fetch(`${BASE}/fetch?table=users&${qs}`, { headers: { Accept: 'application/json' } })).json().then(d => d, () => null);
const pat = await Promise.all([0, 50, 100].map(o => get(`index=${encodeURIComponent('u1*')}&offset=${o}`)));
const patKeys = pat.flatMap(p => p.rows.map(r => r._i));
check('pattern u1* pages through its 111 matches', JSON.stringify(pat.map(p => [p.rows.length, p.has_more])) === '[[50,true],[50,true],[11,false]]'
    && new Set(patKeys).size === 111 && patKeys.every(k => k.startsWith('u1')), JSON.stringify(pat.map(p => p.rows.length)));
check('text filter: contains, any case', (await get('column=name&value=USER%2022')).rows.length === 11);
check('number filter: equals', JSON.stringify((await get('column=age&value=7')).rows.map(r => r._i)) === '["u7"]');
check('unknown filter column -> 422', (await fetch(`${BASE}/fetch?table=users&column=nope&value=1`, { headers: { Accept: 'application/json' } })).status === 422);

await open('ints');
await open('users');
await page.getByPlaceholder('Index Search').fill('u1*');
await page.getByPlaceholder('Index Search').press('Enter');
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 50);
for (let i = 0; i < 2; i++) {
    const before = (await vm()).rows;
    await page.getByRole('button', { name: 'Load More' }).click();
    await page.waitForFunction(b => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length > b, before);
}
s = await vm();
check('UI pattern search + Load More', s.rows === 111 && s.uniq === 111 && !s.hasMore, JSON.stringify(s));
await page.getByPlaceholder('Index Search').fill('');
await page.locator('.p-select').click();
await page.getByRole('option', { name: 'name' }).click();
await page.getByPlaceholder('Value').fill('user 22');
await page.getByPlaceholder('Value').press('Enter');
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 11);
check('UI column filter', (await vm()).rows === 11);
await open('ints');
check('switching table clears the column filter', await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.filterColumn) === null);

// --- Theme ---
const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const lightBg = await bg();
await page.locator('button[title="Dark theme"]').click();
const darkBg = await bg();
await page.reload();
await page.locator('.p-badge').first().waitFor();
check('dark theme applies and survives a reload', lightBg === 'rgb(255, 255, 255)' && darkBg !== lightBg
    && await page.evaluate(() => document.documentElement.classList.contains('p-dark')) && await bg() === darkBg, `${lightBg} -> ${darkBg}`);
if (process.env.OTM_E2E_SHOT) {
    await page.screenshot({ path: process.env.OTM_E2E_SHOT });
}
await page.locator('button[title="Light theme"]').click();

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
