/* 围棋级位测试6000题 · Service Worker
 *
 * 目标：装到主屏幕之后，断网也能做题。
 * 策略：安装时全量预缓存（整包 1.5 MB，一次拉完）→ 之后 cache-first。
 * 更新：build.py 会把 90c365a73363 换成构建时间，版本一变就换新缓存、删旧缓存。
 *
 * 注意：Service Worker 只在 https 或 localhost 下生效。
 * 用局域网 http://192.168.x.x 打开时不会注册，属于预期行为。
 */
const V = "90c365a73363";
const CACHE = "gotest-" + V;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./sounds.js",
  "./app.js",
  "./vendor/qrcode.js",
  "./vendor/jsqr.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

// 离线做题必须的资源：任一缓存失败就让 install 失败，
// 好过装出一个「断网打开白屏、还看不出原因」的新版本。
// 图标 / manifest / 首页别名只影响桌面图标，允许缺失。
const CRITICAL = [
  "./index.html",
  "./style.css",
  "./data.js",
  "./sounds.js",
  "./app.js",
  "./vendor/qrcode.js",
  "./vendor/jsqr.js"
];

self.addEventListener("install", (e) => {
  // 注意：这里故意不调用 skipWaiting()。
  // 新版本先进入"等待"状态，由页面显示「有新版本」提示，
  // 用户点了才通过 message 通知这里跳过等待、立即接管。
  // 如果用户一直不点，等 App 被关掉、没有客户端时它也会自动接管。
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // 关键资源用 Promise.all：任一失败 → install 失败 → 旧版本继续顶着，不会静默降级
      await Promise.all(
        CRITICAL.map((a) => c.add(new Request(a, { cache: "reload" })))
      );
      // 非关键资源允许失败，但也不再把失败全吞掉不记录
      await Promise.allSettled(
        ASSETS.filter((a) => !CRITICAL.includes(a))
              .map((a) => c.add(new Request(a, { cache: "reload" })))
      );
    })
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // 只清理本应用的缓存，别把同源下其它应用的缓存一起删了
        keys.filter((k) => k.startsWith("gotest-") && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 只接管本站资源
  if (url.searchParams.has("dev")) return;      // 调试模式直连网络，不缓存

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // 只有「页面导航」才配拿首页兜底。
        // 旧版对 data.js / app.js 也返回 index.html，浏览器拿到 HTML 当 JS 解析 → 白屏且无提示。
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 503, statusText: "Offline asset missing" });
      });
    })
  );
});
