import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { gasGet } from '../lib/gas';

/* ══════════════════════════════════════════════════════════
   なぎの木テラス 月次サマリタブ
   - 日別売上データ（getDailyData / localStorage nk_daily3）を月次に集計
   - 売上・客数・客単価を前年同月と比較
   - 当月が途中の場合は、前年も同じ日まで（1日〜n日）で比較する
   ══════════════════════════════════════════════════════════ */

const DEPTS = ['全体', 'キッチン', 'マーケット', 'カフェ'];
const SUB_DEPTS = ['キッチン', 'マーケット', 'カフェ'];
const DC = { '全体': '#1b4332', 'キッチン': '#c1440e', 'マーケット': '#386641', 'カフェ': '#b5651d' };
const PRIOR = '#cfccc2';
const UP = '#2d6a4f';
const DOWN = '#c1440e';
const FY_START_MONTH = 6;

const METRICS = [
  { key: 'sales', label: '売上', unit: '円' },
  { key: 'customers', label: '客数', unit: '人' },
  { key: 'avgSpend', label: '客単価', unit: '円' },
];

const yen = v => '¥' + Math.round(v || 0).toLocaleString();
const ppl = v => Math.round(v || 0).toLocaleString() + '人';
const fmtMetric = (k, v) => (k === 'customers' ? ppl(v) : yen(v));
const man = v => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(v >= 1e6 || v <= -1e6 ? 0 : 1) + '万' : Math.round(v).toLocaleString());
const pct = v => (v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%');
const yoyColor = v => (v == null ? '#999' : v >= 100 ? UP : DOWN);
const signed = (v, f) => (v >= 0 ? '+' : '▲') + f(Math.abs(v));

const ymKey = (y, m) => y + '/' + String(m).padStart(2, '0');
const prevYearYm = ym => ymKey(+ym.slice(0, 4) - 1, +ym.slice(5, 7));
const daysInMonth = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const monthLabel = ym => ym.slice(2, 4) + '/' + ym.slice(5, 7);
const fyOf = ym => {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return m >= FY_START_MONTH ? y : y - 1;
};
const fyLabel = startY => '第' + (startY - 1965) + '期';   // 2026年6月開始 = 第61期

function normDate(s) {
  const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  return m[1] + '/' + m[2].padStart(2, '0') + '/' + m[3].padStart(2, '0');
}

// dept -> ym -> { day -> {sales, customers} } に整形
function buildIndex(data) {
  const idx = {};
  SUB_DEPTS.forEach(d => {
    idx[d] = {};
    const src = data[d] || {};
    Object.keys(src).forEach(k => {
      const r = src[k];
      const dt = normDate((r && r.date) || k);
      if (!dt) return;
      const ym = dt.slice(0, 7), day = +dt.slice(8, 10);
      if (!idx[d][ym]) idx[d][ym] = {};
      idx[d][ym][day] = { sales: +r.sales || 0, customers: +r.customers || 0 };
    });
  });
  return idx;
}

function agg(idx, dept, ym, maxDay) {
  const depts = dept === '全体' ? SUB_DEPTS : [dept];
  let sales = 0, customers = 0, firstDay = 99, lastDay = 0;
  depts.forEach(d => {
    const mm = (idx[d] && idx[d][ym]) || {};
    Object.keys(mm).forEach(k => {
      const day = +k;
      if (maxDay && day > maxDay) return;
      sales += mm[k].sales;
      customers += mm[k].customers;
      if (mm[k].sales > 0) { firstDay = Math.min(firstDay, day); lastDay = Math.max(lastDay, day); }
    });
  });
  return { sales, customers, avgSpend: customers > 0 ? sales / customers : 0, firstDay, lastDay, has: sales > 0 };
}

const ratio = (a, b) => (b > 0 && a > 0 ? (a / b) * 100 : null);

export default function SummaryPanel() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [dept, setDept] = useState('全体');
  const [metric, setMetric] = useState('sales');
  const [period, setPeriod] = useState('recent12');
  const [focus, setFocus] = useState('');

  useEffect(() => {
    let alive = true;
    gasGet('getDailyData').then(res => {
      if (!alive) return;
      if (res && res.data && Object.keys(res.data).length > 0) {
        setData(res.data); setStatus('synced');
      } else {
        try {
          const d = localStorage.getItem('nk_daily3');
          if (d) { setData(JSON.parse(d)); setStatus('local'); return; }
        } catch (e) { /* ignore */ }
        setData({}); setStatus('empty');
      }
    });
    return () => { alive = false; };
  }, []);

  const idx = useMemo(() => (data ? buildIndex(data) : null), [data]);

  // データのある月一覧と最新日
  const meta = useMemo(() => {
    if (!idx) return null;
    const set = {};
    SUB_DEPTS.forEach(d => Object.keys(idx[d]).forEach(ym => { set[ym] = 1; }));
    const months = Object.keys(set).sort();
    if (!months.length) return null;
    const latest = months[months.length - 1];
    const lastDay = agg(idx, '全体', latest).lastDay;
    const partial = lastDay < daysInMonth(latest);
    const fys = Array.from(new Set(months.map(fyOf))).sort((a, b) => b - a);
    return { months, latest, lastDay, partial, fys };
  }, [idx]);

  // 1ヶ月分の行（今年・前年・前年比）。途中月は前年も同日までで比較
  const rowOf = useMemo(() => {
    if (!idx || !meta) return () => null;
    return (ym, dp) => {
      const cut = ym === meta.latest && meta.partial ? meta.lastDay : null;
      const cur = agg(idx, dp, ym, cut);
      const pre = agg(idx, dp, prevYearYm(ym), cut);
      const preComplete = pre.has && pre.firstDay <= 1;
      const yoy = {
        sales: ratio(cur.sales, pre.sales),
        customers: ratio(cur.customers, pre.customers),
        avgSpend: ratio(cur.avgSpend, pre.avgSpend),
      };
      return {
        ym, label: monthLabel(ym), cut, cur, pre, preComplete, yoy,
        preNote: pre.has && !preComplete ? '前年は' + pre.firstDay + '日〜のため参考値' : '',
        // グラフ・期間計に使う前年比（前年が月途中から始まる月は除外）
        yoyFair: preComplete ? yoy : { sales: null, customers: null, avgSpend: null },
      };
    };
  }, [idx, meta]);

  const rangeMonths = useMemo(() => {
    if (!meta) return [];
    if (period === 'recent12') return meta.months.slice(-12);
    const fy = +period.replace('fy', '');
    const out = [];
    for (let i = 0; i < 12; i++) {
      const m = ((FY_START_MONTH - 1 + i) % 12) + 1;
      const y = m >= FY_START_MONTH ? fy : fy + 1;
      out.push(ymKey(y, m));
    }
    return out;
  }, [meta, period]);

  const rows = useMemo(() => rangeMonths.map(ym => rowOf(ym, dept)).filter(Boolean), [rangeMonths, rowOf, dept]);

  // 注目月：既定は最新の「締まった」月
  const defaultFocus = meta ? (meta.partial && meta.months.length > 1 ? meta.months[meta.months.length - 2] : meta.latest) : '';
  const focusYm = focus && meta && meta.months.includes(focus) ? focus : defaultFocus;
  const fr = focusYm ? rowOf(focusYm, dept) : null;
  const deptRows = focusYm ? DEPTS.map(d => ({ dept: d, r: rowOf(focusYm, d) })) : [];

  // 売上増減の分解：客数要因＋客単価要因＝売上差
  const decomp = fr && fr.pre.has ? {
    diff: fr.cur.sales - fr.pre.sales,
    cust: (fr.cur.customers - fr.pre.customers) * fr.pre.avgSpend,
    spend: (fr.cur.avgSpend - fr.pre.avgSpend) * fr.cur.customers,
  } : null;

  const chartData = rows.map(r => ({
    label: r.label + (r.cut ? '*' : ''),
    ym: r.ym,
    今年: r.cur.has ? Math.round(r.cur[metric]) : null,
    前年: r.pre.has ? Math.round(r.pre[metric]) : null,
    前年比: r.cur.has ? r.yoyFair[metric] : null,
  }));
  const yoyData = rows.filter(r => r.cur.has && r.preComplete).map(r => ({
    label: r.label + (r.cut ? '*' : ''),
    売上: r.yoy.sales, 客数: r.yoy.customers, 客単価: r.yoy.avgSpend,
  }));

  // 範囲合計
  const tot = rows.reduce((a, r) => {
    if (!r.cur.has) return a;
    a.cs += r.cur.sales; a.cc += r.cur.customers;
    if (r.preComplete) { a.ps += r.pre.sales; a.pc += r.pre.customers; a.cs2 += r.cur.sales; a.cc2 += r.cur.customers; }
    return a;
  }, { cs: 0, cc: 0, ps: 0, pc: 0, cs2: 0, cc2: 0 });

  if (status === 'loading') return <Card><div style={{ padding: 40, textAlign: 'center', color: '#999' }}>読み込み中…</div></Card>;
  if (!meta) return <Card><div style={{ padding: 40, textAlign: 'center', color: '#999' }}>日別売上データがありません。「日別売上推移」タブでCSVを取り込んでください。</div></Card>;

  const color = DC[dept];
  const mLabel = METRICS.find(m => m.key === metric).label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* コントロール */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DEPTS.map(d => (
              <Pill key={d} active={dept === d} color={DC[d]} onClick={() => setDept(d)}>{d}</Pill>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select value={period} onChange={setPeriod}>
              <option value="recent12">直近12ヶ月</option>
              {meta.fys.map(fy => <option key={fy} value={'fy' + fy}>{fyLabel(fy)}（{fy}/06〜{fy + 1}/05）</option>)}
            </Select>
            <Select value={focusYm} onChange={setFocus}>
              {meta.months.slice().reverse().map(ym => (
                <option key={ym} value={ym}>{ym}{ym === meta.latest && meta.partial ? '（' + meta.lastDay + '日まで）' : ''}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* 注目月のKPI */}
      {fr && (
        <div>
          <div style={{ fontSize: 13, color: '#666', margin: '0 2px 8px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1b4332' }}>{focusYm.replace('/', '年') + '月'}</span>
            <span>{dept}・前年同月比較</span>
            {fr.cut && <Badge>{'1〜' + fr.cut + '日の途中集計（前年も同日まで）'}</Badge>}
            {fr.preNote && <Badge>{fr.preNote}</Badge>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {METRICS.map(m => (
              <KpiCard key={m.key} label={m.label} color={color}
                value={fmtMetric(m.key, fr.cur[m.key])}
                prior={fr.pre.has ? fmtMetric(m.key, fr.pre[m.key]) : '—'}
                yoy={fr.yoy[m.key]}
                diff={fr.pre.has ? signed(fr.cur[m.key] - fr.pre[m.key], v => (m.key === 'customers' ? ppl(v) : yen(v))) : ''}
                active={metric === m.key}
                onClick={() => setMetric(m.key)} />
            ))}
            {decomp && (
              <div style={{ ...cardBase, borderLeft: '4px solid #8a8577' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>売上増減の内訳（前年差）</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: yoyColor(decomp.diff >= 0 ? 100 : 0) }}>{signed(decomp.diff, man)}<span style={{ fontSize: 12 }}>円</span></div>
                <Bar2 label="客数要因" v={decomp.cust} max={Math.max(Math.abs(decomp.cust), Math.abs(decomp.spend))} />
                <Bar2 label="客単価要因" v={decomp.spend} max={Math.max(Math.abs(decomp.cust), Math.abs(decomp.spend))} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 月次推移チャート */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{'📊 月次推移（' + dept + '・' + mLabel + '）'}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {METRICS.map(m => <Pill key={m.key} small active={metric === m.key} color="#1b4332" onClick={() => setMetric(m.key)}>{m.label}</Pill>)}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            onClick={e => { if (e && e.activePayload && e.activePayload[0]) setFocus(e.activePayload[0].payload.ym); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="v" tick={{ fontSize: 11 }} width={56}
              tickFormatter={v => (metric === 'customers' ? v.toLocaleString() : metric === 'sales' ? (v / 10000).toFixed(0) + '万' : '¥' + v.toLocaleString())} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={46} domain={[dataMin => Math.min(80, Math.floor(dataMin / 10) * 10), dataMax => Math.max(130, Math.ceil(dataMax / 10) * 10)]} tickFormatter={v => v + '%'} />
            <Tooltip formatter={(v, n) => (n === '前年比' ? pct(v) : fmtMetric(metric, v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine yAxisId="r" y={100} stroke="#999" strokeDasharray="4 4" />
            <Bar yAxisId="v" dataKey="前年" fill={PRIOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Bar yAxisId="v" dataKey="今年" fill={color} radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Line yAxisId="r" dataKey="前年比" stroke="#d4a017" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>棒：今年／前年（左軸）、線：前年比（右軸）。月をクリックすると上のKPIがその月に切り替わります。{meta.partial ? '　*は途中月（前年も同日までで比較）' : ''}</div>
      </Card>

      {/* 前年比の推移（売上＝客数×客単価） */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 4 }}>{'📈 前年比の推移（' + dept + '）'}</div>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>売上の伸びが「客数」と「客単価」のどちらから来ているかを見る</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={yoyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={46} domain={['auto', 'auto']} tickFormatter={v => v + '%'} />
            <Tooltip formatter={v => pct(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="#999" strokeDasharray="4 4" />
            <Line dataKey="売上" stroke={color} strokeWidth={3} dot={{ r: 3 }} />
            <Line dataKey="客数" stroke="#4a6fa5" strokeWidth={2} dot={{ r: 2 }} />
            <Line dataKey="客単価" stroke="#d4a017" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* 部門別（注目月） */}
      {fr && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 10 }}>{'🏪 部門別　' + focusYm.replace('/', '年') + '月' + (fr.cut ? '（1〜' + fr.cut + '日）' : '')}</div>
          <Table head={['部門', '売上', '前年比', '構成比', '客数', '前年比', '客単価', '前年比']}>
            {deptRows.map(({ dept: d, r }) => {
              const share = deptRows[0].r.cur.sales > 0 ? (r.cur.sales / deptRows[0].r.cur.sales) * 100 : null;
              return (
                <tr key={d} style={{ background: d === '全体' ? '#f7f6f1' : 'transparent', fontWeight: d === '全体' ? 700 : 400, cursor: 'pointer' }} onClick={() => setDept(d)}>
                  <Td left><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: DC[d], marginRight: 6 }} />{d}</Td>
                  <Td>{yen(r.cur.sales)}</Td><YoyTd v={r.yoy.sales} />
                  <Td>{d === '全体' ? '100%' : pct(share)}</Td>
                  <Td>{ppl(r.cur.customers)}</Td><YoyTd v={r.yoy.customers} />
                  <Td>{yen(r.cur.avgSpend)}</Td><YoyTd v={r.yoy.avgSpend} />
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* 月次一覧 */}
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 10 }}>{'📋 月次一覧（' + dept + '）'}</div>
        <Table head={['月', '売上', '前年', '前年比', '客数', '前年比', '客単価', '前年比']}>
          {rows.slice().reverse().map(r => (
            <tr key={r.ym} onClick={() => r.cur.has && setFocus(r.ym)}
              style={{ cursor: r.cur.has ? 'pointer' : 'default', background: r.ym === focusYm ? 'rgba(27,67,50,.07)' : 'transparent', color: r.cur.has ? '#333' : '#bbb' }}>
              <Td left>{r.ym}{r.cut ? <span style={{ fontSize: 10, color: '#999' }}>{'（' + r.cut + '日まで）'}</span> : null}{r.preNote ? <span style={{ fontSize: 10, color: '#b5651d' }}> ※参考</span> : null}</Td>
              <Td>{r.cur.has ? yen(r.cur.sales) : '—'}</Td>
              <Td muted>{r.pre.has ? yen(r.pre.sales) : '—'}</Td>
              <YoyTd v={r.cur.has ? r.yoy.sales : null} />
              <Td>{r.cur.has ? ppl(r.cur.customers) : '—'}</Td>
              <YoyTd v={r.cur.has ? r.yoy.customers : null} />
              <Td>{r.cur.has ? yen(r.cur.avgSpend) : '—'}</Td>
              <YoyTd v={r.cur.has ? r.yoy.avgSpend : null} />
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700, background: '#f7f6f1' }}>
            <Td left>表示期間計</Td>
            <Td>{yen(tot.cs)}</Td>
            <Td muted>{tot.ps ? yen(tot.ps) : '—'}</Td>
            <YoyTd v={ratio(tot.cs2, tot.ps)} />
            <Td>{ppl(tot.cc)}</Td>
            <YoyTd v={ratio(tot.cc2, tot.pc)} />
            <Td>{tot.cc ? yen(tot.cs / tot.cc) : '—'}</Td>
            <YoyTd v={tot.cc2 && tot.pc ? ratio(tot.cs2 / tot.cc2, tot.ps / tot.pc) : null} />
          </tr>
        </Table>
        <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
          POS日別データ（税込）より集計。期間計の前年比は前年データが1ヶ月そろっている月同士で比較（※参考の月はグラフ・期間計の前年比から除外）。
          {status === 'local' ? '　※GASに接続できなかったため、このブラウザに保存されたデータで表示しています。' : ''}
        </div>
      </Card>
    </div>
  );
}

// ── UI parts ─────────────────────────────────────────
const cardBase = { background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', border: '1px solid #ebe9e3' };

function Card({ children }) { return <div style={cardBase}>{children}</div>; }

function Pill({ active, color, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? '4px 12px' : '6px 16px', borderRadius: 999, cursor: 'pointer',
      border: '1px solid ' + (active ? color : '#ddd'), background: active ? color : '#fff',
      color: active ? '#fff' : '#555', fontSize: small ? 12 : 13, fontWeight: active ? 700 : 500,
    }}>{children}</button>
  );
}

function Select({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, background: '#fff', color: '#333' }}>
      {children}
    </select>
  );
}

function Badge({ children }) {
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#fbf3e4', color: '#9a6a1c' }}>{children}</span>;
}

function KpiCard({ label, value, prior, yoy, diff, color, active, onClick }) {
  return (
    <div onClick={onClick} style={{ ...cardBase, borderLeft: '4px solid ' + color, cursor: 'pointer', outline: active ? '2px solid ' + color + '33' : 'none' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#222' }}>{value}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: yoyColor(yoy) }}>{pct(yoy)}</div>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>前年 {prior}</span><span style={{ color: yoyColor(yoy) }}>{diff}</span>
      </div>
    </div>
  );
}

function Bar2({ label, v, max }) {
  const w = max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: '#666' }}>
      <span style={{ width: 62 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#f0eee8', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: w + '%', height: '100%', background: v >= 0 ? UP : DOWN }} />
      </div>
      <span style={{ width: 58, textAlign: 'right', color: v >= 0 ? UP : DOWN }}>{signed(v, man)}</span>
    </div>
  );
}

function Table({ head, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', fontSize: 11, color: '#888', fontWeight: 600, borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, left, muted }) {
  return <td style={{ textAlign: left ? 'left' : 'right', padding: '7px 10px', borderBottom: '1px solid #f3f1ec', whiteSpace: 'nowrap', color: muted ? '#999' : undefined, fontVariantNumeric: 'tabular-nums' }}>{children}</td>;
}

function YoyTd({ v }) {
  const bg = v == null ? 'transparent' : v >= 110 ? 'rgba(45,106,79,.14)' : v >= 100 ? 'rgba(45,106,79,.06)' : v >= 90 ? 'rgba(193,68,14,.07)' : 'rgba(193,68,14,.16)';
  return <td style={{ textAlign: 'right', padding: '7px 10px', borderBottom: '1px solid #f3f1ec', color: yoyColor(v), fontWeight: 600, background: bg, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{pct(v)}</td>;
}
