/* 잠긴 원고와 사진을 암호로 푸는 일을 맡는다. (tools/crypt.py 와 짝이다)
 *
 * 저장소가 공개라, 예전에는 주소만 알면 암호창을 거치지 않고
 * sayeon.json 을 그대로 받아 볼 수 있었다. 이제 잠근 파일(.enc)만 올라가 있고,
 * 암호를 넣어야 풀린다. 암호는 이 파일 어디에도 적혀 있지 않다
 * — 암호가 맞는지는 풀리는지로 가린다.
 *
 * 쓰는 법:
 *   await SaCrypt.unlock('암호')        // 맞으면 true
 *   var data = await SaCrypt.json('sayeon.json');
 *   img.src = await SaCrypt.blobURL('img/1-1.jpg', 'image/jpeg');
 */
(function (global) {
  var PASS_KEY = 'sayeonPass';   // 다시 물어보지 않으려고 기기에만 둔다
  // 그 저장소의 뿌리 = 주소의 첫 칸 (/sayeon/, /malsseum/ …).
  // 저장소를 나눠도(같은 호스트라 같은 출처) 이 규칙 하나로 맞는다.
  var base = (function () {
    var m = location.pathname.match(/^\/[^\/]+\//);
    return m ? m[0] : '/';
  })();

  var key = null, metaCache = null, jsonCache = {}, blobCache = {};

  function bytes(buf) { return new Uint8Array(buf); }
  function fromB64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
    return out;
  }

  // '/' 로 시작하면 그대로(다른 저장소를 가리킬 때), 아니면 이 저장소 뿌리 기준.
  function getBuffer(url) {
    var full = url.charAt(0) === '/' ? url : base + url;
    return fetch(full, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' 을 받지 못했습니다 (' + r.status + ')');
      return r.arrayBuffer();
    });
  }

  function meta() {
    if (metaCache) return Promise.resolve(metaCache);
    return fetch(base + 'crypt.json').then(function (r) { return r.json(); })
      .then(function (m) { metaCache = m; return m; });
  }

  function deriveKey(pass) {
    return meta().then(function (m) {
      return crypto.subtle.importKey(
        'raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']
      ).then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: fromB64(m.salt), iterations: m.iter, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
    });
  }

  // 잠긴 덩어리는 앞 12바이트가 iv, 나머지가 내용이다
  function decrypt(buf) {
    var all = bytes(buf);
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  }

  /* 암호를 넣어 열쇠를 만든다. 작은 표(check.enc)가 풀리면 맞는 암호다. */
  function unlock(pass) {
    return deriveKey(pass).then(function (k) {
      key = k;
      return getBuffer('check.enc').then(decrypt).then(function () {
        try { localStorage.setItem(PASS_KEY, pass); } catch (e) {}
        return true;
      });
    }).catch(function () { key = null; return false; });
  }

  /* 저장해 둔 암호로 조용히 열어 본다 (두 번째부터는 묻지 않는다) */
  function resume() {
    var saved = null;
    try { saved = localStorage.getItem(PASS_KEY); } catch (e) {}
    if (!saved) return Promise.resolve(false);
    return unlock(saved);
  }

  function forget() {
    key = null;
    jsonCache = {};
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
  }

  function ready() { return !!key; }

  /* 잠긴 원고를 받아 풀어서 돌려준다 */
  function json(url) {
    if (jsonCache[url]) return Promise.resolve(jsonCache[url]);
    if (!key) return Promise.reject(new Error('아직 열지 않았습니다'));
    return getBuffer(url + '.enc').then(decrypt).then(function (buf) {
      var value = JSON.parse(new TextDecoder().decode(buf));
      jsonCache[url] = value;
      return value;
    });
  }

  /* 잠긴 사진을 풀어 화면에 붙일 수 있는 주소로 돌려준다 */
  function blobURL(url, type) {
    if (blobCache[url]) return Promise.resolve(blobCache[url]);
    if (!key) return Promise.reject(new Error('아직 열지 않았습니다'));
    return getBuffer(url + '.enc').then(decrypt).then(function (buf) {
      var u = URL.createObjectURL(new Blob([buf], { type: type || 'image/jpeg' }));
      blobCache[url] = u;
      return u;
    });
  }

  global.SaCrypt = {
    unlock: unlock, resume: resume, forget: forget, ready: ready,
    json: json, blobURL: blobURL
  };
})(window);
