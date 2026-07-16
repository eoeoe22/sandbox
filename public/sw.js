// Particle Sandbox — 오프라인 지원 서비스 워커.
//
// 이 파일은 `public/`에 있어 Vite가 처리하지 않고 그대로 `/sw.js`로 배포된다
// (해시 파일명이 붙지 않는다). 브라우저가 매 내비게이션마다 이 URL을 바이트
// 단위로 비교해 업데이트를 감지하는 표준 SW 갱신 절차가 그대로 동작하려면
// 이 파일 경로는 항상 고정이어야 한다.
//
// 캐싱 전략 (astro.config.mjs의 콘텐츠 해시 파일명 정책과 반드시 맞물려야 함):
//   - 내비게이션 요청(HTML 문서): network-first. 최신 HTML은 항상 최신 해시가
//     붙은 자산 URL을 참조하므로, 온라인일 땐 네트워크를 우선하고 실패(오프라인)
//     시에만 캐시를 사용한다. 성공한 응답은 매번 캐시에 덮어써서 별도의 버전
//     무효화 없이도 항상 "마지막으로 성공한 응답"을 오프라인 폴백으로 유지한다.
//   - 그 외 GET 요청(_astro/* 해시 자산, 아이콘, 폰트 등): cache-first. 해시가
//     붙은 자산은 내용이 바뀌면 URL 자체가 바뀌므로 무기한 캐시해도 안전하다 —
//     즉 "파일이 바뀌면 새 URL이 캐시를 채우고, 옛 URL은 그냥 참조되지 않게
//     될 뿐" 이라 별도의 캐시 제거 로직이 없어도 최신 파일이 항상 우선한다.
//
// SW_VERSION은 이 전략 자체(fetch 핸들러 로직)를 바꿀 때만 올린다. 앱 콘텐츠가
// 바뀔 때마다 올릴 필요는 없다 — 위 전략이 이미 콘텐츠 변경을 자동으로 반영한다.
const SW_VERSION = 'v1';
const SHELL_CACHE = `sandbox-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `sandbox-runtime-${SW_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // 설치 시점에 앱 셸을 미리 데워둔다(오프라인 첫 진입 대비). 실패해도
      // 설치 자체는 계속 진행 — 최초 방문이 어차피 온라인이라면 fetch 핸들러가
      // 곧바로 캐시를 채운다.
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add('/');
      } catch {
        // 오프라인 설치 등 — 다음 온라인 방문 때 fetch 핸들러가 채운다.
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !CURRENT_CACHES.has(name)).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/'));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // 캐싱 대상 아님 — 브라우저 기본 동작에 맡김

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
