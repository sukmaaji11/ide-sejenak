"use strict";

const CACHE_NAME = "sela-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./styles-raised.css",
  "./app.js",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./perbandingan.html",
  "./icons/sela-192.png",
  "./icons/sela-512.png",
  "./icons/sela-180.png",
  "./icons/sela-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("sela-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request)
            || await caches.match(new URL("./index.html", self.registration.scope).href);
          if (cachedPage) return cachedPage;
          return Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(async (cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        const response = await fetch(request);
        if (response.ok) {
          await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }),
  );
});
