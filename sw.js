/* =========================================================
   神的工作台 · Service Worker
   策略：导航请求网络优先（断网回退缓存），同源静态资源缓存优先 + 后台更新，
        跨域请求（Gitee / GitHub / AI 接口 / 字体 CDN）一律放行，不拦截、不缓存。
   目的：在线永远是 GitHub 上的最新 index.html，断网仍能打开，且不干扰任何 API 调用。
   ========================================================= */
var VERSION = 'v2026-11-10-1';
var CACHE = 'nmwb-' + VERSION;

/* 首次安装时预缓存的同源静态文件（相对路径，兼容 GitHub Pages 子目录）
   只缓存 index.html 一份：访问 "/"、"index.html"、带参数等任何入口都回退到它，
   避免同一张 700KB 的页面被重复存两份。 */
var PRECACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* ---------- 安装：预缓存 + 立即接管 ---------- */
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* 逐个 add，单个失败（例如某图还没部署）不影响整体安装 */
      return Promise.all(PRECACHE.map(function(u){
        return c.add(new Request(u, { cache: 'reload' })).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

/* ---------- 激活：清掉旧版本缓存，接管已打开的页面 ---------- */
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k.indexOf('nmwb-') === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* ---------- 离线兜底页（只在缓存也没命中时出现） ---------- */
function offlinePage(){
  var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>暂时离线 · 神的工作台</title><style>' +
    'html,body{margin:0;height:100%;background:#E5E0D0;color:#22201C;}' +
    'body{display:flex;align-items:center;justify-content:center;' +
    'font-family:"Songti SC","SimSun",serif;letter-spacing:.05em;padding:32px;}' +
    '.box{max-width:340px;text-align:center;border:1px solid rgba(56,107,75,.25);padding:34px 26px;}' +
    'h1{font-size:17px;font-weight:normal;letter-spacing:.14em;color:#386B4B;margin:0 0 14px;}' +
    'p{font-size:13px;line-height:2;color:#68645B;margin:0 0 22px;}' +
    'button{font:inherit;font-size:14px;letter-spacing:.2em;color:#386B4B;background:transparent;' +
    'border:1px solid rgba(56,107,75,.55);padding:9px 20px;}' +
    '</style></head><body><div class="box"><h1>NO CONNECTION</h1>' +
    '<p>当前处于离线状态，且这台设备上还没有可用的页面副本。<br>连上网络后重新打开即可。</p>' +
    '<button onclick="location.reload()">重 试</button></div></body></html>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* ---------- 导航请求：网络优先，失败回退缓存 ---------- */
function handleNavigate(req){
  return fetch(req, { cache: 'no-store' }).then(function(res){
    if(res && res.ok){
      caches.open(CACHE).then(function(c){
        /* 固定用 index.html 作为键，子目录部署 / 带参数访问都能命中同一份 */
        c.put('./index.html', res.clone()).catch(function(){});
      }).catch(function(){});
    }
    return res;
  }).catch(function(){
    return caches.match('./index.html', { ignoreSearch: true })
      .then(function(hit){ return hit || caches.match('./', { ignoreSearch: true }); })
      .then(function(hit){ return hit || caches.match(req, { ignoreSearch: true }); })
      .then(function(hit){ return hit || offlinePage(); });
  });
}

/* ---------- 同源静态资源：缓存优先，后台静默更新 ---------- */
function handleAsset(req){
  return caches.open(CACHE).then(function(c){
    return c.match(req, { ignoreSearch: true }).then(function(hit){
      var net = fetch(req).then(function(res){
        if(res && res.ok && res.status === 200){
          c.put(req, res.clone()).catch(function(){});
        }
        return res;
      }).catch(function(){ return null; });
      return hit || net.then(function(res){
        return res || new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  });
}

/* ---------- 统一入口 ---------- */
self.addEventListener('fetch', function(e){
  var req = e.request;

  /* 非 GET（表单提交等）不处理 */
  if(req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(err) { return; }

  /* 只接管 http(s) 同源；chrome-extension、file 等直接放行 */
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if(url.origin !== self.location.origin) return;   // 跨域请求原样放行

  /* Service Worker 脚本本身交给浏览器自己管 */
  if(url.pathname.indexOf('/sw.js') >= 0) return;

  /* 页面导航：网络优先 */
  if(req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') === 0){
    e.respondWith(handleNavigate(req));
    return;
  }

  /* 其余同源静态资源 */
  e.respondWith(handleAsset(req));
});

/* ---------- 允许页面主动触发更新 ---------- */
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
