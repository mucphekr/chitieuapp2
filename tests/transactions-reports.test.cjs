const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const elements = new Map();
    class Element {
        constructor(tag = 'div') {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.dataset = {};
            this.attributes = {};
            this.events = {};
            this.style = {};
            this.value = '';
            this.disabled = false;
            this.elements = [];
            this._text = '';
            const names = new Set();
            this.classList = { add: name => names.add(name), remove: name => names.delete(name), toggle: (name, on) => on ? names.add(name) : names.delete(name) };
        }
        set textContent(value) { this._text = String(value); this.children = []; }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
        set innerHTML(value) { assert.equal(value, '', 'Only empty HTML clearing is allowed in this fixture'); this.replaceChildren(); }
        get options() { return this.children; }
        appendChild(child) {
            if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
            child.parent = this;
            this.children.push(child);
            return child;
        }
        replaceChildren(...children) { this.children = []; this._text = ''; children.forEach(child => this.appendChild(child)); }
        add(option) { this.appendChild(option); }
        addEventListener(type, handler) { this.events[type] = handler; }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        getAttribute(name) { return this.attributes[name] || null; }
        contains(element) { return this === element || this.children.some(child => child.contains(element)); }
        focus() { document.activeElement = this; }
        querySelector(selector) { return this.children.find(child => child.tagName.toLowerCase() === selector) || null; }
        reset() { this.resetCount = (this.resetCount || 0) + 1; }
    }
    const document = {
        activeElement: null,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, new Element(/category|source|year|month|day/.test(id) ? 'select' : 'div'));
            return elements.get(id);
        },
        createElement: tag => new Element(tag),
        addEventListener() {}
    };
    const state = { epoch: 1, uid: 'first', added: [], updated: [], pendingAdd: null, pendingUpdate: null };
    const context = {
        document, console: { error() {} }, Date, Map, Set, Intl,
        Option: function(text, value) { const option = new Element('option'); option.textContent = text; option.value = String(value); return option; },
        currentUser: { uid: 'first' }, settingsReady: true, transactionsReady: true,
        transactions: [], wallets: [{ id: 'first-wallet', name: 'Test', icon: '' }], categories: ['New'], sources: ['Cash'], currentWallet: 'first-wallet', selectedDate: null,
        currentMonth: new Date(2026, 0, 31),
        getSessionToken: () => ({ uid: state.uid, epoch: state.epoch }),
        isSessionCurrent: token => !!token && token.uid === state.uid && token.epoch === state.epoch,
        getUserTransactionsCol: () => ({
            add(data) { state.added.push(data); return state.pendingAdd || Promise.resolve(); },
            doc(id) { return { update(data) { state.updated.push({ id, data }); return state.pendingUpdate || Promise.resolve(); }, delete: () => Promise.resolve() }; }
        }),
        getSelectedDate: () => '2026-01-31', initDatePicker() {}, setSelectedDate() {}, updateAppReadiness() {},
        showAppModal: id => { state.modal = id; }, hideAppModal: () => { state.modal = null; },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
        alert: message => { state.alert = message; }, confirm: () => true,
    };
    ['totalIncomeSummary', 'totalExpenseSummary', 'netBalanceSummary', 'netBalanceCard', 'currentMonthDisplay', 'calendarGrid', 'categorySelect', 'sourceSelect'].forEach(name => { context[name] = new Element(); });
    vm.createContext(context);
    const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    vm.runInContext(script.slice(script.indexOf('// --- 7.')), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'reports.js'), 'utf8'), context);
    function addForm() {
        const form = document.getElementById('add-transaction-form');
        const fields = { wallet: 'first-wallet', type: 'expense', amount: '1200', description: 'Lunch', category: 'Food', source: 'Cash' };
        form.elements = Object.keys(fields).map(id => { const element = document.getElementById(id); element.value = fields[id]; return element; });
        return { target: form, preventDefault() {} };
    }
    return { context, document, state, addForm };
}

test('calendar month change from January 31 advances exactly one month and uses real buttons', () => {
    const { context: app } = fixture();
    app.changeMonth(1);
    assert.equal(app.currentMonth.getMonth(), 1);
    assert.equal(app.currentMonth.getDate(), 1);
    assert.equal(app.calendarGrid.children.filter(child => child.tagName === 'BUTTON').length, 28);
    app.changeMonth(-1);
    assert.equal(app.currentMonth.getMonth(), 0);
    assert.equal(app.parseLocalDate('2024-02-29').getDate(), 29);
    assert.equal(app.parseLocalDate('2025-02-29'), null);
    assert.equal(app.localDateString(new Date(2026, 0, 1)), '2026-01-01');
});

test('transaction metadata renders hostile markup only as text', () => {
    const { context: app } = fixture();
    const payload = '<img src=x onerror=alert(1)>';
    const card = app.createTransactionCard({ id: '1', type: 'expense', amount: 100, description: payload, category: payload, source: payload, date: '2026-01-01' }, true);
    assert.ok(card.textContent.includes(payload));
    assert.equal(card.children[1].children[1].children.every(child => child.tagName === 'SPAN'), true);
});

test('failed save preserves the form, prevents duplicates, then permits a retry', async () => {
    const { context: app, state, addForm, document } = fixture();
    let reject;
    state.pendingAdd = new Promise((resolve, fail) => { reject = fail; });
    const event = addForm();
    const save = app.handleAddTransaction(event);
    await app.handleAddTransaction(event);
    assert.equal(state.added.length, 1);
    assert.equal(event.target.dataset.saving, 'true');
    assert.equal(event.target.elements.every(control => control.disabled), true);
    reject(new Error('permission-denied'));
    await save;
    assert.equal(event.target.resetCount || 0, 0);
    assert.equal(document.getElementById('description').value, 'Lunch');
    assert.equal(event.target.dataset.saving, undefined);
    assert.ok(document.getElementById('transaction-save-status').textContent.includes('Chưa lưu'));
    state.pendingAdd = null;
    await app.handleAddTransaction(event);
    assert.equal(event.target.resetCount, 1);
    assert.equal(state.added.length, 2);
});

test('a late save from an old account never resets or unlocks the new account form', async () => {
    const { context: app, state, addForm, document } = fixture();
    let resolve;
    state.pendingAdd = new Promise(done => { resolve = done; });
    const event = addForm();
    const save = app.handleAddTransaction(event);
    state.epoch++;
    state.uid = 'second';
    app.resetTransactionUiState();
    document.getElementById('description').value = 'Second account draft';
    resolve();
    await save;
    assert.equal(event.target.resetCount || 0, 0);
    assert.equal(document.getElementById('description').value, 'Second account draft');
    assert.equal(document.getElementById('transaction-save-status').textContent, '');
});

test('historical editor preserves removed categories, sources and old years', async () => {
    const { context: app, document, state } = fixture();
    app.transactions = [{ id: 'old', wallet: 'first-wallet', type: 'expense', date: '2001-02-28', amount: 100, description: 'Old entry', category: 'Retired category', source: 'Retired source' }];
    app.openEditTransactionModal('old');
    assert.equal(document.getElementById('edit-category').value, 'Retired category');
    assert.equal(document.getElementById('edit-source').value, 'Retired source');
    assert.ok(document.getElementById('edit-date-year').options.some(option => option.value === '2001'));
    await app.handleEditTransaction({ target: document.getElementById('edit-transaction-form'), preventDefault() {} });
    assert.equal(state.updated[0].data.date, '2001-02-28');
    assert.equal(state.updated[0].data.category, 'Retired category');
});

test('editing an uncategorized historical transaction does not force a new category or source', async () => {
    const { context: app, document, state } = fixture();
    app.transactions = [{ id: 'old-empty', wallet: 'first-wallet', type: 'expense', date: '2001-02-28', amount: 100, description: 'Old entry', category: '', source: '' }];
    app.openEditTransactionModal('old-empty');
    assert.equal(document.getElementById('edit-category').required, false);
    assert.equal(document.getElementById('edit-source').required, false);
    await app.handleEditTransaction({ target: document.getElementById('edit-transaction-form'), preventDefault() {} });
    assert.equal(state.updated[0].data.category, '');
    assert.equal(state.updated[0].data.source, '');
});

test('reports combine wallet, date, text, type, historical category and source filters', () => {
    const { context: app } = fixture();
    app.transactions = [
        { id: 'a', wallet: 'first-wallet', date: '2026-01-01', type: 'expense', amount: 100, description: 'Đồ ăn', category: 'Old food', source: 'Cash' },
        { id: 'b', wallet: 'first-wallet', date: '2026-01-31', type: 'income', amount: 200, description: 'Salary', category: 'Salary', source: 'Bank' },
        { id: 'c', wallet: 'first-wallet', date: '2026-02-01', type: 'expense', amount: 300, description: 'Lunch', category: 'Old food', source: 'Cash' },
        { id: 'd', wallet: 'other', date: '2026-01-01', type: 'expense', amount: 900, description: 'Đồ ăn', category: 'Old food', source: 'Cash' }
    ];
    app.reportState = { period: 'month', month: '2026-01', query: '' };
    assert.equal(app.getReportTransactions().length, 2);
    app.reportState.query = 'do an';
    assert.equal(app.getReportTransactions()[0].id, 'a');
    const filters = { period: 'custom', start: '2026-01-01', end: '2026-01-31', type: 'expense', category: 'Old food', source: 'Cash' };
    assert.equal(app.getReportTransactions(app.getFilteredTransactions(), filters).length, 1);
    filters.start = '2026-02-01';
    assert.equal(app.getReportTransactions(app.getFilteredTransactions(), filters).length, 0);
});

test('report totals cover all filtered pages, pagination clamps, and reset removes account data', () => {
    const { context: app } = fixture();
    app.transactions = Array.from({ length: 21 }, (_, index) => ({ id: String(index), wallet: 'first-wallet', date: '2026-01-01', type: 'expense', amount: 100, description: 'Private item', category: '<b>Private category</b>', source: 'Cash' }));
    app.initializeReports();
    app.reportState.period = 'all';
    app.renderReports();
    assert.equal(app.reportDom.results.children.length, 20);
    assert.equal(app.reportDom.pagination.hidden, false);
    assert.ok(app.reportDom.totals.textContent.includes(app.formatCurrency(2100)));
    app.reportState.page = 2;
    app.renderReports();
    assert.equal(app.reportDom.results.children.length, 1);
    app.transactions.pop();
    app.renderReports();
    assert.equal(app.reportState.page, 1);
    app.resetReportsState();
    assert.equal(app.reportDom.results.textContent, '');
    assert.equal(app.reportDom.totals.textContent, '');
    assert.equal(app.reportDom.inputs.category.options.length, 1);
    app.reportDom.inputs.period.value = 'all';
    app.reportDom.inputs.month.value = '';
    app.settingsReady = false;
    app.renderReports();
    assert.equal(app.reportDom.inputs.period.value, 'month');
    assert.equal(app.reportDom.inputs.month.value, app.reportState.month);
});
