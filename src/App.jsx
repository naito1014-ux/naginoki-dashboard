import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  LineChart,
  Cell,
  ReferenceLine
} from "recharts";
import Papa from "papaparse";

// ════════════════════════════════════
// Constants
// ════════════════════════════════════
var DEPTS = ["全体", "キッチン", "マーケット", "カフェ"];
var DC = {
  "全体": "#1b4332",
  "キッチン": "#c1440e",
  "マーケット": "#386641",
  "カフェ": "#b5651d"
};

var METRICS = [
  {
    key: "sales",
    label: "売上",
    fmt: function(v) { return "\u00a5" + (v || 0).toLocaleString(); },
    yFmt: function(v) { return (v / 10000).toFixed(0) + "万"; }
  },
  {
    key: "customers",
    label: "客数",
    fmt: function(v) { return (v || 0).toLocaleString() + "人"; },
    yFmt: function(v) { return String(v); }
  },
  {
    key: "avgSpend",
    label: "客単価",
    fmt: function(v) { return "\u00a5" + (v || 0).toLocaleString(); },
    yFmt: function(v) { return "\u00a5" + v; }
  }
];

var WD = ["日", "月", "火", "水", "木", "金", "土"];
var SKIP_LABELS = new Set(["合計", "前月実績", "前月比", "前年実績", "前年比"]);

var DMAP = {
  "定食": "キッチン", "ごはんもの": "キッチン", "ラーメン": "キッチン",
  "うどん・そば": "キッチン", "パスタ": "キッチン", "単品": "キッチン",
  "トッピング": "キッチン", "ソフトドリンク": "キッチン", "アルコール": "キッチン",
  "ビール": "キッチン", "清酒": "キッチン", "単式蒸留焼酎": "キッチン",
  "果実酒": "キッチン", "ウイスキー": "キッチン", "リキュール": "キッチン",
  "発泡酒": "キッチン", "甘味果実酒": "キッチン",
  "Sweets": "カフェ", "Drink": "カフェ", "Foods": "カフェ", "焼き立てパン": "カフェ",
  "お土産": "マーケット", "江津": "マーケット", "石見": "マーケット",
  "まる姫ポーク": "マーケット", "苔": "マーケット", "鮎": "マーケット",
  "松葉屋": "マーケット", "松江クロード": "マーケット", "令和シーフーズ": "マーケット",
  "空と小さな屋根の農園": "マーケット", "石州勝地半紙": "マーケット",
  "sukimono": "マーケット", "販促商品": "マーケット",
  "その他": "マーケット", "バーコードなし": "マーケット"
};

var PERIOD_COLORS = ["#1b4332", "#c1440e", "#4a6fa5"];
var GAS_URL_KEY = "nk_gas_url";

// ════════════════════════════════════
// GAS API Client
// ════════════════════════════════════
function getGasUrl() {
  try { return localStorage.getItem(GAS_URL_KEY) || ""; } catch(e) { return ""; }
}

function setGasUrl(url) {
  try { localStorage.setItem(GAS_URL_KEY, url); } catch(e) {}
}

function gasGet(action, params) {
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

function gasPost(body) {
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


// ════════════════════════════════════
// Helpers
// ════════════════════════════════════
function detectEncoding(buf) {
  var b = new Uint8Array(buf);
  for (var i = 0; i < Math.min(b.length, 500); i++) {
    if (b[i] >= 0x80 && b[i] <= 0x9f) return "shift-jis";
  }
  return "utf-8";
}

function readFileText(file) {
  return file.arrayBuffer().then(function(buf) {
    return new TextDecoder(detectEncoding(buf)).decode(buf);
  });
}

function parseCSV(text) {
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

function parseDailyRow(r) {
  var dt = r["\u65e5\u4ed8"];
  if (!dt || SKIP_LABELS.has(String(dt).trim())) return null;
  var s = parseFloat(r["\u7d14\u58f2\u4e0a"]) || 0;
  if (s === 0) return null;
  var c = parseInt(r["\u5ba2\u6570"]) || 0;
  var d = new Date(dt);
  return {
    date: dt, sales: s, customers: c,
    avgSpend: c > 0 ? Math.round(s / c) : 0,
    dow: WD[d.getDay()],
    y: d.getFullYear(),
    m: d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0")
  };
}

function parseProductRow(r) {
  if (!r["\u5546\u54c1\u540d"] || String(r["\u5546\u54c1\u30b3\u30fc\u30c9"]).trim() === "\u5408\u8a08" || !r["\u5546\u54c1\u540d"].trim()) return null;
  var s = parseFloat(r["\u7d14\u58f2\u4e0a"]) || 0;
  if (s === 0) return null;
  var cat = r["\u90e8\u9580\u540d"] || "";
  return {
    code: r["\u5546\u54c1\u30b3\u30fc\u30c9"], category: cat, name: r["\u5546\u54c1\u540d"],
    sales: s, cost: parseFloat(r["\u539f\u4fa1"]) || 0,
    profit: parseFloat(r["\u7c97\u5229\u76ca"]) || 0,
    profitRate: parseFloat(r["\u7c97\u5229\u7387"]) || 0,
    quantity: parseInt(r["\u8ca9\u58f2\u70b9\u6570"]) || 0,
    store: DMAP[cat] || "\u305d\u306e\u4ed6"
  };
}

function extractPeriodFromFilename(fn) {
  var m = fn.match(/(\d{8})-(\d{8})/);
  if (m) {
    var s = m[1]; var e = m[2];
    return {
      key: s + "-" + e,
      label: s.slice(0, 4) + "/" + s.slice(4, 6) + "/" + s.slice(6, 8) + " \u301c " + e.slice(0, 4) + "/" + e.slice(4, 6) + "/" + e.slice(6, 8),
      shortLabel: s.slice(0, 4) + "/" + s.slice(4, 6),
      startDate: s, endDate: e
    };
  }
  return null;
}

function fmtYen(v) { return "\u00a5" + (v || 0).toLocaleString(); }


// ════════════════════════════════════
// Sync Status Indicator
// ════════════════════════════════════
function SyncStatus(props) {
  var colors = { idle: "#ccc", syncing: "#f0ad4e", synced: "#5cb85c", error: "#d9534f" };
  var labels = { idle: "未接続", syncing: "同期中...", synced: "同期済み", error: "同期エラー" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: colors[props.status] || colors.idle,
        animation: props.status === "syncing" ? "pulse 1s infinite" : "none"
      }} />
      <span>{labels[props.status] || ""}</span>
      {props.lastSync && <span style={{ color: "#bbb" }}>{"(" + props.lastSync + ")"}</span>}
    </div>
  );
}


// ════════════════════════════════════
// UI Components
// ════════════════════════════════════
function chipStyle(active, color) {
  return {
    padding: "7px 18px", border: active ? "none" : "1px solid #d4d0c8",
    borderRadius: 20, background: active ? (color || "#1b4332") : "#fff",
    color: active ? "#fff" : "#666", fontSize: 13,
    fontWeight: active ? 600 : 400, cursor: "pointer",
    transition: "all .15s", whiteSpace: "nowrap"
  };
}

function Card(props) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14,
      boxShadow: "0 2px 12px rgba(0,0,0,.04)", padding: 24,
      ...(props.style || {})
    }}>
      {props.children}
    </div>
  );
}

function KPICard(props) {
  return (
    <div style={{
      flex: 1, minWidth: 160, background: "#fff", borderRadius: 14,
      padding: "18px 22px", boxShadow: "0 2px 12px rgba(0,0,0,.04)",
      borderLeft: "4px solid " + props.color, position: "relative", overflow: "hidden"
    }}>
      <div style={{ position: "absolute", top: 10, right: 14, fontSize: 28, opacity: 0.1 }}>{props.icon}</div>
      <div style={{ fontSize: 11, color: "#999", letterSpacing: ".06em", marginBottom: 4 }}>{props.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a" }}>{props.value}</div>
      {props.sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{props.sub}</div>}
    </div>
  );
}

function FileUploader(props) {
  var ref = useRef(null);
  var _s = useState(false); var drag = _s[0]; var setDrag = _s[1];

  var handleFiles = useCallback(function(files) {
    for (var i = 0; i < files.length; i++) {
      (function(file) {
        readFileText(file).then(function(text) {
          props.onUpload(text, file.name);
        });
      })(files[i]);
    }
  }, [props.onUpload]);

  return (
    <div
      onDragOver={function(e) { e.preventDefault(); setDrag(true); }}
      onDragLeave={function() { setDrag(false); }}
      onDrop={function(e) { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      onClick={function() { ref.current && ref.current.click(); }}
      style={{
        border: "2px dashed " + (drag ? "#1b4332" : "#ccc"),
        borderRadius: 14, padding: "28px 20px", textAlign: "center",
        cursor: "pointer", background: drag ? "rgba(27,67,50,.03)" : "#fafaf8",
        transition: "all .2s"
      }}
    >
      <input ref={ref} type="file" accept=".csv" multiple hidden
        onChange={function(e) { handleFiles(e.target.files); }} />
      <div style={{ fontSize: 26, marginBottom: 6 }}>{"📁"}</div>
      <div style={{ fontSize: 13, color: "#888" }}>{props.label}</div>
    </div>
  );
}

function ChartTooltip(props) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  return (
    <div style={{
      background: "#fff", border: "1px solid #e8e6e0", borderRadius: 10,
      padding: "12px 16px", boxShadow: "0 4px 20px rgba(0,0,0,.08)", fontSize: 13
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "#333" }}>{props.label}</div>
      {props.payload.filter(function(p) { return p.value != null; }).map(function(p, i) {
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color }} />
            <span style={{ color: "#666" }}>{p.name}:</span>
            <span style={{ fontWeight: 600 }}>{props.mi ? props.mi.fmt(p.value) : p.value}</span>
          </div>
        );
      })}
    </div>
  );
}


// ════════════════════════════════════
// Settings Panel
// ════════════════════════════════════
function SettingsPanel(props) {
  var _u = useState(getGasUrl()); var url = _u[0]; var setUrl = _u[1];
  var _t = useState(false); var testing = _t[0]; var setTesting = _t[1];
  var _r = useState(""); var testResult = _r[0]; var setTestResult = _r[1];

  function handleSave() {
    setGasUrl(url);
    props.onUrlChange(url);
    setTestResult("✅ URLを保存しました");
  }

  function handleTest() {
    if (!url) { setTestResult("❌ URLを入力してください"); return; }
    setTesting(true);
    setTestResult("");
    fetch(url + "?action=ping")
      .then(function(r) { return r.json(); })
      .then(function(d) {
        setTestResult(d.ok ? "✅ 接続成功！" : "⚠️ レスポンスエラー");
        setTesting(false);
      })
      .catch(function() {
        setTestResult("❌ 接続できません。URLを確認してください");
        setTesting(false);
      });
  }

  return (
    <Card>
      <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
        {"⚙️ Googleスプレッドシート連携設定"}
      </h3>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 14, lineHeight: 1.6 }}>
        {"GAS WebアプリのURLを設定すると、データがGoogleスプレッドシートに自動保存されます。"}
        <br />
        {"未設定でもブラウザのローカルストレージに保存されますが、容量制限があります。"}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text" value={url}
          onChange={function(e) { setUrl(e.target.value); }}
          placeholder="https://script.google.com/macros/s/xxxxx/exec"
          style={{
            flex: 1, minWidth: 300, padding: "10px 14px",
            border: "1px solid #d4d0c8", borderRadius: 10, fontSize: 13
          }}
        />
        <button onClick={handleSave} style={{
          padding: "10px 20px", background: "#1b4332", color: "#fff",
          border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer"
        }}>{"保存"}</button>
        <button onClick={handleTest} disabled={testing} style={{
          padding: "10px 20px", background: "#fff", color: "#1b4332",
          border: "1px solid #1b4332", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer"
        }}>{testing ? "テスト中..." : "接続テスト"}</button>
      </div>
      {testResult && (
        <div style={{ marginTop: 10, fontSize: 13, color: testResult.startsWith("✅") ? "#1b4332" : "#c1440e" }}>
          {testResult}
        </div>
      )}
    </Card>
  );
}


// ════════════════════════════════════
// Daily Dashboard
// ════════════════════════════════════
function DailyDashboard() {
  var _d = useState({}); var data = _d[0]; var setData = _d[1];
  var _dept = useState("全体"); var dept = _dept[0]; var setDept = _dept[1];
  var _met = useState("sales"); var metric = _met[0]; var setMetric = _met[1];
  var _rng = useState({ s: "", e: "" }); var range = _rng[0]; var setRange = _rng[1];
  var _imp = useState("キッチン"); var impDept = _imp[0]; var setImpDept = _imp[1];
  var _cmp = useState(null); var compareMode = _cmp[0]; var setCompareMode = _cmp[1];
  var _tbl = useState(false); var showTable = _tbl[0]; var setShowTable = _tbl[1];
  var _sync = useState("idle"); var syncStatus = _sync[0]; var setSyncStatus = _sync[1];
  var _loaded = useState(false); var loaded = _loaded[0]; var setLoaded = _loaded[1];

  // 初回ロード: GASから取得 → なければlocalStorage
  useEffect(function() {
    if (loaded) return;
    setSyncStatus("syncing");
    gasGet("getDailyData").then(function(res) {
      if (res && res.data && Object.keys(res.data).length > 0) {
        setData(res.data);
        setSyncStatus("synced");
      } else {
        // fallback to localStorage
        try {
          var d = localStorage.getItem("nk_daily3");
          if (d) setData(JSON.parse(d));
        } catch(e) {}
        setSyncStatus(getGasUrl() ? "error" : "idle");
      }
      setLoaded(true);
    });
  }, [loaded]);

  var handleImport = useCallback(function(text) {
    var rows = parseCSV(text).map(parseDailyRow).filter(Boolean);
    if (rows.length === 0) return;
    setData(function(prev) {
      var next = JSON.parse(JSON.stringify(prev));
      if (!next[impDept]) next[impDept] = {};
      rows.forEach(function(r) { next[impDept][r.date] = r; });

      // Save to localStorage as backup
      try { localStorage.setItem("nk_daily3", JSON.stringify(next)); } catch(e) {}

      // Sync to GAS
      setSyncStatus("syncing");
      gasPost({ action: "saveDailyData", dept: impDept, rows: rows }).then(function(res) {
        setSyncStatus(res ? "synced" : (getGasUrl() ? "error" : "idle"));
      });

      return next;
    });
  }, [impDept]);

  // === Computed values ===
  var allData = useMemo(function() {
    var result = {};
    ["キッチン", "マーケット", "カフェ"].forEach(function(d) {
      if (!data[d]) return;
      Object.keys(data[d]).forEach(function(dt) {
        var row = data[d][dt];
        if (!result[dt]) result[dt] = { date: dt, sales: 0, customers: 0, avgSpend: 0, dow: row.dow, y: row.y, m: row.m };
        result[dt].sales += row.sales;
        result[dt].customers += row.customers;
      });
    });
    Object.keys(result).forEach(function(dt) {
      var r = result[dt];
      r.avgSpend = r.customers > 0 ? Math.round(r.sales / r.customers) : 0;
    });
    return result;
  }, [data]);

  var current = useMemo(function() {
    var src = dept === "全体" ? allData : (data[dept] || {});
    var arr = Object.values(src).sort(function(a, b) { return a.date.localeCompare(b.date); });
    if (range.s) arr = arr.filter(function(r) { return r.date >= range.s; });
    if (range.e) arr = arr.filter(function(r) { return r.date <= range.e; });
    return arr;
  }, [dept, data, allData, range]);

  var mi = METRICS.find(function(m) { return m.key === metric; });

  var yoyData = useMemo(function() {
    if (!compareMode || current.length === 0) return [];
    var src = dept === "全体" ? allData : (data[dept] || {});
    return current.map(function(r) {
      var d = new Date(r.date);
      var lyDate;
      if (compareMode === "date") {
        var ly = new Date(d); ly.setFullYear(ly.getFullYear() - 1);
        lyDate = ly.getFullYear() + "/" + String(ly.getMonth() + 1).padStart(2, "0") + "/" + String(ly.getDate()).padStart(2, "0");
      } else {
        var ld = new Date(d); ld.setDate(ld.getDate() - 364);
        lyDate = ld.getFullYear() + "/" + String(ld.getMonth() + 1).padStart(2, "0") + "/" + String(ld.getDate()).padStart(2, "0");
      }
      var lyRow = src[lyDate];
      var tv = r[metric]; var lv = lyRow ? lyRow[metric] : null;
      return {
        label: r.date.slice(5), fullDate: r.date, dow: r.dow,
        thisYear: tv, lastYear: lv, lyDate: lyDate,
        ratio: (lv && lv > 0) ? tv / lv : null
      };
    });
  }, [compareMode, current, metric, dept, data, allData]);

  var kpis = useMemo(function() {
    if (current.length === 0) return { s: 0, c: 0, a: 0, d: 0 };
    var s = current.reduce(function(acc, r) { return acc + r.sales; }, 0);
    var c = current.reduce(function(acc, r) { return acc + r.customers; }, 0);
    return { s: s, c: c, a: c > 0 ? Math.round(s / c) : 0, d: current.length };
  }, [current]);

  var yoyKpi = useMemo(function() {
    if (yoyData.length === 0) return null;
    var pairs = yoyData.filter(function(r) { return r.lastYear != null; });
    if (pairs.length === 0) return null;
    var tySum = pairs.reduce(function(s, r) { return s + r.thisYear; }, 0);
    var lySum = pairs.reduce(function(s, r) { return s + r.lastYear; }, 0);
    return { ratio: lySum > 0 ? tySum / lySum : null, matched: pairs.length, total: yoyData.length };
  }, [yoyData]);

  var cnt = Object.keys(data).reduce(function(s, d) { return s + Object.keys(data[d]).length; }, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: "#333", fontWeight: 600 }}>{"📥 日別売上CSVインポート"}</h3>
          <SyncStatus status={syncStatus} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#666" }}>{"取込先："}</span>
          {["キッチン", "マーケット", "カフェ"].map(function(d) {
            return <button key={d} onClick={function() { setImpDept(d); }} style={chipStyle(impDept === d, DC[d])}>{d}</button>;
          })}
        </div>
        <FileUploader onUpload={handleImport} label={"「" + impDept + "」の日別売上CSVをドロップ（複数月OK）"} />
        {cnt > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{"💾 " + Object.keys(data).filter(function(k) { return Object.keys(data[k]).length > 0; }).join("・") + " 保持中（" + cnt + "日分）"}</span>
            <button onClick={function() {
              setData({});
              try { localStorage.removeItem("nk_daily3"); } catch(e) {}
            }}
              style={{ fontSize: 11, color: "#c1440e", background: "none", border: "1px solid #c1440e", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>{"全削除"}</button>
          </div>
        )}
      </Card>

      {current.length > 0 && (
        <>
          <Card style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {DEPTS.map(function(d) {
                  return <button key={d} onClick={function() { setDept(d); }} style={chipStyle(dept === d, DC[d])}>{d}</button>;
                })}
              </div>
              <div style={{ width: 1, height: 28, background: "#e8e6e0" }} />
              <div style={{ display: "flex", gap: 6 }}>
                {METRICS.map(function(m) {
                  return <button key={m.key} onClick={function() { setMetric(m.key); }} style={chipStyle(metric === m.key, "#333")}>{m.label}</button>;
                })}
              </div>
              <div style={{ width: 1, height: 28, background: "#e8e6e0" }} />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="date" value={range.s.replace(/\//g, "-")}
                  onChange={function(e) { setRange(function(p) { return { s: e.target.value.replace(/-/g, "/"), e: p.e }; }); }}
                  style={{ padding: "5px 8px", border: "1px solid #d4d0c8", borderRadius: 8, fontSize: 13 }} />
                <span style={{ color: "#bbb" }}>{"\u301c"}</span>
                <input type="date" value={range.e.replace(/\//g, "-")}
                  onChange={function(e) { setRange(function(p) { return { s: p.s, e: e.target.value.replace(/-/g, "/") }; }); }}
                  style={{ padding: "5px 8px", border: "1px solid #d4d0c8", borderRadius: 8, fontSize: 13 }} />
                {(range.s || range.e) && (
                  <button onClick={function() { setRange({ s: "", e: "" }); }}
                    style={{ fontSize: 11, color: "#999", background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>{"\u2715"}</button>
                )}
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <KPICard label="期間売上合計" value={fmtYen(kpis.s)} sub={kpis.d + "日間"} color="#1b4332" icon="💰" />
            <KPICard label="期間客数合計" value={kpis.c.toLocaleString() + "人"} sub={"日平均 " + Math.round(kpis.c / Math.max(kpis.d, 1)).toLocaleString() + "人"} color="#386641" icon="👥" />
            <KPICard label="平均客単価" value={fmtYen(kpis.a)} color="#c1440e" icon="🧾" />
            <KPICard label="日平均売上" value={fmtYen(Math.round(kpis.s / Math.max(kpis.d, 1)))} color="#b5651d" icon="📊" />
          </div>

          <Card>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
              {"📈 日別推移（" + dept + "・" + mi.label + "）"}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={current} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tickFormatter={function(v) { return v.slice(5); }} fontSize={11} tick={{ fill: "#888" }} />
                <YAxis tickFormatter={mi.yFmt} fontSize={11} tick={{ fill: "#888" }} />
                <Tooltip content={function(p) { return <ChartTooltip active={p.active} payload={p.payload} label={p.label} mi={mi} />; }} />
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DC[dept]} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={DC[dept]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey={metric} name={mi.label} fill="url(#areaGrad)" stroke={DC[dept]} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {dept === "全体" && (
            <Card>
              <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
                {"🏪 部門別比較（" + mi.label + "）"}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tickFormatter={function(v) { return v.slice(5); }} fontSize={11} allowDuplicatedCategory={false} tick={{ fill: "#888" }} />
                  <YAxis tickFormatter={mi.yFmt} fontSize={11} tick={{ fill: "#888" }} />
                  <Tooltip content={function(p) { return <ChartTooltip active={p.active} payload={p.payload} label={p.label} mi={mi} />; }} />
                  <Legend />
                  {["キッチン", "マーケット", "カフェ"].map(function(d) {
                    var dd = data[d] ? Object.values(data[d]).sort(function(a, b) { return a.date.localeCompare(b.date); }).filter(function(r) {
                      if (range.s && r.date < range.s) return false;
                      if (range.e && r.date > range.e) return false;
                      return true;
                    }) : [];
                    if (dd.length === 0) return null;
                    return <Line key={d} data={dd} dataKey={metric} name={d} stroke={DC[d]} strokeWidth={2} dot={false} type="monotone" />;
                  })}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#333", fontWeight: 600 }}>
                {"📊 前年比較（" + dept + "・" + mi.label + "）"}
              </h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={function() { setCompareMode(compareMode === "date" ? null : "date"); }}
                  style={chipStyle(compareMode === "date", "#1b4332")}>{"📅 日付合わせ"}</button>
                <button onClick={function() { setCompareMode(compareMode === "dow" ? null : "dow"); }}
                  style={chipStyle(compareMode === "dow", "#1b4332")}>{"🗓️ 曜日合わせ"}</button>
              </div>
            </div>

            {compareMode == null && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#bbb", fontSize: 14 }}>
                {"上のボタンで比較モードを選択してください"}
                <br /><span style={{ fontSize: 12 }}>{"「日付合わせ」＝前年の同じ日付と比較　｜　「曜日合わせ」＝364日前（同じ曜日）と比較"}</span>
              </div>
            )}

            {compareMode != null && yoyData.length > 0 && (
              <>
                {yoyKpi && (
                  <div style={{ display: "flex", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
                    <div style={{
                      flex: 1, minWidth: 200, padding: "14px 20px", borderRadius: 12,
                      background: yoyKpi.ratio >= 1 ? "rgba(27,67,50,.06)" : "rgba(193,68,14,.06)",
                      border: "1px solid " + (yoyKpi.ratio >= 1 ? "rgba(27,67,50,.15)" : "rgba(193,68,14,.15)")
                    }}>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                        {"前年比（" + (compareMode === "date" ? "日付合わせ" : "曜日合わせ") + "）"}
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: yoyKpi.ratio >= 1 ? "#1b4332" : "#c1440e" }}>
                        {yoyKpi.ratio != null ? (yoyKpi.ratio * 100).toFixed(1) + "%" : "\u2014"}
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                        {"前年データ一致：" + yoyKpi.matched + "/" + yoyKpi.total + "日"}
                      </div>
                    </div>
                    <div style={{ flex: 2, minWidth: 250, padding: "14px 20px", borderRadius: 12, background: "#fafaf8", border: "1px solid #eee" }}>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                        {compareMode === "date" ? "前年の同じ日付" : "364日前（同じ曜日）"}
                      </div>
                      <div style={{ display: "flex", gap: 20 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#999" }}>{"今年合計"}</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>
                            {mi.fmt(yoyData.filter(function(r) { return r.lastYear != null; }).reduce(function(s, r) { return s + r.thisYear; }, 0))}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#999" }}>{"前年合計"}</div>
                          <div style={{ fontSize: 16, fontWeight: 600 }}>
                            {mi.fmt(yoyData.filter(function(r) { return r.lastYear != null; }).reduce(function(s, r) { return s + r.lastYear; }, 0))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, fontWeight: 500 }}>{"▼ 今年 vs 前年 棒グラフ"}</div>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={yoyData} barGap={2} margin={{ left: 10, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" fontSize={10} tick={{ fill: "#888" }} interval={Math.max(0, Math.floor(yoyData.length / 20))} />
                      <YAxis tickFormatter={mi.yFmt} fontSize={11} tick={{ fill: "#888" }} />
                      <Tooltip content={function(tp) {
                        if (!tp.active || !tp.payload || tp.payload.length === 0) return null;
                        var item = yoyData.find(function(r) { return r.label === tp.label; });
                        return (
                          <div style={{ background: "#fff", border: "1px solid #e8e6e0", borderRadius: 10, padding: "12px 16px", boxShadow: "0 4px 20px rgba(0,0,0,.08)", fontSize: 13 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{item ? item.fullDate + "（" + item.dow + "）" : ""}</div>
                            {tp.payload.filter(function(p) { return p.value != null; }).map(function(p, i) {
                              return (
                                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                                  <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color, marginTop: 3 }} />
                                  <span style={{ color: "#666" }}>{p.name + "："}</span>
                                  <span style={{ fontWeight: 600 }}>{mi.fmt(p.value)}</span>
                                </div>
                              );
                            })}
                            {item && item.ratio != null && (
                              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontWeight: 600, color: item.ratio >= 1 ? "#1b4332" : "#c1440e" }}>
                                {"前年比 " + (item.ratio * 100).toFixed(1) + "%"}
                              </div>
                            )}
                          </div>
                        );
                      }} />
                      <Legend />
                      <Bar dataKey="lastYear" name="前年" fill="#ccc" radius={[2, 2, 0, 0]} maxBarSize={24} />
                      <Bar dataKey="thisYear" name="今年" fill={DC[dept]} radius={[2, 2, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, fontWeight: 500 }}>{"▼ 前年比推移（100%ライン付き）"}</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={yoyData.filter(function(r) { return r.ratio != null; })} margin={{ left: 10, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" fontSize={10} tick={{ fill: "#888" }} interval={Math.max(0, Math.floor(yoyData.length / 20))} />
                      <YAxis tickFormatter={function(v) { return (v * 100).toFixed(0) + "%"; }} fontSize={11} tick={{ fill: "#888" }} />
                      <Tooltip formatter={function(v) { return [(v * 100).toFixed(1) + "%", "前年比"]; }} />
                      <ReferenceLine y={1} stroke="#999" strokeDasharray="4 4" />
                      <Bar dataKey="ratio" name="前年比" maxBarSize={18} radius={[2, 2, 0, 0]}>
                        {yoyData.filter(function(r) { return r.ratio != null; }).map(function(r, i) {
                          return <Cell key={i} fill={r.ratio >= 1 ? "rgba(27,67,50,.5)" : "rgba(193,68,14,.5)"} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, fontWeight: 500 }}>{"▼ 前年比較データテーブル"}</div>
                  <div style={{ maxHeight: 400, overflowY: "auto", borderRadius: 10, border: "1px solid #eee" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ position: "sticky", top: 0, background: "#f8f7f4", zIndex: 1 }}>
                          {["日付", "曜日", "今年", "前年", "前年比", "前年日付"].map(function(h, i) {
                            return <th key={i} style={{ padding: "8px 10px", textAlign: i <= 1 ? "left" : "right", borderBottom: "2px solid #ddd" }}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {yoyData.map(function(r, i) {
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
                              <td style={{ padding: "6px 10px" }}>{r.fullDate}</td>
                              <td style={{ padding: "6px 10px", color: r.dow === "日" ? "#c1440e" : r.dow === "土" ? "#1b4332" : "#666" }}>{r.dow}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{mi.fmt(r.thisYear)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.lastYear != null ? "#666" : "#ccc" }}>
                                {r.lastYear != null ? mi.fmt(r.lastYear) : "データなし"}
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: r.ratio == null ? "#ccc" : r.ratio >= 1 ? "#1b4332" : "#c1440e" }}>
                                {r.ratio != null ? (r.ratio * 100).toFixed(1) + "%" : "\u2014"}
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: "#999" }}>{r.lyDate}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#333", fontWeight: 600 }}>{"📋 日別データ（" + dept + "）"}</h3>
              <button onClick={function() { setShowTable(!showTable); }}
                style={{ fontSize: 12, color: "#666", background: "none", border: "1px solid #ddd", borderRadius: 8, padding: "5px 14px", cursor: "pointer" }}>
                {showTable ? "テーブルを閉じる" : "テーブルを開く"}
              </button>
            </div>
            {showTable && (
              <div style={{ maxHeight: 400, overflowY: "auto", borderRadius: 10, border: "1px solid #eee" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#f8f7f4" }}>
                      {["日付", "曜日", "売上", "客数", "客単価"].map(function(h, i) {
                        return <th key={i} style={{ padding: "8px 12px", textAlign: i <= 1 ? "left" : "right", borderBottom: "2px solid #ddd" }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {current.map(function(r, i) {
                      return (
                        <tr key={r.date} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
                          <td style={{ padding: "6px 12px" }}>{r.date}</td>
                          <td style={{ padding: "6px 12px", color: r.dow === "日" ? "#c1440e" : r.dow === "土" ? "#1b4332" : "#666" }}>{r.dow}</td>
                          <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtYen(r.sales)}</td>
                          <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.customers.toLocaleString()}</td>
                          <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtYen(r.avgSpend)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}


// ════════════════════════════════════
// Product Dashboard (Multi-Period Compare)
// ════════════════════════════════════
function ProductDashboard() {
  var _p = useState({}); var periods = _p[0]; var setPeriods = _p[1];
  var _base = useState(""); var basePeriod = _base[0]; var setBasePeriod = _base[1];
  var _cmp1 = useState(""); var cmpPeriod1 = _cmp1[0]; var setCmpPeriod1 = _cmp1[1];
  var _cmp2 = useState(""); var cmpPeriod2 = _cmp2[0]; var setCmpPeriod2 = _cmp2[1];
  var _store = useState("全体"); var store = _store[0]; var setStore = _store[1];
  var _cat = useState("全て"); var cat = _cat[0]; var setCat = _cat[1];
  var _search = useState(""); var search = _search[0]; var setSearch = _search[1];
  var _sortK = useState("sales"); var sortK = _sortK[0]; var setSortK = _sortK[1];
  var _sortD = useState("desc"); var sortD = _sortD[0]; var setSortD = _sortD[1];
  var _metric = useState("sales"); var prodMetric = _metric[0]; var setProdMetric = _metric[1];
  var _sync = useState("idle"); var syncStatus = _sync[0]; var setSyncStatus = _sync[1];
  var _loaded = useState(false); var loaded = _loaded[0]; var setLoaded = _loaded[1];

  // 初回ロード
  useEffect(function() {
    if (loaded) return;
    setSyncStatus("syncing");
    gasGet("getProductData").then(function(res) {
      if (res && res.data && Object.keys(res.data).length > 0) {
        setPeriods(res.data);
        setSyncStatus("synced");
      } else {
        try {
          var d = localStorage.getItem("nk_prod4");
          if (d) setPeriods(JSON.parse(d));
        } catch(e) {}
        setSyncStatus(getGasUrl() ? "error" : "idle");
      }
      setLoaded(true);
    });
  }, [loaded]);

  var periodKeys = useMemo(function() {
    return Object.keys(periods).sort(function(a, b) { return b.localeCompare(a); });
  }, [periods]);

  useEffect(function() {
    if (periodKeys.length >= 1 && !basePeriod) setBasePeriod(periodKeys[0]);
    if (periodKeys.length >= 2 && !cmpPeriod1) setCmpPeriod1(periodKeys[1]);
  }, [periodKeys]);

  var handleImport = useCallback(function(text, fn) {
    var rows = parseCSV(text).map(parseProductRow).filter(Boolean);
    if (rows.length === 0) return;
    var info = extractPeriodFromFilename(fn);
    if (!info) {
      info = { key: "manual_" + Date.now(), label: fn.replace(/\.csv$/i, ""), shortLabel: fn.replace(/\.csv$/i, "").slice(0, 12) };
    }
    setPeriods(function(prev) {
      var next = JSON.parse(JSON.stringify(prev));
      next[info.key] = { label: info.label, shortLabel: info.shortLabel, rows: rows };
      // Save locally
      try { localStorage.setItem("nk_prod4", JSON.stringify(next)); } catch(e) {}
      return next;
    });

    // Sync to GAS
    setSyncStatus("syncing");
    gasPost({
      action: "saveProductData",
      periodKey: info.key,
      periodLabel: info.label,
      rows: rows
    }).then(function(res) {
      setSyncStatus(res ? "synced" : (getGasUrl() ? "error" : "idle"));
    });
  }, []);

  var removePeriod = useCallback(function(key) {
    setPeriods(function(prev) {
      var next = JSON.parse(JSON.stringify(prev));
      delete next[key];
      try { localStorage.setItem("nk_prod4", JSON.stringify(next)); } catch(e) {}
      return next;
    });
    if (basePeriod === key) setBasePeriod("");
    if (cmpPeriod1 === key) setCmpPeriod1("");
    if (cmpPeriod2 === key) setCmpPeriod2("");

    gasPost({ action: "deleteProductPeriod", periodKey: key });
  }, [basePeriod, cmpPeriod1, cmpPeriod2]);

  var cats = useMemo(function() {
    if (!basePeriod || !periods[basePeriod]) return ["全て"];
    var s = new Set(periods[basePeriod].rows.map(function(r) { return r.category; }));
    return ["全て"].concat(Array.from(s).filter(Boolean).sort());
  }, [basePeriod, periods]);

  var compareData = useMemo(function() {
    if (!basePeriod || !periods[basePeriod]) return [];
    var baseRows = periods[basePeriod].rows;
    var filtered = baseRows;
    if (store !== "全体") filtered = filtered.filter(function(r) { return r.store === store; });
    if (cat !== "全て") filtered = filtered.filter(function(r) { return r.category === cat; });
    if (search) filtered = filtered.filter(function(r) { return r.name.includes(search) || r.category.includes(search); });
    filtered = filtered.slice().sort(function(a, b) { return sortD === "desc" ? b[sortK] - a[sortK] : a[sortK] - b[sortK]; });

    var cmp1Map = {};
    var cmp2Map = {};
    if (cmpPeriod1 && periods[cmpPeriod1]) {
      periods[cmpPeriod1].rows.forEach(function(r) { cmp1Map[r.code] = r; });
    }
    if (cmpPeriod2 && periods[cmpPeriod2]) {
      periods[cmpPeriod2].rows.forEach(function(r) { cmp2Map[r.code] = r; });
    }

    return filtered.map(function(r) {
      var c1 = cmp1Map[r.code];
      var c2 = cmp2Map[r.code];
      var val = r[prodMetric] || 0;
      var c1val = c1 ? (c1[prodMetric] || 0) : null;
      var c2val = c2 ? (c2[prodMetric] || 0) : null;
      return {
        code: r.code, name: r.name, category: r.category, store: r.store,
        baseSales: r.sales, baseQty: r.quantity, baseProfit: r.profit, baseProfitRate: r.profitRate,
        baseVal: val, cmp1Val: c1val, cmp2Val: c2val,
        cmp1Sales: c1 ? c1.sales : null, cmp1Qty: c1 ? c1.quantity : null,
        cmp2Sales: c2 ? c2.sales : null, cmp2Qty: c2 ? c2.quantity : null,
        ratio1: (c1val && c1val > 0) ? val / c1val : null,
        ratio2: (c2val && c2val > 0) ? val / c2val : null,
        isNew1: c1 == null, isNew2: c2 == null
      };
    });
  }, [basePeriod, cmpPeriod1, cmpPeriod2, periods, store, cat, search, sortK, sortD, prodMetric]);

  var disappeared = useMemo(function() {
    if (!basePeriod || !periods[basePeriod]) return [];
    var baseCodeSet = new Set(periods[basePeriod].rows.map(function(r) { return r.code; }));
    var result = [];
    if (cmpPeriod1 && periods[cmpPeriod1]) {
      periods[cmpPeriod1].rows.forEach(function(r) {
        if (!baseCodeSet.has(r.code)) {
          var ok = true;
          if (store !== "全体" && r.store !== store) ok = false;
          if (cat !== "全て" && r.category !== cat) ok = false;
          if (ok) result.push({ name: r.name, category: r.category, store: r.store, sales: r.sales, qty: r.quantity });
        }
      });
    }
    return result.sort(function(a, b) { return b.sales - a.sales; });
  }, [basePeriod, cmpPeriod1, periods, store, cat]);

  var abc = useMemo(function() {
    if (compareData.length === 0) return [];
    var total = compareData.reduce(function(s, r) { return s + r.baseSales; }, 0);
    var cum = 0;
    return compareData.map(function(r) {
      cum += r.baseSales;
      var p = (cum / total) * 100;
      return { code: r.code, rank: p <= 70 ? "A" : p <= 90 ? "B" : "C" };
    });
  }, [compareData]);

  var rkC = { A: "#1b4332", B: "#b5651d", C: "#c1440e" };
  var baseTotal = compareData.reduce(function(s, r) { return s + r.baseSales; }, 0);
  var cmp1Total = cmpPeriod1 ? compareData.reduce(function(s, r) { return s + (r.cmp1Sales || 0); }, 0) : null;
  var overallRatio1 = (cmp1Total && cmp1Total > 0) ? baseTotal / cmp1Total : null;
  var top20 = compareData.slice(0, 20);
  var PROD_METRICS = [{ key: "sales", label: "売上" }, { key: "quantity", label: "数量" }, { key: "profit", label: "粗利" }];
  var metricFmt = function(v, key) { return (key === "sales" || key === "profit") ? fmtYen(v) : (v || 0).toLocaleString(); };
  var hasCompare = cmpPeriod1 && periods[cmpPeriod1];
  var hasCompare2 = cmpPeriod2 && periods[cmpPeriod2];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: "#333", fontWeight: 600 }}>{"📥 商品別売上CSVインポート"}</h3>
          <SyncStatus status={syncStatus} />
        </div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
          {"複数期間のCSVを取り込んで比較できます（ファイル名の日付から期間を自動判定）"}
        </div>
        <FileUploader onUpload={handleImport} label="商品別売上CSVをドロップ（複数ファイルOK）" />

        {periodKeys.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontWeight: 500 }}>{"📂 取込済み期間："}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {periodKeys.map(function(key, idx) {
                var p = periods[key];
                return (
                  <div key={key} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 14px", borderRadius: 10, background: "#fafaf8", border: "1px solid #eee"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: PERIOD_COLORS[idx] || "#999" }} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</span>
                      <span style={{ fontSize: 11, color: "#999" }}>{p.rows.length + "商品"}</span>
                    </div>
                    <button onClick={function() { removePeriod(key); }}
                      style={{ fontSize: 11, color: "#c1440e", background: "none", border: "1px solid #c1440e", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>{"削除"}</button>
                  </div>
                );
              })}
            </div>
            <button onClick={function() {
              setPeriods({});
              setBasePeriod(""); setCmpPeriod1(""); setCmpPeriod2("");
              try { localStorage.removeItem("nk_prod4"); } catch(e) {}
            }}
              style={{ marginTop: 8, fontSize: 11, color: "#c1440e", background: "none", border: "1px solid #c1440e", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>{"全削除"}</button>
          </div>
        )}
      </Card>

      {periodKeys.length >= 1 && (
        <Card>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>{"🔀 比較期間の選択"}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {[
              { val: basePeriod, set: setBasePeriod, label: "基準期間（今年）", color: PERIOD_COLORS[0], exclude: [] },
              { val: cmpPeriod1, set: setCmpPeriod1, label: "比較期間1（前年等）", color: PERIOD_COLORS[1], exclude: [basePeriod] },
              { val: cmpPeriod2, set: setCmpPeriod2, label: "比較期間2（オプション）", color: PERIOD_COLORS[2], exclude: [basePeriod, cmpPeriod1] }
            ].map(function(cfg, idx) {
              return (
                <div key={idx} style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 12, color: cfg.color, fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: cfg.color }} />
                    {cfg.label}
                  </div>
                  <select value={cfg.val} onChange={function(e) { cfg.set(e.target.value); }}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #d4d0c8", borderRadius: 8, fontSize: 13, background: "#fff" }}>
                    <option value="">{idx === 2 ? "-- なし --" : "-- 選択 --"}</option>
                    {periodKeys.filter(function(k) { return cfg.exclude.indexOf(k) === -1; }).map(function(k) {
                      return <option key={k} value={k}>{periods[k].label}</option>;
                    })}
                  </select>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {basePeriod && periods[basePeriod] && (
        <>
          <Card style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {DEPTS.map(function(d) {
                  return <button key={d} onClick={function() { setStore(d); }} style={chipStyle(store === d, DC[d])}>{d}</button>;
                })}
              </div>
              <select value={cat} onChange={function(e) { setCat(e.target.value); }}
                style={{ padding: "6px 12px", border: "1px solid #d4d0c8", borderRadius: 8, fontSize: 13, background: "#fff" }}>
                {cats.map(function(c) { return <option key={c}>{c}</option>; })}
              </select>
              <input type="text" placeholder="🔍 商品名検索" value={search}
                onChange={function(e) { setSearch(e.target.value); }}
                style={{ padding: "6px 12px", border: "1px solid #d4d0c8", borderRadius: 8, fontSize: 13, width: 180 }} />
              <div style={{ width: 1, height: 28, background: "#e8e6e0" }} />
              <div style={{ display: "flex", gap: 5 }}>
                {PROD_METRICS.map(function(m) {
                  return <button key={m.key} onClick={function() { setProdMetric(m.key); }} style={chipStyle(prodMetric === m.key, "#333")}>{m.label}</button>;
                })}
              </div>
              <div style={{ width: 1, height: 28, background: "#e8e6e0" }} />
              <div style={{ display: "flex", gap: 5 }}>
                {[{ k: "sales", l: "売上" }, { k: "quantity", l: "数量" }, { k: "profit", l: "粗利" }].map(function(s) {
                  return (
                    <button key={s.k} onClick={function() {
                      if (sortK === s.k) setSortD(function(d) { return d === "desc" ? "asc" : "desc"; });
                      else { setSortK(s.k); setSortD("desc"); }
                    }} style={chipStyle(sortK === s.k, "#666")}>
                      {"Sort:" + s.l + (sortK === s.k ? (sortD === "desc" ? "↓" : "↑") : "")}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <KPICard label="基準期間 売上合計" value={fmtYen(baseTotal)} sub={periods[basePeriod].label} color="#1b4332" icon="💰" />
            <KPICard label="該当商品数" value={compareData.length + "件"} color="#386641" icon="📦" />
            {hasCompare && overallRatio1 != null && (
              <KPICard label="対 比較期間1 売上比" value={(overallRatio1 * 100).toFixed(1) + "%"}
                sub={fmtYen(cmp1Total) + " → " + fmtYen(baseTotal)}
                color={overallRatio1 >= 1 ? "#1b4332" : "#c1440e"} icon={overallRatio1 >= 1 ? "📈" : "📉"} />
            )}
            {hasCompare && (
              <KPICard label="新商品（基準期間のみ）" value={compareData.filter(function(r) { return r.isNew1; }).length + "件"}
                sub="比較期間1になかった商品" color="#4a6fa5" icon="🆕" />
            )}
          </div>

          <Card>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
              {"🏆 " + PROD_METRICS.find(function(m) { return m.key === prodMetric; }).label + " TOP20 比較"}
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(450, top20.length * 32)}>
              <BarChart data={top20} layout="vertical" margin={{ left: 180, right: 20 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={function(v) {
                  return (prodMetric === "sales" || prodMetric === "profit") ? (v / 10000).toFixed(0) + "万" : String(v);
                }} fontSize={11} tick={{ fill: "#888" }} />
                <YAxis type="category" dataKey="name" width={170} fontSize={11} tick={{ fill: "#444" }} />
                <Tooltip content={function(tp) {
                  if (!tp.active || !tp.payload || tp.payload.length === 0) return null;
                  var item = top20.find(function(r) { return r.name === tp.label; });
                  return (
                    <div style={{ background: "#fff", border: "1px solid #e8e6e0", borderRadius: 10, padding: "12px 16px", boxShadow: "0 4px 20px rgba(0,0,0,.08)", fontSize: 13 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{tp.label}</div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{item ? item.category + " / " + item.store : ""}</div>
                      {tp.payload.filter(function(p) { return p.value != null; }).map(function(p, i) {
                        return (
                          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color, marginTop: 3 }} />
                            <span style={{ color: "#666" }}>{p.name + "："}</span>
                            <span style={{ fontWeight: 600 }}>{metricFmt(p.value, prodMetric)}</span>
                          </div>
                        );
                      })}
                      {item && item.ratio1 != null && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontWeight: 600, color: item.ratio1 >= 1 ? "#1b4332" : "#c1440e" }}>
                          {"対比較1: " + (item.ratio1 * 100).toFixed(1) + "%"}
                        </div>
                      )}
                    </div>
                  );
                }} />
                <Legend />
                {hasCompare2 && <Bar dataKey="cmp2Val" name={periods[cmpPeriod2].shortLabel} fill={PERIOD_COLORS[2]} radius={[0, 4, 4, 0]} maxBarSize={16} opacity={0.5} />}
                {hasCompare && <Bar dataKey="cmp1Val" name={periods[cmpPeriod1].shortLabel} fill={PERIOD_COLORS[1]} radius={[0, 4, 4, 0]} maxBarSize={16} opacity={0.6} />}
                <Bar dataKey="baseVal" name={periods[basePeriod].shortLabel} fill={PERIOD_COLORS[0]} radius={[0, 4, 4, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {hasCompare && (
            <Card>
              <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
                {"📊 前年比 TOP20（" + PROD_METRICS.find(function(m) { return m.key === prodMetric; }).label + "）"}
              </h3>
              <ResponsiveContainer width="100%" height={Math.max(450, top20.filter(function(r) { return r.ratio1 != null; }).length * 30)}>
                <BarChart data={top20.filter(function(r) { return r.ratio1 != null; }).slice().sort(function(a, b) { return b.ratio1 - a.ratio1; })}
                  layout="vertical" margin={{ left: 180, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis type="number" tickFormatter={function(v) { return (v * 100).toFixed(0) + "%"; }} fontSize={11} tick={{ fill: "#888" }} />
                  <YAxis type="category" dataKey="name" width={170} fontSize={11} tick={{ fill: "#444" }} />
                  <Tooltip formatter={function(v) { return [(v * 100).toFixed(1) + "%", "前年比"]; }} />
                  <ReferenceLine x={1} stroke="#999" strokeDasharray="4 4" />
                  <Bar dataKey="ratio1" name="前年比" maxBarSize={20} radius={[0, 4, 4, 0]}>
                    {top20.filter(function(r) { return r.ratio1 != null; }).slice().sort(function(a, b) { return b.ratio1 - a.ratio1; }).map(function(r, i) {
                      return <Cell key={i} fill={r.ratio1 >= 1 ? "rgba(27,67,50,.5)" : "rgba(193,68,14,.5)"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {hasCompare && compareData.filter(function(r) { return r.isNew1; }).length > 0 && (
            <Card>
              <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>{"🆕 新商品"}</h3>
              <div style={{ maxHeight: 300, overflowY: "auto", borderRadius: 10, border: "1px solid #eee" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#f0f8f4", zIndex: 1 }}>
                      {["商品名", "部門", "売上", "数量", "店舗"].map(function(h, i) {
                        return <th key={i} style={{ padding: "8px 10px", textAlign: i >= 2 && i <= 3 ? "right" : "left", borderBottom: "2px solid #ddd" }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.filter(function(r) { return r.isNew1; }).map(function(r, i) {
                      return (
                        <tr key={r.code} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
                          <td style={{ padding: "5px 10px", fontWeight: 500 }}>{r.name}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: "#888" }}>{r.category}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtYen(r.baseSales)}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.baseQty}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: DC[r.store] || "#666", fontWeight: 500 }}>{r.store}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {disappeared.length > 0 && (
            <Card>
              <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>{"⚠️ 消滅商品"}</h3>
              <div style={{ maxHeight: 300, overflowY: "auto", borderRadius: 10, border: "1px solid #eee" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#fdf5f0", zIndex: 1 }}>
                      {["商品名", "部門", "前年売上", "前年数量", "店舗"].map(function(h, i) {
                        return <th key={i} style={{ padding: "8px 10px", textAlign: i >= 2 && i <= 3 ? "right" : "left", borderBottom: "2px solid #ddd" }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {disappeared.map(function(r, i) {
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
                          <td style={{ padding: "5px 10px", fontWeight: 500 }}>{r.name}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: "#888" }}>{r.category}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtYen(r.sales)}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: DC[r.store] || "#666", fontWeight: 500 }}>{r.store}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#333", fontWeight: 600 }}>
              {"📋 全商品データ（" + compareData.length + "件）"}
            </h3>
            <div style={{ maxHeight: 600, overflowX: "auto", overflowY: "auto", borderRadius: 10, border: "1px solid #eee" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: hasCompare ? 900 : 600 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "#f8f7f4", zIndex: 1 }}>
                    <th style={{ padding: "8px 6px", textAlign: "center", borderBottom: "2px solid #ddd", width: 36 }}>{"ABC"}</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid #ddd" }}>{"商品名"}</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid #ddd", width: 55 }}>{"部門"}</th>
                    <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd", background: "rgba(27,67,50,.04)" }}>
                      {"売上"}<div style={{ fontSize: 9, color: "#999", fontWeight: 400 }}>{periods[basePeriod] ? periods[basePeriod].shortLabel : ""}</div>
                    </th>
                    <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd", background: "rgba(27,67,50,.04)" }}>{"数量"}</th>
                    {hasCompare && (
                      <>
                        <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd", background: "rgba(193,68,14,.04)" }}>
                          {"売上"}<div style={{ fontSize: 9, color: "#999", fontWeight: 400 }}>{periods[cmpPeriod1] ? periods[cmpPeriod1].shortLabel : ""}</div>
                        </th>
                        <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd", background: "rgba(193,68,14,.04)" }}>{"数量"}</th>
                        <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd" }}>{"前年比"}</th>
                      </>
                    )}
                    {hasCompare2 && (
                      <>
                        <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd", background: "rgba(74,111,165,.04)" }}>
                          {"売上"}<div style={{ fontSize: 9, color: "#999", fontWeight: 400 }}>{periods[cmpPeriod2] ? periods[cmpPeriod2].shortLabel : ""}</div>
                        </th>
                        <th style={{ padding: "8px 6px", textAlign: "right", borderBottom: "2px solid #ddd" }}>{"比較2比"}</th>
                      </>
                    )}
                    <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid #ddd", width: 50 }}>{"店舗"}</th>
                  </tr>
                </thead>
                <tbody>
                  {compareData.map(function(r, i) {
                    var abcItem = abc.find(function(x) { return x.code === r.code; });
                    var rank = abcItem ? abcItem.rank : "C";
                    return (
                      <tr key={r.code + "_" + i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
                        <td style={{ padding: "5px 6px", textAlign: "center" }}>
                          <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, background: rkC[rank], color: "#fff", fontSize: 10, fontWeight: 600 }}>{rank}</span>
                        </td>
                        <td style={{ padding: "5px 6px", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name}
                          {r.isNew1 && hasCompare && (
                            <span style={{ marginLeft: 6, fontSize: 9, background: "#4a6fa5", color: "#fff", padding: "1px 5px", borderRadius: 6, fontWeight: 600 }}>{"NEW"}</span>
                          )}
                        </td>
                        <td style={{ padding: "5px 6px", fontSize: 10, color: "#888" }}>{r.category}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500, background: "rgba(27,67,50,.02)" }}>{fmtYen(r.baseSales)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", background: "rgba(27,67,50,.02)" }}>{r.baseQty}</td>
                        {hasCompare && (
                          <>
                            <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.cmp1Sales != null ? "#666" : "#ccc", background: "rgba(193,68,14,.02)" }}>
                              {r.cmp1Sales != null ? fmtYen(r.cmp1Sales) : "\u2014"}
                            </td>
                            <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.cmp1Qty != null ? "#666" : "#ccc", background: "rgba(193,68,14,.02)" }}>
                              {r.cmp1Qty != null ? r.cmp1Qty : "\u2014"}
                            </td>
                            <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: r.ratio1 == null ? "#ccc" : r.ratio1 >= 1 ? "#1b4332" : "#c1440e" }}>
                              {r.ratio1 != null ? (r.ratio1 * 100).toFixed(1) + "%" : r.isNew1 ? "NEW" : "\u2014"}
                            </td>
                          </>
                        )}
                        {hasCompare2 && (
                          <>
                            <td style={{ padding: "5px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.cmp2Sales != null ? "#666" : "#ccc", background: "rgba(74,111,165,.02)" }}>
                              {r.cmp2Sales != null ? fmtYen(r.cmp2Sales) : "\u2014"}
                            </td>
                            <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: r.ratio2 == null ? "#ccc" : r.ratio2 >= 1 ? "#1b4332" : "#c1440e" }}>
                              {r.ratio2 != null ? (r.ratio2 * 100).toFixed(1) + "%" : "\u2014"}
                            </td>
                          </>
                        )}
                        <td style={{ padding: "5px 6px", fontSize: 10, color: DC[r.store] || "#666", fontWeight: 500 }}>{r.store}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}


// ════════════════════════════════════
// App
// ════════════════════════════════════
export default function App() {
  var _t = useState("daily"); var tab = _t[0]; var setTab = _t[1];
  var _s = useState(false); var showSettings = _s[0]; var setShowSettings = _s[1];
  var _url = useState(getGasUrl()); var gasUrl = _url[0]; var setGasUrlState = _url[1];

  var tabStyle = function(active) {
    return {
      padding: "10px 22px", border: "none",
      borderBottom: active ? "3px solid #1b4332" : "3px solid transparent",
      background: active ? "rgba(27,67,50,.06)" : "transparent",
      color: active ? "#1b4332" : "#666",
      fontWeight: active ? 700 : 500,
      fontSize: 14, cursor: "pointer", transition: "all .2s", letterSpacing: ".02em"
    };
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f3ef", fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif" }}>
      <style>{"\n@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }\n"}</style>
      <div style={{
        background: "#fff", borderBottom: "1px solid #e8e6e0", padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26 }}>{"🌳"}</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1b4332", letterSpacing: ".04em" }}>{"なぎの木テラス"}</div>
            <div style={{ fontSize: 10, color: "#999", letterSpacing: ".08em" }}>{"売上管理ダッシュボード"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
          <button onClick={function() { setTab("daily"); }} style={tabStyle(tab === "daily")}>{"📈 日別売上推移"}</button>
          <button onClick={function() { setTab("product"); }} style={tabStyle(tab === "product")}>{"📦 商品別分析"}</button>
          <div style={{ width: 1, height: 28, background: "#e8e6e0", margin: "0 8px" }} />
          <button onClick={function() { setShowSettings(!showSettings); }}
            style={{
              padding: "8px 16px", border: "none", borderRadius: 8,
              background: showSettings ? "rgba(27,67,50,.1)" : "transparent",
              color: showSettings ? "#1b4332" : "#999",
              fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
            }}>
            {"⚙️"}
            {gasUrl && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#5cb85c" }} />}
          </button>
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px" }}>
        {showSettings && (
          <div style={{ marginBottom: 20 }}>
            <SettingsPanel onUrlChange={function(u) { setGasUrlState(u); }} />
          </div>
        )}
        {tab === "daily" ? <DailyDashboard /> : <ProductDashboard />}
      </div>
    </div>
  );
}
