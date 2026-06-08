importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  console.log(`Workbox loaded successfully`);

  // 1. Network-first strategy for your main HTML / routes
  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
      cacheName: 'html-cache',
    })
  );

  // 2. Stale-While-Revalidate for JS, CSS, and assets
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'script' || 
                     request.destination === 'style' ||
                     request.destination === 'image',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: 'asset-cache',
    })
  );
} else {
  console.log(`Workbox failed to load`);
}
