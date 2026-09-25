'use strict';
/* ==========================================================================
   Karandaaz Pakistan — Budget vs Actual dashboard (index.html)
   Needs common.js and bva-data.js loaded first.
   --------------------------------------------------------------------------
   1. State & scope   2. Aggregation   3. Rendering   4. Modals   5. Events
   ========================================================================== */

/* 1. STATE & SCOPE ======================================================== */

const state = {
    years: [],
    year: null,
    data: null,               // result of buildDataset
    active: [],               // donor-filtered rows
    donor: ALL_DONORS,
    granularity: 'Monthly',   // Monthly | Quarterly | Yearly
    viewMode: 'QTD',          // Period | QTD | YTD
    period: 'Jul',
    department: '',
    isSummaryView: true,
    asOfIdx: -1,              // last fiscal month with actuals
    scope: new Set(),
    modal: null
};

function getFilteredData() {
    const rows = state.data ? state.data.rows : [];
    if (state.donor === ALL_DONORS) return rows;
    const d = state.donor;
    return rows.map(r => {
        const b = r.BudgetDonors[d] || 0;
        const a = r.ActualDonors[d] || 0;
        return { ...r, Budget: b, Actual: a, BudgetDonors: b !== 0 ? { [d]: b } : {}, ActualDonors: a !== 0 ? { [d]: a } : {} };
    });
}

const scopeMonths = () => scopeMonthsFor(state.granularity, state.viewMode, state.period);
const scopeEndIdx = () => Math.max(...[...state.scope].map(m => MONTH_INDEX[m]));
const monthYearLabel = month => monthYearLabelFor(month, state.data.fyEnd);
const periodLabel = () => periodLabelFor({ ...state, fyEnd: state.data.fyEnd });

/* 2. AGGREGATION ================================================= */

function blankAgg() {
    return { b: 0, a: 0, pace: 0, trendA: Array(12).fill(0), trendB: Array(12).fill(0), budgetDonors: {}, actualDonors: {} };
}

/* scopeRows drive totals; allRows (same filter, every month) drive trends.
   pace = budget for months that have closed (≤ last month with actuals). */
function aggregateBy(keyFn, scopeRows, allRows) {
    const groups = new Map();
    scopeRows.forEach(r => {
        const k = keyFn(r);
        if (!groups.has(k)) groups.set(k, blankAgg());
        const g = groups.get(k);
        g.b += r.Budget;
        g.a += r.Actual;
        if (MONTH_INDEX[r.Month] <= state.asOfIdx) g.pace += r.Budget;
        Object.entries(r.BudgetDonors).forEach(([d, v]) => { g.budgetDonors[d] = (g.budgetDonors[d] || 0) + v; });
        Object.entries(r.ActualDonors).forEach(([d, v]) => { g.actualDonors[d] = (g.actualDonors[d] || 0) + v; });
    });
    allRows.forEach(r => {
        const g = groups.get(keyFn(r));
        if (!g) return;
        const i = MONTH_INDEX[r.Month];
        g.trendA[i] += r.Actual;
        g.trendB[i] += r.Budget;
    });
    return groups;
}

function totalAgg(scopeRows, allRows) {
    return aggregateBy(() => 'all', scopeRows, allRows).get('all') || blankAgg();
}

function trendFor(g) {
    const end = scopeEndIdx() + 1;
    return sparkline(g.trendA.slice(0, end), g.trendB.slice(0, end));
}

/* 3. RENDERING ============================================================ */

function render() {
    if (!state.data) return;
    state.active = getFilteredData();
    state.scope = new Set(scopeMonths());
    const scopeRows = state.active.filter(r => state.scope.has(r.Month));

    renderHeader();
    renderPeriodCard(scopeRows);
    renderEod();
    if (state.isSummaryView) {
        renderSummaryTable(scopeRows);
    } else {
        ensureDepartment(scopeRows);
        renderDeptCards(scopeRows);
        renderOverview(scopeRows);
    }
}

function renderHeader() {
    const rows = state.active;
    const fyB = sum(rows.map(r => r.Budget));
    const fyA = sum(rows.map(r => r.Actual));
    const planToDate = sum(rows.filter(r => MONTH_INDEX[r.Month] <= state.asOfIdx).map(r => r.Budget));
    const variance = fyB - fyA;

    animateNumber($('kpiBudget'), fyB, v => moneyHtml(v));
    animateNumber($('kpiActual'), fyA, v => moneyHtml(v));
    animateNumber($('kpiVariance'), variance, v => `<span class="num">${fmtVariance(v)}</span><span class="unit">M PKR</span>`);
    $('kpiVariance').classList.toggle('is-over', variance < 0);
    $('kpiVarianceSub').textContent = variance < 0 ? 'Over full-year budget' : 'Under full-year budget';

    animateNumber($('kpiUtil'), pctOf(fyA, fyB) ?? 0, v => `<span class="num">${Math.round(v)}%</span>`);
    $('kpiUtilSub').textContent = `Plan to date ${fmtPct(pctOf(planToDate, fyB))}`;

    $('asOfStamp').textContent = state.asOfIdx >= 0
        ? `Actuals through ${monthYearLabel(FISCAL_MONTHS[state.asOfIdx])}`
        : 'No actuals recorded yet';
}

function renderDataCheckChip() {
    const chip = $('dataCheckChip');
    const issues = state.data.audit.filter(a => a.severity !== 'info').length;
    chip.hidden = false;
    chip.classList.toggle('has-issues', issues > 0);
    chip.textContent = issues ? `${issues} data ${issues === 1 ? 'item' : 'items'} to review` : 'Data checks passed';
}

function renderPeriodCard(scopeRows) {
    const g = totalAgg(scopeRows, []);
    $('periodCaption').textContent = periodLabel();
    animateNumber($('periodBudget'), g.b, v => moneyHtml(v));
    animateNumber($('periodActual'), g.a, v => moneyHtml(v));
    const varEl = $('periodVariance');
    animateNumber(varEl, g.b - g.a, v => `<span class="num">${fmtVariance(v)}</span><span class="unit">M PKR</span>`);
    varEl.classList.toggle('is-over', g.b - g.a < 0);
    $('periodBullet').innerHTML = bulletChart(g);
    $('periodDonorBars').innerHTML = donorBars(g.budgetDonors, g.actualDonors);
}

function renderEod() {
    const card = $('eodCard');
    const eod = state.data.eod;
    const endMonth = FISCAL_MONTHS[scopeEndIdx()];
    const target = new Date(calendarYearOf(endMonth, state.data.fyEnd), CALENDAR_MONTH[endMonth], 1);
    let idx = -1;
    eod.forEach((e, i) => { if (e.date <= target) idx = i; });

    if (idx < 0) {
        card.innerHTML = `<h2 class="card-title">Capital deployment (EOD)</h2><p class="empty-note">No EOD data for this period.</p>`;
        return;
    }
    const windowAvg = n => {
        const slice = eod.slice(Math.max(0, idx - n + 1), idx + 1);
        const dep = sum(slice.map(e => e.dep));
        const avail = sum(slice.map(e => e.avail));
        return { pct: avail ? (dep / avail) * 100 : 0, avail: avail / slice.length, dep: dep / slice.length };
    };
    const cur = eod[idx];
    const a3 = windowAvg(3);
    const a12 = windowAvg(12);
    const trend = eod.slice(Math.max(0, idx - 11), idx + 1).map(e => e.pct);
    const fmtPkrM = v => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

    card.innerHTML = `
        <h2 class="card-title">Capital deployment (EOD)</h2>
        <div class="eod-headline">
            <div>
                <div class="eod-pct">${cur.pct.toFixed(1)}%</div>
                <div class="eod-sub">${escapeHtml(cur.label)}</div>
            </div>
            <div class="eod-trend" data-tip="EOD % over the last ${trend.length} months; dashed line is the 12-month average">${sparkline(trend, trend.map(() => a12.pct), 120, 34)}</div>
        </div>
        <table class="mini-table eod-table">
            <thead><tr><th></th><th class="n">EOD</th><th class="n">Available</th><th class="n">Deployed</th></tr></thead>
            <tbody>
                <tr><td>This month</td><td class="n">${cur.pct.toFixed(1)}%</td><td class="n">${fmtPkrM(cur.avail)}</td><td class="n">${fmtPkrM(cur.dep)}</td></tr>
                <tr><td>3-month avg</td><td class="n">${a3.pct.toFixed(1)}%</td><td class="n">${fmtPkrM(a3.avail)}</td><td class="n">${fmtPkrM(a3.dep)}</td></tr>
                <tr><td>12-month avg</td><td class="n">${a12.pct.toFixed(1)}%</td><td class="n">${fmtPkrM(a12.avail)}</td><td class="n">${fmtPkrM(a12.dep)}</td></tr>
            </tbody>
        </table>
        <p class="table-note">Available and deployed capital in PKR million.</p>`;
}

function deptRank(d) {
    const i = state.data.deptOrder.indexOf(d);
    return i < 0 ? 999 : i;
}

function summaryRowCells(g) {
    const v = g.b - g.a;
    return `<td>${trendFor(g)}</td>
        <td class="n">${fmtM(g.b)}</td>
        <td class="n actual">${fmtM(g.a)}</td>
        <td class="n ${v < 0 ? 'is-over' : ''}">${fmtVariance(v)}</td>
        <td class="util-cell"><div class="util-wrap">${utilBar(g)}<span class="util-pct status-text-${statusOf(g)}">${fmtPct(pctOf(g.a, g.b))}</span></div></td>`;
}

function renderSummaryTable(scopeRows) {
    const groups = aggregateBy(r => r.Department, scopeRows, state.active);
    const depts = [...groups.keys()]
        .filter(d => groups.get(d).b !== 0 || groups.get(d).a !== 0)
        .sort((x, y) => deptRank(x) - deptRank(y));

    $('summaryTableBody').innerHTML = depts.map(d => `<tr class="clickable-tr" tabindex="0" data-dept="${escapeHtml(d)}">
            <td class="dept-name">${escapeHtml(d)}</td>${summaryRowCells(groups.get(d))}
        </tr>`).join('')
        || `<tr><td colspan="6" class="empty-note">No budget or spend for this selection.</td></tr>`;

    $('summaryTableFoot').innerHTML = `<tr><td>Total</td>${summaryRowCells(totalAgg(scopeRows, state.active))}</tr>`;
}

function ensureDepartment(scopeRows) {
    const depts = new Set(scopeRows.filter(r => r.Budget || r.Actual).map(r => r.Department));
    if (!depts.has(state.department)) {
        state.department = [...depts].sort((x, y) => deptRank(x) - deptRank(y))[0] || '';
    }
}

function sortGroups(names, groups, mode) {
    if (mode === 'Variance') return names.sort((x, y) => (groups.get(y).a - groups.get(y).b) - (groups.get(x).a - groups.get(x).b));
    return names.sort((x, y) => groups.get(y).a - groups.get(x).a);
}

function metricCard(name, g, { active = false, disabled = false, kind = 'dept' } = {}) {
    const v = g.b - g.a;
    const s = statusOf(g);
    const cls = kind === 'dept' ? 'dept-grid-card' : 'stream-grid-card';
    const attrs = kind === 'dept' ? `data-dept="${escapeHtml(name)}"` : `data-stream="${escapeHtml(name)}"`;
    return `<div class="metric-card ${cls} ${active ? 'active' : ''} ${disabled ? 'disabled-row' : ''}" ${attrs} tabindex="${disabled ? -1 : 0}" role="button" aria-disabled="${disabled}">
        <div class="mc-head">
            <div class="mc-title" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <span class="status-dot status-${s}" data-tip="${escapeHtml(statusTip(g))}"></span>
        </div>
        <div class="mc-middle">
            <div class="mc-remaining ${v < 0 ? 'is-over' : ''}"><span>${v < 0 ? 'Over by' : 'Remaining'}</span><strong>${fmtM(Math.abs(v))}</strong> M PKR</div>
            ${trendFor(g)}
        </div>
        <div class="mc-metrics">
            <div><span class="mc-val">${fmtM(g.a)}</span><span class="mc-lbl">Actual</span></div>
            <div><span class="mc-val status-text-${s}">${fmtPct(pctOf(g.a, g.b))}</span><span class="mc-lbl">Spent</span></div>
            <div><span class="mc-val">${fmtM(g.b)}</span><span class="mc-lbl">Budget</span></div>
        </div>
        ${utilBar(g)}
    </div>`;
}

function renderDeptCards(scopeRows) {
    const groups = aggregateBy(r => r.Department, scopeRows, state.active);
    const names = sortGroups([...groups.keys()].filter(d => groups.get(d).b !== 0 || groups.get(d).a !== 0), groups, $('sortDept').value);
    $('deptListContainer').innerHTML = names.map(d => metricCard(d, groups.get(d), { active: d === state.department })).join('')
        || '<p class="empty-note">No departments for this selection.</p>';
}

function renderOverview(scopeRows) {
    const dept = state.department;
    $('card3Title').textContent = dept || 'Department';
    const deptScope = scopeRows.filter(r => r.Department === dept);
    const deptAll = state.active.filter(r => r.Department === dept);
    const total = totalAgg(deptScope, deptAll);

    $('deptBullet').innerHTML = bulletChart(total);
    $('deptDonorBars').innerHTML = donorBars(total.budgetDonors, total.actualDonors);

    const groups = aggregateBy(r => r.Stream, deptScope, deptAll);
    const names = sortGroups([...groups.keys()].filter(s => groups.get(s).b !== 0 || groups.get(s).a !== 0), groups, $('sortStream').value);
    $('streamListContainer').innerHTML = names.map(s => metricCard(s, groups.get(s), { kind: 'stream', disabled: groups.get(s).a === 0 })).join('')
        || '<p class="empty-note">No streams for this department.</p>';
}

/* 9. MODALS =============================================================== */

/* 4. MODALS ============================================================== */

function openStreamModal(stream) {
    const dept = state.department;
    const months = FISCAL_MONTHS.filter(m => state.scope.has(m));
    const rows = state.active.filter(r => r.Department === dept && r.Stream === stream && state.scope.has(r.Month));

    const accounts = new Map();
    rows.forEach(r => {
        if (!accounts.has(r.Code)) accounts.set(r.Code, { code: r.Code, name: r.NaturalAccount, budget: 0, actual: 0, byMonth: {} });
        const acc = accounts.get(r.Code);
        acc.budget += r.Budget;
        acc.actual += r.Actual;
        acc.byMonth[r.Month] = (acc.byMonth[r.Month] || 0) + r.Actual;
    });

    state.modal = { dept, stream, months, accounts: [...accounts.values()].sort((x, y) => y.actual - x.actual) };
    const tB = sum(state.modal.accounts.map(a => a.budget));
    const tA = sum(state.modal.accounts.map(a => a.actual));

    $('modalStreamTitle').textContent = stream;
    $('modalStreamSubtitle').textContent = `${dept}, ${periodLabel()}${state.donor !== ALL_DONORS ? `, ${state.donor} only` : ''}`;
    $('btnStaffLink').hidden = !/staff|admin/i.test(dept);
    $('modalSearch').value = '';
    $('modalSummaryStats').innerHTML = `
        <div class="stat"><div class="stat-val">${moneyHtml(tB)}</div><div class="stat-lbl">Budget</div></div>
        <div class="stat"><div class="stat-val actual">${moneyHtml(tA)}</div><div class="stat-lbl">Actual</div></div>
        <div class="stat"><div class="stat-val"><span class="num">${fmtPct(pctOf(tA, tB))}</span></div><div class="stat-lbl">Spent</div></div>
        <div class="stat"><div class="stat-val ${tB - tA < 0 ? 'is-over' : ''}"><span class="num">${fmtVariance(tB - tA)}</span><span class="unit">M PKR</span></div><div class="stat-lbl">Variance</div></div>`;
    renderModalTable();
    openModal('streamModal');
}

function renderModalTable() {
    if (!state.modal) return;
    const { months, accounts } = state.modal;
    const term = $('modalSearch').value.trim().toLowerCase();
    const items = accounts.filter(a => !term || a.name.toLowerCase().includes(term) || a.code.toLowerCase().includes(term));

    $('modalTableHead').innerHTML = `<tr><th>Account</th>${months.map(m => `<th class="n">${m}</th>`).join('')}<th class="n">Actual</th><th class="n">Budget</th><th class="n">Variance</th></tr>`;
    $('modalTableBody').innerHTML = items.length
        ? items.map(a => `<tr>
            <td><div class="acc-name">${escapeHtml(a.name)}</div><div class="acc-code">${escapeHtml(a.code)}</div></td>
            ${months.map(m => `<td class="n">${a.byMonth[m] ? fmtM(a.byMonth[m], 2) : '–'}</td>`).join('')}
            <td class="n actual">${fmtM(a.actual, 2)}</td>
            <td class="n">${fmtM(a.budget, 2)}</td>
            <td class="n ${a.budget - a.actual < 0 ? 'is-over' : ''}">${fmtVariance(a.budget - a.actual, 2)}</td>
        </tr>`).join('')
        : `<tr><td colspan="${months.length + 4}" class="empty-note">No accounts match “${escapeHtml(term)}”.</td></tr>`;
}

function exportModalCSV() {
    if (!state.modal) return;
    const { dept, stream, months, accounts } = state.modal;
    const rows = [['Code', 'Account', ...months.map(m => `${m} actual (PKR)`), 'Actual (PKR)', 'Budget (PKR)', 'Variance (PKR)']];
    accounts.forEach(a => rows.push([a.code, a.name, ...months.map(m => (a.byMonth[m] || 0).toFixed(2)), a.actual.toFixed(2), a.budget.toFixed(2), (a.budget - a.actual).toFixed(2)]));
    downloadCSV(`BvA_${state.year}_${dept}_${stream}_${state.viewMode}_${state.period}.csv`, rows);
}

function openAuditModal() {
    const { audit, totals } = state.data;
    const order = { error: 0, warn: 1, info: 2 };
    const items = [...audit].sort((x, y) => order[x.severity] - order[y.severity]);
    const sevLabel = { error: 'Error', warn: 'Review', info: 'Note' };

    $('auditSummary').innerHTML = `
        <div class="stat"><div class="stat-val">${moneyHtml(totals.tbAll)}</div><div class="stat-lbl">Trial balance, all rows</div></div>
        <div class="stat"><div class="stat-val">${moneyHtml(totals.tbExcluded)}</div><div class="stat-lbl">Excluded: non-spend or wrong period</div></div>
        <div class="stat"><div class="stat-val">${moneyHtml(totals.investments + totals.capex)}</div><div class="stat-lbl">Added from investments and CAPEX</div></div>
        <div class="stat"><div class="stat-val ${totals.reconciled ? '' : 'is-over'}">${moneyHtml(totals.ledgerActual)}</div><div class="stat-lbl">${totals.reconciled ? 'Dashboard actual, reconciled' : 'Dashboard actual, does not reconcile'}</div></div>`;

    $('auditTableBody').innerHTML = items.length
        ? items.map(a => `<tr>
            <td><span class="sev sev-${a.severity}">${sevLabel[a.severity]}</span></td>
            <td>${escapeHtml(a.source || '')}</td>
            <td><div class="acc-name">${escapeHtml(a.description || '—')}</div><div class="acc-code">${escapeHtml([a.code, a.month].filter(Boolean).join(', '))}</div></td>
            <td class="n">${a.amount && Math.abs(a.amount) >= 5000 ? fmtM(a.amount, 2) : (a.amount ? '<0.01' : '')}</td>
            <td>${escapeHtml(a.mappedTo || '')}</td>
            <td>${escapeHtml(a.reason || '')}</td>
        </tr>`).join('')
        : `<tr><td colspan="6" class="empty-note">Every actual matched a budget line by account code.</td></tr>`;
    openModal('auditModal');
}

function exportAuditCSV() {
    const rows = [['Severity', 'Source', 'Code', 'Description', 'Month', 'Amount (PKR)', 'Mapped to', 'Reason']];
    state.data.audit.forEach(a => rows.push([a.severity, a.source, a.code, a.description, a.month, a.amount ? a.amount.toFixed(2) : '', a.mappedTo, a.reason]));
    downloadCSV(`BvA_${state.year}_data_checks.csv`, rows);
}

/* 5. EVENTS & INITIALISATION ============================================= */

function setSummaryView(isSummary) {
    state.isSummaryView = isSummary;
    document.body.classList.toggle('view-details', !isSummary);
    document.body.classList.toggle('view-summary', isSummary);
    $('btnBackToSummary').hidden = isSummary;
    render();
}

function openDepartment(dept) {
    state.department = dept;
    setSummaryView(false);
}

function syncToggleButtons() {
    document.querySelectorAll('[data-granularity]').forEach(b => {
        const on = b.dataset.granularity === state.granularity;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-viewmode]').forEach(b => {
        const on = b.dataset.viewmode === state.viewMode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = state.granularity === 'Yearly' && b.dataset.viewmode !== 'Period';
    });
}

function setGranularity(g) {
    const prev = state.period;
    state.granularity = g;
    state.period = nextPeriodFor(g, prev, state.asOfIdx);
    if (g === 'Yearly') state.viewMode = 'Period';
    else if (prev === 'FY' && state.viewMode === 'Period') state.viewMode = 'QTD';
    populatePeriodDropdown();
    syncToggleButtons();
    render();
}

function populatePeriodDropdown() {
    const sel = $('periodDropdown');
    sel.innerHTML = periodOptionsFor(state.granularity, state.data.fyEnd).map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
    sel.value = state.period;
    sel.disabled = state.granularity === 'Yearly';
}

function populateYearDropdown() {
    $('yearDropdown').innerHTML = [...state.years].sort().reverse()
        .map(y => `<option value="${escapeHtml(y)}" ${y === state.year ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('');
}

function populateDonorDropdown() {
    const donors = new Set();
    state.data.rows.forEach(r => {
        Object.keys(r.BudgetDonors).forEach(d => donors.add(d));
        Object.keys(r.ActualDonors).forEach(d => donors.add(d));
    });
    const sorted = [...donors].sort();
    sorted.forEach(donorColor);   // fixes each donor's colour for the session
    if (state.donor !== ALL_DONORS && !donors.has(state.donor)) state.donor = ALL_DONORS;
    $('donorDropdown').innerHTML = [ALL_DONORS, ...sorted]
        .map(d => `<option value="${escapeHtml(d)}" ${d === state.donor ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
}

function bindEvents() {
    bindCommonEvents();
    $('yearDropdown').addEventListener('change', e => loadYear(e.target.value));
    $('donorDropdown').addEventListener('change', e => { state.donor = e.target.value; render(); });
    $('periodDropdown').addEventListener('change', e => { state.period = e.target.value; render(); });
    $('btnBackToSummary').addEventListener('click', () => setSummaryView(true));
    $('sortDept').addEventListener('change', render);
    $('sortStream').addEventListener('change', render);
    $('dataCheckChip').addEventListener('click', openAuditModal);
    $('btnRetry').addEventListener('click', () => loadYear(state.year));
    $('modalSearch').addEventListener('input', debounce(renderModalTable, 120));
    $('btnExportModal').addEventListener('click', exportModalCSV);
    $('btnExportAudit').addEventListener('click', exportAuditCSV);

    document.querySelectorAll('[data-granularity]').forEach(b => b.addEventListener('click', () => setGranularity(b.dataset.granularity)));
    document.querySelectorAll('[data-viewmode]').forEach(b => b.addEventListener('click', () => {
        state.viewMode = b.dataset.viewmode;
        syncToggleButtons();
        render();
    }));

    onActivate($('summaryTableBody'), 'tr[data-dept]', el => openDepartment(el.dataset.dept));
    onActivate($('deptListContainer'), '[data-dept]', el => { state.department = el.dataset.dept; render(); });
    onActivate($('streamListContainer'), '[data-stream]', el => openStreamModal(el.dataset.stream));
}

async function loadYear(year) {
    state.year = year;
    setLoader(true, `Loading ${year}…`);
    try {
        const p = filePaths(year);
        const [budget, tb, innovation, cic, capex, eod] = await Promise.all([
            fetchTable(p.budget, true, FILE_HINTS.budget), fetchTable(p.tb, true, FILE_HINTS.tb),
            fetchTable(p.innovation, false, FILE_HINTS.innovation), fetchTable(p.cic, false, FILE_HINTS.cic),
            fetchTable(p.capex, false, FILE_HINTS.capex), fetchTable(p.eod, false, FILE_HINTS.eod)
        ]);
        const data = buildDataset(year, { budget, tb, innovation, cic, capex, eod });
        if (!data.rows.length) throw new Error(`No budget or actuals found for ${year}.`);

        state.data = data;
        state.asOfIdx = Math.max(-1, ...data.rows.filter(r => r.Actual !== 0).map(r => MONTH_INDEX[r.Month]));
        const asOfMonth = FISCAL_MONTHS[Math.max(0, state.asOfIdx)];
        if (state.granularity === 'Monthly') state.period = asOfMonth;
        else if (state.granularity === 'Quarterly') state.period = MONTH_QUARTER[asOfMonth];

        populateYearDropdown();
        populateDonorDropdown();
        populatePeriodDropdown();
        syncToggleButtons();
        renderDataCheckChip();
        render();
        setLoader(false);
    } catch (err) {
        console.error(err);
        setLoader(true, err.message, true);
    }
}

async function init() {
    initTheme();
    bindEvents();
    state.years = await loadYears();
    await loadYear(state.years[state.years.length - 1]);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__BVA_TEST__) {
    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
}
