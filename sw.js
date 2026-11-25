importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  console.log(`Workbox loaded successfully`);

  // Take over as soon as a new version is installed, rather than once every tab and the
  // installed app have been fully closed, so changes to the caching below apply straight away.
  workbox.core.skipWaiting();
  workbox.core.clientsClaim();

  // 1. Network-first strategy for your main HTML / routes
  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
      cacheName: 'html-cache',
    })
  );

  // 2. Network-first for JS and CSS, so a deploy reaches phones and installed apps on the next
  //    load (stale-while-revalidate kept running the old code until a second reload). The cache
  //    is still used offline, or when the network takes more than 3 seconds.
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'script' ||
                     request.destination === 'style',
    new workbox.strategies.NetworkFirst({
      cacheName: 'code-cache',
      networkTimeoutSeconds: 3,
    })
  );

  // 3. Stale-while-revalidate for images, which rarely change and are fine a load late.
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'image',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: 'asset-cache',
    })
  );
} else {
  console.log(`Workbox failed to load`);
}
