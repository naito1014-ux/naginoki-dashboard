import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
// ↓ 既存の src/lib/gas.js のエクスポート名に合わせてください
import { gasGet, gasPostFull } from '../lib/gas';

/* ══════════════════════════════════════════════════════════
   なぎの木テラス 経営指標タブ
   - 損益計算書(.xlsx)を「期」ごとに切り分けて予実管理表を描画
   - 期首は6月。1ファイルに前期の残シートと当期のシートが混在していても分離する
   - 前期の期首月が当期シートに上書きされている場合は「前年」列から復元する
   - AI分析レポートは既存の getAnalysisReport (type:'pl') を利用
   ══════════════════════════════════════════════════════════ */

const PL_KEY = 'nk_pl2';          // 期対応でスキーマが変わったため旧 nk_pl1 とは別キー
const ACCENT = '#4a6fa5';
const FY_START_MONTH = 6;         // 期首月

const DEPT_ALIAS = [
  ['total',   ['合計', '合  計', '総合計']],
  ['cafe',    ['カフェ']],
  ['market',  ['マーケット']],
  ['kitchen', ['キッチン']],
];
const DEPT_NAMES = { total: '全体', cafe: 'カフェ', market: 'マーケット', kitchen: 'キッチン' };
const DEPTS = ['total', 'cafe', 'market', 'kitchen'];
const norm = v => String(v == null ? '' : v).replace(/[\s\u3000]/g, '');
const ymOf = (y, m) => y + '-' + String(m).padStart(2, '0');
const startYearOf = (y, m) => (m >= FY_START_MONTH ? y : y - 1);

export function parsePlWorkbook(arrayBuffer, fileName) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const accSet = {};
  const real = {};        // ym -> dept -> acc -> [計画, 実績, 前年]
  const recovered = {};   // ym -> dept -> acc -> [0, 実績, 0]（翌期シートの前年列から復元）

  wb.SheetNames.forEach(sn => {
    if (norm(sn).indexOf('合計') === 0) return;          // 累計シートは読み飛ばす
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null });
    if (!rows.length) return;

    const md = String((rows[0] && rows[0][0]) || '').match(/令和(\d+)年(\d+)月/);
    if (!md) return;
    const y = 2018 + parseInt(md[1], 10);
    const m = parseInt(md[2], 10);
    const ym = ymOf(y, m);
    const prevYm = ymOf(y - 1, m);

    const head = rows[1] || [];
    const col = {};
    head.forEach((cell, idx) => {
      const t = norm(cell);
      if (!t) return;
      DEPT_ALIAS.forEach(([key, names]) => {
        if (col[key] == null && names.some(n => t === norm(n))) col[key] = idx;
      });
    });
    if (col.total == null) return;
    if (real[ym]) return;                                 // 同月の重複シートは先勝ち

    const cur = {}, prv = {};
    DEPTS.forEach(d => { cur[d] = {}; prv[d] = {}; });

    rows.forEach(r => {
      if (!r || !/^\d{4}$/.test(String(r[0] || '').trim())) return;
      const name = String(r[1] || '').replace(/[\s\u3000]+$/, '').trim();
      if (!name) return;
      accSet[name] = 1;
      Object.keys(col).forEach(d => {
        const c = col[d];
        const n = o => (typeof r[c + o] === 'number' ? Math.round(r[c + o]) : 0);
        cur[d][name] = [n(0), n(1), n(2)];
        prv[d][name] = [0, n(2), 0];
      });
    });
    real[ym] = cur;
    if (!recovered[prevYm]) recovered[prevYm] = prv;
  });

  const realYms = Object.keys(real);
  if (!realYms.length) throw new Error('月次シートが見つかりませんでした。損益計算書のファイルか確認してください。');

  // 実データのある月から期を洗い出す（前年列しかない期は作らない）
  const seen = {};
  realYms.forEach(ym => {
    const parts = ym.split('-').map(Number);
    seen[startYearOf(parts[0], parts[1])] = 1;
  });
  const years = Object.keys(seen).map(Number).sort((a, b) => b - a);   // 新しい期が先頭

  const fyM = String(fileName || '').match(/第?\s*(\d+)\s*期/);
  const latestNo = fyM ? parseInt(fyM[1], 10) : null;
  const accounts = Object.keys(accSet).sort();

  const periods = years.map((sy, idx) => {
    const months = [];
    for (let i = 0; i < 12; i++) {
      const m = ((FY_START_MONTH - 1 + i) % 12) + 1;
      const y = m >= FY_START_MONTH ? sy : sy + 1;
      const ym = ymOf(y, m);
      const src = real[ym] || recovered[ym] || null;
      months.push({
        ym, label: String(m).padStart(2, '0') + '月',
        has: !!src, recovered: !real[ym] && !!recovered[ym], src,
      });
    }
    const data = {};
    DEPTS.forEach(d => {
      data[d] = {};
      accounts.forEach(a => {
        data[d][a] = months.map(mo => (mo.src && mo.src[d] && mo.src[d][a]) || [0, 0, 0]);
      });
    });
    const no = latestNo != null ? latestNo - idx : null;
    return {
      key: String(sy),
      label: no != null ? '第' + no + '期' : sy + '年度',
      period: sy + '年06月 〜 ' + (sy + 1) + '年05月',
      filled: months.filter(mo => mo.has).length,
      recoveredCount: months.filter(mo => mo.recovered).length,
      months: months.map(mo => ({ ym: mo.ym, label: mo.label, has: mo.has, recovered: mo.recovered })),
      data,
    };
  });

  return {
    fyStartMonth: FY_START_MONTH,
    periods, accounts,
    deptNames: DEPT_NAMES, depts: DEPTS,
    updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
}

/* ── 指標の定義 ─────────────────────────────────────── */
const HR   = ['役員報酬', '給料手当', '雑給', '賞与', '退職金', '法定福利費', '福利厚生費', '賞与引当金繰入'];
const VARC = ['荷造運賃', '支払手数料', '消耗品費', '衛生費'];
const SEMI = ['雑給', '水道光熱費'];

// mIdx = 月インデックス / null なら期の累計（データのある月だけ足す）
// skipRecovered = true のとき、前年列から復元した月（計画も前年も持たない）を除外する
function makePick(period, dept, mIdx, skipRecovered) {
  const src = (period.data && period.data[dept]) || {};
  const ms = period.months;
  return acc => {
    const rows = src[acc];
    if (!rows) return [0, 0, 0];
    if (mIdx === null) {
      const t = [0, 0, 0];
      rows.forEach((x, i) => {
        if (!ms[i].has) return;
        if (skipRecovered && ms[i].recovered) return;
        t[0] += x[0]; t[1] += x[1]; t[2] += x[2];
      });
      return t;
    }
    return rows[mIdx] || [0, 0, 0];
  };
}
const sumOf = (v, list, i) => list.reduce((s, a) => s + v(a)[i], 0);
const rate = (a, b) => (b ? (a / b) * 100 : 0);

const M = {
  sales:      (v, i) => v('純売上高')[i],
  salesGoods: (v, i) => v('売上高')[i],
  salesRent:  (v, i) => v('家賃売上高')[i] + v('共益費収入')[i],
  cogs:       (v, i) => v('売上原価')[i],
  gross:      (v, i) => v('売上総利益')[i],
  sga:        (v, i) => v('販売費・一般管理費計')[i],
  labor:      (v, i) => sumOf(v, HR, i),
  dep:        (v, i) => v('減価償却費')[i],
  opInc:      (v, i) => v('営業利益')[i],
  ordInc:     (v, i) => v('経常利益')[i],
};
M.sgaOther   = (v, i) => M.sga(v, i) - M.labor(v, i) - M.dep(v, i);
M.ebitda     = (v, i) => M.opInc(v, i) + M.dep(v, i);
M.cogsRate   = (v, i) => rate(M.cogs(v, i), M.sales(v, i));
M.grossRate  = (v, i) => rate(M.gross(v, i), M.sales(v, i));
M.laborRate  = (v, i) => rate(M.labor(v, i), M.sales(v, i));
M.laborShare = (v, i) => rate(M.labor(v, i), M.gross(v, i));
M.fl         = (v, i) => rate(M.cogs(v, i) + M.labor(v, i), M.sales(v, i));
M.opRate     = (v, i) => rate(M.opInc(v, i), M.sales(v, i));
M.bep = (v, i) => {
  const s = M.sales(v, i);
  if (!s) return 0;
  const varCost = M.cogs(v, i) + sumOf(v, VARC, i) + 0.5 * sumOf(v, SEMI, i);
  const fixed = M.sga(v, i) - (varCost - M.cogs(v, i));
  const mr = 1 - varCost / s;
  return mr > 0 ? fixed / mr : 0;
};
M.bepRatio = (v, i) => rate(M.bep(v, i), M.sales(v, i));

const ROWS = [
  { k: 'sales',      lab: '純売上高',       t: 'money', grp: true },
  { k: 'salesGoods', lab: '商品売上',       t: 'money', ch: true },
  { k: 'salesRent',  lab: '家賃・共益費',   t: 'money', ch: true },
  { k: 'cogs',       lab: '売上原価',       t: 'money' },
  { k: 'cogsRate',   lab: '原価率',         t: 'pct' },
  { k: 'gross',      lab: '売上総利益',     t: 'money', grp: true },
  { k: 'grossRate',  lab: '粗利率',         t: 'pct' },
  { k: 'sga',        lab: '販管費計',       t: 'money', grp: true },
  { k: 'labor',      lab: '人件費',         t: 'money', ch: true },
  { k: 'dep',        lab: '減価償却費',     t: 'money', ch: true },
  { k: 'sgaOther',   lab: 'その他販管費',   t: 'money', ch: true },
  { k: 'laborRate',  lab: '人件費率',       t: 'pct' },
  { k: 'laborShare', lab: '労働分配率',     t: 'pct' },
  { k: 'fl',         lab: 'FL比率',         t: 'pct' },
  { k: 'opInc',      lab: '営業利益',       t: 'money', grp: true, hl: true },
  { k: 'opRate',     lab: '営業利益率',     t: 'pct' },
  { k: 'ebitda',     lab: 'EBITDA',         t: 'money', grp: true },
  { k: 'ordInc',     lab: '経常利益',       t: 'money' },
  { k: 'bep',        lab: '損益分岐点売上', t: 'money', dim: true },
  { k: 'bepRatio',   lab: '損益分岐点比率', t: 'pct',   dim: true },
];
const LOWER_BETTER = { cogs: 1, cogsRate: 1, sga: 1, labor: 1, dep: 1, sgaOther: 1, laborRate: 1, laborShare: 1, fl: 1, bep: 1, bepRatio: 1 };

/* ── 表示ヘルパー ───────────────────────────────────── */
const cma = n => Math.round(n).toLocaleString('ja-JP');
const money = (n, u) => (u === 'k' ? cma(n / 1000) : cma(n));
const signed = (n, f) => (n > 0 ? '+' : n < 0 ? '−' : '±') + f(Math.abs(n));
const diffColor = (n, lower) => (Math.abs(n) < 0.5 ? '#aaa' : (lower ? n < 0 : n > 0) ? '#386641' : '#c1440e');

const cardBox = extra => ({
  background: '#fff', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,.04)', padding: 24, ...(extra || {}),
});
const pill = (on, color) => ({
  padding: '7px 18px', border: on ? 'none' : '1px solid #d4d0c8', borderRadius: 20,
  background: on ? color || '#1b4332' : '#fff', color: on ? '#fff' : '#666',
  fontSize: 13, fontWeight: on ? 600 : 400, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
});

function StatCard({ label, value, unit, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: '#fff', borderRadius: 14, padding: '18px 22px',
                  boxShadow: '0 2px 12px rgba(0,0,0,.04)', borderLeft: '4px solid ' + color }}>
      <div style={{ fontSize: 11, color: '#999', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a' }}>
        {value}<span style={{ fontSize: 12, color: '#aaa', marginLeft: 2 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ── AI分析レポート ─────────────────────────────────── */
function PlAnalysis({ periodLabel, dept, monthLabel, snapshot }) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');
  const [cached, setCached] = useState(false);
  const [genAt, setGenAt] = useState('');
  const deptLabel = DEPT_NAMES[dept];
  const target = periodLabel + ' ' + monthLabel;

  useEffect(() => { setReport(null); setErr(''); }, [dept, monthLabel, periodLabel]);

  function run(force) {
    setLoading(true); setErr('');
    if (force) setReport(null);
    gasPostFull({
      action: 'getAnalysisReport', type: 'pl',
      dept: deptLabel, month: target, force: !!force, kpi: snapshot,
    }).then(res => {
      setLoading(false);
      if (!res || !res.ok) { setErr((res && res.error) || 'レポートの取得に失敗しました'); return; }
      setReport(res.report || null);
      setCached(res.cached === true);
      setGenAt(res.generatedAt || '');
    });
  }

  const list = (title, items, color) => {
    if (!items || !Array.isArray(items) || !items.length) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#888', fontWeight: 700, marginBottom: 8, letterSpacing: '.04em' }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: 7, flexShrink: 0 }} />
              <div style={{ fontSize: 13.5, color: '#444', lineHeight: 1.7 }}>{String(t)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={cardBox({ marginTop: 20 })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: '#333', fontWeight: 600 }}>📊 AI分析レポート</h3>
        <span style={{ fontSize: 10, color: '#fff', background: ACCENT, borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>経営指標</span>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 14, lineHeight: 1.6 }}>
        前年との差、販管費の増減、原価率、人件費、損益分岐点までを踏まえてAIが分析します。確定済みの月は2回目以降キャッシュ表示（追加コストなし）。
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run(false)} disabled={loading} style={pill(true, ACCENT)}>
          {report ? 'レポート表示' : '分析する'}
        </button>
        {report && <button onClick={() => run(true)} disabled={loading} style={pill(false)}>再生成</button>}
      </div>

      {loading && (
        <div style={{ marginTop: 16, padding: '28px 20px', textAlign: 'center', background: '#fafaf8', borderRadius: 12, border: '1px solid #eee' }}>
          <div style={{ fontSize: 15, color: '#666', fontWeight: 500 }}>🤖 AI分析中...（初回は30秒ほどかかります）</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>{deptLabel}「{target}」を分析しています</div>
        </div>
      )}
      {err && !loading && (
        <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 10, background: '#fdf0ec',
                      border: '1px solid #f0c4b4', color: '#c1440e', fontSize: 13, lineHeight: 1.6 }}>⚠️ {err}</div>
      )}
      {report && !loading && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '3px 10px',
                           background: cached ? '#eef2f7' : '#eaf3ee', color: cached ? '#4a6fa5' : '#1b4332' }}>
              {cached ? '💾 キャッシュから表示' : '✨ 新規生成'}{genAt ? '（' + genAt + '）' : ''}
            </span>
            <span style={{ fontSize: 11, color: '#aaa' }}>{deptLabel}　{target} 分析</span>
          </div>
          {report.summary && (
            <div style={{ marginBottom: 16, padding: '16px 18px', borderRadius: 12,
                          background: 'rgba(74,111,165,.05)', border: '1px solid rgba(74,111,165,.15)' }}>
              <div style={{ fontSize: 12, color: ACCENT, fontWeight: 700, marginBottom: 6, letterSpacing: '.04em' }}>サマリー</div>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.75 }}>{report.summary}</div>
            </div>
          )}
          {report.yoy && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 700, marginBottom: 6, letterSpacing: '.04em' }}>📈 前年との比較</div>
              <div style={{ fontSize: 13.5, color: '#444', lineHeight: 1.75, paddingLeft: 2 }}>{report.yoy}</div>
            </div>
          )}
          {list('✅ ファクト（データが示す事実）', report.facts, '#1b4332')}
          {list('💡 仮説（変動の要因）', report.hypotheses, '#b5651d')}
          {list('📋 今後のタスク案', report.tasks, '#4a6fa5')}
          <div style={{ marginTop: 14, fontSize: 10, color: '#ccc' }}>
            ※ AIによる分析です。数値の裏付けを確認のうえ経営判断にご活用ください。
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 本体 ───────────────────────────────────────────── */
export default function KpiPanel() {
  const [pl, setPl] = useState(null);
  const [pKey, setPKey] = useState('');
  const [dept, setDept] = useState('total');
  const [mode, setMode] = useState('plan');
  const [unit, setUnit] = useState('k');
  const [monthIdx, setMonthIdx] = useState(-1);      // -1 = 期累計
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => {
    const apply = data => {
      if (!data || !data.periods || !data.periods.length) return false;
      setPl(data);
      setPKey(data.periods[0].key);
      return true;
    };
    Promise.resolve(gasGet('getPlData')).then(res => {
      if (!apply(res && res.pl)) {
        try { apply(JSON.parse(localStorage.getItem(PL_KEY))); } catch { /* noop */ }
      }
    }).catch(() => {
      try { apply(JSON.parse(localStorage.getItem(PL_KEY))); } catch { /* noop */ }
    }).then(() => setLoadingData(false));
  }, []);

  const handleFiles = useCallback(files => {
    if (!files || !files.length) return;
    const f = files[0];
    setMsg('');
    f.arrayBuffer().then(buf => {
      let parsed;
      try { parsed = parsePlWorkbook(buf, f.name); }
      catch (e) { setMsg('❌ ' + (e.message || '読み込みに失敗しました')); return; }
      setPl(parsed);
      setPKey(parsed.periods[0].key);
      setMonthIdx(-1);
      try { localStorage.setItem(PL_KEY, JSON.stringify(parsed)); } catch { /* noop */ }
      setMsg('✅ ' + parsed.periods.map(p => p.label + '（' + p.filled + 'ヶ月）').join('、') + ' を取り込みました');
      gasPostFull({ action: 'savePlData', pl: parsed }).then(r => {
        if (!r || !r.ok) setMsg(m => m + '　※スプレッドシートへの保存は未完了です');
      });
    });
  }, []);

  const period = useMemo(
    () => (pl ? pl.periods.find(p => p.key === pKey) || pl.periods[0] : null),
    [pl, pKey]
  );
  const months = (period && period.months) || [];
  const fyPick = useMemo(() => (period ? makePick(period, dept, null) : null), [period, dept]);
  const cmpPick = useMemo(
    () => (period ? makePick(period, dept, null, true) : null),
    [period, dept]
  );
  const mPicks = useMemo(
    () => (period ? months.map((_, i) => makePick(period, dept, i)) : []),
    [period, dept, months]
  );

  const snapshot = useMemo(() => {
    if (!period) return null;
    // すべての指標を { 実績, 前年 } の対で渡す。計画は乖離が大きく分析に使わないため含めない
    const pair = (v, fn, round) => ({
      実績: round ? Math.round(fn(v, 1)) : +fn(v, 1).toFixed(1),
      前年: round ? Math.round(fn(v, 2)) : +fn(v, 2).toFixed(1),
    });
    const kpiOf = v => ({
      売上:           pair(v, M.sales, true),
      売上原価:       pair(v, M.cogs, true),
      売上総利益:     pair(v, M.gross, true),
      販管費:         pair(v, M.sga, true),
      人件費:         pair(v, M.labor, true),
      減価償却費:     pair(v, M.dep, true),
      その他販管費:   pair(v, M.sgaOther, true),
      営業利益:       pair(v, M.opInc, true),
      経常利益:       pair(v, M.ordInc, true),
      EBITDA:         pair(v, M.ebitda, true),
      原価率:         pair(v, M.cogsRate),
      粗利率:         pair(v, M.grossRate),
      人件費率:       pair(v, M.laborRate),
      労働分配率:     pair(v, M.laborShare),
      FL比率:         pair(v, M.fl),
      営業利益率:     pair(v, M.opRate),
      損益分岐点売上: pair(v, M.bep, true),
      損益分岐点比率: pair(v, M.bepRatio),
    });
    const target = monthIdx < 0 ? fyPick : mPicks[monthIdx];
    const trend = [];
    months.forEach((m, i) => {
      if (!m.has) return;
      const v = mPicks[i];
      trend.push({
        月: m.ym,
        売上: Math.round(M.sales(v, 1)), 売上前年: Math.round(M.sales(v, 2)),
        販管費: Math.round(M.sga(v, 1)), 販管費前年: Math.round(M.sga(v, 2)),
        人件費: Math.round(M.labor(v, 1)), 人件費前年: Math.round(M.labor(v, 2)),
        営業利益: Math.round(M.opInc(v, 1)), 営業利益前年: Math.round(M.opInc(v, 2)),
        原価率: +M.cogsRate(v, 1).toFixed(1),
        損益分岐点比率: +M.bepRatio(v, 1).toFixed(1),
      });
    });
    return {
      期: period.label, 期間: period.period, 確定月数: period.filled, 部門: DEPT_NAMES[dept],
      対象: monthIdx < 0 ? '期累計（' + period.filled + 'ヶ月）' : months[monthIdx].ym,
      注記: '期累計KPIは、前年データを持つ月だけで集計した比較用の値です。期の実績総額は「期累計実績総額」を参照してください。前年の値がすべて0の月は前年データが存在しない月です。',
      対象KPI: kpiOf(target),
      期累計KPI: kpiOf(cmpPick),
      期累計実績総額: {
        売上: Math.round(M.sales(fyPick, 1)),
        営業利益: Math.round(M.opInc(fyPick, 1)),
        EBITDA: Math.round(M.ebitda(fyPick, 1)),
        対象月数: period.filled,
        比較可能月数: period.filled - period.recoveredCount,
      },
      月次推移: trend,
      部門別: DEPTS.filter(d => d !== 'total').map(d => ({
        部門: DEPT_NAMES[d], ...kpiOf(makePick(period, d, null)),
      })),
    };
  }, [period, dept, monthIdx, months, fyPick, cmpPick, mPicks]);

  const chartData = useMemo(
    () => months.map((m, i) => (m.has ? {
      name: m.label,
      売上: Math.round(M.sales(mPicks[i], 1) / 1000),
      計画: Math.round(M.sales(mPicks[i], 0) / 1000) || null,
      前年: Math.round(M.sales(mPicks[i], 2) / 1000) || null,
      営業利益: Math.round(M.opInc(mPicks[i], 1) / 1000),
    } : { name: m.label, 売上: null, 計画: null, 前年: null, 営業利益: null })),
    [months, mPicks]
  );

  /* ── 未取込 ── */
  if (!pl) {
    return (
      <div style={cardBox()}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#333', fontWeight: 600 }}>💹 経営指標</h3>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16, lineHeight: 1.6 }}>
          {loadingData
            ? '読み込み中…'
            : '会計ソフトから出力した損益計算書（.xlsx）をドロップすると、期ごとの予実管理表とAI分析が使えるようになります。期首は6月として集計します。'}
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{ border: '2px dashed ' + (drag ? '#1b4332' : '#ccc'), borderRadius: 14, padding: '28px 20px',
                   textAlign: 'center', cursor: 'pointer', background: drag ? 'rgba(27,67,50,.03)' : '#fafaf8', transition: 'all .2s' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => handleFiles(e.target.files)} />
          <div style={{ fontSize: 26, marginBottom: 6 }}>📊</div>
          <div style={{ fontSize: 13, color: '#888' }}>損益計算書（.xlsx）をドロップ</div>
        </div>
        {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith('✅') ? '#1b4332' : '#c1440e' }}>{msg}</div>}
      </div>
    );
  }

  const cellOf = (row, v, isFy, key, has, cmp) => {
    const base = {
      borderBottom: '1px solid #eee', padding: '7px 10px', textAlign: 'right',
      fontVariantNumeric: 'tabular-nums', lineHeight: 1.35,
      background: isFy ? (row.grp ? '#efece4' : '#faf8f4') : row.hl ? '#fdf5f0' : row.grp ? '#f4f2ec' : 'transparent',
      borderLeft: isFy ? '2px solid #d4d0c8' : 'none', fontWeight: row.grp || isFy ? 700 : 400,
      color: row.dim ? '#999' : '#333',
    };
    if (!has) return <td key={key} style={{ ...base, color: '#d4d0c8', fontWeight: 400 }}>–</td>;

    const act = M[row.k](v, 1);
    const top = row.t === 'money' ? money(act, unit) : act.toFixed(1) + '%';
    let sub = '', color = '#aaa';
    if (mode === 'ratio') {
      if (row.t === 'money') sub = rate(act, M.sales(v, 1)).toFixed(1) + '%';
    } else {
      // cmp が渡された場合は、計画・前年を持つ月だけで差を取る
      const cv = cmp || v;
      const b = M[row.k](cv, mode === 'plan' ? 0 : 2);
      if (b !== 0) {
        const d = M[row.k](cv, 1) - b;
        sub = row.t === 'money' ? signed(d, x => money(x, unit)) : signed(d, x => x.toFixed(1) + 'pt');
        color = diffColor(row.t === 'money' ? d / 1000 : d, LOWER_BETTER[row.k]);
      }
    }
    return (
      <td key={key} style={base} title={cmp ? '差は計画・前年のある月のみで算出' : undefined}>
        <span style={{ display: 'block' }}>{top}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, marginTop: 1, color }}>{sub}</span>}
      </td>
    );
  };

  const cmpOn = period.recoveredCount > 0 && mode !== 'ratio';
  const s = M.sales(fyPick, 1);
  const sp = M.sales(cmpPick, 0), sy = M.sales(cmpPick, 2), sCmp = M.sales(cmpPick, 1);
  const op = M.opInc(fyPick, 1);
  const opp = M.opInc(cmpPick, 0), opCmp = M.opInc(cmpPick, 1);
  const bepR = M.bepRatio(fyPick, 1);
  const modeLabel = mode === 'plan' ? '計画との差' : mode === 'prior' ? '前年との差' : '売上構成比';
  const cum = period.filled === 12 ? '通期' : period.filled + 'ヶ月累計';

  return (
    <div>
      {/* 期・部門・表示の切替 */}
      <div style={cardBox({ padding: 18, marginBottom: 16 })}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {pl.periods.map(p => (
            <button key={p.key} onClick={() => { setPKey(p.key); setMonthIdx(-1); }} style={pill(pKey === p.key, ACCENT)}>
              {p.label}
              <span style={{ fontSize: 11, marginLeft: 6, opacity: .75 }}>
                {p.filled === 12 ? '通期' : p.filled + 'ヶ月'}
              </span>
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: '#aaa', marginLeft: 4 }}>{period.period}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {DEPTS.map(d => (
            <button key={d} onClick={() => setDept(d)} style={pill(dept === d)}>{DEPT_NAMES[d]}</button>
          ))}
          <div style={{ width: 1, height: 22, background: '#e8e6e0', margin: '0 4px' }} />
          {[['plan', '予算差'], ['prior', '前年差'], ['ratio', '売上比']].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} style={pill(mode === k, '#c1440e')}>{l}</button>
          ))}
          <div style={{ width: 1, height: 22, background: '#e8e6e0', margin: '0 4px' }} />
          {[['k', '千円'], ['yen', '円']].map(([k, l]) => (
            <button key={k} onClick={() => setUnit(k)} style={pill(unit === k)}>{l}</button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>上段＝実績／下段＝{modeLabel}</div>
        </div>
      </div>

      {/* サマリー */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label={'純売上高（' + cum + '）'} value={cma(s / 1000)} unit="千円" color="#1b4332"
                  sub={(sp ? '計画比 ' + rate(sCmp, sp).toFixed(1) + '%　' : '') + (sy ? '前年比 ' + rate(sCmp, sy).toFixed(0) + '%' : '')} />
        <StatCard label="営業利益" value={cma(op / 1000)} unit="千円" color={op >= 0 ? '#386641' : '#c1440e'}
                  sub={opp ? '計画差 ' + signed((opCmp - opp) / 1000, cma) + '千円' : '計画データなし'} />
        <StatCard label="EBITDA（償却前）" value={cma(M.ebitda(fyPick, 1) / 1000)} unit="千円" color="#4a6fa5"
                  sub={'減価償却 ' + cma(M.dep(fyPick, 1) / 1000) + '千円を加算'} />
        <StatCard label="労働分配率" value={M.laborShare(fyPick, 1).toFixed(1)} unit="%" color="#b5651d"
                  sub={'人件費 ' + cma(M.labor(fyPick, 1) / 1000) + '千円'} />
        <StatCard label="損益分岐点比率" value={bepR.toFixed(1)} unit="%" color={bepR <= 100 ? '#386641' : '#c1440e'}
                  sub={'BEP売上 ' + cma(M.bep(fyPick, 1) / 1000) + '千円'} />
      </div>

      {/* 予実テーブル */}
      <div style={cardBox({ padding: 0, overflow: 'hidden' })}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={{ background: '#f8f7f4', borderBottom: '1px solid #d4d0c8', padding: '10px', textAlign: 'left',
                             position: 'sticky', left: 0, zIndex: 3, fontSize: 11.5, color: '#4a463f', minWidth: 130 }}>項目</th>
                {months.map(m => (
                  <th key={m.ym} title={m.ym} style={{ background: '#f8f7f4', borderBottom: '1px solid #d4d0c8', padding: '10px',
                                                       textAlign: 'right', fontSize: 11.5, color: m.has ? '#4a463f' : '#c4bfb4' }}>
                    {m.label}{m.recovered ? <span style={{ fontSize: 9, color: '#b5651d', marginLeft: 2 }}>*</span> : null}
                  </th>
                ))}
                <th style={{ background: '#f2efe9', borderBottom: '1px solid #d4d0c8', borderLeft: '2px solid #d4d0c8',
                             padding: '10px', textAlign: 'right', fontSize: 11.5, color: '#4a463f' }}>{cum}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => (
                <tr key={row.k}>
                  <td style={{ borderBottom: '1px solid #eee', borderRight: '1px solid #d4d0c8', padding: '7px 10px',
                               paddingLeft: row.ch ? 24 : 10, position: 'sticky', left: 0, zIndex: 1,
                               background: row.hl ? '#fdf5f0' : row.grp ? '#f4f2ec' : '#fff',
                               fontWeight: row.grp ? 700 : 400, color: row.dim ? '#999' : '#333' }}>{row.lab}</td>
                  {mPicks.map((v, i) => cellOf(row, v, false, i, months[i].has))}
                  {cellOf(row, fyPick, true, 'fy', true, cmpOn ? cmpPick : null)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {period.recoveredCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#b5651d' }}>
          * 印の月は、翌期シートの前年列から復元した実績です。計画と前年を持たないため、累計の差と計画比・前年比はこの月を除いて算出しています。
        </div>
      )}

      {/* チャート */}
      <div style={cardBox({ marginTop: 16 })}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: '#333', fontWeight: 600 }}>月次の売上と営業利益</h3>
        <div style={{ fontSize: 11.5, color: '#999', marginBottom: 14 }}>単位：千円。棒＝売上実績／線＝計画・前年。</div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} axisLine={{ stroke: '#e8e6e0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={v => cma(v) + '千円'} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="売上" fill="#c1440e" radius={[3, 3, 0, 0]} barSize={22} />
              <Line dataKey="計画" stroke="#1b4332" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              <Line dataKey="前年" stroke="#9a958a" strokeWidth={1.4} strokeDasharray="4 3" dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ width: '100%', height: 160, marginTop: 8 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} axisLine={{ stroke: '#e8e6e0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={v => cma(v) + '千円'} />
              <ReferenceLine y={0} stroke="#c9c4b8" />
              {/* 負値バーは Cell で色分けする。カスタム shape は height が負のまま渡り描画されない */}
              <Bar dataKey="営業利益" radius={[3, 3, 0, 0]} barSize={22}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={(d.営業利益 || 0) >= 0 ? '#386641' : '#c1440e'} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI分析 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '20px 0 -8px' }}>
        <span style={{ fontSize: 12, color: '#888' }}>分析対象</span>
        <button onClick={() => setMonthIdx(-1)} style={pill(monthIdx === -1, ACCENT)}>{cum}</button>
        {months.map((m, i) => (m.has
          ? <button key={m.ym} onClick={() => setMonthIdx(i)} style={pill(monthIdx === i, ACCENT)}>{m.label}</button>
          : null))}
      </div>
      <PlAnalysis
        periodLabel={period.label}
        dept={dept}
        monthLabel={monthIdx < 0 ? cum : months[monthIdx].ym}
        snapshot={snapshot}
      />

      {/* データ管理 */}
      <div style={cardBox({ marginTop: 16 })}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#333', fontWeight: 600 }}>損益計算書データ</h3>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.8 }}>
          {pl.periods.map(p => (
            <div key={p.key}>
              {p.label}　{p.period}　{p.filled === 12 ? '通期確定' : p.filled + 'ヶ月確定'}
              {p.recoveredCount > 0 ? '（うち' + p.recoveredCount + 'ヶ月は前年列から復元）' : ''}
            </div>
          ))}
          {pl.updatedAt && <div style={{ color: '#bbb' }}>最終取込 {pl.updatedAt}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => fileRef.current && fileRef.current.click()} style={pill(true)}>ファイルを取り込む</button>
          <button onClick={() => {
            if (!window.confirm('取り込んだ損益計算書データを削除しますか？')) return;
            setPl(null);
            try { localStorage.removeItem(PL_KEY); } catch { /* noop */ }
          }} style={pill(false)}>データを削除</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => handleFiles(e.target.files)} />
        </div>
        {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith('✅') ? '#1b4332' : '#c1440e' }}>{msg}</div>}
        <div style={{ marginTop: 14, fontSize: 10.5, color: '#bbb', lineHeight: 1.8 }}>
          期首6月で期を区切っています。1つのファイルに前期の残シートと当期のシートが混在していても、見出しの年月をもとに期ごとに分けて集計します。<br />
          人件費＝役員報酬・給料手当・雑給・賞与・退職金・法定福利費・福利厚生費／労働分配率＝人件費÷売上総利益／FL比率＝（売上原価＋人件費）÷純売上高／EBITDA＝営業利益＋減価償却費。
          損益分岐点は勘定科目法（変動費＝売上原価・荷造運賃・支払手数料・消耗品費・衛生費、雑給と水道光熱費は50%を変動費として算入）。
        </div>
      </div>
    </div>
  );
}
