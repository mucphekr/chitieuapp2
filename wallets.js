// Settings edits are applied to the latest server snapshot on every retry.
var pendingWalletSelection = null;
var walletDrag = null;
var walletOrderSaving = false;
var modalReturnFocus = new Map();

function resetWalletUiState() {
    pendingWalletSelection = null;
    walletOrderSaving = false;
    cancelWalletDrag();
    modalReturnFocus.clear();
    announceWalletOrder('');
}

async function mutateSettings(mutator) {
    var token = getSessionToken();
    if (!settingsReady || !transactionsReady || !isSessionCurrent(token)) {
        throw new Error('Vui lòng đợi dữ liệu tải xong.');
    }
    var ref = getUserSettingsDoc();
    return db.runTransaction(async function(transaction) {
        var snapshot = await transaction.get(ref);
        if (!isSessionCurrent(token)) throw new Error('Phiên đăng nhập đã thay đổi.');
        if (!snapshot.exists) throw new Error('Chưa tải được cài đặt. Vui lòng thử lại.');
        var patch = mutator(snapshot.data());
        if (patch) transaction.update(ref, patch);
    });
}

function showSettingsStatus(message, error) {
    var status = document.getElementById('app-status');
    if (status) {
        status.hidden = false;
        status.dataset.state = 'mutation';
        status.textContent = message;
        status.classList.toggle('status-error', Boolean(error));
    }
}

async function runSettingsAction(form, action, onSuccess) {
    if (form && form.dataset.saving === 'true') return false;
    var token = getSessionToken();
    if (!isSessionCurrent(token)) return false;
    if (form) {
        form.dataset.saving = 'true';
        Array.from(form.elements).forEach(function(control) { control.disabled = true; });
    }
    showSettingsStatus('Đang lưu thay đổi…');
    try {
        await action();
        if (!isSessionCurrent(token)) return false;
        showSettingsStatus('Đã lưu thay đổi.');
        if (onSuccess) onSuccess();
        return true;
    } catch (error) {
        if (isSessionCurrent(token)) {
            pendingWalletSelection = null;
            showSettingsStatus('Không lưu được: ' + error.message, true);
        }
        return false;
    } finally {
        if (form && isSessionCurrent(token)) {
            delete form.dataset.saving;
            Array.from(form.elements).forEach(function(control) { control.disabled = false; });
            updateAppReadiness();
        }
    }
}

async function addSettingValue(field, value, form) {
    return runSettingsAction(form, function() {
        return mutateSettings(function(data) {
            var values = data[field] || [];
            var patch = {};
            patch[field] = values.includes(value) ? values : values.concat(value);
            return patch;
        });
    }, function() { form.reset(); });
}

async function removeSettingValue(field, value) {
    return runSettingsAction(null, function() {
        return mutateSettings(function(data) {
            var patch = {};
            patch[field] = (data[field] || []).filter(function(item) { return item !== value; });
            return patch;
        });
    });
}

function createWalletAction(className, text, label, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset.action = action;
    return button;
}

function focusWalletAction(id, action) {
    var item = Array.from(walletTabsContainer.children).find(function(node) { return node.dataset.wallet === id; });
    if (item) {
        var button = Array.from(item.querySelectorAll('button')).find(function(node) { return node.dataset.action === action; });
        if (button) button.focus({ preventScroll: true });
    }
}

function announceWalletOrder(message) {
    var status = document.getElementById('wallet-reorder-status');
    if (status) status.textContent = message;
}

// Move only the requested wallet relative to an anchor; preserve concurrent additions/edits.
function moveWalletInList(latest, id, anchorId, after) {
    var moved = latest.find(function(wallet) { return wallet.id === id; });
    if (!moved || id === anchorId) return latest;
    var rest = latest.filter(function(wallet) { return wallet.id !== id; });
    var anchor = rest.findIndex(function(wallet) { return wallet.id === anchorId; });
    if (anchor < 0) return latest;
    rest.splice(anchor + (after ? 1 : 0), 0, moved);
    return rest;
}

async function reorderWallet(id, anchorId, after) {
    if (walletOrderSaving) return;
    var token = getSessionToken();
    walletOrderSaving = true;
    announceWalletOrder('Đang lưu thứ tự ví…');
    var saved = await runSettingsAction(null, function() {
        return mutateSettings(function(data) {
            return { wallets: moveWalletInList(data.wallets || [], id, anchorId, after) };
        });
    });
    if (isSessionCurrent(token)) {
        walletOrderSaving = false;
        announceWalletOrder(saved ? 'Đã lưu thứ tự ví.' : 'Không lưu được thứ tự ví. Vui lòng thử lại.');
        focusWalletAction(id, 'move');
    }
}

function handleWalletMoveKey(event, id) {
    var index = wallets.findIndex(function(wallet) { return wallet.id === id; });
    var destination;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') destination = index - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') destination = index + 1;
    if (event.key === 'Home') destination = 0;
    if (event.key === 'End') destination = wallets.length - 1;
    if (destination === undefined) return;
    event.preventDefault();
    if (destination < 0 || destination >= wallets.length || destination === index) return;
    reorderWallet(id, wallets[destination].id, destination > index);
}

function startWalletDrag(event, id) {
    if (event.button !== 0 || walletOrderSaving || !settingsReady || !transactionsReady) return;
    cancelWalletDrag();
    var handle = event.currentTarget;
    walletDrag = { id: id, handle: handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        anchorId: null, after: false, moved: false, token: getSessionToken() };
    handle.setPointerCapture(event.pointerId);
    document.addEventListener('pointermove', moveWalletDrag, { passive: false });
    document.addEventListener('pointerup', finishWalletDrag);
    document.addEventListener('pointercancel', cancelWalletDrag);
    document.addEventListener('keydown', cancelWalletDragOnEscape);
}

function moveWalletDrag(event) {
    if (!walletDrag || event.pointerId !== walletDrag.pointerId) return;
    if (!isSessionCurrent(walletDrag.token)) { cancelWalletDrag(); return; }
    if (!walletDrag.moved && Math.hypot(event.clientX - walletDrag.x, event.clientY - walletDrag.y) < 6) return;
    event.preventDefault();
    walletDrag.moved = true;
    walletDrag.handle.closest('.wallet-item').classList.add('is-dragging');
    var hit = document.elementFromPoint(event.clientX, event.clientY);
    var target = hit && hit.closest('.wallet-item');
    walletTabsContainer.querySelectorAll('.is-drop-target').forEach(function(item) { item.classList.remove('is-drop-target'); });
    walletDrag.anchorId = null;
    if (target && walletTabsContainer.contains(target) && target.dataset.wallet !== walletDrag.id) {
        walletDrag.anchorId = target.dataset.wallet;
        var rect = target.getBoundingClientRect();
        var singleColumn = rect.width >= walletTabsContainer.clientWidth * 0.85;
        walletDrag.after = singleColumn ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
        target.classList.add('is-drop-target');
        target.dataset.dropPosition = walletDrag.after ? 'after' : 'before';
        announceWalletOrder((walletDrag.after ? 'Đặt sau ' : 'Đặt trước ') + getWalletName(walletDrag.anchorId));
    }
}

function finishWalletDrag(event) {
    if (!walletDrag || event.pointerId !== walletDrag.pointerId) return;
    var drag = walletDrag;
    cancelWalletDrag();
    if (drag.moved && drag.anchorId !== null && isSessionCurrent(drag.token)) {
        reorderWallet(drag.id, drag.anchorId, drag.after);
    }
}

function cancelWalletDragOnEscape(event) {
    if (event.key === 'Escape') cancelWalletDrag();
}

function cancelWalletDrag() {
    if (walletDrag && walletDrag.handle.hasPointerCapture(walletDrag.pointerId)) {
        walletDrag.handle.releasePointerCapture(walletDrag.pointerId);
    }
    walletDrag = null;
    document.removeEventListener('pointermove', moveWalletDrag);
    document.removeEventListener('pointerup', finishWalletDrag);
    document.removeEventListener('pointercancel', cancelWalletDrag);
    document.removeEventListener('keydown', cancelWalletDragOnEscape);
    walletTabsContainer.querySelectorAll('.is-dragging, .is-drop-target').forEach(function(item) {
        item.classList.remove('is-dragging', 'is-drop-target');
        delete item.dataset.dropPosition;
    });
}

function showAppModal(id) {
    var modal = document.getElementById(id);
    var active = document.activeElement;
    var walletItem = active.closest('.wallet-item');
    var transactionList = active.closest('#report-results, #transaction-list');
    modalReturnFocus.set(id, { element: active,
        walletId: walletItem ? walletItem.dataset.wallet : null, action: active.dataset.action,
        transactionId: active.dataset.transactionId, listId: transactionList && transactionList.id });
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    var first = modal.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), button:not(:disabled)');
    if (first) first.focus();
}

function hideAppModal(id, restoreFocus) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'none';
    var previous = modalReturnFocus.get(id);
    modalReturnFocus.delete(id);
    if (!Array.from(document.querySelectorAll('.modal-overlay')).some(function(item) { return item.style.display === 'flex'; })) {
        document.body.classList.remove('modal-open');
    }
    if (restoreFocus !== false && previous) {
        if (previous.element.isConnected && !previous.element.disabled) previous.element.focus();
        else if (previous.walletId !== null) focusWalletAction(previous.walletId, previous.action);
        else if (previous.transactionId && previous.listId) {
            var list = document.getElementById(previous.listId);
            var replacement = Array.from(list.querySelectorAll('.edit-btn')).find(function(button) {
                return button.dataset.transactionId === previous.transactionId;
            });
            if (replacement) replacement.focus();
            else {
                list.tabIndex = -1;
                list.focus();
            }
        }
    }
}

document.addEventListener('keydown', function(event) {
    var modal = Array.from(document.querySelectorAll('.modal-overlay')).find(function(item) { return item.style.display === 'flex'; });
    if (!modal) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        hideAppModal(modal.id);
    } else if (event.key === 'Tab') {
        var controls = Array.from(modal.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), [tabindex="0"]'));
        if (!controls.length) { event.preventDefault(); return; }
        var first = controls[0];
        var last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
        }
    }
});
