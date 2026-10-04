const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const authSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8')
    .split('// --- 6. QUẢN LÝ VÍ ---')[0];

function createHarness() {
    const elements = new Map();
    function element(id) {
        if (elements.has(id)) return elements.get(id);
        const item = {
            id, value: '', textContent: '', style: {}, dataset: {}, disabled: false, options: [], listeners: {},
            addEventListener(name, callback) { (this.listeners[name] ||= new Set()).add(callback); },
            removeAttribute() {},
            replaceChildren() { this.options = []; this.value = ''; this.textContent = ''; },
            appendChild(option) { this.options.push(option); },
            add(option) { this.options.push(option); },
            querySelectorAll() { return []; },
            reset() { this.value = ''; },
            classList: { add() {}, remove() {} }
        };
        Object.defineProperty(item, 'innerHTML', {
            get() { return ''; },
            set() { this.options = []; this.value = ''; }
        });
        elements.set(id, item);
        return item;
    }
    let authCallback;
    const documentListeners = [];
    const subscriptions = [];
    const database = {
        collection: name => reference(name),
        runTransaction: async callback => callback({ get: async () => ({ exists: true }), set() {} })
    };
    function reference(refPath) {
        return {
            path: refPath,
            collection: name => reference(refPath + '/' + name),
            doc: name => reference(refPath + '/' + name),
            onSnapshot(next, error) {
                const subscription = { path: refPath, next, error, unsubscribed: false };
                subscriptions.push(subscription);
                return () => { subscription.unsubscribed = true; };
            }
        };
    }
    const controls = [element('amount'), element('description')];
    const form = element('add-transaction-form');
    form.querySelectorAll = () => controls;
    const context = {
        console, Date, Promise, String, Boolean, Array, Error, Intl, Set,
        document: {
            readyState: 'loading',
            getElementById: element,
            querySelector: () => element('net'),
            querySelectorAll: selector => selector.includes('form') ? [form] : [],
            addEventListener(name, callback) { documentListeners.push({ name, callback }); },
            createElement: () => element(Symbol())
        },
        firebase: {
            initializeApp() {},
            firestore: () => database,
            auth: () => ({ onAuthStateChanged(callback) { authCallback = callback; } })
        },
        window: {}, alert() {}, confirm: () => true, localStorage: {}, setTimeout() {},
        renderCalendar() {}, calculateSummary() {}, renderTransactionsForDate() {}, renderReports() {},
        resetReportsState() {}, resetTransactionUiState() {}, updateSelectOptions() {}, renderTags() {},
        renderWalletTabs() {}, renderWalletSelect() {}, handleAddTransaction() {}, handleAddCategory() {},
        handleAddSource() {}, handleAddWallet() {}, handleEditWallet() {}, handleEditTransaction() {},
        closeEditWalletModal() {}, closeEditTransactionModal() {}, closeDateDetail() {}, changeMonth() {}
    };
    context.firebase.firestore.FieldValue = { serverTimestamp: () => 1 };
    vm.createContext(context);
    vm.runInContext(authSource, context);
    function start() {
        const subscription = documentListeners.find(item => item.callback.name === 'subscribeToAuthState');
        assert.ok(subscription, 'Auth subscribes after all feature scripts load');
        subscription.callback();
    }
    return {
        context, element, controls, subscriptions, database, start,
        get authCallback() { return authCallback; },
        state: () => JSON.parse(vm.runInContext('JSON.stringify({uid:currentUser&&currentUser.uid,transactions:transactions.map(item=>item.id),wallet:currentWallet,selectedDate,settingsReady,transactionsReady})', context))
    };
}

function transactionSnapshot(rows) {
    return { forEach(callback) { rows.forEach(row => callback({ id: row.id, data: () => ({ ...row }) })); } };
}

function settingsSnapshot(wallets) {
    return { exists: true, data: () => ({ categories: ['A'], sources: ['B'], wallets }) };
}

function signIn(harness, uid) {
    harness.authCallback({ uid, email: uid + '@example.com' });
}

test('auth waits for DOM readiness and rejects callbacks from the previous account', () => {
    const h = createHarness();
    assert.equal(h.authCallback, undefined);
    h.start();
    signIn(h, 'alice');
    assert.equal(h.controls[0].disabled, true);
    h.subscriptions[0].next(transactionSnapshot([{ id: 'alice-secret', wallet: 'a' }]));
    h.subscriptions[1].next(settingsSnapshot([{ id: 'a', name: 'Alice', icon: 'A' }]));
    assert.equal(h.controls[0].disabled, false);
    vm.runInContext("selectedDate = '2020-01-01'", h.context);
    const token = h.context.getSessionToken();

    signIn(h, 'bob');
    assert.equal(h.subscriptions.length, 4);
    assert.ok(h.subscriptions[0].unsubscribed && h.subscriptions[1].unsubscribed);
    assert.equal(h.context.isSessionCurrent(token), false);
    assert.deepEqual(h.state().transactions, []);
    assert.equal(h.state().wallet, '');
    assert.equal(h.state().selectedDate, null);
    h.subscriptions[0].next(transactionSnapshot([{ id: 'stale-secret' }]));
    h.subscriptions[1].next(settingsSnapshot([{ id: 'stale-wallet' }]));
    h.subscriptions[1].error(new Error('stale listener'));
    assert.deepEqual(h.state().transactions, []);
    assert.equal(h.state().wallet, '');
    assert.equal(h.context.dataLoadError, '');
    assert.equal(h.controls[0].disabled, true);

    h.subscriptions[2].next(transactionSnapshot([{ id: 'bob-only', wallet: 'b' }]));
    h.subscriptions[3].next(settingsSnapshot([{ id: 'b' }]));
    h.authCallback(null);
    assert.equal(h.state().uid, null);
    assert.deepEqual(h.state().transactions, []);
    assert.ok(h.subscriptions[2].unsubscribed && h.subscriptions[3].unsubscribed);
    h.subscriptions[2].next(transactionSnapshot([{ id: 'bob-stale' }]));
    assert.deepEqual(h.state().transactions, []);
    assert.equal(h.controls[0].disabled, true);
});

test('repeated sign-in does not duplicate navigation or date listeners', () => {
    const h = createHarness();
    h.start();
    signIn(h, 'alice');
    signIn(h, 'alice');
    assert.equal(h.subscriptions.length, 2);
    h.authCallback(null);
    signIn(h, 'alice');
    assert.equal(h.subscriptions.length, 4);
    assert.equal(h.element('next-month').listeners.click.size, 1);
    assert.equal(h.element('prev-month').listeners.click.size, 1);
    assert.equal(h.element('date-month').listeners.change.size, 1);
    assert.equal(h.element('date-year').listeners.change.size, 1);
    assert.equal(h.element('add-transaction-form').listeners.submit.size, 1);
});

test('remote deletion falls back to an existing wallet and mutation statuses survive snapshots', () => {
    const h = createHarness();
    h.start();
    signIn(h, 'alice');
    h.subscriptions[0].next(transactionSnapshot([]));
    h.subscriptions[1].next(settingsSnapshot([{ id: 'a' }, { id: 'b' }]));
    assert.equal(h.state().wallet, 'a');
    const status = h.element('app-status');
    status.dataset.state = 'mutation';
    status.textContent = 'Saved';
    h.subscriptions[1].next(settingsSnapshot([{ id: 'b' }]));
    assert.equal(h.state().wallet, 'b');
    assert.equal(status.textContent, 'Saved');
    h.authCallback(null);
    assert.equal(status.textContent, '');
});

test('default creation awaits its transaction and never overwrites existing settings', async () => {
    const h = createHarness();
    const writes = [];
    let finish;
    h.database.runTransaction = async callback => {
        await new Promise(resolve => { finish = resolve; });
        return callback({
            get: async ref => ({ exists: ref.path.endsWith('/settings/appData') }),
            set: (ref, data) => writes.push({ path: ref.path, data })
        });
    };
    let completed = false;
    const operation = h.context.createDefaultUserData('alice', 'Alice', 'alice@example.com')
        .then(() => { completed = true; });
    assert.equal(completed, false);
    finish();
    await operation;
    assert.equal(completed, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, 'users/alice');
});
