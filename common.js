'use strict';
/* ==========================================================================
   Karandaaz Pakistan — shared code for the BvA and Staff cost dashboards
   Loaded before bva-data.js, app.js and staff_app.js.
   --------------------------------------------------------------------------
   Configuration · utilities · CSV reading · period scope · status ·
   chart components · tooltip · modals · theme · loading
   ========================================================================== */

/* CONFIGURATION ========================================================== */

const APP_VERSION = '2026.09.24';
const FALLBACK_YEARS = ['FY2026', 'FY2027'];      // used only if Data/years.json is missing
const DEFAULT_DONOR = 'OSR';
const ALL_DONORS = 'All Donors';
const BEHIND_PACE_THRESHOLD = 0.75;               // spend below 75% of plan-to-date = "behind pace"
/* Donor colours avoid the green / amber / orange used for status. */
const DONOR_PALETTE = ['#006890', '#4a96d2', '#0f9d9a', '#7c5cc4', '#2f4858', '#93b5d6', '#b5838d', '#6b7f3a'];

const FISCAL_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const MONTH_INDEX = Object.fromEntries(FISCAL_MONTHS.map((m, i) => [m, i]));
const MONTH_LONG = { Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December', Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June' };
const CALENDAR_MONTH = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const QUARTER_MONTHS = { Q1: ['Jul', 'Aug', 'Sep'], Q2: ['Oct', 'Nov', 'Dec'], Q3: ['Jan', 'Feb', 'Mar'], Q4: ['Apr', 'May', 'Jun'] };
const MONTH_QUARTER = {};
Object.entries(QUARTER_MONTHS).forEach(([q, ms]) => ms.forEach(m => { MONTH_QUARTER[m] = q; }));

/* UTILITIES ============================================================ */

const $ = id => document.getElementById(id);
const sum = arr => arr.reduce((s, v) => s + v, 0);
const clean = v => (v === undefined || v === null ? '' : String(v).trim());
const normName = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getSafeNum(val) {
    const str = clean(val);
    if (str === '' || str === '-') return 0;
    const isNegative = (str.includes('(') && str.includes(')')) || str.startsWith('-');
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return 0;
    return isNegative ? -num : num;
}

/* All money on screen is in millions of PKR. */
function fmtM(v, dp = 1) {
    return (v / 1e6).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
/* Accounting style: over-budget variance shown in parentheses. */
function fmtVariance(v, dp = 1) {
    const s = fmtM(Math.abs(v), dp);
    return v < 0 ? `(${s})` : s;
}
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : null);
const fmtPct = p => (p === null || !isFinite(p) ? '—' : `${Math.round(p)}%`);

function moneyHtml(v, dp = 1) {
    return `<span class="num">${fmtM(v, dp)}</span><span class="unit">M PKR</span>`;
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function parseMonthLabel(raw) {
    const m = clean(raw).match(/^([A-Za-z]{3,9})\.?[\s\-_']*(\d{2}|\d{4})?$/);
    if (!m) return null;
    const month = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
    if (!(month in MONTH_INDEX)) return null;
    let year = m[2] ? parseInt(m[2], 10) : null;
    if (year !== null && year < 100) year += 2000;
    return { month, year };
}

/* Calendar year a fiscal month falls in: FY2027 → Jul–Dec 2026, Jan–Jun 2027. */
const calendarYearOf = (month, fyEnd) => (MONTH_INDEX[month] < 6 ? fyEnd - 1 : fyEnd);
const inFiscalYear = (p, fyEnd) => p.year === null || p.year === calendarYearOf(p.month, fyEnd);

function downloadCSV(filename, rows) {
    const esc = v => {
        const s = String(v ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[^\w.\-]+/g, '_');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* CSV READING ========================================================== */

function readCSV(text) {
    if (!text) return null;
    const res = Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: h => h.replace(/\s+/g, ' ').trim()
    });
    return { headers: res.meta.fields || [], rows: res.data };
}

function resolveColumns(headers, spec, fileLabel) {
    const byNorm = new Map(headers.map(h => [normName(h), h]));
    const col = {};
    Object.entries(spec.fields).forEach(([field, aliases]) => {
        col[field] = null;
        for (const a of aliases) {
            if (byNorm.has(a)) { col[field] = byNorm.get(a); break; }
        }
    });
    const missing = spec.required.filter(f => !col[f]);
    if (missing.length) {
        throw new Error(`${fileLabel} is missing required column(s): ${missing.join(', ')}. Found: ${headers.slice(0, 8).join(', ') || 'none'}.`);
    }
    return col;
}

/* Returns [{ month, header }] for month columns belonging to this fiscal year. */
function detectMonthColumns(headers, fileLabel, ctx) {
    const out = [];
    const rejected = [];
    headers.forEach(h => {
        const p = parseMonthLabel(h);
        if (!p) return;
        if (inFiscalYear(p, ctx.fyEnd)) out.push({ month: p.month, header: h });
        else rejected.push(h);
    });
    if (rejected.length) {
        ctx.flag({
            severity: 'error', source: fileLabel,
            reason: `Month columns ${rejected[0]} to ${rejected[rejected.length - 1]} are outside ${ctx.year}, so they were ignored. Check that the right file is in the ${ctx.year} folder.`
        });
    }
    return out;
}

/* DONOR COLOURS & STATUS ================================================ */

/* One colour per donor for the whole session, so a donor looks the same in every chart. */
const donorColors = new Map();

function donorColor(d) {
    if (!donorColors.has(d)) donorColors.set(d, DONOR_PALETTE[donorColors.size % DONOR_PALETTE.length]);
    return donorColors.get(d);
}

const STATUS_LABEL = { ontrack: 'On track', behind: 'Behind pace', over: 'Over budget', neutral: 'Not started' };

function statusOf(g) {
    if (g.b <= 0) return g.a > 0 ? 'over' : 'neutral';
    if (g.a > g.b) return 'over';
    if (g.pace <= 0) return 'neutral';
    if (g.a < g.pace * BEHIND_PACE_THRESHOLD) return 'behind';
    return 'ontrack';
}

function statusTip(g) {
    const planPct = g.b > 0 ? (g.pace / g.b) * 100 : 0;
    return `${STATUS_LABEL[statusOf(g)]}: ${fmtPct(pctOf(g.a, g.b))} of budget spent, plan to date ${fmtPct(planPct)}`;
}

/* CHART COMPONENTS ======================================================= */

function sparkline(actual, budget, w = 72, h = 22) {
    if (!actual || actual.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const max = Math.max(...actual, ...budget, 1);
    const min = Math.min(0, ...actual);
    const range = max - min || 1;
    const step = w / (actual.length - 1);
    const y = v => (h - 2 - ((v - min) / range) * (h - 4)).toFixed(1);
    const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v)}`).join(' ');
    const last = actual.length - 1;
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <path class="spark-budget" d="${path(budget)}"/>
        <path class="spark-actual" d="${path(actual)}"/>
        <circle class="spark-dot" cx="${(last * step).toFixed(1)}" cy="${y(actual[last])}" r="2"/>
    </svg>`;
}

function utilBar(g) {
    const s = statusOf(g);
    const pct = g.b > 0 ? Math.min(100, (g.a / g.b) * 100) : (g.a > 0 ? 100 : 0);
    const plan = g.b > 0 ? (g.pace / g.b) * 100 : 0;
    const marker = plan > 0 && plan < 100 ? `<span class="pace-marker" style="--x:${plan.toFixed(1)}%"></span>` : '';
    return `<div class="util-bar status-${s}" data-tip="${escapeHtml(statusTip(g))}">
        <div class="util-track"><div class="util-fill" style="--w:${Math.max(0, pct).toFixed(1)}%"></div>${marker}</div>
    </div>`;
}

/* Larger bullet chart used in the period and department overview cards. */
function bulletChart(g) {
    const s = statusOf(g);
    const spent = pctOf(g.a, g.b);
    const plan = g.b > 0 ? (g.pace / g.b) * 100 : 0;
    const fill = g.b > 0 ? Math.min(100, Math.max(0, spent)) : (g.a > 0 ? 100 : 0);
    const marker = plan > 0 && plan < 100
        ? `<span class="pace-marker" style="--x:${plan.toFixed(1)}%"><span class="pace-label">Plan ${Math.round(plan)}%</span></span>` : '';
    return `<div class="bullet status-${s}">
        <div class="bullet-head">
            <span class="bullet-pct">${fmtPct(spent)}</span>
            <span class="bullet-caption">of budget spent</span>
            <span class="status-chip status-${s}">${STATUS_LABEL[s]}</span>
        </div>
        <div class="bullet-track"><div class="bullet-fill" style="--w:${fill.toFixed(1)}%"></div>${marker}</div>
    </div>`;
}

/* Budget and Spent as two stacked bars on one scale, one colour per donor. */
function donorBars(budgetByDonor, actualByDonor) {
    const donors = [...new Set([...Object.keys(budgetByDonor), ...Object.keys(actualByDonor)])]
        .filter(d => (budgetByDonor[d] || 0) !== 0 || (actualByDonor[d] || 0) !== 0)
        .sort((x, y) => (budgetByDonor[y] || 0) - (budgetByDonor[x] || 0));
    if (!donors.length) return '<p class="empty-note">No donor-tagged budget or spend in this period.</p>';

    const pos = v => Math.max(0, v || 0);
    const scale = Math.max(sum(donors.map(d => pos(budgetByDonor[d]))), sum(donors.map(d => pos(actualByDonor[d]))), 1);
    const bar = (label, src) => `<div class="donor-bar-row">
        <span class="donor-bar-label">${label}</span>
        <div class="donor-bar-track">${donors.map(d => {
            const v = pos(src[d]);
            if (!v) return '';
            return `<span class="donor-seg" style="--w:${((v / scale) * 100).toFixed(2)}%; --c:${donorColor(d)}" data-tip="${escapeHtml(`${d}: ${fmtM(v)} M PKR`)}"></span>`;
        }).join('')}</div>
    </div>`;

    const legend = donors.map(d => {
        const b = budgetByDonor[d] || 0;
        const a = actualByDonor[d] || 0;
        return `<tr>
            <td><span class="swatch" style="--c:${donorColor(d)}"></span>${escapeHtml(d)}</td>
            <td class="n">${fmtM(b)}</td>
            <td class="n">${fmtM(a)}</td>
            <td class="n">${fmtPct(pctOf(a, b))}</td>
        </tr>`;
    }).join('');

    return `<div class="donor-bars">
        ${bar('Budget', budgetByDonor)}
        ${bar('Spent', actualByDonor)}
        <table class="donor-legend">
            <thead><tr><th>Donor</th><th class="n">Budget</th><th class="n">Spent</th><th class="n">Spent %</th></tr></thead>
            <tbody>${legend}</tbody>
        </table>
    </div>`;
}

/* Counts a number up to its new value. Formatter receives the in-between value. */
function animateNumber(el, target, format) {
    if (!el) return;
    const start = el._val ?? 0;
    el._val = target;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || start === target) { el.innerHTML = format(target); return; }
    const t0 = performance.now();
    const dur = 900;
    const tick = now => {
        const p = Math.min((now - t0) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.innerHTML = format(start + (target - start) * e);
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* MODALS & TOOLTIP ======================================================= */

let lastFocus = null;

function openModal(id) {
    lastFocus = document.activeElement;
    const m = $(id);
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    const focusable = m.querySelector('input, button');
    if (focusable) focusable.focus();
}

function closeModals() {
    const open = document.querySelectorAll('.modal.open');
    if (!open.length) return;
    open.forEach(m => {
        m.classList.remove('open');
        m.setAttribute('aria-hidden', 'true');
    });
    hideTooltip();
    if (lastFocus) lastFocus.focus();
}

const tooltip = () => $('hoverTooltip');
function showTooltip(target, e) {
    const t = tooltip();
    t.textContent = target.getAttribute('data-tip');
    t.classList.add('visible');
    moveTooltip(e);
}
function moveTooltip(e) {
    const t = tooltip();
    const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8);
    t.style.left = `${x}px`;
    t.style.top = `${e.clientY + 14}px`;
}
function hideTooltip() { const t = tooltip(); if (t) t.classList.remove('visible'); }

function initTheme() {
    let dark = false;
    try {
        const saved = localStorage.getItem('bva-theme');
        dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) { /* storage unavailable */ }
    applyTheme(dark);
}
function applyTheme(dark) {
    document.body.classList.toggle('light-mode', !dark);
    $('themeToggle').setAttribute('aria-pressed', String(dark));
    $('themeLabel').textContent = dark ? 'Dark' : 'Light';
}
function toggleTheme() {
    const dark = document.body.classList.contains('light-mode');
    applyTheme(dark);
    try { localStorage.setItem('bva-theme', dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
}

function setLoader(visible, message, isError = false) {
    const l = $('loadingOverlay');
    l.classList.toggle('hidden', !visible);
    l.classList.toggle('is-error', isError);
    $('loaderStatusText').textContent = message || '';
    $('btnRetry').hidden = !isError;
}

async function fetchText(path, required) {
    const res = await fetch(path, { cache: 'no-cache' });   // always revalidate monthly data drops
    if (!res.ok) {
        if (required) throw new Error(`Could not load ${path} (HTTP ${res.status}).`);
        return '';
    }
    return res.text();
}

async function loadYears() {
    try {
        const res = await fetch(`Data/years.json?v=${APP_VERSION}`, { cache: 'no-cache' });
        if (res.ok) {
            const years = await res.json();
            if (Array.isArray(years) && years.length) return years.map(String);
        }
    } catch (e) { /* fall through to the fallback list */ }
    return FALLBACK_YEARS;
}

/* PERIOD SCOPE =========================================================== */

/* Months covered by a Monthly/Quarterly/Yearly × Period/QTD/YTD selection. */
function scopeMonthsFor(granularity, viewMode, period) {
    if (granularity === 'Yearly') return FISCAL_MONTHS;
    if (granularity === 'Monthly') {
        const idx = MONTH_INDEX[period];
        if (viewMode === 'Period') return [period];
        if (viewMode === 'QTD') return QUARTER_MONTHS[MONTH_QUARTER[period]].filter(m => MONTH_INDEX[m] <= idx);
        return FISCAL_MONTHS.slice(0, idx + 1);
    }
    const qIdx = QUARTERS.indexOf(period);
    if (viewMode === 'YTD') return QUARTERS.slice(0, qIdx + 1).flatMap(q => QUARTER_MONTHS[q]);
    return QUARTER_MONTHS[period];
}

function monthYearLabelFor(month, fyEnd) {
    return `${MONTH_LONG[month]} ${calendarYearOf(month, fyEnd)}`;
}

function periodLabelFor({ granularity, viewMode, period, year, fyEnd }) {
    if (granularity === 'Yearly') return `Full year ${year}`;
    if (granularity === 'Quarterly') return viewMode === 'YTD' ? `Year to date through ${period} ${year}` : `${period} ${year}`;
    if (viewMode === 'Period') return monthYearLabelFor(period, fyEnd);
    if (viewMode === 'QTD') return `${MONTH_QUARTER[period]} to date, through ${monthYearLabelFor(period, fyEnd)}`;
    return `Year to date, through ${monthYearLabelFor(period, fyEnd)}`;
}

/* Period to select when the granularity changes, anchored on the latest month with data. */
function nextPeriodFor(granularity, prevPeriod, asOfIdx) {
    const asOfMonth = FISCAL_MONTHS[Math.max(0, asOfIdx)];
    if (granularity === 'Yearly') return 'FY';
    if (granularity === 'Quarterly') return MONTH_QUARTER[prevPeriod] || (QUARTERS.includes(prevPeriod) ? prevPeriod : MONTH_QUARTER[asOfMonth]);
    if (QUARTERS.includes(prevPeriod)) {
        const ms = QUARTER_MONTHS[prevPeriod];
        return ms.includes(asOfMonth) ? asOfMonth : ms[2];
    }
    return prevPeriod in MONTH_INDEX ? prevPeriod : asOfMonth;
}

function periodOptionsFor(granularity, fyEnd) {
    if (granularity === 'Monthly') return FISCAL_MONTHS.map(m => [m, monthYearLabelFor(m, fyEnd)]);
    if (granularity === 'Quarterly') return QUARTERS.map(q => [q, `${q} (${MONTH_LONG[QUARTER_MONTHS[q][0]]} to ${MONTH_LONG[QUARTER_MONTHS[q][2]]})`]);
    return [['FY', 'Full year (July to June)']];
}

/* SHARED EVENTS ========================================================== */

/* Tooltip, modal close, Escape and theme toggle — identical on both pages. */
function bindCommonEvents() {
    const toggle = $('themeToggle');
    if (toggle) toggle.addEventListener('click', toggleTheme);
    document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
    document.addEventListener('mouseover', e => {
        const t = e.target.closest('[data-tip]');
        if (t) showTooltip(t, e); else hideTooltip();
    });
    document.addEventListener('mousemove', e => { const t = tooltip(); if (t && t.classList.contains('visible')) moveTooltip(e); });
}

/* Delegated click + Enter/Space activation for rows and cards built from data. */
function onActivate(container, selector, fn) {
    const handler = e => {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest(selector);
        if (!el || !container.contains(el) || el.classList.contains('disabled-row')) return;
        if (e.type === 'keydown') e.preventDefault();
        fn(el);
    };
    container.addEventListener('click', handler);
    container.addEventListener('keydown', handler);
}

