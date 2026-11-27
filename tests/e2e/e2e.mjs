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

// --- OpenSwoole (run.sh starts the app on OpenSwoole and passes "openswoole") ---
// Its set() throws on a value that is not of the column's PHP type, after storing it; the UI sends such values.
if (process.argv[2] === 'openswoole') {
    const browser = await chromium.launch({ channel: process.env.PW_CHANNEL, headless: true });
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.locator('.p-badge').first().waitFor();
    const api = (m, u, d) => page.evaluate(async ([m, u, d]) => {
        try { const r = await window.axios({ method: m, url: baseUrl + u, data: d }); return [r.status, r.data]; }
        catch (e) { return [e.response?.status, e.response?.data?.message]; }
    }, [m, u, d]);
    const row = async index => (await api('get', `/fetch?table=users&index=${index}`))[1]?.rows?.[0];
    const edit = async (field, value, stored) => {
        const res = await api('patch', '/update', { table: 'users', index: 'u1', field, value });
        const now = (await row('u1'))?.[field];
        check(`openswoole: update ${field} = ${JSON.stringify(value)} -> 200, stored ${JSON.stringify(stored)}`, res[0] === 200 && now === stored, JSON.stringify([res, now]));
    };
    await edit('score', 2, 2);
    await edit('age', '', 0);
    await edit('age', 7, 7);
    await edit('score', 3.14159, 3.14159);
    await edit('name', 'renamed', 'renamed');
    const item = { table: 'users', index: 'os-new', data: { name: 'x', age: 4, score: 3 } };
    const first = await api('post', '/store', item);
    const again = await api('post', '/store', item);
    const stored = await row('os-new');
    const found = (await api('get', '/fetch?table=users&index=os-*'))[1]?.rows?.length;
    check('openswoole: store with whole numbers -> 200, then 409', first[0] === 200 && again[0] === 409 && found === 1
        && stored?.name === 'x' && stored?.age === 4 && stored?.score === 3, JSON.stringify([first, again, found, stored]));
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
// Opening a number cell and leaving it must not write back what the editor makes of the value (rounded to 15 digits, clamped to 2^53).
const setup = [await api('patch', '/update', { table: 'users', index: 'u7', field: 'score', value: 2 / 3 }),
    await api('patch', '/update', { table: 'users', index: 'u7', field: 'age', value: 2 ** 60 })];
await page.locator('button:has(.pi-search)').click();
await page.waitForFunction(() => { const r = document.querySelector('#app')._vnode.component.proxy.tableData.rows; return r.length === 1 && r[0].score === 2 / 3 && r[0].age === 2 ** 60; });
const untouched = patches.length;
const leave = async (col, how) => {
    await cell(0, col).click();
    await how();
    await page.locator('tbody input').waitFor({ state: 'detached' });
};
await leave(3, () => editor().press('Enter'));
await leave(3, () => page.getByPlaceholder('Index Search').click());
await page.waitForTimeout(400);
const floatSent = patches.slice(untouched);
await leave(2, () => editor().press('Enter'));
await leave(2, () => page.getByPlaceholder('Index Search').click());
await page.waitForTimeout(400);
const intSent = patches.slice(untouched + floatSent.length);
const u7 = (await api('get', '/fetch?table=users&index=u7'))[1]?.rows?.[0];
check('untouched float cell sends nothing', setup.every(r => r[0] === 200) && floatSent.length === 0 && u7?.score === 2 / 3, JSON.stringify([floatSent, u7?.score]));
check('untouched big int cell sends nothing', intSent.length === 0 && u7?.age === 2 ** 60, JSON.stringify([intSent, u7?.age]));
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
// The limit is in bytes: 40 ş are 40 characters but 80 bytes. 31 ş (62 bytes) still fit; docs takes the extra row.
const wide = 'ş'.repeat(40), fits = 'ş'.repeat(31);
const wideRes = [await api('post', '/store', { table: 'users', index: wide, data: { name: 'x' } }),
    await api('get', '/fetch?table=users&index=' + encodeURIComponent(wide)),
    await api('get', '/fetch?table=users&keys[]=u1&keys[]=' + encodeURIComponent(wide)),
    await api('patch', '/update', { table: 'users', index: wide, field: 'name', value: 'x' }),
    await api('delete', '/delete?table=users&index=' + encodeURIComponent(wide))];
const fitsRes = [await api('post', '/store', { table: 'docs', index: fits, data: { data: 'x' } }),
    await api('delete', '/delete?table=docs&index=' + encodeURIComponent(fits))];
check('multibyte index over 63 bytes -> 422 everywhere, 62 bytes still stored', wideRes.every(r => r[0] === 422) && fitsRes.every(r => r[0] === 200),
    JSON.stringify([wideRes.map(r => r[0]), fitsRes.map(r => r[0]), wideRes[0][1]]));
check('value over the column size -> 422', (await api('patch', '/update', { table: 'users', index: 'u2', field: 'name', value: 'ş'.repeat(40) }))[0] === 422);
// The exception quotes the first 20 bytes of the value; here byte 20 splits a ş, and the 422 must still encode.
const cut = 'a' + 'ş'.repeat(39), cutIndex = 'cut-' + Date.now();
const cutRes = [await api('patch', '/update', { table: 'users', index: 'u2', field: 'name', value: cut }),
    await api('post', '/store', { table: 'users', index: cutIndex, data: { name: cut } }),
    await api('get', '/fetch?table=users&index=' + cutIndex)];
check('value over the column size cut mid-character -> 422, nothing stored',
    cutRes.slice(0, 2).every(r => r[0] === 422 && /too large/.test(r[1])) && cutRes[2][0] === 404, JSON.stringify(cutRes));
check('index "0" can be found', (await api('post', '/store', { table: 'nosize', index: '0', data: { v: 5 } }))[0] === 200
    && (await api('get', '/fetch?table=nosize&index=0'))[1]?.rows?.length === 1);
// From outside the browser: no session, no token, no Sec-Fetch-Site (Laravel 13 lets same-origin browser requests through on that header).
await api('post', '/store', { table: 'nosize', index: 'k[1]', data: { v: 1 } });
await api('post', '/store', { table: 'nosize', index: 'k1', data: { v: 2 } });
const exactBracket = (await api('get', '/fetch?table=nosize&index=' + encodeURIComponent('k[1]')))[1]?.rows?.map(r => r._i);
const patternK = (await api('get', '/fetch?table=nosize&index=' + encodeURIComponent('k*')))[1]?.rows?.map(r => r._i).sort();
check('a key containing [ ] is found as itself, k* is still a pattern', JSON.stringify(exactBracket) === '["k[1]"]' && JSON.stringify(patternK) === '["k1","k[1]"]',
    JSON.stringify([exactBracket, patternK]));
// Keys and cells are exact bytes: the app's TrimStrings must not turn "w " into "w" or trim a value.
const delSpace = await api('delete', '/delete?table=ints&index=' + encodeURIComponent('w '));
const intsKeys = (await api('get', '/fetch?table=ints'))[1]?.rows?.map(r => r._i);
await api('post', '/store', { table: 'docs', index: 'ws', data: { data: 'x' } });
await api('patch', '/update', { table: 'docs', index: 'ws', field: 'data', value: ' padded\n' });
const wsData = (await api('get', '/fetch?table=docs&index=ws'))[1]?.rows?.[0]?.data;
await api('delete', '/delete?table=docs&index=ws');
check('deleting "w " leaves "w"; a value keeps its whitespace', delSpace[0] === 200 && JSON.stringify(intsKeys) === '["w"]' && wsData === ' padded\n',
    JSON.stringify([delSpace, intsKeys, wsData]));
const csrf = (await fetch(BASE + '/store', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status;
check('foreign POST without XSRF token -> 419', csrf === 419, String(csrf));

// --- Octane's cache table ---
const binRes = await fetch(`${BASE}/fetch?table=octane:cache`, { headers: { Accept: 'application/json' } });
const binKeys = binRes.status === 200 ? (await binRes.json()).rows.map(r => r._i) : [];
check('a cell that is not valid UTF-8 does not break fetch', binRes.status === 200 && binKeys.includes('e2e-key') && binKeys.includes('e2e-bin'),
    JSON.stringify([binRes.status, binKeys]));
await open('octane:cache');
const cacheRow = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.find(r => r._i === 'e2e-key'));
check('octane:cache lists the raw serialized value', cacheRow?.value === 's:5:"hello";', JSON.stringify(cacheRow));
check('octane:cache has no edit controls', await page.locator('button:has(.pi-plus), button:has(.pi-trash), button[title="Clear table"]').count() === 0
    && await page.getByText('Read-only').count() === 1);
check('octane:cache refuses writes', (await api('patch', '/update', { table: 'octane:cache', index: 'e2e-key', field: 'value', value: 'x' }))[0] === 403
    && (await api('delete', '/truncate?table=octane:cache'))[0] === 403);
// The table named in the query must not win over the one in the body that the read-only guard checked.
const split = await api('delete', '/delete?table=octane:cache', { table: 'users', index: 'e2e-key' });
check('octane:cache cannot be written through a query/body split', (await api('get', '/fetch?table=octane:cache&index=e2e-key'))[1]?.rows?.length === 1,
    JSON.stringify(split));

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
await api('patch', '/update', { table: 'users', index: firstKeys[0], field: 'bio', value: secret });
const logLines = readFileSync(process.env.OTM_E2E_LOG, 'utf8').split('\n').filter(l => l.includes('Octane table changed'));
check('changes are logged with table, index and field', (logLines.at(-1) ?? '').includes(`"action":"update","table":"users","index":${JSON.stringify(firstKeys[0])},"field":"bio"`), logLines.at(-1));
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

// --- INF, -INF and NAN in a float column (the seed below puts users back) ---
// Opened first: once these rows exist, a page that holds one of them is what is being tested.
await open('users');
const nfCount = Number(await (await fetch(APP + '/otm-e2e/nonfinite')).text());
const nfScores = rows => Object.fromEntries((rows ?? []).map(r => [r._i, r.score]).sort(([a], [b]) => a.localeCompare(b)));
const nfWalk = await api('get', '/fetch?table=users&index=' + encodeURIComponent('nf-*'));
const nfExact = await api('get', '/fetch?table=users&index=nf-nan');
const nfKeys = await api('get', '/fetch?table=users&keys[]=nf-inf&keys[]=nf-ninf');
check('fetch answers INF, -INF and NAN as text (walk, exact index, keys[])',
    JSON.stringify(nfScores(nfWalk[1]?.rows)) === '{"nf-inf":"INF","nf-nan":"NAN","nf-ninf":"-INF"}'
    && JSON.stringify(nfScores(nfExact[1]?.rows)) === '{"nf-nan":"NAN"}'
    && JSON.stringify(nfScores(nfKeys[1]?.rows)) === '{"nf-inf":"INF","nf-ninf":"-INF"}',
    JSON.stringify([nfWalk, nfExact, nfKeys].map(r => [r[0], r[0] === 200 ? nfScores(r[1].rows) : r[1]])));
const nfExportText = await (await fetch(`${BASE}/export?table=users`)).text();
let nfExport = null;
try { nfExport = JSON.parse(nfExportText); } catch { }
check('JSON export with INF and NAN parses and has every row', nfExport?.length === nfCount
    && JSON.stringify(nfScores(nfExport.filter(r => r._index.startsWith('nf-')).map(r => ({ _i: r._index, score: r.score })))) === '{"nf-inf":"INF","nf-nan":"NAN","nf-ninf":"-INF"}',
    nfExport ? `${nfExport.length}/${nfCount}` : nfExportText.slice(0, 40));
// A float needing more than 14 digits (microtime(true)) goes out exact, and INF, -INF and NAN as the same text as in JSON.
const csvFloatKey = nfExport?.find(r => !r._index.startsWith('nf-'))?._index;
const csvPatch = await api('patch', '/update', { table: 'users', index: csvFloatKey, field: 'score', value: 1764240000.123456 });
const nfCsvLines = (await (await fetch(`${BASE}/export?table=users&format=csv`)).text()).trim().split('\n');
const csvScores = nfScores(nfCsvLines.slice(1).map(l => l.split(',')).filter(([k]) => k === csvFloatKey || k.startsWith('nf-')).map(c => ({ _i: c[0], score: c[3] })));
check('CSV export writes floats exact and INF, -INF and NAN as text', csvPatch[0] === 200 && nfCsvLines[0] === '_index,name,age,score,bio' && nfCsvLines.length === nfCount + 1
    && JSON.stringify(csvScores) === JSON.stringify(nfScores([[csvFloatKey, '1764240000.123456'], ['nf-inf', 'INF'], ['nf-ninf', '-INF'], ['nf-nan', 'NAN']].map(([_i, score]) => ({ _i, score })))),
    JSON.stringify([csvPatch[0], nfCsvLines.length, nfCount, csvScores]));
await page.getByPlaceholder('Index Search').fill('nf-inf');
await page.locator('button:has(.pi-search)').click();
const nfShown = await page.waitForFunction(() => { const r = document.querySelector('#app')._vnode.component.proxy.tableData.rows; return r.length === 1 && r[0]._i === 'nf-inf'; },
    null, { timeout: 5000 }).then(() => true, () => false);
let nfText = null, nfLeft = null, nfStored = null, nfTyped = null;
if (nfShown) {
    nfText = await cell(0, 3).innerText();
    const before = patches.length;
    await leave(3, () => editor().press('Enter'));
    await leave(3, () => page.getByPlaceholder('Index Search').click());
    await page.waitForTimeout(400);
    nfLeft = patches.slice(before);
    nfStored = (await api('get', '/fetch?table=users&index=nf-inf'))[1]?.rows?.[0]?.score;
    await cell(0, 3).click();
    await editor().fill('');
    await editor().pressSequentially('7');
    await editor().press('Enter');
    await page.waitForTimeout(600);
    nfTyped = patches.slice(before);
}
check('an untouched INF cell shows INF and sends nothing; a typed number is saved', nfText === 'INF' && nfLeft?.length === 0 && nfStored === 'INF'
    && nfTyped?.length === 1 && JSON.parse(nfTyped[0]).value === 7, JSON.stringify({ nfShown, nfText, nfLeft, nfStored, nfTyped }));

// --- Line breaks in string cells (the seed below puts users back) ---
// An <input> drops CR and LF, a <textarea> turns CRLF into LF: typing one character must leave the line breaks as they were.
const nl = { name: 'line one\nline two', bio: 'a\r\nb\r\nc' };
const nlStore = await api('post', '/store', { table: 'users', index: 'nl', data: nl });
await page.getByPlaceholder('Index Search').fill('nl');
await page.locator('button:has(.pi-search)').click();
const nlShown = await page.waitForFunction(() => { const r = document.querySelector('#app')._vnode.component.proxy.tableData.rows; return r.length === 1 && r[0]._i === 'nl'; },
    null, { timeout: 5000 }).then(() => true, () => false);
const nlLeft = {}, nlSent = {}, nlStored = {};
for (const [field, col] of nlShown ? [['name', 1], ['bio', 4]] : []) {
    const before = patches.length;
    await cell(0, col).click();
    await page.getByPlaceholder('Index Search').click();
    await editor().waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    nlLeft[field] = patches.slice(before);
    await cell(0, col).click();
    await editor().press('!');
    await page.getByPlaceholder('Index Search').click();
    await editor().waitFor({ state: 'detached' });
    await page.waitForTimeout(600);
    nlSent[field] = patches.slice(before);
    nlStored[field] = (await api('get', '/fetch?table=users&index=nl'))[1]?.rows?.[0]?.[field];
}
const typedOne = field => nlSent[field]?.length === 1 && nlStored[field]?.length === nl[field].length + 1 && nlStored[field].replace('!', '') === nl[field];
check('opening and leaving a cell holding line breaks sends nothing', nlStore[0] === 200 && nlShown && nlLeft.name?.length === 0 && nlLeft.bio?.length === 0,
    JSON.stringify({ nlStore, nlShown, nlLeft }));
check('an edit in a short string cell keeps its line break', typedOne('name'), JSON.stringify({ sent: nlSent.name, stored: nlStored.name }));
check('an edit in a string cell keeps its CRLF line breaks', typedOne('bio'), JSON.stringify({ sent: nlSent.bio, stored: nlStored.bio }));

// --- Live view with long keys (the seed below puts users back) ---
// 60 keys of 63 bytes (ş is 6 bytes percent-encoded) would make an 11 KB URL; nginx answers 414 past 8 KB by default.
await fetch(APP + '/otm-e2e/longkeys');
await page.getByPlaceholder('Index Search').fill('lk*');
await page.locator('button:has(.pi-search)').click();
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 50);
await page.getByRole('button', { name: 'Load More' }).click();
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 60);
const lkLast = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.at(-1)._i);
const lkFrom = liveReqs.length;
await clearToasts();
await page.getByRole('button', { name: 'Live' }).click();
await api('patch', '/update', { table: 'users', index: lkLast, field: 'name', value: 'long live' });
const lkSeen = await page.waitForFunction(k => document.querySelector('#app')._vnode.component.proxy.tableData.rows.find(r => r._i === k)?.name === 'long live',
    lkLast, { timeout: 6000 }).then(() => true, () => false);
const lkLive = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.live);
const lkErrors = await page.locator('.p-toast-message').count();
const lkLens = liveReqs.slice(lkFrom).map(u => u.length);
check('live view keeps every URL under 8 KB with long keys and stays on', lkLens.length >= 1 && Math.max(...lkLens) < 8192 && lkSeen && lkLive === true && lkErrors === 0,
    JSON.stringify({ requests: lkLens.length, maxUrl: Math.max(...lkLens), seen: lkSeen, live: lkLive, toasts: lkErrors }));
if (lkLive) {
    await page.getByRole('button', { name: 'Live' }).click();
}

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

// Load More continues the loaded query: rows edited out of the filter must not shift the offset past rows still matching.
const shownKeys = () => page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.map(r => r._i));
const loadMore = async () => {
    const req = page.waitForRequest(r => r.url().includes('/fetch?') && new URL(r.url()).searchParams.get('offset') !== '0');
    await page.getByRole('button', { name: 'Load More' }).click();
    const url = new URL((await req).url());
    await page.waitForFunction(() => !document.querySelector('#app')._vnode.component.proxy.moreLoader);
    return url.searchParams;
};
// Every key the server returns for name contains "user 1", paged through the API.
const matchingKeys = async () => {
    const keys = [];
    for (let o = 0, more = true; more; o += 50) {
        const p = await get(`column=name&value=${encodeURIComponent('user 1')}&offset=${o}`);
        keys.push(...p.rows.map(r => r._i));
        more = p.has_more;
    }
    return keys;
};
await open('users');
await page.locator('.p-select').click();
await page.getByRole('option', { name: 'name' }).click();
await page.getByPlaceholder('Value').fill('user 1');
await page.getByPlaceholder('Value').press('Enter');
// The unfiltered view also holds 50 rows: wait for the filtered one.
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.every(r => r.name.includes('user 1')));
// Two shown rows the server matches through a case fold the client cannot check (non-ASCII); then 5 rows edited out in the UI.
for (const key of (await shownKeys()).slice(0, 2)) {
    await api('patch', '/update', { table: 'users', index: key, field: 'name', value: 'USER 1 ş' });
}
await page.getByPlaceholder('Value').press('Enter');
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows[0].name === 'USER 1 ş');
for (let i = 0; i < 5; i++) {
    await clearToasts();
    await cell(i, 1).click();
    await editor().fill('done ' + i);
    await editor().press('Enter');
    await toast();
}
for (let i = 0; i < 5 && (await vm()).hasMore; i++) {
    await loadMore();
}
const stillMatching = await matchingKeys();
let onScreen = new Set(await shownKeys());
const missing = stillMatching.filter(k => !onScreen.has(k));
check('Load More after editing rows out of the filter skips no matching row', stillMatching.length === 106 && missing.length === 0 && !(await vm()).hasMore,
    JSON.stringify({ matching: stillMatching.length, missing }));

// Typing a new search without Enter must not change what Load More fetches.
await page.getByPlaceholder('Value').press('Enter');
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 50);
await page.getByPlaceholder('Index Search').fill('u2*');
const sentQuery = await loadMore();
onScreen = await shownKeys();
check('Load More sends the loaded query, not the unsubmitted search', !sentQuery.has('index') && sentQuery.get('column') === 'name' && sentQuery.get('value') === 'user 1'
    && onScreen.length > 50 && new Set(onScreen).size === onScreen.length && onScreen.every(k => stillMatching.includes(k)),
    JSON.stringify({ sent: Object.fromEntries(sentQuery), rows: onScreen.length }));

// An edit completed by clicking Load More (the editor closes on mousedown) is saved before that page's offset is counted.
await page.getByPlaceholder('Index Search').fill('');
await page.getByPlaceholder('Value').press('Enter');
await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.length === 50);
await cell(5, 1).click();
await editor().fill('done 5');
const moreUrl = u => u.pathname.endsWith('/fetch') && u.searchParams.get('offset') !== '0';
const heldMore = new Promise(resolve => page.route(moreUrl, resolve));
await clearToasts();
await page.getByRole('button', { name: 'Load More' }).click();
await toast();
await (await heldMore).continue();
await page.unroute(moreUrl);
await page.waitForFunction(() => !document.querySelector('#app')._vnode.component.proxy.moreLoader);
for (let i = 0; i < 5 && (await vm()).hasMore; i++) {
    await loadMore();
}
const matchingNow = await matchingKeys();
onScreen = new Set(await shownKeys());
const lost = matchingNow.filter(k => !onScreen.has(k));
check('an edit closed by clicking Load More shifts no matching row away', matchingNow.length === 105 && lost.length === 0, JSON.stringify({ matching: matchingNow.length, lost }));

// A Load More that answers after another table was opened must not land in that table.
await open('users');
const loadMoreUrl = u => u.pathname.endsWith('/fetch') && u.searchParams.get('offset') === '50';
const heldRoute = new Promise(resolve => page.route(loadMoreUrl, resolve));
await page.getByRole('button', { name: 'Load More' }).click();
const held = await heldRoute;
await open('ints');
const intsShown = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.tableData.rows.map(r => r._i));
const lateDone = page.waitForResponse(r => loadMoreUrl(new URL(r.url())));
await held.continue();
await (await lateDone).finished();
await page.waitForTimeout(300);
await page.unroute(loadMoreUrl);
const late = await page.evaluate(() => { const p = document.querySelector('#app')._vnode.component.proxy; return { table: p.tableData.table.name, keys: p.tableData.rows.map(r => r._i), more: p.moreLoader }; });
check('a late Load More does not land in the table opened since', late.table === 'ints' && JSON.stringify(late.keys) === JSON.stringify(intsShown) && !late.more,
    JSON.stringify({ table: late.table, rows: late.keys.length, more: late.more }));

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
