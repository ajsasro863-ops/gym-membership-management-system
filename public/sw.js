const CACHE = "fitzone-static-v1";

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => {
            return cache.addAll([
                "/",
                "/style.css",
                "/app.js",
                "/manifest.json"
            ]);
        })
    );
});

self.addEventListener("fetch", event => {
    if (
        event.request.method !== "GET" ||
        new URL(event.request.url).pathname.startsWith("/api/")
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});