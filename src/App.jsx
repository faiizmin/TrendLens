import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import SettingsForm from './components/SettingsForm.jsx';
import AuthControls from './components/AuthControls.jsx';
import { productionData, productionLines, productNames } from './data/productionData.js';
import {
  COMPANY_STORAGE_KEY, PROFILE_STORAGE_KEY, defaultCompany, defaultProfile,
  readSettings, validateCompany, validateProfile, writeSetting,
} from './settings/settingsModel.js';

const fmt = new Intl.NumberFormat('en-US');
const navItems = [
  ['Overview', '▦'], ['Analytics', '⌁'], ['Settings', '⚙'],
];
const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function IconMark() { return <span className="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5 9.1 12l3.7 3.2L20 7"/><path d="M14.8 7H20v5.2"/></svg></span>; }

function MetricCard({ icon, tone, label, value, unit, detail }) {
  return <article className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    <div className="metric-detail">{detail}</div>
  </article>;
}

function PanelHeading({ title, subtitle, action }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}

function EmptyChart() { return <div className="empty-chart"><span>⌁</span><strong>No production records</strong><p>Try adjusting the selected filters to see results.</p></div>; }

export default function App({ authEnabled = false }) {
  const [activeNav, setActiveNav] = useState('Overview');
  const [startDate, setStartDate] = useState(productionData[0].date);
  const [endDate, setEndDate] = useState(productionData.at(-1).date);
  const [line, setLine] = useState('All lines');
  const [product, setProduct] = useState('All products');
  const [dateError, setDateError] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);
  const [authenticatedCompany, setAuthenticatedCompany] = useState(null);
  const [settings, setSettings] = useState(() => {
    try { return readSettings(window.localStorage); }
    catch { return { profile: { ...defaultProfile }, company: { ...defaultCompany }, errors: ['Browser storage is unavailable. Changes cannot be saved.'] }; }
  });
  const { profile, company } = settings;
  const visibleCompany = authenticatedCompany || company;

  function saveProfile(nextProfile) {
    try {
      const result = writeSetting(window.localStorage, PROFILE_STORAGE_KEY, nextProfile);
      if (!result.ok) return result;
      setSettings((current) => ({ ...current, profile: { ...nextProfile }, errors: [] }));
      return result;
    } catch { return { ok: false, error: 'Browser storage is unavailable. Changes were not saved.' }; }
  }

  function saveCompany(nextCompany) {
    try {
      const result = writeSetting(window.localStorage, COMPANY_STORAGE_KEY, nextCompany);
      if (!result.ok) return result;
      setSettings((current) => ({ ...current, company: { ...nextCompany }, errors: [] }));
      return result;
    } catch { return { ok: false, error: 'Browser storage is unavailable. Changes were not saved.' }; }
  }

  const rows = useMemo(() => {
    if (dateError) return [];
    return productionData.filter((row) =>
      row.date >= startDate && row.date <= endDate &&
      (line === 'All lines' || row.line === line) &&
      (product === 'All products' || row.product === product));
  }, [startDate, endDate, line, product, dateError]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    target: sum.target + row.target,
    actual: sum.actual + row.actual,
    downtime: sum.downtime + row.downtime,
    defects: sum.defects + row.defects,
  }), { target: 0, actual: 0, downtime: 0, defects: 0 }), [rows]);
  const achievement = totals.target ? (totals.actual / totals.target) * 100 : 0;
  const defectRate = totals.actual ? (totals.defects / totals.actual) * 100 : 0;

  const productionTrend = useMemo(() => {
    const days = new Map();
    rows.forEach((row) => {
      const item = days.get(row.date) || { date: row.date, actual: 0, target: 0, downtime: 0, defects: 0 };
      item.actual += row.actual; item.target += row.target; item.downtime += row.downtime; item.defects += row.defects; days.set(row.date, item);
    });
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);
  const analyticsTrend = useMemo(() => productionTrend.map((day) => ({
    ...day,
    achievement: day.target ? (day.actual / day.target) * 100 : 0,
    defectRate: day.actual ? (day.defects / day.actual) * 100 : 0,
  })), [productionTrend]);
  const bestProductionDay = analyticsTrend.reduce((best, day) => !best || day.actual > best.actual ? day : best, null);
  const downtimeByLine = useMemo(() => productionLines.map((name) => ({
    name: name.replace('Assembly ', 'Asm. '),
    minutes: rows.filter((row) => row.line === name).reduce((sum, row) => sum + row.downtime, 0),
  })).filter((item) => item.minutes > 0), [rows]);
  const defectsByProduct = useMemo(() => productNames.map((name) => ({
    name: name.replace(' ', '\n'),
    defects: rows.filter((row) => row.product === name).reduce((sum, row) => sum + row.defects, 0),
  })).filter((item) => item.defects > 0), [rows]);

  function updateDate(which, value) {
    const nextStart = which === 'start' ? value : startDate;
    const nextEnd = which === 'end' ? value : endDate;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      setDateError('Start date must be on or before the end date.');
      if (which === 'start') setStartDate(value); else setEndDate(value);
      return;
    }
    setDateError('');
    if (which === 'start') setStartDate(value); else setEndDate(value);
  }

  function resetFilters() {
    setStartDate(productionData[0].date); setEndDate(productionData.at(-1).date);
    setLine('All lines'); setProduct('All products'); setDateError(''); setShowAllRows(false);
  }

  const dateRange = startDate && endDate ? `${dateLabel(startDate)} – ${dateLabel(endDate)}` : 'Select date range';

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => setActiveNav('Overview')}><IconMark/><span>Trend<span>Lens</span></span></a>
      <button className="workspace-picker" onClick={() => setActiveNav('Settings')} aria-label="Open company settings"><div className="workspace-avatar">{visibleCompany.name?.trim().slice(0, 1).toUpperCase() || 'C'}</div><div><strong>{visibleCompany.name}</strong><small>{visibleCompany.industry}</small></div><span className="chevron">⌄</span></button>
      <div className="nav-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{navItems.map(([name, icon]) =>
        <button key={name} className={activeNav === name ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav(name)}>
          <span className="nav-icon">{icon}</span>{name}
        </button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="help-card"><div className="help-symbol">?</div><strong>Need a hand?</strong><p>Visit the operations help center.</p><button onClick={() => setActiveNav('Settings')}>Get support <span>↗</span></button></div>
      <div className="user-profile"><div className="user-avatar">{profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><strong>{profile.name}</strong><small>{profile.role}</small></div><button aria-label="Open profile and company settings" className="more-button" onClick={() => setActiveNav('Settings')}>···</button></div>
    </aside>

    <main className="main-area" id="overview">
      <header className="topbar"><div className="breadcrumb"><span>{visibleCompany.name}</span><b>/</b><strong>{activeNav}</strong></div><div className="topbar-tools"><span className="live-status"><i />Data updated 8 min ago</span><button className="icon-button notification" aria-label="Notifications">♧<i /></button><AuthControls enabled={authEnabled} onCompanyChange={setAuthenticatedCompany} /></div></header>
      <div className="dashboard-content">
        {activeNav !== 'Settings' && <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> {activeNav === 'Overview' ? 'OPERATIONS OVERVIEW' : 'PRODUCTION ANALYTICS'}</div><h1>{activeNav === 'Overview' ? `Good morning, ${profile.name.split(/\s+/)[0] || 'there'}` : 'Performance trends'}</h1><p>{activeNav === 'Overview' ? 'Here’s what’s happening across your production floor today.' : 'Explore production, downtime, and quality patterns across the selected period.'}</p></div><div className="heading-actions"><button className="export-button" onClick={() => window.print()}><span>↓</span> Export report</button><div className="date-range-chip"><span className="calendar-icon">▦</span>{dateRange}<span className="chip-caret">⌄</span></div></div></section>}

        {activeNav !== 'Settings' && <>
        <section className="filter-row" aria-label="Dashboard filters">
          <div className="filter-control date-filter"><label htmlFor="start-date">Date range</label><div className="date-inputs"><input id="start-date" type="date" value={startDate} max={endDate} onChange={(event) => updateDate('start', event.target.value)} aria-label="Start date"/><span>to</span><input type="date" value={endDate} min={startDate} onChange={(event) => updateDate('end', event.target.value)} aria-label="End date"/></div></div>
          <div className="filter-divider" />
          <div className="filter-control"><label htmlFor="line-select">Production line</label><select id="line-select" value={line} onChange={(event) => setLine(event.target.value)}><option>All lines</option>{productionLines.map((name) => <option key={name}>{name}</option>)}</select></div>
          <div className="filter-divider" />
          <div className="filter-control"><label htmlFor="product-select">Product</label><select id="product-select" value={product} onChange={(event) => setProduct(event.target.value)}><option>All products</option>{productNames.map((name) => <option key={name}>{name}</option>)}</select></div>
          <div className="filter-end"><span className="filtered-count">{rows.length} records</span><button onClick={resetFilters} className="reset-button">Reset</button></div>
        </section>
        {dateError && <div className="validation-message" role="alert">{dateError}</div>}
        </>}

        {activeNav === 'Overview' && <div>
        <section className="metrics-grid" aria-label="Key performance indicators">
          <MetricCard icon="▥" tone="mint" label="Total production" value={fmt.format(totals.actual)} unit="units" detail={<><span className="detail-pill green">{rows.length}</span> production runs in view</>} />
          <MetricCard icon="◎" tone="blue" label="Target achievement" value={rows.length ? achievement.toFixed(1) : '0.0'} unit="%" detail={<><span className={achievement >= 100 ? 'detail-pill green' : 'detail-pill amber'}>{fmt.format(totals.actual)} / {fmt.format(totals.target)}</span> units produced / planned</>} />
          <MetricCard icon="◷" tone="peach" label="Total downtime" value={fmt.format(totals.downtime)} unit="min" detail={<><span className="detail-pill green">{rows.length ? Math.round(totals.downtime / rows.length) : 0} min</span> average per run</>} />
          <MetricCard icon="◇" tone="lavender" label="Defect rate" value={rows.length ? defectRate.toFixed(2) : '0.00'} unit="%" detail={<><span className="detail-pill green">{fmt.format(totals.defects)}</span> defects across filtered output</>} />
        </section>

        <section className="chart-grid">
          <article className="panel production-panel">
            <PanelHeading title="Production performance" subtitle="Actual output compared to daily target" action={<div className="chart-legend"><span><i className="legend-actual"/>Actual</span><span><i className="legend-target"/>Target</span><button aria-label="More chart options" className="panel-menu">···</button></div>} />
            <div className="chart-area">{productionTrend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={productionTrend} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <defs><linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#258b7b" stopOpacity={0.18}/><stop offset="95%" stopColor="#258b7b" stopOpacity={0.01}/></linearGradient></defs>
              <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 11 }} minTickGap={28}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 11 }} tickFormatter={(value) => `${value}`} width={48}/><Tooltip labelFormatter={dateLabel} formatter={(value, name) => [`${fmt.format(value)} units`, name === 'actual' ? 'Actual output' : 'Daily target']} contentStyle={{ border: '1px solid #e6ebec', borderRadius: 9, boxShadow: '0 8px 24px #23333c14', fontSize: 12 }}/><Area type="monotone" dataKey="target" stroke="#b6c2c5" strokeWidth={2} strokeDasharray="5 5" fill="none" activeDot={false}/><Area type="monotone" dataKey="actual" stroke="#258b7b" strokeWidth={2.5} fill="url(#actualFill)" activeDot={{ r: 5, fill: '#258b7b', stroke: '#fff', strokeWidth: 2 }}/>
            </AreaChart></ResponsiveContainer> : <EmptyChart/>}</div>
            <div className="chart-caption"><span><i className="caption-dot"/> Production output, units / day</span><strong>{productionTrend.length} days shown</strong></div>
          </article>
          <article className="panel downtime-panel"><PanelHeading title="Downtime by line" subtitle="Unplanned downtime this period" action={<button className="period-menu">This period⌄</button>}/>
            <div className="chart-area short-chart">{downtimeByLine.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={downtimeByLine} layout="vertical" margin={{ top: 8, right: 14, left: 10, bottom: 0 }} barCategoryGap={14}><CartesianGrid stroke="#edf1f2" horizontal={false}/><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} tickFormatter={(value) => `${value}m`}/><YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#657378', fontSize: 11 }} width={66}/><Tooltip formatter={(value) => [`${fmt.format(value)} min`, 'Downtime']} cursor={{ fill: '#f7f9f9' }}/><Bar dataKey="minutes" fill="#e8a66f" radius={[0, 5, 5, 0]} maxBarSize={22}/></BarChart></ResponsiveContainer> : <EmptyChart/>}</div>
            <div className="panel-foot"><span>Total downtime</span><strong>{fmt.format(totals.downtime)} <small>min</small></strong></div>
          </article>
        </section>

        <section className="lower-grid">
          <article className="panel quality-panel"><PanelHeading title="Defects by product" subtitle="Rejected units across product families" action={<button className="period-menu">By product⌄</button>}/>
            <div className="chart-area quality-chart">{defectsByProduct.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={defectsByProduct} margin={{ top: 12, right: 8, left: -17, bottom: 1 }} barCategoryGap="36%"><CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#748186', fontSize: 10 }} interval={0} tickFormatter={(value) => value.replace('\n', ' ')}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} width={38}/><Tooltip formatter={(value) => [`${fmt.format(value)} units`, 'Defects']}/><Bar dataKey="defects" fill="#6b8fe4" radius={[5, 5, 0, 0]} maxBarSize={48}/></BarChart></ResponsiveContainer> : <EmptyChart/>}</div>
            <div className="panel-foot"><span>Total rejected units</span><strong>{fmt.format(totals.defects)} <small>units</small></strong></div>
          </article>

          <article className="panel target-panel"><PanelHeading title="Shift snapshot" subtitle="Production mix at a glance" action={<span className="snapshot-live"><i/> Live</span>}/>
            <div className="snapshot-total"><div><small>Units produced</small><strong>{fmt.format(totals.actual)}</strong></div><span className="snapshot-ring">{rows.length ? Math.round(achievement) : 0}<small>%</small></span></div>
            <div className="progress-label"><span>Target completion</span><strong>{achievement.toFixed(1)}%</strong></div><div className="progress-track"><span style={{ width: `${Math.min(achievement, 100)}%` }}/></div>
            <div className="snapshot-divider"/><div className="snapshot-meta"><div><span className="meta-icon meta-blue">▥</span><span>Active production lines</span><strong>{line === 'All lines' ? productionLines.length : 1} <small>lines</small></strong></div><div><span className="meta-icon meta-orange">◷</span><span>Average downtime</span><strong>{rows.length ? Math.round(totals.downtime / rows.length) : 0} <small>min / run</small></strong></div></div>
          </article>
        </section>

        <section className="panel table-panel"><PanelHeading title="Production performance" subtitle="A detailed view of recent production runs" action={<button className="view-all" onClick={() => setShowAllRows((current) => !current)}>{showAllRows ? 'Show recent' : 'View all records'} <span>→</span></button>}/>
          <div className="table-scroll"><table><thead><tr><th>Date</th><th>Production line</th><th>Product</th><th className="numeric">Target</th><th className="numeric">Actual output</th><th className="numeric">Downtime</th><th className="numeric">Defects</th><th>Status</th></tr></thead><tbody>{rows.slice().reverse().slice(0, showAllRows ? undefined : 8).map((row) => {
            const rate = row.actual / row.target;
            const status = rate >= 1 ? 'On target' : rate >= 0.92 ? 'Near target' : 'Below target';
            return <tr key={row.id}><td>{dateLabel(row.date)}, {new Date(`${row.date}T00:00:00`).getFullYear()}</td><td><span className="line-bullet"/>{row.line}</td><td>{row.product}</td><td className="numeric">{fmt.format(row.target)}</td><td className="numeric actual-cell">{fmt.format(row.actual)}</td><td className="numeric">{row.downtime} min</td><td className="numeric">{row.defects}</td><td><span className={`status-pill ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></td></tr>;
          })}</tbody></table>{!rows.length && <EmptyChart/>}</div>
          <div className="table-footer"><span>Showing <strong>{Math.min(rows.length, showAllRows ? rows.length : 8)}</strong> of <strong>{rows.length}</strong> production records</span><span className="table-period">Filtered period · {dateRange}</span></div>
        </section>
        <footer className="dashboard-footer"><span>© 2026 TrendLens Analytics</span><span>Manufacturing intelligence, made clear.</span><a href="#overview">Privacy · Help center</a></footer>
        </div>}
        {activeNav === 'Analytics' && <section className="analytics-page">
          <div className="analytics-summary">
            <MetricCard icon="◎" tone="blue" label="Average daily achievement" value={analyticsTrend.length ? (analyticsTrend.reduce((sum, day) => sum + day.achievement, 0) / analyticsTrend.length).toFixed(1) : '0.0'} unit="%" detail="Average across filtered production days" />
            <MetricCard icon="◷" tone="peach" label="Average downtime per run" value={rows.length ? (totals.downtime / rows.length).toFixed(1) : '0.0'} unit="min" detail={`${fmt.format(totals.downtime)} minutes across ${rows.length} runs`} />
            <MetricCard icon="◇" tone="lavender" label="Filtered defect rate" value={rows.length ? defectRate.toFixed(2) : '0.00'} unit="%" detail={`${fmt.format(totals.defects)} defects across filtered output`} />
            <MetricCard icon="▥" tone="mint" label="Best production day" value={bestProductionDay ? fmt.format(bestProductionDay.actual) : '—'} unit={bestProductionDay ? 'units' : ''} detail={bestProductionDay ? dateLabel(bestProductionDay.date) : 'No filtered production days'} />
          </div>
          <div className="analytics-chart-grid">
            <article className="panel"><PanelHeading title="Daily target achievement" subtitle="Actual output as a percentage of the daily target" action={<span className="chart-unit">Percent (%)</span>}/>
              <div className="chart-area analytics-chart">{analyticsTrend.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={analyticsTrend} margin={{ top: 14, right: 12, left: -12, bottom: 0 }}><CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} minTickGap={28}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} tickFormatter={(value) => `${value}%`} width={48}/><Tooltip labelFormatter={dateLabel} formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Target achievement']}/><ReferenceLine y={100} stroke="#b7c4c6" strokeDasharray="5 5"/><Line type="monotone" dataKey="achievement" stroke="#4e83d8" strokeWidth={2.5} dot={{ r: 3, fill: '#4e83d8', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }}/></LineChart></ResponsiveContainer> : <EmptyChart/>}</div>
              <div className="chart-caption"><span><i className="analytics-dot blue-dot"/> Daily target achievement</span><strong>{analyticsTrend.length} days analyzed</strong></div>
            </article>
            <article className="panel"><PanelHeading title="Downtime trend" subtitle="Downtime minutes recorded each production day" action={<span className="chart-unit">Minutes</span>}/>
              <div className="chart-area analytics-chart">{analyticsTrend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={analyticsTrend} margin={{ top: 14, right: 12, left: -12, bottom: 0 }}><defs><linearGradient id="downtimeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e8a66f" stopOpacity={0.24}/><stop offset="95%" stopColor="#e8a66f" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} minTickGap={28}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} tickFormatter={(value) => `${value}m`} width={48}/><Tooltip labelFormatter={dateLabel} formatter={(value) => [`${fmt.format(value)} min`, 'Downtime']}/><Area type="monotone" dataKey="downtime" stroke="#dc9861" strokeWidth={2.5} fill="url(#downtimeFill)" activeDot={{ r: 4 }}/></AreaChart></ResponsiveContainer> : <EmptyChart/>}</div>
              <div className="chart-caption"><span><i className="analytics-dot orange-dot"/> Downtime per day</span><strong>{fmt.format(totals.downtime)} min total</strong></div>
            </article>
            <article className="panel"><PanelHeading title="Quality trend" subtitle="Defect rate as a share of actual daily output" action={<span className="chart-unit">Percent (%)</span>}/>
              <div className="chart-area analytics-chart">{analyticsTrend.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={analyticsTrend} margin={{ top: 14, right: 12, left: -12, bottom: 0 }}><CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="date" tickFormatter={dateLabel} tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} minTickGap={28}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8b989d', fontSize: 10 }} tickFormatter={(value) => `${value}%`} width={48}/><Tooltip labelFormatter={dateLabel} formatter={(value) => [`${Number(value).toFixed(2)}%`, 'Defect rate']}/><Line type="monotone" dataKey="defectRate" stroke="#9279cb" strokeWidth={2.5} dot={{ r: 3, fill: '#9279cb', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }}/></LineChart></ResponsiveContainer> : <EmptyChart/>}</div>
              <div className="chart-caption"><span><i className="analytics-dot purple-dot"/> Daily defect rate</span><strong>{fmt.format(totals.defects)} total defects</strong></div>
            </article>
            <article className="panel analytical-notes"><PanelHeading title="Period readout" subtitle="Summary of the current filtered view"/>
              {rows.length ? <div className="readout-list"><div><span className="readout-icon mint">↗</span><p><strong>{achievement >= 100 ? 'Overall output met target' : 'Overall output below target'}</strong><small>{fmt.format(totals.actual)} actual units against {fmt.format(totals.target)} planned.</small></p></div><div><span className="readout-icon orange">◷</span><p><strong>{fmt.format(totals.downtime)} minutes of downtime</strong><small>{(totals.downtime / rows.length).toFixed(1)} minutes per production run on average.</small></p></div><div><span className="readout-icon purple">◇</span><p><strong>{fmt.format(totals.defects)} rejected units</strong><small>{defectRate.toFixed(2)}% of filtered output recorded as defects.</small></p></div></div> : <EmptyChart/>}
            </article>
          </div>
          <footer className="dashboard-footer"><span>© 2026 TrendLens Analytics</span><span>Manufacturing intelligence, made clear.</span><a href="#overview">Privacy · Help center</a></footer>
        </section>}
        {activeNav === 'Settings' && <section className="settings-page">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> WORKSPACE PREFERENCES</div><h1>Settings</h1><p>Manage your profile and company information.</p></div></div>
          {settings.errors.map((error) => <div className="settings-message error storage-warning" role="alert" key={error}>{error}</div>)}
          <SettingsForm id="profile" title="User profile" description="These details identify you in the workspace." initialValue={profile} validate={validateProfile} onSave={saveProfile} fields={[
            { name: 'name', label: 'Full name', autoComplete: 'name', required: true },
            { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email', required: true },
            { name: 'role', label: 'Job title', autoComplete: 'organization-title', required: true },
          ]}/>
          <SettingsForm id="company" title="Company settings" description="Company details appear in the workspace navigation and header." initialValue={company} validate={validateCompany} onSave={saveCompany} fields={[
            { name: 'name', label: 'Company name', autoComplete: 'organization', required: true },
            { name: 'industry', label: 'Industry', autoComplete: 'organization-title', required: true },
            { name: 'location', label: 'Location', autoComplete: 'address-level2', required: true },
            { name: 'website', label: 'Website', type: 'url', autoComplete: 'url' },
          ]}/>
          <p className="storage-note">Prototype settings are stored in this browser’s localStorage. They are not secured, sent to a server, or shared with other users of the app.</p>
        </section>}
      </div>
    </main>
  </div>;
}
