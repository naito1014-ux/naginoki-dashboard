// ════════════════════════════════════
// GAS API Client
// なぎの木テラス ダッシュボード共通。App.jsx と KpiPanel.jsx から使う。
// ════════════════════════════════════

export var GAS_URL_KEY = "nk_gas_url";

export var DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbwbTwVFL4ACvfASndEAD7fRIO5kDyeAsHXsrn8qV02td_pbPFl3H2aka-13wD9tQ4qO/exec";

export function getGasUrl() {
  try { return localStorage.getItem(GAS_URL_KEY) || DEFAULT_GAS_URL; } catch(e) { return DEFAULT_GAS_URL; }
}

export function setGasUrl(url) {
  try { localStorage.setItem(GAS_URL_KEY, url); } catch(e) {}
}

export function gasGet(action, params) {
  var url = getGasUrl();
  if (!url) return Promise.resolve(null);
  var qs = "?action=" + encodeURIComponent(action);
  if (params) {
    Object.keys(params).forEach(function(k) {
      qs += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    });
  }
  return fetch(url + qs)
    .then(function(r) { return r.json(); })
    .then(function(d) { return d.ok ? d : null; })
    .catch(function() { return null; });
}

export function gasPost(body) {
  var url = getGasUrl();
  if (!url) return Promise.resolve(null);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    redirect: "follow"
  })
    .then(function(r) { return r.json(); })
    .then(function(d) { return d.ok ? d : null; })
    .catch(function() { return null; });
}

// gasPost と違い ok:false でも null化せず、レスポンス全体（error含む）を返す。
// AI分析レポートのようにサーバ側エラーメッセージをUIに表示したいケースで使う。
export function gasPostFull(body) {
  var url = getGasUrl();
  if (!url) return Promise.resolve({ ok: false, error: "GAS URLが未設定です。⚙️設定から連携URLを保存してください。" });
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    redirect: "follow"
  })
    .then(function(r) { return r.json(); })
    .catch(function(err) {
      console.error("[gasPostFull] エラー:", err);
      return { ok: false, error: "通信エラー: " + (err && err.message ? err.message : String(err)) };
    });
}

