import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { gasGet } from '../lib/gas';

/* ══════════════════════════════════════════════════════════
   なぎの木テラス 月次サマリタブ
   - 日別売上データ（getDailyData / localStorage nk_daily3）を月次に集計
   - 期首（6月）合わせ：表示は期単位（6月〜翌5月）、累計は期首から選択月まで
   - 売上・客数・客単価を前年同月／前年同期と比較
   - 平日／土日祝に分けた分析（日数が年で違うため1日平均で比較）
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
  { key: 'sales', label: '売上' },
  { key: 'customers', label: '客数' },
  { key: 'avgSpend', label: '客単価' },
];
const DAY_TYPES = [
  { key: 'all', label: '全日' },
  { key: 'weekday', label: '平日' },
  { key: 'holiday', label: '土日祝' },
];

// 国民の祝日・振替休日（土日は曜日で判定するので、ここは平日に当たる祝日が主）
const HOLIDAYS = new Set([
  '2024/01/01', '2024/01/08', '2024/02/12', '2024/02/23', '2024/03/20', '2024/04/29', '2024/05/03', '2024/05/06',
  '2024/07/15', '2024/08/12', '2024/09/16', '2024/09/23', '2024/10/14', '2024/11/04', '2024/11/23',
  '2025/01/01', '2025/01/13', '2025/02/11', '2025/02/24', '2025/03/20', '2025/04/29', '2025/05/05', '2025/05/06',
  '2025/07/21', '2025/08/11', '2025/09/15', '2025/09/23', '2025/10/13', '2025/11/03', '2025/11/24',
  '2026/01/01', '2026/01/12', '2026/02/11', '2026/02/23', '2026/03/20', '2026/04/29', '2026/05/04', '2026/05/05',
  '2026/05/06', '2026/07/20', '2026/08/11', '2026/09/21', '2026/09/22', '2026/09/23', '2026/10/12', '2026/11/03',
  '2026/11/23',
  '2027/01/01', '2027/01/11', '2027/02/11', '2027/02/23', '2027/03/22', '2027/04/29', '2027/05/03', '2027/05/04',
  '2027/05/05', '2027/07/19', '2027/08/11', '2027/09/20', '2027/09/23', '2027/10/11', '2027/11/03', '2027/11/23',
  '2028/01/03', '2028/01/10', '2028/02/11', '2028/02/23', '2028/03/20', '2028/04/29', '2028/05/03', '2028/05/04',
  '2028/05/05',
]);

const yen = v => '¥' + Math.round(v || 0).toLocaleString();
const ppl = v => Math.round(v || 0).toLocaleString() + '人';
const fmtMetric = (k, v) => (k === 'customers' ? ppl(v) : yen(v));
const man = v => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(Math.abs(v) >= 1e6 ? 0 : 1) + '万' : Math.round(v).toLocaleString());
const pct = v => (v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%');
const yoyColor = v => (v == null ? '#999' : v >= 100 ? UP : DOWN);
const signed = (v, f) => (v >= 0 ? '+' : '▲') + f(Math.abs(v));
const ratio = (a, b) => (b > 0 && a > 0 ? (a / b) * 100 : null);

const pad2 = n => String(n).padStart(2, '0');
const ymKey = (y, m) => y + '/' + pad2(m);
const prevYearYm = ym => ymKey(+ym.slice(0, 4) - 1, +ym.slice(5, 7));
const daysInMonth = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const monthLabel = ym => +ym.slice(5, 7) + '月';
const ymJa = ym => ym.slice(0, 4) + '年' + +ym.slice(5, 7) + '月';
const fyOf = ym => {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return m >= FY_START_MONTH ? y : y - 1;
};
const fyLabel = startY => '第' + (startY - 1965) + '期';   // 2026年6月開始 = 第61期
const fyMonths = fy => Array.from({ length: 12 }, (_, i) => {
  const m = ((FY_START_MONTH - 1 + i) % 12) + 1;
  return ymKey(m >= FY_START_MONTH ? fy : fy + 1, m);
});

function isOffDay(ym, day) {
  const w = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, day).getDay();
  return w === 0 || w === 6 || HOLIDAYS.has(ym + '/' + pad2(day));
}
const dayMatch = (dt, ym, day) => dt === 'all' || (dt === 'holiday') === isOffDay(ym, day);

function normDate(s) {
  const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  return m[1] + '/' + pad2(m[2]) + '/' + pad2(m[3]);
}

// dept -> ym -> { day -> {sales, customers} }
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

const EMPTY = () => ({ sales: 0, customers: 0, days: 0, firstDay: 99, lastDay: 0, has: false });

// 1ヶ月を集計。dt=日区分、maxDay=途中月の締め日。firstDay は日区分に関係なく判定
function agg(idx, dept, ym, maxDay, dt) {
  const depts = dept === '全体' ? SUB_DEPTS : [dept];
  const byDay = {};
  depts.forEach(d => {
    const mm = (idx[d] && idx[d][ym]) || {};
    Object.keys(mm).forEach(k => {
      const day = +k;
      if (maxDay && day > maxDay) return;
      if (!byDay[day]) byDay[day] = { sales: 0, customers: 0 };
      byDay[day].sales += mm[k].sales;
      byDay[day].customers += mm[k].customers;
    });
  });
  const a = EMPTY();
  Object.keys(byDay).forEach(k => {
    const day = +k, v = byDay[k];
    if (v.sales <= 0) return;
    a.firstDay = Math.min(a.firstDay, day);
    a.lastDay = Math.max(a.lastDay, day);
    if (!dayMatch(dt, ym, day)) return;
    a.sales += v.sales; a.customers += v.customers; a.days += 1;
  });
  a.has = a.sales > 0;
  return a;
}

const addAgg = (x, y) => ({
  sales: x.sales + y.sales, customers: x.customers + y.customers, days: x.days + y.days,
  firstDay: Math.min(x.firstDay, y.firstDay), lastDay: Math.max(x.lastDay, y.lastDay), has: x.has || y.has,
});

// 指標値。perDay=true なら売上・客数は1日平均
function val(a, key, perDay) {
  if (!a || !a.has) return null;
  if (key === 'avgSpend') return a.customers > 0 ? a.sales / a.customers : null;
  const v = key === 'sales' ? a.sales : a.customers;
  return perDay ? (a.days > 0 ? v / a.days : null) : v;
}
const yoyOf = (cur, pre, key, perDay) => ratio(val(cur, key, perDay), val(pre, key, perDay));

export default function SummaryPanel() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [dept, setDept] = useState('全体');
  const [metric, setMetric] = useState('sales');
  const [dayType, setDayType] = useState('all');
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

  const meta = useMemo(() => {
    if (!idx) return null;
    const set = {};
    SUB_DEPTS.forEach(d => Object.keys(idx[d]).forEach(ym => { set[ym] = 1; }));
    const months = Object.keys(set).sort();
    if (!months.length) return null;
    const latest = months[months.length - 1];
    const lastDay = agg(idx, '全体', latest, null, 'all').lastDay;
    const partial = lastDay < daysInMonth(latest);
    const fys = Array.from(new Set(months.map(fyOf))).sort((a, b) => b - a);
    const defaultFocus = partial && months.length > 1 ? months[months.length - 2] : latest;
    return { months, latest, lastDay, partial, fys, defaultFocus };
  }, [idx]);

  // 1ヶ月分（今年・前年）。途中月は前年も同日まで
  const rowOf = useMemo(() => {
    if (!idx || !meta) return () => null;
    return (ym, dp, dt) => {
      const cut = ym === meta.latest && meta.partial ? meta.lastDay : null;
      const cur = agg(idx, dp, ym, cut, dt);
      const preAll = agg(idx, dp, prevYearYm(ym), cut, 'all');
      const pre = agg(idx, dp, prevYearYm(ym), cut, dt);
      const preComplete = preAll.has && preAll.firstDay <= 1;
      return {
        ym, cut, cur, pre, preComplete,
        preNote: preAll.has && !preComplete ? '前年は' + preAll.firstDay + '日〜のため参考値' : '',
      };
    };
  }, [idx, meta]);

  // 期首から指定月までの累計（前年比は前年が1ヶ月そろっている月同士）
  const ytdOf = useMemo(() => (fy, upto, dp, dt) => {
    let cur = EMPTY(), curCmp = EMPTY(), pre = EMPTY(), n = 0, nCmp = 0, cut = null;
    fyMonths(fy).filter(ym => ym <= upto).forEach(ym => {
      const r = rowOf(ym, dp, dt);
      if (!r || !r.cur.has) return;
      cur = addAgg(cur, r.cur); n += 1;
      if (r.cut) cut = r.cut;
      if (r.preComplete) { curCmp = addAgg(curCmp, r.cur); pre = addAgg(pre, r.pre); nCmp += 1; }
    });
    return { cur, curCmp, pre, n, nCmp, cut };
  }, [rowOf]);

  const focusYm = focus && meta && meta.months.includes(focus) ? focus : (meta ? meta.defaultFocus : '');
  const fy = focusYm ? fyOf(focusYm) : null;
  const perDay = dayType !== 'all';
  const dtLabel = DAY_TYPES.find(d => d.key === dayType).label;
  const basis = perDay ? '（1日平均）' : '';

  const selectFy = newFy => {
    const ms = meta.months.filter(ym => fyOf(ym) === newFy);
    const full = ms.filter(ym => !(ym === meta.latest && meta.partial));
    setFocus((full.length ? full : ms)[(full.length ? full : ms).length - 1]);
  };

  if (status === 'loading') return <Card><div style={{ padding: 40, textAlign: 'center', color: '#999' }}>読み込み中…</div></Card>;
  if (!meta) return <Card><div style={{ padding: 40, textAlign: 'center', color: '#999' }}>日別売上データがありません。「日別売上推移」タブでCSVを取り込んでください。</div></Card>;

  const months = fyMonths(fy);
  const rows = months.map(ym => rowOf(ym, dept, dayType));
  const fr = rowOf(focusYm, dept, dayType);
  const ytd = ytdOf(fy, focusYm, dept, dayType);
  const ytdFull = ytdOf(fy, months[11], dept, dayType);
  const color = DC[dept];
  const mLabel = METRICS.find(m => m.key === metric).label;
  const firstYm = months[0];

  const decompOf = (cur, pre) => {
    const s1 = val(cur, 'sales', perDay), s0 = val(pre, 'sales', perDay);
    const c1 = val(cur, 'customers', perDay), c0 = val(pre, 'customers', perDay);
    if (s1 == null || s0 == null || !c0 || !c1) return null;
    const a1 = s1 / c1, a0 = s0 / c0;
    return { diff: s1 - s0, cust: (c1 - c0) * a0, spend: (a1 - a0) * c1 };
  };

  const chartData = rows.map(r => ({
    label: monthLabel(r.ym) + (r.cut ? '*' : ''),
    ym: r.ym,
    今年: r.cur.has ? Math.round(val(r.cur, metric, perDay)) : null,
    前年: r.pre.has ? Math.round(val(r.pre, metric, perDay)) : null,
    前年比: r.cur.has && r.preComplete ? yoyOf(r.cur, r.pre, metric, perDay) : null,
  }));
  const yoyData = rows.map(r => ({
    label: monthLabel(r.ym) + (r.cut ? '*' : ''),
    売上: r.cur.has && r.preComplete ? yoyOf(r.cur, r.pre, 'sales', perDay) : null,
    客数: r.cur.has && r.preComplete ? yoyOf(r.cur, r.pre, 'customers', perDay) : null,
    客単価: r.cur.has && r.preComplete ? yoyOf(r.cur, r.pre, 'avgSpend', perDay) : null,
  }));

  const ytdLabel = ytd.n ? '期累計（' + monthLabel(firstYm) + '〜' + monthLabel(focusYm) + (ytd.cut ? ytd.cut + '日' : '') + '）' : '期累計';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* コントロール */}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DEPTS.map(d => <Pill key={d} active={dept === d} color={DC[d]} onClick={() => setDept(d)}>{d}</Pill>)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DAY_TYPES.map(d => <Pill key={d.key} active={dayType === d.key} color="#4a6fa5" onClick={() => setDayType(d.key)}>{d.label}</Pill>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select value={String(fy)} onChange={v => selectFy(+v)}>
              {meta.fys.map(f => <option key={f} value={f}>{fyLabel(f)}（{f}/06〜{f + 1}/05）</option>)}
            </Select>
            <Select value={focusYm} onChange={setFocus}>
              {meta.months.filter(ym => fyOf(ym) === fy).reverse().map(ym => (
                <option key={ym} value={ym}>{ymJa(ym)}{ym === meta.latest && meta.partial ? '（' + meta.lastDay + '日まで）' : ''}</option>
              ))}
            </Select>
          </div>
        </div>
        {perDay && <div style={{ fontSize: 11, color: '#4a6fa5', marginTop: 10 }}>{dtLabel}のみで集計。日数が年によって違うため、売上・客数は「1日平均」で前年と比べています。土日祝＝土曜・日曜・祝日（振替休日を含む）。</div>}
      </Card>

      {/* KPI：単月 */}
      <div>
        <SectionTitle main={ymJa(focusYm)} sub={dept + '・' + dtLabel + basis + '・前年同月比'}>
          {fr.cut && <Badge>{'1〜' + fr.cut + '日の途中集計（前年も同日まで）'}</Badge>}
          {fr.preNote && <Badge>{fr.preNote}</Badge>}
        </SectionTitle>
        <KpiRow cur={fr.cur} pre={fr.preComplete ? fr.pre : EMPTY()} perDay={perDay} color={color} metric={metric} setMetric={setMetric}
          extra={perDay ? '日数 ' + fr.cur.days + '日（前年' + fr.pre.days + '日）' : ''}
          decomp={fr.preComplete ? decompOf(fr.cur, fr.pre) : null} />
      </div>

      {/* KPI：期累計 */}
      <div>
        <SectionTitle main={fyLabel(fy) + ' ' + ytdLabel} sub={dept + '・' + dtLabel + basis + '・前年同期比'}>
          {ytd.nCmp > 0 && ytd.nCmp < ytd.n && <Badge>{'前年データがそろう' + ytd.nCmp + 'ヶ月分のみで集計・比較'}</Badge>}
        </SectionTitle>
        <KpiRow cur={ytd.nCmp > 0 ? ytd.curCmp : ytd.cur} pre={ytd.pre} cmpCur={ytd.curCmp} perDay={perDay} color={color} metric={metric} setMetric={setMetric}
          extra={perDay ? '日数 ' + (ytd.nCmp > 0 ? ytd.curCmp : ytd.cur).days + '日（前年' + ytd.pre.days + '日）' : ''}
          decomp={decompOf(ytd.curCmp, ytd.pre)} />
      </div>

      {/* 平日／土日祝 */}
      <Card>
        <CardTitle title={'📅 平日／土日祝の比較（' + dept + '）'} note="1日平均で前年と比較。土日祝＝土曜・日曜・祝日（振替休日を含む）" />
        <Table head={['期間', '区分', '日数（前年）', '1日平均売上', '前年比', '1日平均客数', '前年比', '客単価', '前年比']}>
          {[
            { label: ymJa(focusYm) + (fr.cut ? '（' + fr.cut + '日まで）' : ''), get: dt => { const r = rowOf(focusYm, dept, dt); return { cur: r.cur, pre: r.preComplete ? r.pre : EMPTY() }; } },
            { label: ytdLabel, get: dt => { const y = ytdOf(fy, focusYm, dept, dt); return { cur: y.curCmp.has ? y.curCmp : y.cur, pre: y.pre }; } },
          ].map((blk, bi) => DAY_TYPES.slice(1).concat(DAY_TYPES[0]).map((d, i) => {
            const { cur, pre } = blk.get(d.key);
            const isAll = d.key === 'all';
            return (
              <tr key={bi + d.key} style={{ background: isAll ? '#f7f6f1' : 'transparent', fontWeight: isAll ? 700 : 400, borderTop: i === 0 && bi > 0 ? '2px solid #e5e2da' : undefined }}>
                <Td left>{i === 0 ? blk.label : ''}</Td>
                <Td left><DayDot k={d.key} />{d.label}</Td>
                <Td>{cur.days + '日'}<span style={{ color: '#999' }}>{'（' + (pre.has ? pre.days : '—') + '）'}</span></Td>
                <Td>{cur.has ? yen(val(cur, 'sales', true)) : '—'}</Td><YoyTd v={yoyOf(cur, pre, 'sales', true)} />
                <Td>{cur.has ? ppl(val(cur, 'customers', true)) : '—'}</Td><YoyTd v={yoyOf(cur, pre, 'customers', true)} />
                <Td>{cur.has ? yen(val(cur, 'avgSpend')) : '—'}</Td><YoyTd v={yoyOf(cur, pre, 'avgSpend')} />
              </tr>
            );
          }))}
        </Table>
      </Card>

      {/* 月次推移 */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{'📊 月次推移　' + fyLabel(fy) + '（' + dept + '・' + dtLabel + '・' + mLabel + basis + '）'}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {METRICS.map(m => <Pill key={m.key} small active={metric === m.key} color="#1b4332" onClick={() => setMetric(m.key)}>{m.label}</Pill>)}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            onClick={e => { const p = e && e.activePayload && e.activePayload[0] && e.activePayload[0].payload; if (p && p.今年 != null) setFocus(p.ym); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="v" tick={{ fontSize: 11 }} width={56}
              tickFormatter={v => (metric === 'customers' ? v.toLocaleString() : metric === 'sales' ? Math.round(v / 10000).toLocaleString() + '万' : '¥' + v.toLocaleString())} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={46}
              domain={[dataMin => Math.min(80, Math.floor(dataMin / 10) * 10), dataMax => Math.max(130, Math.ceil(dataMax / 10) * 10)]} tickFormatter={v => v + '%'} />
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

      {/* 前年比の推移 */}
      <Card>
        <CardTitle title={'📈 前年比の推移　' + fyLabel(fy) + '（' + dept + '・' + dtLabel + '）'} note="売上の伸びが「客数」と「客単価」のどちらから来ているかを見る" />
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={yoyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={46} domain={['auto', 'auto']} tickFormatter={v => v + '%'} />
            <Tooltip formatter={v => pct(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="#999" strokeDasharray="4 4" />
            <Line dataKey="売上" stroke={color} strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
            <Line dataKey="客数" stroke="#4a6fa5" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line dataKey="客単価" stroke="#d4a017" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* 部門別 */}
      <Card>
        <CardTitle title={'🏪 部門別　' + ymJa(focusYm) + (fr.cut ? '（1〜' + fr.cut + '日）' : '') + '・' + dtLabel + basis} />
        <Table head={['部門', '売上' + basis, '前年比', '構成比', '客数' + basis, '前年比', '客単価', '前年比']}>
          {DEPTS.map(d => {
            const r = rowOf(focusYm, d, dayType);
            const tot = rowOf(focusYm, '全体', dayType);
            const pre = r.preComplete ? r.pre : EMPTY();
            return (
              <tr key={d} style={{ background: d === '全体' ? '#f7f6f1' : 'transparent', fontWeight: d === '全体' ? 700 : 400, cursor: 'pointer' }} onClick={() => setDept(d)}>
                <Td left><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: DC[d], marginRight: 6 }} />{d}</Td>
                <Td>{r.cur.has ? yen(val(r.cur, 'sales', perDay)) : '—'}</Td><YoyTd v={yoyOf(r.cur, pre, 'sales', perDay)} />
                <Td>{d === '全体' ? '100%' : pct(ratio(r.cur.sales, tot.cur.sales))}</Td>
                <Td>{r.cur.has ? ppl(val(r.cur, 'customers', perDay)) : '—'}</Td><YoyTd v={yoyOf(r.cur, pre, 'customers', perDay)} />
                <Td>{r.cur.has ? yen(val(r.cur, 'avgSpend')) : '—'}</Td><YoyTd v={yoyOf(r.cur, pre, 'avgSpend')} />
              </tr>
            );
          })}
        </Table>
      </Card>

      {/* 月次一覧 */}
      <Card>
        <CardTitle title={'📋 月次一覧　' + fyLabel(fy) + '（' + dept + '・' + dtLabel + basis + '）'} />
        <Table head={['月'].concat(perDay ? ['日数'] : [], ['売上' + basis, '前年', '前年比', '客数' + basis, '前年比', '客単価', '前年比'])}>
          {rows.map(r => {
            const pre = r.preComplete ? r.pre : EMPTY();
            const has = r.cur.has;
            return (
              <tr key={r.ym} onClick={() => has && setFocus(r.ym)}
                style={{ cursor: has ? 'pointer' : 'default', background: r.ym === focusYm ? 'rgba(27,67,50,.07)' : 'transparent', color: has ? '#333' : '#bbb' }}>
                <Td left>{r.ym}{r.cut ? <span style={{ fontSize: 10, color: '#999' }}>{'（' + r.cut + '日まで）'}</span> : null}{r.preNote ? <span style={{ fontSize: 10, color: '#b5651d' }}> ※参考</span> : null}</Td>
                {perDay && <Td>{has ? r.cur.days + '日' : '—'}</Td>}
                <Td>{has ? yen(val(r.cur, 'sales', perDay)) : '—'}</Td>
                <Td muted>{r.pre.has ? yen(val(r.pre, 'sales', perDay)) : '—'}</Td>
                <YoyTd v={has ? yoyOf(r.cur, pre, 'sales', perDay) : null} />
                <Td>{has ? ppl(val(r.cur, 'customers', perDay)) : '—'}</Td>
                <YoyTd v={has ? yoyOf(r.cur, pre, 'customers', perDay) : null} />
                <Td>{has ? yen(val(r.cur, 'avgSpend')) : '—'}</Td>
                <YoyTd v={has ? yoyOf(r.cur, pre, 'avgSpend') : null} />
              </tr>
            );
          })}
          <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700, background: '#f7f6f1' }}>
            <Td left>期累計</Td>
            {perDay && <Td>{ytdFull.cur.days + '日'}</Td>}
            <Td>{ytdFull.cur.has ? yen(val(ytdFull.cur, 'sales', perDay)) : '—'}</Td>
            <Td muted>{ytdFull.pre.has ? yen(val(ytdFull.pre, 'sales', perDay)) : '—'}</Td>
            <YoyTd v={yoyOf(ytdFull.curCmp, ytdFull.pre, 'sales', perDay)} />
            <Td>{ytdFull.cur.has ? ppl(val(ytdFull.cur, 'customers', perDay)) : '—'}</Td>
            <YoyTd v={yoyOf(ytdFull.curCmp, ytdFull.pre, 'customers', perDay)} />
            <Td>{ytdFull.cur.has ? yen(val(ytdFull.cur, 'avgSpend')) : '—'}</Td>
            <YoyTd v={yoyOf(ytdFull.curCmp, ytdFull.pre, 'avgSpend')} />
          </tr>
        </Table>
        <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
          POS日別データ（税込）より集計。期首は6月。前年が月の途中から始まる月（※参考）は前年比・期累計の比較から除外。
          {status === 'local' ? '　※GASに接続できなかったため、このブラウザに保存されたデータで表示しています。' : ''}
        </div>
      </Card>
    </div>
  );
}

// ── UI parts ─────────────────────────────────────────
const cardBase = { background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', border: '1px solid #ebe9e3' };

function Card({ children }) { return <div style={cardBase}>{children}</div>; }

function CardTitle({ title, note }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function SectionTitle({ main, sub, children }) {
  return (
    <div style={{ fontSize: 13, color: '#666', margin: '0 2px 8px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#1b4332' }}>{main}</span>
      <span>{sub}</span>
      {children}
    </div>
  );
}

function KpiRow({ cur, pre, cmpCur, perDay, color, metric, setMetric, extra, decomp }) {
  const c2 = cmpCur && cmpCur.has ? cmpCur : cur;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      {METRICS.map(m => {
        const pd = m.key !== 'avgSpend' && perDay;
        const v = val(cur, m.key, pd), p = val(pre, m.key, pd);
        const y = yoyOf(c2, pre, m.key, pd);
        const vCmp = val(c2, m.key, pd);
        const f = x => fmtMetric(m.key, x);
        return (
          <div key={m.key} onClick={() => setMetric(m.key)}
            style={{ ...cardBase, borderLeft: '4px solid ' + color, cursor: 'pointer', outline: metric === m.key ? '2px solid ' + color + '33' : 'none' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{m.label + (pd ? '（1日平均）' : '')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#222' }}>{v == null ? '—' : f(v)}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: yoyColor(y) }}>{pct(y)}</div>
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span>前年 {p == null ? '—' : f(p)}</span>
              <span style={{ color: yoyColor(y) }}>{p != null && vCmp != null ? signed(vCmp - p, f) : ''}</span>
            </div>
            {extra && m.key === 'sales' && <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>{extra}</div>}
          </div>
        );
      })}
      <div style={{ ...cardBase, borderLeft: '4px solid #8a8577' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{'売上増減の内訳（前年差' + (perDay ? '・1日平均' : '') + '）'}</div>
        {decomp ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, color: decomp.diff >= 0 ? UP : DOWN }}>{signed(decomp.diff, man)}<span style={{ fontSize: 12 }}>円</span></div>
            <Bar2 label="客数要因" v={decomp.cust} max={Math.max(Math.abs(decomp.cust), Math.abs(decomp.spend))} />
            <Bar2 label="客単価要因" v={decomp.spend} max={Math.max(Math.abs(decomp.cust), Math.abs(decomp.spend))} />
          </>
        ) : <div style={{ fontSize: 13, color: '#bbb', marginTop: 10 }}>前年データなし</div>}
      </div>
    </div>
  );
}

function DayDot({ k }) {
  const c = k === 'holiday' ? '#c1440e' : k === 'weekday' ? '#4a6fa5' : '#1b4332';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c, marginRight: 6 }} />;
}

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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
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
