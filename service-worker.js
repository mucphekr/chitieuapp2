// Service Worker cho Sổ Tay Chi Tiêu Gia Đình
const CACHE_NAME = 'chitieu-v1.0';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/icons/icon.svg'
];

// Cài đặt Service Worker
self.addEventListener('install', function(event) {
    console.log('[Service Worker] Đang cài đặt...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('[Service Worker] Đang cache các file...');
                return cache.addAll(urlsToCache);
            })
            .then(function() {
                console.log('[Service Worker] Cài đặt hoàn tất!');
                return self.skipWaiting();
            })
            .catch(function(error) {
                console.log('[Service Worker] Lỗi khi cache:', error);
            })
    );
});

// Kích hoạt Service Worker
self.addEventListener('activate', function(event) {
    console.log('[Service Worker] Đang kích hoạt...');
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    // Xóa cache cũ nếu có phiên bản mới
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Xóa cache cũ:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(function() {
            console.log('[Service Worker] Đã kích hoạt!');
            return self.clients.claim();
        })
    );
});

// Xử lý request - Chiến lược Network First, fallback to Cache
self.addEventListener('fetch', function(event) {
    // Bỏ qua các request đến Firebase (cần internet)
    if (event.request.url.includes('firebaseio.com') || 
        event.request.url.includes('googleapis.com') ||
        event.request.url.includes('gstatic.com')) {
        return;
    }
    
    event.respondWith(
        // Thử lấy từ network trước
        fetch(event.request)
            .then(function(response) {
                // Nếu thành công, cache lại response
                if (response && response.status === 200) {
                    var responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(function(cache) {
                            cache.put(event.request, responseToCache);
                        });
                }
                return response;
            })
            .catch(function() {
                // Nếu offline, lấy từ cache
                return caches.match(event.request)
                    .then(function(response) {
                        if (response) {
                            return response;
                        }
                        // Nếu không có trong cache, trả về trang offline
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Xử lý sync khi có lại internet (cho tương lai)
self.addEventListener('sync', function(event) {
    console.log('[Service Worker] Background sync:', event.tag);
});

// Xử lý push notification (cho tương lai)
self.addEventListener('push', function(event) {
    console.log('[Service Worker] Push received:', event);
    var options = {
        body: event.data ? event.data.text() : 'Bạn có thông báo mới!',
        icon: '/icons/icon.svg',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now()
        }
    };
    event.waitUntil(
        self.registration.showNotification('Sổ Tay Chi Tiêu', options)
    );
});

