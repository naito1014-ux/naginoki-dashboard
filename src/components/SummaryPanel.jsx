import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { gasGet } from '../lib/gas';

/* ══════════════════════════════════════════════════════════
   なぎの木テラス 月次サマリタブ
   切り替えボタンなしで「全体・部門別・平日／土日祝」を一覧で見せるサマリ。
   - 日別売上データ（getDailyData / localStorage nk_daily3）を月次に集計
   - 期首（6月）合わせ：期累計は6月〜選択月、推移は6月〜翌5月
   - 前年同月／前年同期と比較。平日・土日祝は日数が年で違うため1日平均で比較
   - 当月が途中の場合は、前年も同じ日まで（1日〜n日）で比較する
   - 前年が月の途中から始まる月は前年比の対象外（参考扱い）
   ══════════════════════════════════════════════════════════ */

const DEPTS = ['全体', 'キッチン', 'マーケット', 'カフェ'];
const SUB_DEPTS = ['キッチン', 'マーケット', 'カフェ'];
const DC = { '全体': '#1b4332', 'キッチン': '#c1440e', 'マーケット': '#386641', 'カフェ': '#d49a3a' };
const INK = '#2b2b2b';
const SUB = '#8a877f';
const LINE = '#eeece6';
const UP = '#2d6a4f';
const DOWN = '#c1440e';
const FY_START_MONTH = 6;

// 国民の祝日・振替休日（土日は曜日で判定）
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

// ── 書式 ──
const yen = v => (v == null ? '—' : '¥' + Math.round(v).toLocaleString());
const manYen = v => (v == null ? '—' : Math.round(v / 10000).toLocaleString() + '万円');
const ppl = v => (v == null ? '—' : Math.round(v).toLocaleString() + '人');
const pct = v => (v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%');
const pct0 = v => (v == null || !isFinite(v) ? '—' : Math.round(v) + '%');
const manSigned = v => (v >= 0 ? '+' : '▲') + (Math.abs(v) >= 1e6 ? Math.round(Math.abs(v) / 10000).toLocaleString() : (Math.abs(v) / 10000).toFixed(1)) + '万';
const ratio = (a, b) => (a != null && b != null && b > 0 && a > 0 ? (a / b) * 100 : null);

// 前年比の色（100%を境に緑／赤の濃淡）
function heat(v) {
  if (v == null) return { bg: '#f6f5f1', fg: '#c3c0b8' };
  if (v >= 115) return { bg: '#2d6a4f', fg: '#fff' };
  if (v >= 105) return { bg: '#74a98d', fg: '#fff' };
  if (v >= 100) return { bg: '#d3e6da', fg: '#1f4d38' };
  if (v >= 95) return { bg: '#f6dccf', fg: '#8a3410' };
  if (v >= 85) return { bg: '#e39a78', fg: '#fff' };
  return { bg: '#c1440e', fg: '#fff' };
}

// ── 日付 ──
const pad2 = n => String(n).padStart(2, '0');
const ymKey = (y, m) => y + '/' + pad2(m);
const prevYearYm = ym => ymKey(+ym.slice(0, 4) - 1, +ym.slice(5, 7));
const daysInMonth = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const mOf = ym => +ym.slice(5, 7) + '月';
const ymJa = ym => ym.slice(0, 4) + '年' + +ym.slice(5, 7) + '月';
const fyOf = ym => (+ym.slice(5, 7) >= FY_START_MONTH ? +ym.slice(0, 4) : +ym.slice(0, 4) - 1);
const fyLabel = y => '第' + (y - 1965) + '期';   // 2026年6月開始 = 第61期
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
  return m ? m[1] + '/' + pad2(m[2]) + '/' + pad2(m[3]) : null;
}

// ── 集計 ──
function buildIndex(data) {
  const idx = {};
  SUB_DEPTS.forEach(d => {
    idx[d] = {};
    const src = data[d] || {};
    Object.keys(src).forEach(k => {
      const r = src[k];
      const dt = normDate((r && r.date) || k);
      if (!dt) return;
      const ym = dt.slice(0, 7);
      if (!idx[d][ym]) idx[d][ym] = {};
      idx[d][ym][+dt.slice(8, 10)] = { sales: +r.sales || 0, customers: +r.customers || 0 };
    });
  });
  return idx;
}

const EMPTY = () => ({ sales: 0, customers: 0, days: 0, firstDay: 99, lastDay: 0, has: false });
const addAgg = (x, y) => ({
  sales: x.sales + y.sales, customers: x.customers + y.customers, days: x.days + y.days,
  firstDay: Math.min(x.firstDay, y.firstDay), lastDay: Math.max(x.lastDay, y.lastDay), has: x.has || y.has,
});

function agg(idx, dept, ym, maxDay, dt) {
  const depts = dept === '全体' ? SUB_DEPTS : [dept];
  const byDay = {};
  depts.forEach(d => {
    const mm = (idx[d] && idx[d][ym]) || {};
    Object.keys(mm).forEach(k => {
      if (maxDay && +k > maxDay) return;
      if (!byDay[k]) byDay[k] = { sales: 0, customers: 0 };
      byDay[k].sales += mm[k].sales;
      byDay[k].customers += mm[k].customers;
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

// 指標値（perDay=true なら売上・客数は1日平均）
function val(a, key, perDay) {
  if (!a || !a.has) return null;
  if (key === 'avgSpend') return a.customers > 0 ? a.sales / a.customers : null;
  const v = key === 'sales' ? a.sales : a.customers;
  return perDay ? (a.days > 0 ? v / a.days : null) : v;
}
const yoy = (p, key, perDay) => (p ? ratio(val(p.cur, key, perDay), val(p.pre, key, perDay)) : null);

export default function SummaryPanel() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [focus, setFocus] = useState('');

  useEffect(() => {
    let alive = true;
    gasGet('getDailyData').then(res => {
      if (!alive) return;
      if (res && res.data && Object.keys(res.data).length > 0) { setData(res.data); setStatus('synced'); return; }
      try {
        const d = localStorage.getItem('nk_daily3');
        if (d) { setData(JSON.parse(d)); setStatus('local'); return; }
      } catch (e) { /* ignore */ }
      setData({}); setStatus('empty');
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
    const defaultFocus = partial && months.length > 1 ? months[months.length - 2] : latest;
    return { months, latest, lastDay, partial, defaultFocus };
  }, [idx]);

  // 比較ペア { cur, pre, ok }。ok=false は前年比の対象外
  const pairOf = useMemo(() => {
    if (!idx || !meta) return () => null;
    const cache = {};
    return (ym, dept, dt) => {
      const key = ym + '|' + dept + '|' + dt;
      if (cache[key]) return cache[key];
      const cut = ym === meta.latest && meta.partial ? meta.lastDay : null;
      const cur = agg(idx, dept, ym, cut, dt);
      const preAll = agg(idx, dept, prevYearYm(ym), cut, 'all');
      const ok = preAll.has && preAll.firstDay <= 1;
      const r = { ym, cut, cur, pre: ok ? agg(idx, dept, prevYearYm(ym), cut, dt) : EMPTY(), ok, partialPre: preAll.has && !ok };
      cache[key] = r;
      return r;
    };
  }, [idx, meta]);

  // 期首〜指定月の累計（前年比は前年がそろう月同士）
  const ytdOf = (fy, upto, dept, dt) => {
    let cur = EMPTY(), pre = EMPTY(), n = 0, cut = null;
    fyMonths(fy).filter(ym => ym <= upto).forEach(ym => {
      const p = pairOf(ym, dept, dt);
      if (!p.cur.has || !p.ok) return;
      cur = addAgg(cur, p.cur); pre = addAgg(pre, p.pre); n += 1;
      if (p.cut) cut = p.cut;
    });
    return { cur, pre, n, cut, ok: n > 0 };
  };

  if (status === 'loading') return <Card><div style={{ padding: 40, textAlign: 'center', color: SUB }}>読み込み中…</div></Card>;
  if (!meta) return <Card><div style={{ padding: 40, textAlign: 'center', color: SUB }}>日別売上データがありません。「日別売上推移」タブでCSVを取り込んでください。</div></Card>;

  const focusYm = focus && meta.months.includes(focus) ? focus : meta.defaultFocus;
  const fy = fyOf(focusYm);
  const months = fyMonths(fy);
  const ytdMonths = months.filter(ym => ym <= focusYm && pairOf(ym, '全体', 'all').cur.has);
  const ytdRange = mOf(months[0]) + '〜' + mOf(focusYm);
  const cur = d => pairOf(focusYm, d, 'all');
  const ytd = d => ytdOf(fy, focusYm, d, 'all');
  const fr = cur('全体');
  const fy0 = ytd('全体');

  const decomp = (p, perDay) => {
    if (!p || !p.cur.has || !p.pre.has) return null;
    const s1 = val(p.cur, 'sales', perDay), s0 = val(p.pre, 'sales', perDay);
    const c1 = val(p.cur, 'customers', perDay), c0 = val(p.pre, 'customers', perDay);
    if (!c0 || !c1) return null;
    return { diff: s1 - s0, cust: (c1 - c0) * (s0 / c0), spend: (s1 / c1 - s0 / c0) * c1 };
  };

  // 推移チャート（締まった月のみ）
  const chartMonths = months.filter(ym => !(ym === meta.latest && meta.partial));
  const trend = key => chartMonths.map(ym => {
    const row = { label: mOf(ym) };
    SUB_DEPTS.forEach(d => { const p = pairOf(ym, d, 'all'); row[d] = p.cur.has ? Math.round(val(p.cur, key)) : null; });
    const t = pairOf(ym, '全体', 'all');
    row['今年'] = t.cur.has ? Math.round(val(t.cur, key)) : null;
    row['前年'] = t.ok && t.pre.has ? Math.round(val(t.pre, key)) : null;
    return row;
  });

  const monthOptions = meta.months.slice().reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: INK }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: SUB, letterSpacing: '.06em' }}>{fyLabel(fy) + '　' + ytdMonths.length + 'ヶ月目'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1b4332' }}>{ymJa(focusYm) + ' 月次サマリ'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: SUB }}>
          <span>表示月</span>
          <select value={focusYm} onChange={e => setFocus(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, background: '#fff', color: INK }}>
            {monthOptions.map(ym => <option key={ym} value={ym}>{ymJa(ym)}{ym === meta.latest && meta.partial ? '（' + meta.lastDay + '日まで）' : ''}</option>)}
          </select>
        </div>
      </div>

      {/* ① 全体KPI（当月＋期累計） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {[['sales', '売上', yen], ['customers', '客数', ppl], ['avgSpend', '客単価', yen]].map(([k, label, f]) => (
          <div key={k} style={{ ...cardBase, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 18px 12px' }}>
              <div style={{ fontSize: 12, color: SUB }}>{label}<span style={{ marginLeft: 6 }}>{mOf(focusYm)}{fr.cut ? '（' + fr.cut + '日まで）' : ''}</span></div>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{f(val(fr.cur, k))}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: SUB }}>前年 {f(val(fr.pre, k))}</span>
                <YoyBadge v={yoy(fr, k)} big />
              </div>
            </div>
            <div style={{ background: '#f8f7f3', borderTop: '1px solid ' + LINE, padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
              <div>
                <div style={{ fontSize: 10, color: SUB }}>{'期累計（' + ytdRange + '）'}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f(val(fy0.cur, k))}</div>
                <div style={{ fontSize: 10, color: SUB, marginTop: 1 }}>前年 {f(val(fy0.pre, k))}</div>
              </div>
              <YoyBadge v={yoy(fy0, k)} />
            </div>
          </div>
        ))}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 8 }}>売上の前年差　内訳</div>
          <Decomp title={mOf(focusYm)} d={decomp(fr)} />
          <div style={{ height: 1, background: LINE, margin: '10px 0' }} />
          <Decomp title={'期累計'} d={decomp(fy0)} />
        </div>
      </div>

      {/* ② 部門別 */}
      <Card>
        <CardTitle title="部門別" note={'当月と期累計（' + ytdRange + '）の前年比'} />
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th left rowSpan={2}>部門</Th>
                <Th group colSpan={4}>{mOf(focusYm) + (fr.cut ? '（' + fr.cut + '日まで）' : '')}</Th>
                <Th group colSpan={4} shade>{'期累計（' + ytdRange + '）'}</Th>
              </tr>
              <tr>
                <Th>売上</Th><Th>前年比</Th><Th>客数／前年比</Th><Th>客単価／前年比</Th>
                <Th shade>売上</Th><Th shade>前年比</Th><Th shade>客数／前年比</Th><Th shade>客単価／前年比</Th>
              </tr>
            </thead>
            <tbody>
              {DEPTS.map(d => {
                const c = cur(d), y = ytd(d);
                const total = d === '全体';
                return (
                  <tr key={d} style={{ fontWeight: total ? 700 : 400 }}>
                    <Td left><DeptName d={d} /></Td>
                    <Td><ValStack v={manYen(val(c.cur, 'sales'))} p={manYen(val(c.pre, 'sales'))} extra={<Share v={total ? null : ratio(c.cur.sales, fr.cur.sales)} />} /></Td>
                    <HeatTd v={yoy(c, 'sales')} />
                    <HeatTd v={yoy(c, 'customers')} sub={ppl(val(c.cur, 'customers'))} pre={ppl(val(c.pre, 'customers'))} />
                    <HeatTd v={yoy(c, 'avgSpend')} sub={yen(val(c.cur, 'avgSpend'))} pre={yen(val(c.pre, 'avgSpend'))} />
                    <Td shade><ValStack v={manYen(val(y.cur, 'sales'))} p={manYen(val(y.pre, 'sales'))} /></Td>
                    <HeatTd v={yoy(y, 'sales')} />
                    <HeatTd v={yoy(y, 'customers')} sub={ppl(val(y.cur, 'customers'))} pre={ppl(val(y.pre, 'customers'))} />
                    <HeatTd v={yoy(y, 'avgSpend')} sub={yen(val(y.cur, 'avgSpend'))} pre={yen(val(y.pre, 'avgSpend'))} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Legend2 />
      </Card>

      {/* ③ 平日／土日祝 */}
      <Card>
        <CardTitle title="平日／土日祝" note="日数が年で違うため、売上・客数は1日平均で前年と比較。土日祝＝土曜・日曜・祝日（振替休日を含む）" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {[
            { title: mOf(focusYm) + (fr.cut ? '（' + fr.cut + '日まで）' : ''), get: (d, dt) => pairOf(focusYm, d, dt) },
            { title: '期累計（' + ytdRange + '）', get: (d, dt) => ytdOf(fy, focusYm, d, dt) },
          ].map(blk => {
            const wd = blk.get('全体', 'weekday'), hd = blk.get('全体', 'holiday');
            return (
              <div key={blk.title} style={{ overflowX: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: INK, margin: '0 0 6px 2px' }}>{blk.title}</div>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <Th left rowSpan={2}>部門</Th>
                      <Th group colSpan={3}><DayTag k="weekday" />{'平日 ' + wd.cur.days + '日'}<span style={{ fontWeight: 400, color: SUB }}>{'（前年' + wd.pre.days + '日）'}</span></Th>
                      <Th group colSpan={3} shade><DayTag k="holiday" />{'土日祝 ' + hd.cur.days + '日'}<span style={{ fontWeight: 400, color: SUB }}>{'（前年' + hd.pre.days + '日）'}</span></Th>
                    </tr>
                    <tr>
                      <Th>1日売上</Th><Th>1日客数</Th><Th>客単価</Th>
                      <Th>1日売上</Th><Th>1日客数</Th><Th>客単価</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEPTS.map(d => {
                      const w = blk.get(d, 'weekday'), h = blk.get(d, 'holiday');
                      return (
                        <tr key={d} style={{ fontWeight: d === '全体' ? 700 : 400 }}>
                          <Td left><DeptName d={d} /></Td>
                          <HeatTd v={yoy(w, 'sales', true)} sub={yen(val(w.cur, 'sales', true))} pre={yen(val(w.pre, 'sales', true))} />
                          <HeatTd v={yoy(w, 'customers', true)} sub={ppl(val(w.cur, 'customers', true))} pre={ppl(val(w.pre, 'customers', true))} />
                          <HeatTd v={yoy(w, 'avgSpend')} sub={yen(val(w.cur, 'avgSpend'))} pre={yen(val(w.pre, 'avgSpend'))} />
                          <HeatTd v={yoy(h, 'sales', true)} sub={yen(val(h.cur, 'sales', true))} pre={yen(val(h.pre, 'sales', true))} />
                          <HeatTd v={yoy(h, 'customers', true)} sub={ppl(val(h.cur, 'customers', true))} pre={ppl(val(h.pre, 'customers', true))} />
                          <HeatTd v={yoy(h, 'avgSpend')} sub={yen(val(h.cur, 'avgSpend'))} pre={yen(val(h.pre, 'avgSpend'))} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <Legend2 />
      </Card>

      {/* ④ 月次推移（期首から） */}
      <Card>
        <CardTitle title={'月次推移　' + fyLabel(fy)} note="棒＝今年（部門別の積み上げ）、点線＝前年の全体" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 18 }}>
          <MiniChart title="売上" data={trend('sales')} stacked fmt={v => Math.round(v / 10000).toLocaleString() + '万'} tip={yen} />
          <MiniChart title="客数" data={trend('customers')} stacked fmt={v => v.toLocaleString()} tip={ppl} />
          <MiniChart title="客単価（全体）" data={trend('avgSpend')} fmt={v => '¥' + v.toLocaleString()} tip={yen} />
        </div>
      </Card>

      {/* ⑤ 前年比ヒートマップ */}
      <Card>
        <CardTitle title={'前年比の推移　' + fyLabel(fy)} note="月ごとの前年比。部門・指標・曜日区分を一覧で比較（平日・土日祝は1日平均）" />
        <YoyMatrix months={months} meta={meta} pairOf={pairOf} ytdOf={(d, dt) => ytdOf(fy, months[11], d, dt)} focusYm={focusYm} onPick={setFocus} />
        <Legend2 />
      </Card>

      <div style={{ fontSize: 11, color: SUB, padding: '0 4px' }}>
        POS日別データ（税込）より集計。期首は6月。途中の月は前年も同じ日までで比較。前年が月の途中から始まる月は前年比の対象外。
        {status === 'local' ? '　※GASに接続できなかったため、このブラウザに保存されたデータで表示しています。' : ''}
      </div>
    </div>
  );
}

// ── 前年比ヒートマップ ──
function YoyMatrix({ months, meta, pairOf, ytdOf, focusYm, onPick }) {
  const groups = [
    { title: '売上', rows: DEPTS.map(d => ({ label: d, dept: d, dt: 'all', key: 'sales' })) },
    { title: '客数', rows: DEPTS.map(d => ({ label: d, dept: d, dt: 'all', key: 'customers' })) },
    { title: '客単価', rows: DEPTS.map(d => ({ label: d, dept: d, dt: 'all', key: 'avgSpend' })) },
    {
      title: '曜日区分（全体）', rows: [
        { label: '平日 1日売上', dept: '全体', dt: 'weekday', key: 'sales', pd: true },
        { label: '土日祝 1日売上', dept: '全体', dt: 'holiday', key: 'sales', pd: true },
        { label: '平日 1日客数', dept: '全体', dt: 'weekday', key: 'customers', pd: true },
        { label: '土日祝 1日客数', dept: '全体', dt: 'holiday', key: 'customers', pd: true },
      ]
    },
  ];
  const cell = { padding: 0, borderBottom: '2px solid #fff', borderRight: '2px solid #fff' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: 'left', width: 120 }} />
            {months.map(ym => {
              const partial = ym === meta.latest && meta.partial;
              return (
                <th key={ym} onClick={() => meta.months.includes(ym) && onPick(ym)}
                  style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: ym === focusYm ? '#1b4332' : SUB, fontWeight: ym === focusYm ? 800 : 600 }}>
                  {mOf(ym)}{partial ? '*' : ''}
                </th>
              );
            })}
            <th style={{ ...thBase, textAlign: 'center', background: '#f8f7f3' }}>{meta.partial && fyOf(meta.latest) === fyOf(months[0]) ? '期累計（〜' + +meta.latest.slice(5, 7) + '/' + meta.lastDay + '）' : '期累計'}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <React.Fragment key={g.title}>
              <tr><td colSpan={months.length + 2} style={{ padding: '12px 4px 4px', fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: '.05em' }}>{g.title}</td></tr>
              {g.rows.map(r => (
                <tr key={g.title + r.label}>
                  <td style={{ padding: '0 8px 0 4px', whiteSpace: 'nowrap', fontWeight: r.dept === '全体' && r.dt === 'all' ? 700 : 400 }}>
                    {r.dt === 'all' ? <DeptName d={r.label} /> : <span><DayTag k={r.dt} />{r.label}</span>}
                  </td>
                  {months.map(ym => {
                    const p = pairOf(ym, r.dept, r.dt);
                    const v = p.cur.has ? yoy(p, r.key, r.pd) : null;
                    const h = heat(v);
                    const isF = ym === focusYm;
                    return (
                      <td key={ym} style={cell} title={p.cur.has ? ymJa(ym) + ' ' + r.label + '：' + pct(v) : ''}>
                        <div style={{ background: h.bg, color: h.fg, textAlign: 'center', padding: '6px 2px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', outline: isF ? '2px solid #1b4332' : 'none', outlineOffset: -2, opacity: p.cut ? 0.6 : 1 }}>
                          {p.cur.has ? pct0(v) : ''}
                        </div>
                      </td>
                    );
                  })}
                  {(() => {
                    const y = ytdOf(r.dept, r.dt);
                    const v = y.ok ? yoy(y, r.key, r.pd) : null;
                    const h = heat(v);
                    return (
                      <td style={{ ...cell, paddingLeft: 6 }}>
                        <div style={{ background: h.bg, color: h.fg, textAlign: 'center', padding: '6px 4px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pct(v)}</div>
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {meta.partial && <div style={{ fontSize: 11, color: SUB, marginTop: 6 }}>{'*' + mOf(meta.latest) + 'は' + meta.lastDay + '日までの途中集計（前年も同日まで）。月名をクリックすると上の表がその月に切り替わります。'}</div>}
    </div>
  );
}

// ── 小さな推移グラフ ──
function MiniChart({ title, data, stacked, fmt, tip }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 4 }}>{title}</div>
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: SUB }} tickLine={false} axisLine={{ stroke: LINE }} interval={0} />
          <YAxis tick={{ fontSize: 10, fill: SUB }} tickLine={false} axisLine={false} width={50} tickFormatter={fmt} />
          <Tooltip formatter={v => tip(v)} />
          {stacked
            ? SUB_DEPTS.map((d, i) => <Bar key={d} dataKey={d} stackId="a" fill={DC[d]} maxBarSize={20} radius={i === SUB_DEPTS.length - 1 ? [3, 3, 0, 0] : 0} />)
            : <Bar dataKey="今年" fill={DC['全体']} maxBarSize={20} radius={[3, 3, 0, 0]} />}
          <Line dataKey="前年" stroke="#9a968c" strokeDasharray="4 3" strokeWidth={1.5} dot={{ r: 2, fill: '#9a968c' }} connectNulls={false} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── UI parts ──
const cardBase = { background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.04)', border: '1px solid #ebe9e3' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 };
const thBase = { padding: '6px 8px', fontSize: 11, color: SUB, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid ' + LINE };

function Card({ children }) { return <div style={cardBase}>{children}</div>; }

function CardTitle({ title, note }) {
  return (
    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1b4332' }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: SUB }}>{note}</div>}
    </div>
  );
}

function Th({ children, left, group, shade, colSpan, rowSpan }) {
  return (
    <th colSpan={colSpan} rowSpan={rowSpan} style={{
      ...thBase, textAlign: left ? 'left' : group ? 'center' : 'right',
      color: group ? INK : SUB, fontWeight: group ? 700 : 600,
      background: shade ? '#f8f7f3' : 'transparent',
      borderBottom: group ? '2px solid ' + LINE : thBase.borderBottom,
    }}>{children}</th>
  );
}

function Td({ children, left, shade }) {
  return <td style={{ textAlign: left ? 'left' : 'right', padding: '8px 8px', borderBottom: '1px solid ' + LINE, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', background: shade ? '#f8f7f3' : 'transparent' }}>{children}</td>;
}

// 前年比を色付きで。sub に実数を小さく添える
function HeatTd({ v, sub, pre }) {
  const h = heat(v);
  return (
    <td style={{ padding: '4px 4px', borderBottom: '1px solid ' + LINE, textAlign: 'right', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {sub && <ValStack v={sub} p={pre} small />}
        <span style={{ minWidth: 54, display: 'inline-block', textAlign: 'center', padding: '3px 6px', borderRadius: 6, background: h.bg, color: h.fg, fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{pct(v)}</span>
      </div>
    </td>
  );
}

// 今年の値（上）と前年の値（下・小さく薄く）
function ValStack({ v, p, small, extra }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: small ? 12 : 13, color: small ? '#555' : INK }}>{v}{extra}</span>
      {p != null && <span style={{ fontSize: 10, color: '#aaa69c', fontWeight: 400 }}>{'前年 ' + p}</span>}
    </span>
  );
}

function YoyBadge({ v, big }) {
  const h = heat(v);
  return <span style={{ padding: big ? '4px 10px' : '2px 8px', borderRadius: 8, background: h.bg, color: h.fg, fontWeight: 700, fontSize: big ? 14 : 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{'前年比 ' + pct(v)}</span>;
}

function Share({ v }) {
  if (v == null) return null;
  return <span style={{ fontSize: 10, color: SUB, marginLeft: 6, fontWeight: 400 }}>{'構成' + Math.round(v) + '%'}</span>;
}

function DeptName({ d }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: DC[d] }} />{d}</span>;
}

function DayTag({ k }) {
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: k === 'holiday' ? '#c1440e' : '#4a6fa5', marginRight: 5, verticalAlign: 'middle' }} />;
}

function Decomp({ title, d }) {
  if (!d) return <div style={{ fontSize: 12, color: SUB }}>{title}：前年データなし</div>;
  const max = Math.max(Math.abs(d.cust), Math.abs(d.spend)) || 1;
  const bar = (label, v) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: SUB, marginTop: 4 }}>
      <span style={{ width: 66, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: '#f0eee8', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: (Math.abs(v) / max) * 100 + '%', height: '100%', background: v >= 0 ? UP : DOWN }} />
      </div>
      <span style={{ minWidth: 58, textAlign: 'right', whiteSpace: 'nowrap', color: v >= 0 ? UP : DOWN, fontVariantNumeric: 'tabular-nums' }}>{manSigned(v)}</span>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: SUB }}>{title}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: d.diff >= 0 ? UP : DOWN }}>{manSigned(d.diff)}<span style={{ fontSize: 11 }}>円</span></span>
      </div>
      {bar('客数要因', d.cust)}
      {bar('客単価要因', d.spend)}
    </div>
  );
}

function Legend2() {
  const steps = [['〜85%', 80], ['85〜95%', 90], ['95〜100%', 97], ['100〜105%', 102], ['105〜115%', 110], ['115%〜', 120]];
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', marginTop: 10, fontSize: 10, color: SUB, flexWrap: 'wrap' }}>
      <span style={{ marginRight: 4 }}>前年比</span>
      {steps.map(([l, v]) => { const h = heat(v); return <span key={l} style={{ padding: '2px 6px', borderRadius: 4, background: h.bg, color: h.fg }}>{l}</span>; })}
    </div>
  );
}
