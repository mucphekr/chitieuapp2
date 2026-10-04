// Reports use the same in-memory snapshot and wallet as the calendar.
var reportState = createReportState();
var reportDom = null;

function createReportState() {
    return { query: '', type: '', category: '', source: '', period: 'month', month: localDateString(new Date()).slice(0, 7), start: '', end: '', page: 1, pageSize: 20, wallet: null };
}

function normalizeReportText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/đ/g, 'd');
}

function getReportTransactions(items, filters) {
    items = items || getFilteredTransactions();
    filters = filters || reportState;
    var query = normalizeReportText(filters.query).trim();
    if (filters.period === 'custom' && filters.start && filters.end && filters.start > filters.end) return [];
    if (filters.period === 'month' && !/^\d{4}-\d{2}$/.test(filters.month || '')) return [];
    return items.filter(function(transaction) {
        if (filters.type && transaction.type !== filters.type) return false;
        if (filters.category && transaction.category !== filters.category) return false;
        if (filters.source && transaction.source !== filters.source) return false;
        if (filters.period === 'month' && String(transaction.date || '').slice(0, 7) !== filters.month) return false;
        if (filters.period === 'custom' && filters.start && transaction.date < filters.start) return false;
        if (filters.period === 'custom' && filters.end && transaction.date > filters.end) return false;
        return !query || normalizeReportText([transaction.description, transaction.category, transaction.source, transaction.amount, transaction.date].join(' ')).includes(query);
    }).slice().sort(function(a, b) {
        return String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || ''));
    });
}

function reportElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function initializeReports() {
    var section = document.getElementById('reports-section');
    if (!section || reportDom) return;
    var heading = section.querySelector('h2') || reportElement('h2', '', 'Tra cứu và báo cáo');
    heading.id = 'reports-title';
    section.setAttribute('aria-labelledby', heading.id);
    section.appendChild(heading);
    var walletLabel = reportElement('p', 'report-wallet');
    section.appendChild(walletLabel);
    var filters = reportElement('form', 'report-filters');
    filters.setAttribute('aria-label', 'Bộ lọc giao dịch');
    filters.addEventListener('submit', function(event) { event.preventDefault(); });
    section.appendChild(filters);
    reportDom = { section: section, filters: filters, walletLabel: walletLabel, inputs: {}, fields: {} };

    function field(name, title, type, options) {
        var wrapper = reportElement('div', 'report-field');
        var label = reportElement('label', '', title);
        label.htmlFor = 'report-' + name;
        var input = document.createElement(options ? 'select' : 'input');
        input.id = 'report-' + name;
        input.name = name;
        if (!options) input.type = type;
        if (options) options.forEach(function(option) { input.add(new Option(option[1], option[0])); });
        if (name === 'query') input.placeholder = 'Mô tả, danh mục, nguồn tiền...';
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        filters.appendChild(wrapper);
        reportDom.inputs[name] = input;
        reportDom.fields[name] = wrapper;
        input.addEventListener(options ? 'change' : 'input', function() {
            reportState[name] = input.value;
            reportState.page = 1;
            renderReports();
        });
    }

    field('query', 'Tìm kiếm', 'search');
    field('period', 'Kỳ thống kê', null, [['month', 'Theo tháng'], ['all', 'Toàn bộ thời gian'], ['custom', 'Khoảng ngày']]);
    field('month', 'Tháng', 'month');
    field('start', 'Từ ngày', 'date');
    field('end', 'Đến ngày', 'date');
    field('type', 'Loại giao dịch', null, [['', 'Tất cả'], ['income', 'Thu nhập'], ['expense', 'Chi tiêu']]);
    field('category', 'Danh mục', null, [['', 'Tất cả danh mục']]);
    field('source', 'Nguồn tiền', null, [['', 'Tất cả nguồn tiền']]);
    var reset = reportElement('button', 'report-reset', 'Đặt lại bộ lọc');
    reset.type = 'button';
    reset.addEventListener('click', function() {
        reportState = createReportState();
        syncReportInputs();
        renderReports();
    });
    filters.appendChild(reset);
    reportDom.status = reportElement('p', 'report-status');
    reportDom.status.setAttribute('role', 'status');
    reportDom.status.setAttribute('aria-live', 'polite');
    section.appendChild(reportDom.status);
    reportDom.totals = reportElement('div', 'report-totals');
    section.appendChild(reportDom.totals);
    reportDom.breakdown = reportElement('div', 'report-breakdown');
    section.appendChild(reportDom.breakdown);
    reportDom.results = reportElement('div', 'report-results');
    reportDom.results.id = 'report-results';
    reportDom.results.setAttribute('aria-label', 'Kết quả tra cứu giao dịch');
    section.appendChild(reportDom.results);
    reportDom.pagination = reportElement('nav', 'report-pagination');
    reportDom.pagination.setAttribute('aria-label', 'Phân trang giao dịch');
    reportDom.previous = reportElement('button', '', 'Trang trước');
    reportDom.next = reportElement('button', '', 'Trang sau');
    reportDom.pageLabel = reportElement('span', 'report-page-label');
    reportDom.pageLabel.setAttribute('aria-live', 'polite');
    [reportDom.previous, reportDom.next].forEach(function(button) {
        button.type = 'button';
        button.setAttribute('aria-controls', 'report-results');
    });
    reportDom.previous.addEventListener('click', function() { reportState.page--; renderReports(); });
    reportDom.next.addEventListener('click', function() { reportState.page++; renderReports(); });
    reportDom.pagination.appendChild(reportDom.previous);
    reportDom.pagination.appendChild(reportDom.pageLabel);
    reportDom.pagination.appendChild(reportDom.next);
    section.appendChild(reportDom.pagination);
    syncReportInputs();
    renderReports();
}

function syncReportInputs() {
    if (!reportDom) return;
    Object.keys(reportDom.inputs).forEach(function(name) { reportDom.inputs[name].value = reportState[name]; });
}

function updateReportChoices(name, values, title) {
    var select = reportDom.inputs[name];
    var unique = Array.from(new Set(values.filter(function(value) { return typeof value === 'string' && value.length; })));
    if (reportState[name] && !unique.includes(reportState[name])) unique.push(reportState[name]);
    unique.sort(function(a, b) { return a.localeCompare(b, 'vi'); });
    select.replaceChildren(new Option(title, ''));
    unique.forEach(function(value) { select.add(new Option(value, value)); });
    select.value = reportState[name];
}

function resetReportsState() {
    reportState = createReportState();
    if (!reportDom) return;
    reportDom.walletLabel.textContent = '';
    reportDom.status.textContent = '';
    reportDom.totals.replaceChildren();
    reportDom.breakdown.replaceChildren();
    reportDom.results.replaceChildren();
    reportDom.pagination.hidden = true;
    updateReportChoices('category', [], 'Tất cả danh mục');
    updateReportChoices('source', [], 'Tất cả nguồn tiền');
    syncReportInputs();
}

function renderReports() {
    if (!reportDom) return;
    syncReportInputs();
    var ready = !!currentUser && settingsReady && transactionsReady;
    Array.from(reportDom.filters.elements).forEach(function(control) { control.disabled = !ready; });
    reportDom.fields.month.hidden = reportState.period !== 'month';
    reportDom.fields.start.hidden = reportState.period !== 'custom';
    reportDom.fields.end.hidden = reportState.period !== 'custom';
    if (!ready) {
        reportDom.totals.replaceChildren();
        reportDom.breakdown.replaceChildren();
        reportDom.results.replaceChildren();
        reportDom.pagination.hidden = true;
        reportDom.status.textContent = currentUser ? 'Đang tải dữ liệu báo cáo...' : '';
        return;
    }
    var wallet = wallets.find(function(item) { return item.id === currentWallet; });
    reportDom.walletLabel.textContent = wallet ? 'Ví đang xem: ' + wallet.icon + ' ' + wallet.name : 'Chưa có ví được chọn';
    if (reportState.wallet !== currentWallet) {
        reportState.wallet = currentWallet;
        reportState.page = 1;
        reportState.category = '';
        reportState.source = '';
    }
    var walletTransactions = getFilteredTransactions();
    updateReportChoices('category', categories.concat(walletTransactions.map(function(transaction) { return transaction.category; })), 'Tất cả danh mục');
    updateReportChoices('source', sources.concat(walletTransactions.map(function(transaction) { return transaction.source; })), 'Tất cả nguồn tiền');
    var invalidRange = reportState.period === 'custom' && reportState.start && reportState.end && reportState.start > reportState.end;
    var missingMonth = reportState.period === 'month' && !reportState.month;
    var results = getReportTransactions(walletTransactions, reportState);
    var periodLabel = reportState.period === 'month' ? 'tháng ' + reportState.month : reportState.period === 'all' ? 'toàn bộ thời gian' : 'từ ' + (reportState.start || 'đầu dữ liệu') + ' đến ' + (reportState.end || 'cuối dữ liệu');
    reportDom.status.textContent = invalidRange ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' : missingMonth ? 'Vui lòng chọn tháng thống kê.' : results.length + ' giao dịch phù hợp · ' + periodLabel;
    reportDom.status.classList.toggle('error', !!(invalidRange || missingMonth));
    var income = 0;
    var expense = 0;
    var byCategory = new Map();
    results.forEach(function(transaction) {
        var amount = Number(transaction.amount) || 0;
        if (transaction.type === 'income') income += amount;
        if (transaction.type === 'expense') expense += amount;
        var category = transaction.category || 'Chưa phân loại';
        if (!byCategory.has(category)) byCategory.set(category, { income: 0, expense: 0 });
        if (transaction.type === 'income' || transaction.type === 'expense') byCategory.get(category)[transaction.type] += amount;
    });
    reportDom.totals.replaceChildren();
    [['Thu nhập', income, 'income'], ['Chi tiêu', expense, 'expense'], ['Chênh lệch thu - chi', income - expense, 'balance']].forEach(function(total) {
        var card = reportElement('div', 'report-total ' + total[2]);
        card.appendChild(reportElement('span', '', total[0]));
        card.appendChild(reportElement('strong', '', formatCurrency(total[1])));
        reportDom.totals.appendChild(card);
    });
    reportDom.breakdown.replaceChildren();
    if (byCategory.size) {
        reportDom.breakdown.appendChild(reportElement('h3', '', 'Tổng theo danh mục trong kết quả lọc'));
        Array.from(byCategory.entries()).sort(function(a, b) { return b[1].expense - a[1].expense || b[1].income - a[1].income; }).forEach(function(entry) {
            var row = reportElement('div', 'report-category-row');
            row.appendChild(reportElement('span', '', entry[0]));
            row.appendChild(reportElement('span', 'income', 'Thu: ' + formatCurrency(entry[1].income)));
            row.appendChild(reportElement('span', 'expense', 'Chi: ' + formatCurrency(entry[1].expense)));
            reportDom.breakdown.appendChild(row);
        });
    }
    var pageCount = Math.max(1, Math.ceil(results.length / reportState.pageSize));
    reportState.page = Math.min(Math.max(1, reportState.page), pageCount);
    reportDom.results.replaceChildren();
    results.slice((reportState.page - 1) * reportState.pageSize, reportState.page * reportState.pageSize).forEach(function(transaction) {
        reportDom.results.appendChild(createTransactionCard(transaction, true));
    });
    if (!results.length) reportDom.results.appendChild(reportElement('p', 'report-empty', 'Không có giao dịch phù hợp với bộ lọc.'));
    reportDom.pagination.hidden = results.length <= reportState.pageSize;
    reportDom.previous.disabled = reportState.page <= 1;
    reportDom.next.disabled = reportState.page >= pageCount;
    reportDom.pageLabel.textContent = 'Trang ' + reportState.page + ' / ' + pageCount;
}

document.addEventListener('DOMContentLoaded', initializeReports);
