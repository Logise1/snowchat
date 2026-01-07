const CACHE_NAME = 'snowtrack-v1';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './512.png',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
