// script.js - SỬ DỤNG FIREBASE COMPAT + QUẢN LÝ VÍ ĐỘNG + MULTI-USER AUTHENTICATION

// 1. CẤU HÌNH FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDC1gme0hkUWK-np5sG4jqLO9LwgMOFF1M",
    authDomain: "chitieucacnhan.firebaseapp.com",
    projectId: "chitieucacnhan",
    storageBucket: "chitieucacnhan.firebasestorage.app",
    messagingSenderId: "591107537190",
    appId: "1:591107537190:web:21e716584f7043ca7429e7",
    measurementId: "G-SWZ590KJWN"
};

// 2. KHỞI TẠO FIREBASE
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// === AUTHENTICATION LOGIC (MULTI-USER) ===

// Biến lưu thông tin user hiện tại
var currentUser = null;
var currentUserData = null;
var sessionEpoch = 0;
var settingsReady = false;
var transactionsReady = false;
var dataLoadError = '';

function getSessionToken() {
    return { uid: currentUser ? currentUser.uid : null, epoch: sessionEpoch };
}

function isSessionCurrent(token) {
    return Boolean(token && currentUser && token.uid === currentUser.uid && token.epoch === sessionEpoch);
}

// DOM Elements cho Auth (sẽ được gán sau khi DOM load)
var authScreen, appContent, loginForm, registerForm, authError, authSuccess, userEmailDisplay, logoutBtn;

// Hiển thị lỗi
function showAuthError(message) {
    if (authError) {
        authError.textContent = message;
        authError.style.display = 'block';
        if (authSuccess) authSuccess.style.display = 'none';
        setTimeout(function() {
            authError.style.display = 'none';
        }, 5000);
    }
}

// Hiển thị thông báo thành công
function showAuthSuccess(message) {
    if (authSuccess) {
        authSuccess.textContent = message;
        authSuccess.style.display = 'block';
        if (authError) authError.style.display = 'none';
        setTimeout(function() {
            authSuccess.style.display = 'none';
        }, 5000);
    }
}

// Tải thông tin đăng nhập đã lưu
function loadSavedCredentials() {
    var savedEmail = localStorage.getItem('saved_email');
    var savedPassword = localStorage.getItem('saved_password');
    var rememberMe = localStorage.getItem('remember_me') === 'true';
    
    var emailInput = document.getElementById('login-email');
    var passwordInput = document.getElementById('login-password');
    var rememberCheckbox = document.getElementById('remember-me');
    
    if (rememberMe && savedEmail && savedPassword && emailInput && passwordInput) {
        emailInput.value = savedEmail;
        passwordInput.value = savedPassword;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }
}

// Lưu thông tin đăng nhập
function saveCredentials(email, password) {
    localStorage.setItem('saved_email', email);
    localStorage.setItem('saved_password', password);
    localStorage.setItem('remember_me', 'true');
}

// Xóa thông tin đăng nhập đã lưu
function clearSavedCredentials() {
    localStorage.removeItem('saved_email');
    localStorage.removeItem('saved_password');
    localStorage.removeItem('remember_me');
}

// Chuyển đổi tab Auth (Đăng nhập / Đăng ký)
function switchAuthTab(tabName) {
    var loginTab = document.querySelector('.auth-tab[data-tab="login"]');
    var registerTab = document.querySelector('.auth-tab[data-tab="register"]');
    var subtitle = document.getElementById('auth-subtitle');
    
    if (tabName === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        subtitle.textContent = '🔐 Vui lòng đăng nhập để tiếp tục';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        loginTab.classList.remove('active');
        registerTab.classList.add('active');
        subtitle.textContent = '📝 Tạo tài khoản mới để bắt đầu';
    }
    
    // Ẩn thông báo lỗi/thành công
    if (authError) authError.style.display = 'none';
    if (authSuccess) authSuccess.style.display = 'none';
}

// Toggle hiển thị mật khẩu
function setupPasswordToggle(toggleBtnId, inputId) {
    var toggleBtn = document.getElementById(toggleBtnId);
    var input = document.getElementById(inputId);
    
    if (toggleBtn && input) {
        toggleBtn.addEventListener('click', function() {
            if (input.type === 'password') {
                input.type = 'text';
                this.querySelector('.eye-icon').textContent = '🙈';
                this.classList.add('active');
            } else {
                input.type = 'password';
                this.querySelector('.eye-icon').textContent = '👁️';
                this.classList.remove('active');
            }
        });
    }
}

// Tạo dữ liệu mặc định cho user mới
function getDefaultSettings() {
    return {
        categories: ["Ăn uống", "Lương", "Đi lại", "Mua sắm", "Tiền nhà", "Giải trí", "Y tế", "Giáo dục"],
        sources: ["Tiền mặt", "Thẻ ATM", "Chuyển khoản", "Ví điện tử"],
        wallets: [
            { id: 'chung', icon: '🏠', name: 'Ví Chung' },
            { id: 'canhan', icon: '👤', name: 'Cá Nhân' }
        ]
    };
}

function createDefaultUserData(userId, displayName, email) {
    var userDocRef = db.collection('users').doc(userId);
    var settingsDoc = userDocRef.collection('settings').doc('appData');
    // Registration and the first snapshot can race; only create missing documents.
    return db.runTransaction(async function(transaction) {
        var profile = await transaction.get(userDocRef);
        var settings = await transaction.get(settingsDoc);
        if (!profile.exists) {
            transaction.set(userDocRef, {
                displayName: displayName,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        if (!settings.exists) transaction.set(settingsDoc, getDefaultSettings());
    });
}

// === CHỨC NĂNG DI CHUYỂN DỮ LIỆU CŨ ===
var isMigrating = false;

function migrateOldData() {
    if (!currentUser) {
        alert('❌ Vui lòng đăng nhập trước khi di chuyển dữ liệu!');
        return;
    }
    
    if (isMigrating) {
        alert('⏳ Đang di chuyển dữ liệu, vui lòng đợi...');
        return;
    }
    
    if (!confirm('🔄 Bạn có muốn di chuyển dữ liệu cũ (từ tài khoản vietnhung) sang tài khoản hiện tại?\n\nLưu ý: Thao tác này sẽ COPY dữ liệu cũ vào tài khoản của bạn.')) {
        return;
    }
    
    isMigrating = true;
    var migrationSession = getSessionToken();
    console.log('🔄 Bắt đầu di chuyển dữ liệu cũ...');
    
    var oldTransactionsCol = db.collection('transactions');
    var oldSettingsDoc = db.collection('settings').doc('appData');
    var userDocRef = db.collection('users').doc(currentUser.uid);
    
    var migratedTransactions = 0;
    
    // 1. Di chuyển Settings trước
    oldSettingsDoc.get().then(function(docSnap) {
        if (!isSessionCurrent(migrationSession)) throw new Error('Session changed');
        if (docSnap.exists) {
            var oldSettings = docSnap.data();
            console.log('📋 Tìm thấy settings cũ:', oldSettings);
            
            return userDocRef.collection('settings').doc('appData').set(oldSettings, { merge: true })
                .then(function() {
                    console.log('✅ Đã di chuyển settings!');
                });
        } else {
            console.log('⚠️ Không tìm thấy settings cũ');
            return Promise.resolve();
        }
    }).then(function() {
        if (!isSessionCurrent(migrationSession)) throw new Error('Session changed');
        // 2. Di chuyển Transactions
        return oldTransactionsCol.get();
    }).then(function(snapshot) {
        if (!isSessionCurrent(migrationSession)) throw new Error('Session changed');
        if (snapshot.empty) {
            console.log('⚠️ Không tìm thấy giao dịch cũ');
            return Promise.resolve();
        }
        
        console.log('📊 Tìm thấy ' + snapshot.size + ' giao dịch cũ');
        
        // Sử dụng batch để ghi nhiều documents cùng lúc
        var batch = db.batch();
        var batchCount = 0;
        var batchPromises = [];
        
        snapshot.forEach(function(doc) {
            var data = doc.data();
            var newDocRef = userDocRef.collection('transactions').doc(doc.id);
            batch.set(newDocRef, data);
            batchCount++;
            migratedTransactions++;
            
            // Firestore batch chỉ hỗ trợ 500 operations
            if (batchCount >= 450) {
                batchPromises.push(batch.commit());
                batch = db.batch();
                batchCount = 0;
            }
        });
        
        // Commit batch cuối cùng
        if (batchCount > 0) {
            batchPromises.push(batch.commit());
        }
        
        return Promise.all(batchPromises);
    }).then(function() {
        if (!isSessionCurrent(migrationSession)) return;
        isMigrating = false;
        var message = '✅ Di chuyển dữ liệu thành công!\n\n' +
            '📊 Đã di chuyển ' + migratedTransactions + ' giao dịch.\n\n' +
            'Dữ liệu cũ vẫn được giữ nguyên trong Firebase.';
        alert(message);
        console.log(message);
        
        // Reload để cập nhật giao diện
        location.reload();
    }).catch(function(error) {
        if (!isSessionCurrent(migrationSession)) return;
        isMigrating = false;
        console.error('❌ Lỗi khi di chuyển dữ liệu:', error);
        alert('❌ Có lỗi xảy ra khi di chuyển dữ liệu!\n\n' + error.message);
    });
}

// Expose function để có thể gọi từ console hoặc button
window.migrateOldData = migrateOldData;

// Khởi tạo Authentication khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', function() {
    // Gán DOM Elements
    authScreen = document.getElementById('auth-screen');
    appContent = document.getElementById('app-content');
    loginForm = document.getElementById('login-form');
    registerForm = document.getElementById('register-form');
    authError = document.getElementById('auth-error');
    authSuccess = document.getElementById('auth-success');
    userEmailDisplay = document.getElementById('user-email');
    logoutBtn = document.getElementById('logout-btn');
    
    // Tải credentials đã lưu
    loadSavedCredentials();
    
    // Setup toggle password cho tất cả các input password
    setupPasswordToggle('toggle-password-login', 'login-password');
    setupPasswordToggle('toggle-password-register', 'register-password');
    setupPasswordToggle('toggle-password-confirm', 'register-confirm-password');
    
    // Setup Auth Tabs
    var authTabs = document.querySelectorAll('.auth-tab');
    authTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            switchAuthTab(this.getAttribute('data-tab'));
        });
    });
    
    // Xử lý Quên mật khẩu
    var forgotPasswordLink = document.getElementById('forgot-password-link');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            var email = document.getElementById('login-email').value.trim();
            
            if (!email) {
                email = prompt('Nhập email của bạn để nhận link đặt lại mật khẩu:');
            }
            
            if (!email || !email.includes('@')) {
                showAuthError('❌ Vui lòng nhập email hợp lệ!');
                return;
            }
            
            auth.sendPasswordResetEmail(email)
                .then(function() {
                    showAuthSuccess('✅ Đã gửi email đặt lại mật khẩu!\n\nKiểm tra hộp thư của bạn (kể cả thư mục Spam).');
                    alert('✅ Đã gửi email đặt lại mật khẩu đến:\n' + email + '\n\nVui lòng kiểm tra hộp thư (kể cả thư mục Spam).');
                })
                .catch(function(error) {
                    console.error('Reset password error:', error);
                    if (error.code === 'auth/user-not-found') {
                        showAuthError('❌ Email này chưa được đăng ký!');
                    } else if (error.code === 'auth/invalid-email') {
                        showAuthError('❌ Email không hợp lệ!');
                    } else {
                        showAuthError('❌ Lỗi: ' + error.message);
                    }
                });
        });
    }
    
    // Xử lý đăng nhập
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            var email = document.getElementById('login-email').value.trim();
            var password = document.getElementById('login-password').value;
            var rememberCheckbox = document.getElementById('remember-me');
            var rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
            
            // Kiểm tra email
            if (!email || !email.includes('@')) {
                showAuthError('❌ Vui lòng nhập email hợp lệ!');
                return;
            }
            
            // Đăng nhập với Firebase Auth
            auth.signInWithEmailAndPassword(email, password)
                .then(function(userCredential) {
                    console.log('✅ Đăng nhập thành công!');
                    // Lưu thông tin nếu chọn "Ghi nhớ"
                    if (rememberMe) {
                        saveCredentials(email, password);
                    } else {
                        clearSavedCredentials();
                    }
                })
                .catch(function(error) {
                    console.log('Firebase Auth Error:', error.code);
                    
                    if (error.code === 'auth/user-not-found') {
                        showAuthError('❌ Tài khoản không tồn tại! Vui lòng đăng ký.');
                    } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                        showAuthError('❌ Email hoặc mật khẩu không đúng!');
                    } else if (error.code === 'auth/too-many-requests') {
                        showAuthError('⏳ Quá nhiều lần thử! Vui lòng đợi vài phút.');
                    } else if (error.code === 'auth/invalid-email') {
                        showAuthError('❌ Email không hợp lệ!');
                    } else {
                        showAuthError('❌ Lỗi đăng nhập! ' + error.message);
                        console.error(error);
                    }
                });
        });
    }
    
    // Xử lý đăng ký
    if (registerForm) {
        registerForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            var displayName = document.getElementById('register-name').value.trim();
            var email = document.getElementById('register-email').value.trim();
            var password = document.getElementById('register-password').value;
            var confirmPassword = document.getElementById('register-confirm-password').value;
            
            // Validate
            if (!displayName) {
                showAuthError('❌ Vui lòng nhập tên hiển thị!');
                return;
            }
            
            if (!email || !email.includes('@')) {
                showAuthError('❌ Vui lòng nhập email hợp lệ!');
                return;
            }
            
            if (password.length < 6) {
                showAuthError('❌ Mật khẩu phải có ít nhất 6 ký tự!');
                return;
            }
            
            if (password !== confirmPassword) {
                showAuthError('❌ Mật khẩu xác nhận không khớp!');
                return;
            }
            
            // Đăng ký với Firebase Auth
            auth.createUserWithEmailAndPassword(email, password)
                .then(function(userCredential) {
                    console.log('✅ Đăng ký thành công!');
                    
                    // Cập nhật profile
                    return userCredential.user.updateProfile({
                        displayName: displayName
                    }).then(function() {
                        return createDefaultUserData(userCredential.user.uid, displayName, email);
                    }).then(function() {
                        showAuthSuccess('✅ Đăng ký thành công! Đang đăng nhập...');
                    });
                })
                .catch(function(error) {
                    console.log('Register Error:', error.code);
                    
                    if (error.code === 'auth/email-already-in-use') {
                        showAuthError('❌ Email này đã được sử dụng!');
                    } else if (error.code === 'auth/weak-password') {
                        showAuthError('❌ Mật khẩu quá yếu! Vui lòng chọn mật khẩu mạnh hơn.');
                    } else if (error.code === 'auth/invalid-email') {
                        showAuthError('❌ Email không hợp lệ!');
                    } else {
                        showAuthError('❌ Lỗi đăng ký! ' + error.message);
                        console.error(error);
                    }
                });
        });
    }
    
    // Xử lý đăng xuất
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('Bạn có chắc muốn đăng xuất?')) {
                auth.signOut()
                    .then(function() {
                        console.log('✅ Đã đăng xuất!');
                    })
                    .catch(function(error) {
                        console.error('Lỗi khi đăng xuất:', error);
                        alert('Lỗi khi đăng xuất! Vui lòng thử lại.');
                    });
            }
        });
    }
});

// Lắng nghe trạng thái đăng nhập
function handleAuthStateChanged(user) {
    // Đợi DOM sẵn sàng
    if (!authScreen) {
        authScreen = document.getElementById('auth-screen');
        appContent = document.getElementById('app-content');
        userEmailDisplay = document.getElementById('user-email');
    }
    
    var nextUid = user ? user.uid : null;
    if (authStateApplied && (currentUser ? currentUser.uid : null) === nextUid) {
        currentUser = user;
        return;
    }
    authStateApplied = true;
    // Invalidate queued snapshots and pending writes before clearing the old UI.
    sessionEpoch += 1;
    teardownRealtimeListeners();
    currentUser = null;
    resetSessionState();
    currentUser = user;

    if (user) {
        // Đã đăng nhập - hiển thị app
        if (authScreen) authScreen.style.display = 'none';
        if (appContent) appContent.style.display = 'block';
        
        // Hiển thị tên người dùng
        if (userEmailDisplay) {
            var displayName = user.displayName || (user.email || '').split('@')[0];
            userEmailDisplay.textContent = '👤 ' + displayName;
        }
        
        // Khởi tạo app
        initializeApp();
    } else {
        // Chưa đăng nhập - hiển thị màn hình đăng nhập
        if (authScreen) authScreen.style.display = 'flex';
        if (appContent) appContent.style.display = 'none';
    }
    updateAppReadiness();
}

var authStateApplied = false;
function subscribeToAuthState() {
    auth.onAuthStateChanged(handleAuthStateChanged);
}
// All feature scripts must be loaded before cached auth can render the app.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', subscribeToAuthState, { once: true });
} else {
    subscribeToAuthState();
}

// Hàm khởi tạo app (chỉ chạy khi đã đăng nhập)
var appInitialized = false;
var appEventsBound = false;

function resetSessionState() {
    appInitialized = false;
    currentUserData = null;
    transactions = [];
    categories = [];
    sources = [];
    wallets = [];
    currentWallet = '';
    selectedDate = null;
    currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    settingsReady = false;
    transactionsReady = false;
    dataLoadError = '';
    isMigrating = false;
    if (typeof resetWalletUiState === 'function') resetWalletUiState();
    if (typeof resetTransactionUiState === 'function') resetTransactionUiState();
    document.querySelectorAll('#app-content form, .modal-overlay form').forEach(function(form) {
        form.reset();
        delete form.dataset.saving;
        form.removeAttribute('aria-busy');
    });
    if (typeof resetReportsState === 'function') resetReportsState();
    document.querySelectorAll('.modal-overlay').forEach(function(modal) {
        if (typeof hideAppModal === 'function') hideAppModal(modal.id, false);
        else modal.style.display = 'none';
    });
    ['wallet-tabs', 'wallet', 'category', 'source', 'category-list', 'source-list',
        'transaction-list', 'selected-date-summary', 'selected-date-text',
        'edit-category', 'edit-source'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) element.replaceChildren();
    });
    ['edit-wallet-id', 'edit-transaction-id'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) element.value = '';
    });
    if (userEmailDisplay) userEmailDisplay.textContent = '';
    var status = document.getElementById('app-status');
    if (status) {
        status.textContent = '';
        status.hidden = true;
        delete status.dataset.state;
    }
    if (currentWalletNameEl) currentWalletNameEl.textContent = 'Đang xem: ---';
    var detailSection = document.getElementById('transaction-detail-section');
    if (detailSection) detailSection.style.display = 'none';
    calculateSummary();
    renderCalendar();
}

function updateAppReadiness() {
    var ready = Boolean(currentUser && settingsReady && transactionsReady);
    var status = document.getElementById('app-status');
    if (status) {
        if (!currentUser) {
            status.textContent = '';
            delete status.dataset.state;
        } else if (dataLoadError) {
            status.textContent = dataLoadError;
            status.dataset.state = 'error';
        } else if (!ready) {
            status.textContent = 'Đang tải dữ liệu tài khoản...';
            status.dataset.state = 'loading';
        } else if (status.dataset.state === 'loading' || status.dataset.state === 'error') {
            status.textContent = '';
            delete status.dataset.state;
        }
        status.hidden = !status.textContent;
    }
    document.querySelectorAll('#app-content form, .modal-overlay form').forEach(function(form) {
        var saving = form.dataset.saving === 'true';
        form.querySelectorAll('input, select, textarea, button').forEach(function(control) {
            control.disabled = !ready || saving;
        });
    });
}

function initializeApp() {
    if (appInitialized || !currentUser) return;
    appInitialized = true;
    
    // Lắng nghe dữ liệu từ Firebase
    setupRealtimeListeners(); 
    
    // Khởi tạo lịch
    renderCalendar();
    
    // Khởi tạo date picker
    initDatePicker();
    
    if (!appEventsBound) {
        appEventsBound = true;
        document.getElementById('prev-month').addEventListener('click', function() { changeMonth(-1); });
        document.getElementById('next-month').addEventListener('click', function() { changeMonth(1); });
        document.getElementById('close-date-detail').addEventListener('click', closeDateDetail);
        setupEventListeners();
    }
}

// Tham chiếu đến collections và documents (THEO USER)
function getUserTransactionsCol() {
    if (!currentUser) return null;
    return db.collection('users').doc(currentUser.uid).collection('transactions');
}

function getUserSettingsDoc() {
    if (!currentUser) return null;
    return db.collection('users').doc(currentUser.uid).collection('settings').doc('appData');
}

// --- 3. CÁC BIẾN ỨNG DỤNG ---
let transactions = []; 
let categories = [];
let sources = [];
let wallets = []; // Danh sách ví động
let currentWallet = ''; // Ví hiện tại đang xem

// Biến cho History Section
let selectedDate = null;
const categorySelect = document.getElementById('category');
const sourceSelect = document.getElementById('source');
const walletSelect = document.getElementById('wallet');
const walletTabsContainer = document.getElementById('wallet-tabs');

// Biến cho Summary
const totalIncomeSummary = document.getElementById('total-income-summary');
const totalExpenseSummary = document.getElementById('total-expense-summary');
const netBalanceSummary = document.getElementById('net-balance-summary');
const netBalanceCard = document.querySelector('.net-balance');

// Biến cho Calendar
let currentMonth = new Date();
const currentMonthDisplay = document.getElementById('current-month-display');
const calendarGrid = document.getElementById('calendar-grid');

// Biến cho Wallet
const currentWalletNameEl = document.getElementById('current-wallet-name');


// --- 4. LOGIC KHỞI TẠO ---
// (Đã chuyển sang hàm initializeApp() - được gọi sau khi đăng nhập thành công)

// --- HÀM KHỞI TẠO DATE PICKER ---
function initDatePicker() {
    var daySelect = document.getElementById('date-day');
    var monthSelect = document.getElementById('date-month');
    var yearSelect = document.getElementById('date-year');
    
    // Populate years (từ năm hiện tại - 5 đến năm hiện tại + 2)
    var currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '';
    for (var y = currentYear - 5; y <= currentYear + 2; y++) {
        var option = document.createElement('option');
        option.value = y;
        option.textContent = y;
        yearSelect.appendChild(option);
    }
    
    // Set current date
    var today = new Date();
    yearSelect.value = today.getFullYear();
    monthSelect.value = today.getMonth() + 1;
    updateDaysInMonth();
    daySelect.value = today.getDate();
    
    // Event listeners để cập nhật số ngày khi thay đổi tháng/năm
    monthSelect.addEventListener('change', updateDaysInMonth);
    yearSelect.addEventListener('change', updateDaysInMonth);
}

function updateDaysInMonth() {
    var daySelect = document.getElementById('date-day');
    var monthSelect = document.getElementById('date-month');
    var yearSelect = document.getElementById('date-year');
    
    var currentDay = parseInt(daySelect.value) || 1;
    var month = parseInt(monthSelect.value);
    var year = parseInt(yearSelect.value);
    
    // Tính số ngày trong tháng
    var daysInMonth = new Date(year, month, 0).getDate();
    
    // Populate days
    daySelect.innerHTML = '';
    for (var d = 1; d <= daysInMonth; d++) {
        var option = document.createElement('option');
        option.value = d;
        option.textContent = String(d).padStart(2, '0');
        daySelect.appendChild(option);
    }
    
    // Giữ ngày đã chọn nếu hợp lệ
    if (currentDay > daysInMonth) {
        daySelect.value = daysInMonth;
    } else {
        daySelect.value = currentDay;
    }
}

function getSelectedDate() {
    var day = document.getElementById('date-day').value;
    var month = document.getElementById('date-month').value;
    var year = document.getElementById('date-year').value;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function setSelectedDate(dateStr) {
    var parts = dateStr.split('-');
    if (parts.length === 3) {
        var year = parseInt(parts[0]);
        var month = parseInt(parts[1]);
        var day = parseInt(parts[2]);
        
        var yearSelect = document.getElementById('date-year');
        if (typeof ensureDateYearOption === 'function') ensureDateYearOption(yearSelect, year);
        yearSelect.value = year;
        document.getElementById('date-month').value = month;
        updateDaysInMonth();
        document.getElementById('date-day').value = day;
    }
}

function setupEventListeners() {
    document.getElementById('add-transaction-form').addEventListener('submit', handleAddTransaction);
    document.getElementById('add-category-form').addEventListener('submit', handleAddCategory);
    document.getElementById('add-source-form').addEventListener('submit', handleAddSource);
    document.getElementById('add-wallet-form').addEventListener('submit', handleAddWallet);
    
    // Event listeners cho modal chỉnh sửa
    document.getElementById('edit-wallet-form').addEventListener('submit', handleEditWallet);
    document.getElementById('edit-transaction-form').addEventListener('submit', handleEditTransaction);
    
    // Đóng modal khi click bên ngoài
    document.getElementById('edit-wallet-modal').addEventListener('click', function(e) {
        if (e.target === this) closeEditWalletModal();
    });
    document.getElementById('edit-transaction-modal').addEventListener('click', function(e) {
        if (e.target === this) closeEditTransactionModal();
    });
}


// --- 5. HÀM LẮNG NGHE DỮ LIỆU THỜI GIAN THỰC ---
var transactionsUnsubscribe = null;
var settingsUnsubscribe = null;

function teardownRealtimeListeners() {
    if (transactionsUnsubscribe) transactionsUnsubscribe();
    if (settingsUnsubscribe) settingsUnsubscribe();
    transactionsUnsubscribe = null;
    settingsUnsubscribe = null;
}

function setupRealtimeListeners() {
    teardownRealtimeListeners();
    var token = getSessionToken();
    if (!token.uid) return;
    var userDoc = db.collection('users').doc(token.uid);
    var transactionsCol = userDoc.collection('transactions');
    var settingsDoc = userDoc.collection('settings').doc('appData');
    var creatingSettings = false;
    
    // 1. Lắng nghe Dữ liệu Giao Dịch
    transactionsUnsubscribe = transactionsCol.onSnapshot(function(snapshot) {
        if (!isSessionCurrent(token)) return;
        transactions = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            // Nếu giao dịch cũ không có wallet, gán mặc định
            if (data.wallet === undefined || data.wallet === null) {
                data.wallet = 'chung';
            }
            transactions.push({ ...data, id: doc.id });
        });
        transactionsReady = true;
        if (settingsReady) dataLoadError = '';
        updateAppReadiness();
        // Sau khi tải xong, vẽ lại giao diện
        calculateSummary();
        renderCalendar();
        // Nếu đang chọn ngày, cập nhật lại danh sách giao dịch
        if (selectedDate) {
            renderTransactionsForDate(selectedDate);
        }
    }, function(error) {
        if (!isSessionCurrent(token)) return;
        transactionsReady = false;
        dataLoadError = 'Không tải được giao dịch. Vui lòng kiểm tra kết nối/quyền truy cập và tải lại trang.';
        updateAppReadiness();
        console.error('❌ Lỗi khi lắng nghe transactions:', error);
    });

    // 2. Lắng nghe Dữ liệu Cài Đặt (Danh mục/Nguồn/Ví)
    settingsUnsubscribe = settingsDoc.onSnapshot(function(docSnap) {
        if (!isSessionCurrent(token)) return;
        if (docSnap.exists) {
            var data = docSnap.data();
            categories = Array.isArray(data.categories) ? data.categories : [];
            sources = Array.isArray(data.sources) ? data.sources : [];
            wallets = Array.isArray(data.wallets) ? data.wallets : [
                { id: 'chung', icon: '🏠', name: 'Ví Chung' }
            ];
            if (!wallets.some(function(wallet) { return wallet.id === currentWallet; })) {
                currentWallet = wallets.length ? wallets[0].id : '';
            }
            var previousCategory = categorySelect.value;
            var previousSource = sourceSelect.value;
            var previousWallet = walletSelect.value;
            var walletBeforeRender = currentWallet;
            updateSelectOptions();
            renderTags();
            renderWalletTabs();
            renderWalletSelect();
            if (categories.includes(previousCategory)) categorySelect.value = previousCategory;
            if (sources.includes(previousSource)) sourceSelect.value = previousSource;
            if (currentWallet === walletBeforeRender && wallets.some(function(wallet) { return wallet.id === previousWallet; })) {
                walletSelect.value = previousWallet;
            }
            settingsReady = true;
            if (transactionsReady) dataLoadError = '';
            updateAppReadiness();
            
            // Render lại khi có thay đổi
            calculateSummary();
            renderCalendar();
            // Nếu đang chọn ngày, cập nhật lại danh sách giao dịch
            if (selectedDate) {
                renderTransactionsForDate(selectedDate);
            }
        } else {
            settingsReady = false;
            updateAppReadiness();
            if (creatingSettings) return;
            creatingSettings = true;
            db.runTransaction(async function(transaction) {
                var existing = await transaction.get(settingsDoc);
                if (!isSessionCurrent(token)) throw new Error('Session changed');
                if (!existing.exists) transaction.set(settingsDoc, getDefaultSettings());
            }).catch(function(error) {
                if (!isSessionCurrent(token)) return;
                dataLoadError = 'Không tạo được cài đặt tài khoản. Vui lòng kiểm tra kết nối/quyền truy cập và tải lại trang.';
                updateAppReadiness();
                console.error('Không tạo được cài đặt mặc định:', error);
            }).finally(function() {
                creatingSettings = false;
            });
        }
    }, function(error) {
        if (!isSessionCurrent(token)) return;
        settingsReady = false;
        dataLoadError = 'Không tải được cài đặt. Vui lòng kiểm tra kết nối/quyền truy cập và tải lại trang.';
        updateAppReadiness();
        console.error('❌ Lỗi khi lắng nghe settings:', error);
    });
}


// --- 6. QUẢN LÝ VÍ ---

// Render các tab ví
function renderWalletTabs() {
    if (pendingWalletSelection && isSessionCurrent(pendingWalletSelection.token) &&
        wallets.some(function(w) { return w.id === pendingWalletSelection.id; })) {
        currentWallet = pendingWalletSelection.id;
        pendingWalletSelection = null;
    }
    var focused = document.activeElement;
    var focusedItem = focused && focused.closest('.wallet-item');
    var focusId = focusedItem && focusedItem.dataset.wallet;
    var focusAction = focused && focused.dataset.action;
    if (typeof cancelWalletDrag === 'function') cancelWalletDrag();
    walletTabsContainer.replaceChildren();
    wallets.forEach(function(wallet) {
        var item = document.createElement('div');
        item.className = 'wallet-item' + (wallet.id === currentWallet ? ' active' : '');
        item.dataset.wallet = wallet.id;
        item.setAttribute('role', 'listitem');
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'wallet-tab' + (wallet.id === currentWallet ? ' active' : '');
        tab.setAttribute('data-wallet', wallet.id);
        tab.dataset.action = 'select';
        tab.setAttribute('aria-pressed', String(wallet.id === currentWallet));
        tab.textContent = wallet.icon + ' ' + wallet.name;
        tab.addEventListener('click', function() {
            selectWallet(wallet.id);
        });
        item.appendChild(tab);
        var handle = createWalletAction('wallet-drag-handle', '↔', 'Đổi vị trí ví ' + wallet.name, 'move');
        handle.setAttribute('aria-describedby', 'wallet-reorder-help');
        handle.addEventListener('pointerdown', function(event) { startWalletDrag(event, wallet.id); });
        handle.addEventListener('keydown', function(event) { handleWalletMoveKey(event, wallet.id); });
        item.appendChild(handle);
        var edit = createWalletAction('edit-wallet', '✏️', 'Sửa ví ' + wallet.name, 'edit');
        edit.addEventListener('click', function() { openEditWalletModal(wallet.id); });
        item.appendChild(edit);
        var remove = createWalletAction('delete-wallet', '×', 'Xóa ví ' + wallet.name, 'delete');
        remove.addEventListener('click', function() { deleteWallet(wallet.id); });
        item.appendChild(remove);
        walletTabsContainer.appendChild(item);
    });
    updateCurrentWalletDisplay();
    if (focusId && focusAction) focusWalletAction(focusId, focusAction);
}

// Render dropdown chọn ví trong form
function renderWalletSelect() {
    walletSelect.innerHTML = '';
    wallets.forEach(function(wallet) {
        var option = new Option(wallet.icon + ' ' + wallet.name, wallet.id);
        walletSelect.add(option);
    });
    walletSelect.value = currentWallet;
}

// Chọn ví
function selectWallet(walletId) {
    if (!wallets.some(function(wallet) { return wallet.id === walletId; })) return;
    currentWallet = walletId;
    
    // Cập nhật UI tabs
    document.querySelectorAll('.wallet-tab').forEach(function(tab) {
        tab.classList.remove('active');
        tab.setAttribute('aria-pressed', String(tab.getAttribute('data-wallet') === walletId));
        if (tab.getAttribute('data-wallet') === walletId) {
            tab.classList.add('active');
        }
    });
    document.querySelectorAll('.wallet-item').forEach(function(item) {
        item.classList.toggle('active', item.dataset.wallet === walletId);
    });
    
    // Cập nhật dropdown
    walletSelect.value = walletId;
    
    // Cập nhật display
    updateCurrentWalletDisplay();
    
    // Render lại giao diện
    calculateSummary();
    renderCalendar();
    // Nếu đang chọn ngày, cập nhật lại danh sách giao dịch
    if (selectedDate) {
        renderTransactionsForDate(selectedDate);
    }
}

// Cập nhật hiển thị ví đang xem
function updateCurrentWalletDisplay() {
    var wallet = wallets.find(function(w) { return w.id === currentWallet; });
    if (wallet) {
        currentWalletNameEl.textContent = 'Đang xem: ' + wallet.icon + ' ' + wallet.name;
    } else {
        currentWalletNameEl.textContent = 'Đang xem: ---';
    }
}

// Lấy tên ví theo ID
function getWalletName(walletId) {
    var wallet = wallets.find(function(w) { return w.id === walletId; });
    if (wallet) {
        return wallet.icon + ' ' + wallet.name;
    }
    return walletId;
}

// Thêm ví mới
async function handleAddWallet(e) {
    e.preventDefault();
    
    var icon = document.getElementById('new-wallet-icon').value.trim() || '💰';
    var name = document.getElementById('new-wallet-name').value.trim();
    
    if (!name) {
        alert('Vui lòng nhập tên ví!');
        return;
    }
    
    if (!currentUser || !settingsReady) return;
    var id = getUserTransactionsCol().doc().id;
    var form = e.target;
    await runSettingsAction(form, function() {
        pendingWalletSelection = { id: id, token: getSessionToken() };
        return mutateSettings(function(data) {
            var latest = data.wallets || [];
            if (latest.some(function(w) { return w.name.toLocaleLowerCase() === name.toLocaleLowerCase(); })) {
                throw new Error('Tên ví này đã tồn tại.');
            }
            return { wallets: latest.concat({ id: id, icon: icon, name: name }) };
        });
    }, function() {
        form.reset();
        if (wallets.some(function(w) { return w.id === id; })) selectWallet(id);
    });
}

// Xóa ví
async function deleteWallet(walletId) {
    if (wallets.length <= 1) {
        alert('Phải có ít nhất 1 ví!');
        return;
    }
    
    var wallet = wallets.find(function(w) { return w.id === walletId; });
    var walletName = wallet ? wallet.icon + ' ' + wallet.name : walletId;
    
    // Đếm số giao dịch trong ví này
    var transactionCount = transactions.filter(function(t) { return t.wallet === walletId; }).length;
    
    var confirmMsg = 'Bạn có chắc muốn xóa ví "' + walletName + '"?';
    if (transactionCount > 0) {
        confirmMsg += '\n\n⚠️ Ví này có ' + transactionCount + ' giao dịch. Các giao dịch sẽ KHÔNG bị xóa nhưng sẽ không hiển thị.';
    }
    
    if (confirm(confirmMsg)) {
        await runSettingsAction(null, function() {
            return mutateSettings(function(data) {
                var latest = data.wallets || [];
                if (latest.length <= 1) throw new Error('Phải có ít nhất 1 ví.');
                return { wallets: latest.filter(function(w) { return w.id !== walletId; }) };
            });
        });
    }
}

// Mở modal chỉnh sửa ví
function openEditWalletModal(walletId) {
    var wallet = wallets.find(function(w) { return w.id === walletId; });
    if (!wallet) return;
    
    document.getElementById('edit-wallet-id').value = walletId;
    document.getElementById('edit-wallet-icon').value = wallet.icon;
    document.getElementById('edit-wallet-name').value = wallet.name;
    
    showAppModal('edit-wallet-modal');
}

// Đóng modal chỉnh sửa ví
function closeEditWalletModal() {
    hideAppModal('edit-wallet-modal');
}

// Xử lý lưu chỉnh sửa ví
async function handleEditWallet(e) {
    e.preventDefault();
    
    var walletId = document.getElementById('edit-wallet-id').value;
    var newIcon = document.getElementById('edit-wallet-icon').value.trim() || '💰';
    var newName = document.getElementById('edit-wallet-name').value.trim();
    
    if (!newName) {
        alert('Vui lòng nhập tên ví!');
        return;
    }
    
    await runSettingsAction(e.target, function() {
        return mutateSettings(function(data) {
            var latest = data.wallets || [];
            if (!latest.some(function(w) { return w.id === walletId; })) {
                throw new Error('Ví này đã bị xóa trên thiết bị khác.');
            }
            return { wallets: latest.map(function(w) {
                return w.id === walletId ? Object.assign({}, w, { icon: newIcon, name: newName }) : w;
            }) };
        });
    }, closeEditWalletModal);
}


// --- 7. TÍNH TOÁN & HIỂN THỊ CHUNG ---

// Đổi đơn vị tiền sang Won (KRW)
function formatCurrency(amount) {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
}

function localDateString(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function parseLocalDate(dateStr) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!parts) return null;
    var date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    return localDateString(date) === dateStr ? date : null;
}

function ensureDateYearOption(select, year) {
    if (!Array.from(select.options).some(function(option) { return Number(option.value) === year; })) {
        select.add(new Option(String(year), String(year)));
    }
}

// Lọc giao dịch theo ví hiện tại
function getFilteredTransactions() {
    return transactions.filter(function(t) { return t.wallet === currentWallet; });
}

function calculateSummary() {
    var totalIncome = 0;
    var totalExpense = 0;
    
    var filteredTransactions = getFilteredTransactions();
    
    filteredTransactions.forEach(function(t) {
        if (t.type === 'income') {
            totalIncome += t.amount;
        } else if (t.type === 'expense') {
            totalExpense += t.amount;
        }
    });
    
    var netBalance = totalIncome - totalExpense;
    
    totalIncomeSummary.textContent = formatCurrency(totalIncome);
    totalExpenseSummary.textContent = formatCurrency(totalExpense);
    netBalanceSummary.textContent = formatCurrency(netBalance);
    
    if (netBalance < 0) {
        netBalanceCard.classList.add('negative');
    } else {
        netBalanceCard.classList.remove('negative');
    }
    if (typeof renderReports === 'function') renderReports();
}

// --- 10. LOGIC LỊCH SỬ GIAO DỊCH THEO NGÀY ---

function selectDateForHistory(dateStr) {
    selectedDate = dateStr;
    
    // Hiển thị thông tin ngày đã chọn
    var dateObj = parseLocalDate(dateStr);
    if (!dateObj) return;
    var dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    document.getElementById('selected-date-text').textContent = '📅 ' + dayNames[dateObj.getDay()] + ', ' + dateObj.getDate() + '/' + (dateObj.getMonth() + 1) + '/' + dateObj.getFullYear();
    
    // Hiển thị section chi tiết giao dịch
    document.getElementById('transaction-detail-section').style.display = 'block';
    
    // Cập nhật ngày trong form Thêm Giao Dịch Mới
    setSelectedDate(dateStr);
    
    // Cập nhật highlight ngày trong lịch
    renderCalendar();
    
    renderTransactionsForDate(dateStr);
}

function renderTransactionsForDate(dateStr) {
    var list = document.getElementById('transaction-list');
    var summaryEl = document.getElementById('selected-date-summary');
    
    // Lọc giao dịch theo ngày
    var dayTransactions = getFilteredTransactions().filter(function(t) {
        return t.date === dateStr;
    });
    
    // Sắp xếp theo thời gian (mới nhất trước)
    dayTransactions.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    // Tính tổng
    var totalIncome = 0;
    var totalExpense = 0;
    dayTransactions.forEach(function(t) {
        if (t.type === 'income') {
            totalIncome += t.amount;
        } else {
            totalExpense += t.amount;
        }
    });
    
    // Hiển thị tóm tắt
    summaryEl.innerHTML = '';
    if (totalIncome > 0) {
        var incomeSpan = document.createElement('span');
        incomeSpan.className = 'summary-item income';
        incomeSpan.textContent = '📈 Thu: ' + formatCurrency(totalIncome);
        summaryEl.appendChild(incomeSpan);
    }
    if (totalExpense > 0) {
        var expenseSpan = document.createElement('span');
        expenseSpan.className = 'summary-item expense';
        expenseSpan.textContent = '📉 Chi: ' + formatCurrency(totalExpense);
        summaryEl.appendChild(expenseSpan);
    }
    if (dayTransactions.length > 0) {
        var countSpan = document.createElement('span');
        countSpan.className = 'summary-item';
        countSpan.textContent = '📝 ' + dayTransactions.length + ' giao dịch';
        summaryEl.appendChild(countSpan);
    }
    
    // Render danh sách giao dịch
    list.innerHTML = '';
    
    if (dayTransactions.length === 0) {
        var emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<div class="empty-icon">📭</div><p>Không có giao dịch nào trong ngày này</p>';
        list.appendChild(emptyState);
        return;
    }
    
    dayTransactions.forEach(function(t) {
        list.appendChild(createTransactionCard(t, false));
    });
}

function createTransactionCard(transaction, includeDate) {
    var session = getSessionToken();
    var card = document.createElement('div');
    card.className = 'transaction-card ' + (transaction.type === 'income' ? 'income' : 'expense');
    var icon = document.createElement('div');
    icon.className = 'transaction-icon';
    icon.textContent = transaction.type === 'income' ? '💰' : '💸';
    icon.setAttribute('aria-hidden', 'true');
    card.appendChild(icon);

    var details = document.createElement('div');
    details.className = 'transaction-details';
    var description = document.createElement('div');
    description.className = 'transaction-description';
    description.textContent = transaction.description || 'Không có mô tả';
    details.appendChild(description);
    var meta = document.createElement('div');
    meta.className = 'transaction-meta';
    var metadata = [transaction.category, transaction.source];
    if (includeDate) metadata.unshift(transaction.date);
    metadata.forEach(function(value) {
        var span = document.createElement('span');
        span.textContent = value || 'Chưa phân loại';
        meta.appendChild(span);
    });
    details.appendChild(meta);
    card.appendChild(details);
    var amount = document.createElement('div');
    amount.className = 'transaction-amount';
    amount.textContent = (transaction.type === 'income' ? '+' : '-') + formatCurrency(transaction.amount);
    card.appendChild(amount);

    var actions = document.createElement('div');
    actions.className = 'transaction-actions';
    var editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'edit-btn';
    editButton.dataset.transactionId = transaction.id;
    editButton.textContent = 'Sửa';
    editButton.setAttribute('aria-label', 'Sửa giao dịch ' + (transaction.description || transaction.date));
    editButton.addEventListener('click', function() {
        if (isSessionCurrent(session)) openEditTransactionModal(transaction.id);
    });
    actions.appendChild(editButton);
    var deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-btn';
    deleteButton.textContent = 'Xóa';
    deleteButton.setAttribute('aria-label', 'Xóa giao dịch ' + (transaction.description || transaction.date));
    deleteButton.addEventListener('click', function() {
        if (!isSessionCurrent(session) || deleteButton.disabled || !settingsReady || !transactionsReady) return;
        if (!confirm('Bạn có chắc muốn xóa giao dịch này?')) return;
        var collection = getUserTransactionsCol();
        if (!collection) return;
        deleteButton.disabled = true;
        collection.doc(transaction.id).delete().catch(function(error) {
            if (!isSessionCurrent(session)) return;
            deleteButton.disabled = false;
            console.error('Lỗi khi xóa giao dịch:', error);
            alert('Không thể xóa giao dịch. Vui lòng thử lại.');
        });
    });
    actions.appendChild(deleteButton);
    card.appendChild(actions);
    return card;
}

// --- MODAL CHỈNH SỬA GIAO DỊCH ---

var transactionSaveState = { add: null, edit: null };
var editTransactionSession = null;

function setTransactionFormBusy(form, busy) {
    if (busy) {
        form.dataset.saving = 'true';
        form.setAttribute('aria-busy', 'true');
    } else {
        delete form.dataset.saving;
        form.removeAttribute('aria-busy');
    }
    Array.from(form.elements).forEach(function(control) { control.disabled = busy; });
    if (!busy && typeof updateAppReadiness === 'function') updateAppReadiness();
}

function setTransactionStatus(id, message, isError) {
    var status = document.getElementById(id);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
}

function resetTransactionUiState() {
    transactionSaveState.add = null;
    transactionSaveState.edit = null;
    editTransactionSession = null;
    ['add-transaction-form', 'edit-transaction-form'].forEach(function(id) {
        var form = document.getElementById(id);
        if (form) setTransactionFormBusy(form, false);
    });
    setTransactionStatus('transaction-save-status', '', false);
    setTransactionStatus('edit-transaction-status', '', false);
}

// Khởi tạo date picker cho modal edit
function initEditDatePicker() {
    var yearSelect = document.getElementById('edit-date-year');
    var currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '';
    for (var y = currentYear - 5; y <= currentYear + 2; y++) {
        var option = document.createElement('option');
        option.value = y;
        option.textContent = y;
        yearSelect.appendChild(option);
    }
    
    // Event listeners
    document.getElementById('edit-date-month').addEventListener('change', updateEditDaysInMonth);
    document.getElementById('edit-date-year').addEventListener('change', updateEditDaysInMonth);
}

function updateEditDaysInMonth() {
    var daySelect = document.getElementById('edit-date-day');
    var month = parseInt(document.getElementById('edit-date-month').value);
    var year = parseInt(document.getElementById('edit-date-year').value);
    var currentDay = parseInt(daySelect.value) || 1;
    
    var daysInMonth = new Date(year, month, 0).getDate();
    
    daySelect.innerHTML = '';
    for (var d = 1; d <= daysInMonth; d++) {
        var option = document.createElement('option');
        option.value = d;
        option.textContent = String(d).padStart(2, '0');
        daySelect.appendChild(option);
    }
    
    daySelect.value = currentDay > daysInMonth ? daysInMonth : currentDay;
}

// Mở modal chỉnh sửa giao dịch
function openEditTransactionModal(transactionId) {
    if (!settingsReady || !transactionsReady || transactionSaveState.edit) return;
    var transaction = transactions.find(function(t) { return t.id === transactionId; });
    if (!transaction) return;
    editTransactionSession = getSessionToken();
    setTransactionStatus('edit-transaction-status', '', false);
    
    // Khởi tạo date picker nếu chưa có
    if (document.getElementById('edit-date-year').options.length === 0) {
        initEditDatePicker();
    }
    
    // Cập nhật category và source options
    var editCategorySelect = document.getElementById('edit-category');
    var editSourceSelect = document.getElementById('edit-source');
    editCategorySelect.required = Boolean(transaction.category);
    editSourceSelect.required = Boolean(transaction.source);
    
    editCategorySelect.innerHTML = '';
    categories.forEach(function(cat) {
        var option = new Option(cat, cat);
        editCategorySelect.add(option);
    });
    if (!categories.includes(transaction.category)) {
        editCategorySelect.add(new Option((transaction.category || 'Chưa phân loại') + ' (đã lưu trước đây)', transaction.category || ''));
    }
    
    editSourceSelect.innerHTML = '';
    sources.forEach(function(src) {
        var option = new Option(src, src);
        editSourceSelect.add(option);
    });
    if (!sources.includes(transaction.source)) {
        editSourceSelect.add(new Option((transaction.source || 'Chưa phân loại') + ' (đã lưu trước đây)', transaction.source || ''));
    }
    
    // Điền dữ liệu vào form
    document.getElementById('edit-transaction-id').value = transactionId;
    document.getElementById('edit-type').value = transaction.type;
    document.getElementById('edit-amount').value = transaction.amount;
    document.getElementById('edit-description').value = transaction.description;
    document.getElementById('edit-category').value = transaction.category || '';
    document.getElementById('edit-source').value = transaction.source || '';
    
    // Điền ngày
    var dateParts = transaction.date.split('-');
    ensureDateYearOption(document.getElementById('edit-date-year'), Number(dateParts[0]));
    document.getElementById('edit-date-year').value = parseInt(dateParts[0]);
    document.getElementById('edit-date-month').value = parseInt(dateParts[1]);
    updateEditDaysInMonth();
    document.getElementById('edit-date-day').value = parseInt(dateParts[2]);
    
    showAppModal('edit-transaction-modal');
}

// Đóng modal chỉnh sửa giao dịch
function closeEditTransactionModal() {
    hideAppModal('edit-transaction-modal');
}

// Xử lý lưu chỉnh sửa giao dịch
async function handleEditTransaction(e) {
    e.preventDefault();
    if (transactionSaveState.edit || !settingsReady || !transactionsReady || !isSessionCurrent(editTransactionSession)) return;
    
    var transactionsCol = getUserTransactionsCol();
    if (!transactionsCol) {
        alert("Lỗi: Vui lòng đăng nhập lại!");
        return;
    }
    
    var transactionId = document.getElementById('edit-transaction-id').value;
    var day = document.getElementById('edit-date-day').value;
    var month = document.getElementById('edit-date-month').value;
    var year = document.getElementById('edit-date-year').value;
    var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    
    var updatedData = {
        type: document.getElementById('edit-type').value,
        date: dateStr,
        amount: parseFloat(document.getElementById('edit-amount').value),
        description: document.getElementById('edit-description').value,
        category: document.getElementById('edit-category').value,
        source: document.getElementById('edit-source').value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    if (!Number.isFinite(updatedData.amount) || updatedData.amount <= 0) {
        alert("Số tiền không hợp lệ!");
        return;
    }
    if (!parseLocalDate(dateStr)) {
        setTransactionStatus('edit-transaction-status', 'Ngày giao dịch không hợp lệ.', true);
        return;
    }
    var session = getSessionToken();
    transactionSaveState.edit = session;
    setTransactionFormBusy(e.target, true);
    setTransactionStatus('edit-transaction-status', 'Đang lưu thay đổi...', false);
    try {
        await transactionsCol.doc(transactionId).update(updatedData);
        if (!isSessionCurrent(session)) return;
        closeEditTransactionModal();
        setTransactionStatus('edit-transaction-status', '', false);
    } catch (error) {
        if (!isSessionCurrent(session)) return;
        console.error('Lỗi khi cập nhật giao dịch:', error);
        setTransactionStatus('edit-transaction-status', 'Chưa lưu được thay đổi. Dữ liệu vẫn được giữ để bạn thử lại.', true);
    } finally {
        if (isSessionCurrent(session) && transactionSaveState.edit === session) {
            transactionSaveState.edit = null;
            setTransactionFormBusy(e.target, false);
        }
    }
}

function closeDateDetail() {
    selectedDate = null;
    
    // Ẩn section chi tiết giao dịch
    document.getElementById('transaction-detail-section').style.display = 'none';
    
    // Cập nhật lịch để bỏ highlight
    renderCalendar();
}

function updateSelectOptions() {
    var selectedCategory = categorySelect.value;
    var selectedSource = sourceSelect.value;
    categorySelect.innerHTML = '';
    categories.forEach(function(cat) {
        var option = new Option(cat, cat);
        categorySelect.add(option);
    });
    if (selectedCategory) {
        if (!categories.includes(selectedCategory)) categorySelect.add(new Option(selectedCategory + ' (đã chọn)', selectedCategory));
        categorySelect.value = selectedCategory;
    }

    sourceSelect.innerHTML = '';
    sources.forEach(function(src) {
        var option = new Option(src, src);
        sourceSelect.add(option);
    });
    if (selectedSource) {
        if (!sources.includes(selectedSource)) sourceSelect.add(new Option(selectedSource + ' (đã chọn)', selectedSource));
        sourceSelect.value = selectedSource;
    }
}

function renderTags() {
    var categoryList = document.getElementById('category-list');
    var sourceList = document.getElementById('source-list');
    
    categoryList.innerHTML = '';
    categories.forEach(function(cat) {
        categoryList.appendChild(createTagElement(cat, 'category'));
    });
    
    sourceList.innerHTML = '';
    sources.forEach(function(src) {
        sourceList.appendChild(createTagElement(src, 'source'));
    });
}

function createTagElement(name, type) {
    var tag = document.createElement('span');
    tag.textContent = name;
    var removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'x';
    removeButton.className = 'remove-tag';
    removeButton.setAttribute('aria-label', 'Xóa ' + name);
    removeButton.setAttribute('data-name', name);
    removeButton.setAttribute('data-type', type);
    removeButton.addEventListener('click', function() {
        var tagName = this.getAttribute('data-name');
        var tagType = this.getAttribute('data-type');
        if (confirm('Bạn có chắc muốn xóa "' + tagName + '"?')) {
            if (tagType === 'category') {
                removeSettingValue('categories', tagName);
            } else {
                removeSettingValue('sources', tagName);
            }
        }
    });
    tag.appendChild(removeButton);
    return tag;
}


// --- 8. LOGIC THÊM / XÓA GIAO DỊCH ---

async function handleAddTransaction(e) {
    e.preventDefault();
    if (transactionSaveState.add || !settingsReady || !transactionsReady) return;
    
    var transactionsCol = getUserTransactionsCol();
    if (!transactionsCol) {
        alert("Lỗi: Vui lòng đăng nhập lại!");
        return;
    }

    var newTransaction = {
        wallet: document.getElementById('wallet').value,
        type: document.getElementById('type').value,
        date: getSelectedDate(),
        amount: parseFloat(document.getElementById('amount').value),
        description: document.getElementById('description').value,
        category: document.getElementById('category').value,
        source: document.getElementById('source').value,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    if (!Number.isFinite(newTransaction.amount) || newTransaction.amount <= 0) {
        alert("Số tiền không hợp lệ!");
        return;
    }
    if (!parseLocalDate(newTransaction.date) || !wallets.some(function(wallet) { return wallet.id === newTransaction.wallet; })) {
        setTransactionStatus('transaction-save-status', 'Vui lòng chọn ngày và ví hợp lệ.', true);
        return;
    }
    var session = getSessionToken();
    transactionSaveState.add = session;
    setTransactionFormBusy(e.target, true);
    setTransactionStatus('transaction-save-status', 'Đang lưu giao dịch. Vui lòng đợi xác nhận...', false);
    try {
        await transactionsCol.add(newTransaction);
        if (!isSessionCurrent(session)) return;
        e.target.reset();
        initDatePicker();
        document.getElementById('wallet').value = currentWallet;
        setTransactionStatus('transaction-save-status', 'Đã lưu giao dịch thành công.', false);
    } catch (error) {
        if (!isSessionCurrent(session)) return;
        console.error('Lỗi khi ghi giao dịch:', error);
        setTransactionStatus('transaction-save-status', 'Chưa lưu được giao dịch. Dữ liệu vẫn được giữ để bạn thử lại.', true);
    } finally {
        if (isSessionCurrent(session) && transactionSaveState.add === session) {
            transactionSaveState.add = null;
            setTransactionFormBusy(e.target, false);
        }
    }
}

async function handleAddCategory(e) {
    e.preventDefault();
    var newCat = document.getElementById('new-category').value.trim();
    if (newCat) await addSettingValue('categories', newCat, e.target);
}

async function handleAddSource(e) {
    e.preventDefault();
    var newSrc = document.getElementById('new-source').value.trim();
    if (newSrc) await addSettingValue('sources', newSrc, e.target);
}


// --- 9. LOGIC LỊCH THÁNG ---

function changeMonth(step) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + step, 1);
    renderCalendar();
}

function renderCalendar() {
    var year = currentMonth.getFullYear();
    var month = currentMonth.getMonth();
    var focusedDate = calendarGrid.contains(document.activeElement) ? document.activeElement.getAttribute('data-date') : null;

    currentMonthDisplay.textContent = 'Tháng ' + (month + 1) + ' Năm ' + year;

    var dailySummary = {};
    var currentMonthTransactions = getFilteredTransactions().filter(function(t) {
        var tDate = parseLocalDate(t.date);
        return tDate && tDate.getFullYear() === year && tDate.getMonth() === month;
    });

    currentMonthTransactions.forEach(function(t) {
        var day = parseLocalDate(t.date).getDate();
        if (!dailySummary[day]) {
            dailySummary[day] = { income: 0, expense: 0 };
        }
        if (t.type === 'income') {
            dailySummary[day].income += t.amount;
        } else {
            dailySummary[day].expense += t.amount;
        }
    });

    calendarGrid.innerHTML = '';
    var dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    dayNames.forEach(function(day) {
        var header = document.createElement('div');
        header.className = 'day-header';
        header.textContent = day;
        calendarGrid.appendChild(header);
    });

    var firstDayOfMonth = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    for (var i = 0; i < firstDayOfMonth; i++) {
        var emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day';
        emptyDay.setAttribute('aria-hidden', 'true');
        calendarGrid.appendChild(emptyDay);
    }

    for (var day = 1; day <= daysInMonth; day++) {
        var dayElement = document.createElement('button');
        dayElement.type = 'button';
        dayElement.className = 'calendar-day current-month';
        var dateStr = localDateString(new Date(year, month, day));
        dayElement.setAttribute('data-date', dateStr);
        dayElement.setAttribute('aria-pressed', selectedDate === dateStr ? 'true' : 'false');
        var accessibleLabel = 'Ngày ' + day + '/' + (month + 1) + '/' + year;
        
        // Đánh dấu ngày đang được chọn
        if (selectedDate) {
            if (selectedDate === dateStr) {
                dayElement.classList.add('selected');
            }
        }

        var dayNumber = document.createElement('span');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        dayElement.appendChild(dayNumber);

        if (dailySummary[day]) {
            var summary = dailySummary[day];
            
            if (summary.income > 0) {
                var incomeSpan = document.createElement('span');
                incomeSpan.className = 'day-income';
                incomeSpan.textContent = '+' + formatCurrency(summary.income);
                dayElement.appendChild(incomeSpan);
                accessibleLabel += ', thu ' + formatCurrency(summary.income);
            }

            if (summary.expense > 0) {
                var expenseSpan = document.createElement('span');
                expenseSpan.className = 'day-expense';
                expenseSpan.textContent = '-' + formatCurrency(summary.expense);
                dayElement.appendChild(expenseSpan);
                accessibleLabel += ', chi ' + formatCurrency(summary.expense);
            }
        }
        
        // Thêm style clickable
        dayElement.style.cursor = 'pointer';
        dayElement.setAttribute('aria-label', accessibleLabel);
        
        // Click vào ngày để xem chi tiết giao dịch
        (function(d, y, m) {
            dayElement.addEventListener('click', function() {
                var dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                selectDateForHistory(dateStr);
            });
        })(day, year, month);
        
        calendarGrid.appendChild(dayElement);
        if (focusedDate === dateStr) dayElement.focus({ preventScroll: true });
    }
}
