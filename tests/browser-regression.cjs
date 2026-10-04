// Optional browser integration suite: requires the playwright package and Chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

function mockFirebase() {
    const records = new Map();
    const subscriptions = [];
    let counter = 0;
    let revision = 0;
    let authCallback;
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const snapshot = key => ({ exists: records.has(key), data: () => clone(records.get(key)) });
    function emit() {
        subscriptions.filter(item => item.active).forEach(item => {
            if (!item.collection) item.callback(snapshot(item.key));
            else item.callback({ forEach(callback) {
                for (const [key, value] of records) {
                    if (key.startsWith(item.key + '/') && key.split('/').length === item.key.split('/').length + 1) {
                        callback({ id: key.split('/').at(-1), data: () => clone(value) });
                    }
                }
            } });
        });
    }
    function ref(key, collection) {
        return { key, id: key.split('/').at(-1),
            collection: name => ref(key + '/' + name, true),
            doc: id => ref(key + '/' + (id || 'generated-' + (++counter)), false),
            get: async () => snapshot(key),
            set: async value => { records.set(key, clone(value)); revision++; emit(); },
            update: async value => {
                if (!records.has(key)) throw new Error('not-found');
                records.set(key, {...records.get(key), ...clone(value)}); revision++; emit();
            },
            delete: async () => { records.delete(key); revision++; emit(); },
            add: async value => {
                const id = 'transaction-' + (++counter);
                if (window.__mock.holdWrite) {
                    await new Promise((resolve, reject) => { window.__mock.releaseWrite = resolve; window.__mock.rejectWrite = reject; });
                }
                records.set(key + '/' + id, clone(value)); revision++; emit();
                return { id };
            },
            onSnapshot: callback => {
                const item = {key, collection, callback, active: true};
                subscriptions.push(item);
                queueMicrotask(emit);
                return () => { item.active = false; };
            }
        };
    }
    const db = {
        collection: name => ref(name, true),
        async runTransaction(callback) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const original = revision;
                const writes = [];
                await callback({ get: async reference => snapshot(reference.key),
                    update: (reference, data) => writes.push([reference.key, data, true]),
                    set: (reference, data) => writes.push([reference.key, data, false]) });
                await Promise.resolve();
                if (revision !== original) continue;
                writes.forEach(([key, data, merge]) => records.set(key, merge ? {...records.get(key), ...clone(data)} : clone(data)));
                if (writes.length) { revision++; emit(); }
                return;
            }
            throw new Error('too much contention');
        }
    };
    const auth = { onAuthStateChanged(callback) { authCallback = callback; queueMicrotask(() => callback(null)); },
        signOut: async () => authCallback(null) };
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'mock-server-time' };
    window.firebase = { initializeApp() {}, firestore, auth: () => auth };
    window.__mock = { records, subscriptions, emit, holdWrite: false,
        login(uid) { authCallback(uid ? {uid, email: uid + '@example.test', displayName: uid} : null); },
        seed(uid, settings, transactions) {
            records.set('users/' + uid + '/settings/appData', clone(settings));
            transactions.forEach(item => records.set('users/' + uid + '/transactions/' + item.id, clone(item)));
        },
        settings(uid) { return clone(records.get('users/' + uid + '/settings/appData')); }
    };
}

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: {width:1280,height:900}, hasTouch: true, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    await context.addInitScript(mockFirebase);
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://app.test') return route.fulfill({body:'', contentType:'application/javascript'});
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) return route.abort();
        const body = await fs.readFile(file);
        const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
        await route.fulfill({ body, contentType: types[path.extname(file)] || 'image/png' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    try {
        await page.goto('http://app.test');
        await page.evaluate(() => {
            const settings = {categories:['Ăn uống','Lương'],sources:['Tiền mặt','Thẻ ATM'],wallets:[
                {id:'chung',name:'Ví Chung',icon:'🏠'}, {id:'private',name:'Cá Nhân',icon:'👤'}, {id:'saving',name:'Tiết kiệm',icon:'💰'}]};
            __mock.seed('A', settings, [
                {id:'one',wallet:'chung',date:'2026-10-02',amount:50000,type:'expense',description:'Ăn tối',category:'Ăn uống',source:'Tiền mặt'},
                {id:'two',wallet:'chung',date:'2026-10-01',amount:200000,type:'income',description:'Lương tháng 10',category:'Lương',source:'Thẻ ATM'},
                {id:'old',wallet:'chung',date:'2001-02-03',amount:1000,type:'expense',description:'Giao dịch cũ',category:'Danh mục đã xóa',source:'Nguồn đã xóa'}
            ]);
            __mock.seed('B', {categories:['B category'],sources:['B source'],wallets:[{id:'b-wallet',name:'B wallet',icon:'B'}]}, []);
            __mock.login('A');
        });
        await page.waitForFunction(() => settingsReady && transactionsReady);
        assert.equal(await page.locator('.wallet-item').count(), 3);
        await page.selectOption('#report-period', 'all');
        assert.equal(await page.locator('.report-results .transaction-card').count(), 3);
        await page.fill('#report-query', 'an toi');
        assert.equal(await page.locator('.report-results .transaction-card').count(), 1);
        await page.fill('#report-query', '');
        await page.evaluate(() => openEditTransactionModal('old'));
        assert.equal(await page.inputValue('#edit-category'), 'Danh mục đã xóa');
        assert.equal(await page.inputValue('#edit-date-year'), '2001');
        await page.fill('#edit-description', 'Đã sửa');
        await page.locator('#edit-transaction-form button[type=submit]').click();
        await page.waitForFunction(() => document.getElementById('edit-transaction-modal').style.display === 'none');
        assert.equal(await page.evaluate(() => __mock.records.get('users/A/transactions/old').date), '2001-02-03');
        console.log('PASS reports/search and historical edit');

        await page.fill('#new-wallet-name', '<img src=x onerror=window.xss=1>');
        await page.locator('#add-wallet-form button[type=submit]').click();
        await page.waitForFunction(() => wallets.length === 4);
        assert.equal(await page.locator('#wallet-tabs img').count(), 0);
        assert.equal(await page.evaluate(() => window.xss), undefined);
        await page.fill('#new-wallet-name', '생활비');
        await page.locator('#add-wallet-form button[type=submit]').click();
        await page.waitForFunction(() => wallets.length === 5);
        assert.match(await page.evaluate(() => currentWallet), /^generated-/);
        assert.equal(await page.evaluate(() => walletSelect.value), await page.evaluate(() => currentWallet));
        console.log('PASS literal wallet labels and Korean wallet IDs');

        await page.evaluate(async () => {
            await Promise.all([
                mutateSettings(data => ({categories:data.categories.concat('Concurrent A')})),
                mutateSettings(data => ({categories:data.categories.concat('Concurrent B')}))
            ]);
        });
        const savedCategories = await page.evaluate(() => __mock.settings('A').categories);
        assert(savedCategories.includes('Concurrent A') && savedCategories.includes('Concurrent B'));
        await page.locator('.wallet-item').last().locator('.wallet-drag-handle').focus();
        const movedId = await page.locator('.wallet-item').last().getAttribute('data-wallet');
        await page.keyboard.press('Home');
        await page.waitForFunction(id => wallets[0].id === id, movedId);
        assert.equal(await page.evaluate(() => __mock.settings('A').wallets[0].id), movedId);
        await page.evaluate(async () => {
            await Promise.all([
                mutateSettings(data => ({wallets: moveWalletInList(data.wallets, 'saving', 'chung', false)})),
                mutateSettings(data => ({wallets: data.wallets.map(w => w.id === 'private' ? {...w,name:'Renamed concurrently'} : w).concat({id:'remote',name:'Remote wallet',icon:'R'})}))
            ]);
        });
        const concurrentWallets = await page.evaluate(() => __mock.settings('A').wallets);
        assert(concurrentWallets.some(w=>w.id==='remote'));
        assert.equal(concurrentWallets.find(w=>w.id==='private').name,'Renamed concurrently');
        assert.equal(concurrentWallets.findIndex(w=>w.id==='saving')+1,concurrentWallets.findIndex(w=>w.id==='chung'));
        console.log('PASS transaction retries preserve concurrent changes and keyboard reorder persists');

        await page.evaluate(() => { selectWallet('chung'); __mock.holdWrite = true; });
        await page.fill('#amount', '1200');
        await page.fill('#description', 'Keep this draft');
        await page.locator('#add-transaction-form button[type=submit]').click();
        assert.equal(await page.inputValue('#description'), 'Keep this draft');
        assert(await page.locator('#amount').isDisabled());
        await page.evaluate(() => __mock.rejectWrite(new Error('permission-denied')));
        await page.waitForFunction(() => !document.getElementById('amount').disabled);
        assert.equal(await page.inputValue('#description'), 'Keep this draft');
        await page.evaluate(() => { __mock.holdWrite = false; });
        await page.locator('#add-transaction-form button[type=submit]').click();
        await page.waitForFunction(() => document.getElementById('description').value === '');
        console.log('PASS save failure retains draft; successful retry clears it');

        await page.evaluate(() => {
            currentMonth = new Date(2026,0,31); changeMonth(1);
            window.monthAfterOverflow = currentMonth.getMonth();
            window.oldSubscription = __mock.subscriptions.find(s => s.active && !s.collection);
            __mock.login(null); __mock.login('B');
        });
        await page.waitForFunction(() => settingsReady && transactionsReady);
        assert.equal(await page.evaluate(() => window.monthAfterOverflow), 1);
        assert.equal(await page.evaluate(() => currentWallet), 'b-wallet');
        assert.equal(await page.locator('#report-query').inputValue(), '');
        assert.equal(await page.locator('#report-month').inputValue(), await page.evaluate(() => reportState.month));
        await page.evaluate(() => oldSubscription.callback({exists:true,data:()=>({wallets:[{id:'leak',name:'LEAK',icon:'!'}]})}));
        assert.equal(await page.locator('.wallet-item').count(), 1);
        await page.evaluate(() => { currentMonth = new Date(2026,0,1); renderCalendar(); });
        await page.locator('#next-month').click();
        assert.equal(await page.evaluate(() => currentMonth.getMonth()), 1);
        assert.equal(await page.evaluate(() => __mock.subscriptions.filter(s=>s.active).length), 2);
        console.log('PASS auth changes clear data, stale snapshots ignored, one calendar listener');

        await page.evaluate(() => __mock.login('A'));
        await page.waitForFunction(() => settingsReady && transactionsReady);
        await page.evaluate(() => selectWallet('chung'));
        await page.selectOption('#report-period', 'all');
        await page.screenshot({path:path.join(os.tmpdir(),'chitieu-desktop.png'),fullPage:true});
        await page.setViewportSize({width:375,height:667});
        await page.locator('#wallet-tabs').scrollIntoViewIfNeeded();
        const first = page.locator('.wallet-item').first();
        const second = page.locator('.wallet-item').nth(1);
        const firstId = await first.getAttribute('data-wallet');
        const handle = await first.locator('.wallet-drag-handle').boundingBox();
        const destination = await second.boundingBox();
        await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
        await page.mouse.down();
        await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height-5,{steps:6});
        await page.mouse.up();
        await page.waitForFunction(id=>wallets[1].id===id,firstId);
        await page.locator('#wallet-tabs').scrollIntoViewIfNeeded();
        const touchHandle = await page.locator('.wallet-item').nth(1).locator('.wallet-drag-handle').boundingBox();
        const touchTarget = await page.locator('.wallet-item').first().boundingBox();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchHandle.x+22,y:touchHandle.y+22}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchTarget.x+touchTarget.width/2,y:touchTarget.y+8}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(id=>wallets[0].id===id,firstId);
        await cdp.detach();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({path:path.join(os.tmpdir(),'chitieu-mobile.png'),fullPage:true});
        await page.locator('#reports-section').screenshot({path:path.join(os.tmpdir(),'chitieu-report-mobile.png')});
        await page.locator('.wallet-item').first().locator('.edit-wallet').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'edit');
        await page.locator('.wallet-item').first().locator('.edit-wallet').click();
        await page.fill('#edit-wallet-name','Renamed wallet');
        await page.locator('#edit-wallet-form button[type=submit]').click();
        await page.waitForFunction(() => document.getElementById('edit-wallet-modal').style.display==='none');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'edit');
        await page.setViewportSize({width:320,height:568});
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.evaluate(() => __mock.login(null));
        await page.locator('.auth-tab[data-tab=register]').click();
        await page.locator('.register-btn').scrollIntoViewIfNeeded();
        assert(await page.locator('.register-btn').isVisible());
        console.log('PASS mobile mouse/touch reorder, 320px layout, short registration screen, modal focus restoration');
        assert.deepEqual(errors, []);
        console.log('PASS no uncaught browser errors');
        console.log('Screenshots: '+path.join(os.tmpdir(),'chitieu-desktop.png')+' and '+path.join(os.tmpdir(),'chitieu-mobile.png'));
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode=1; });
