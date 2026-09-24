'use strict';
/* ==========================================================================
   Karandaaz Pakistan — Budget vs Actual dashboard
   --------------------------------------------------------------------------
   1. Configuration        6. Aggregation & status
   2. Utilities            7. Components (bars, sparklines, donor bars)
   3. CSV reading          8. Rendering
   4. Data parsing         9. Modals (drill-down, data checks)
   5. State & scope       10. Events & initialisation
   ========================================================================== */

/* 1. CONFIGURATION ======================================================== */

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

function filePaths(year) {
    return {
        budget: `Data/${year}/Budget.csv`,
        tb: `Data/${year}/ActualDonor.csv`,
        innovation: `Data/${year}/Innovation.csv`,
        cic: `Data/${year}/CIC.csv`,
        capex: `Data/${year}/CAPEX.csv`,
        eod: `Data/${year}/EOD.csv`
    };
}

/* Explicit column map. Header names are normalised (lower-case, letters and
   digits only) before matching, so "Account code" matches "accountcode".
   To support a renamed column, add its normalised name to the alias list.  */
const COLUMN_SPECS = {
    budget: {
        fields: {
            department: ['department', 'dept'],
            program: ['program', 'programme'],
            stream: ['stream', 'workstream', 'expenseitems'],
            code: ['accountcode', 'code', 'acct'],
            name: ['accountname', 'accountdescription', 'description', 'name'],
            donor: ['donor', 'fund'],
            q1: ['q1budget', 'q1'], q2: ['q2budget', 'q2'], q3: ['q3budget', 'q3'], q4: ['q4budget', 'q4'],
            annual: ['annualbudget', 'yearlybudget', 'totalbudget']
        },
        required: ['department']
    },
    tb: {
        fields: {
            code: ['naturalacctsegmentvalue', 'naturalaccount', 'accountcode'],
            desc: ['naturalacctsegmentdesc', 'accountdescription'],
            donor: ['additionalsegmentdesc'],
            donorFallback: ['donor', 'fund'],
            type: ['accttype'],
            dr: ['totaldr', 'debit'],
            cr: ['totalcr', 'credit'],
            period: ['accountingperiodparam', 'period']
        },
        required: ['code', 'dr', 'cr', 'period']
    },
    investment: {
        fields: { party: ['party'], type: ['type'] },
        required: ['party']
    },
    capex: {
        fields: {
            description: ['description', 'item', 'particulars'],
            code: ['accountcode', 'code'],
            budget: ['budget', 'annualbudget']
        },
        required: ['description']
    },
    eod: {
        fields: {
            month: ['month'],
            statedPct: ['eod'],
            available: ['capitalavailablepkrmillion', 'capitalavailablefordeploymentpkrmillion', 'capitalavailable'],
            deployed: ['capitaldeployedpkrmillion', 'capitaldeployed']
        },
        required: ['month', 'available', 'deployed']
    }
};

/* 2. UTILITIES ============================================================ */

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

/* 3. CSV READING ========================================================== */

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

/* 4. DATA PARSING ========================================================= */

function createLedger() {
    const records = new Map();
    return {
        add(month, mapping, donor, { budget = 0, actual = 0 }) {
            const key = `${month}|${mapping.Code}|${mapping.Program}|${donor}`;
            let r = records.get(key);
            if (!r) {
                r = {
                    Department: mapping.Dept, Stream: mapping.Stream, Program: mapping.Program,
                    Code: mapping.Code, NaturalAccount: mapping.Name, Month: month,
                    Budget: 0, Actual: 0, BudgetDonors: {}, ActualDonors: {}
                };
                records.set(key, r);
            }
            if (budget) {
                r.Budget += budget;
                r.BudgetDonors[donor] = (r.BudgetDonors[donor] || 0) + budget;
            }
            if (actual) {
                r.Actual += actual;
                r.ActualDonors[donor] = (r.ActualDonors[donor] || 0) + actual;
            }
        },
        values: () => [...records.values()]
    };
}

const isTotalLabel = s => {
    const u = clean(s).toUpperCase();
    return u === 'TOTAL' || /^SUB-?TOTAL/.test(u) || u.includes('TOTAL EXPENSES');
};

function parseBudget(table, ctx) {
    const col = resolveColumns(table.headers, COLUMN_SPECS.budget, 'Budget.csv');
    const coa = new Map();       // account code → mapping
    const byName = new Map();    // normalised account name → mapping (only real names)
    const deptOrder = [];

    table.rows.forEach((row, i) => {
        const dept = clean(row[col.department]) || 'Uncategorized';
        const rawName = clean(row[col.name]);
        /* A cell may hold several codes ("D108006, D103004"); each maps to this line. */
        const codes = clean(row[col.code]).toUpperCase().split(/[,;\/]+/).map(c => c.trim()).filter(c => c && c !== 'NAN');
        let code = codes[0] || '';
        if (isTotalLabel(dept) || isTotalLabel(rawName) || code.includes('SUBTOTAL')) return;
        if (!code) code = `BUD-${i + 2}`;   // i + 2 = spreadsheet row number

        const stream = clean(row[col.stream]) || 'General';
        const program = clean(row[col.program]) || 'Unallocated';
        const donor = clean(row[col.donor]) || DEFAULT_DONOR;
        const mapping = { Dept: dept, Stream: stream, Name: rawName || stream, Program: program, Donor: donor, Code: code };

        coa.set(code, mapping);
        codes.slice(1).forEach(c => coa.set(c, mapping));
        if (rawName) {
            const k = normName(rawName);
            if (!byName.has(k)) byName.set(k, mapping);
        }
        if (!deptOrder.includes(dept)) deptOrder.push(dept);

        let q = ['q1', 'q2', 'q3', 'q4'].map(f => (col[f] ? getSafeNum(row[col[f]]) : 0));
        if (q.every(v => v === 0) && col.annual) {
            const y = getSafeNum(row[col.annual]);
            q = [y / 4, y / 4, y / 4, y / 4];
        }
        q.forEach((qv, qi) => {
            if (!qv) return;
            QUARTER_MONTHS[QUARTERS[qi]].forEach(m => ctx.ledger.add(m, mapping, donor, { budget: qv / 3 }));
        });
    });
    return { coa, byName, deptOrder };
}

/* Name matching used when an account code isn't in Budget.csv.
   Partial (substring) matches need 6+ characters on both sides and are always flagged. */
function matchByName(desc, chart) {
    const n = normName(desc);
    if (!n) return null;
    if (chart.byName.has(n)) return { mapping: chart.byName.get(n), method: 'Exact name match' };
    if (n.length < 6) return null;
    for (const [k, mapping] of chart.byName) {
        if (k.length >= 6 && (k.includes(n) || n.includes(k))) return { mapping, method: 'Partial name match' };
    }
    return null;
}

function mapTbAccount(code, desc, type, chart) {
    if (chart.coa.has(code)) {
        const m = { ...chart.coa.get(code) };
        if (code.startsWith('D')) m.Dept = 'Digital Financial Services';   // business rule: D-codes are DFS
        return { mapping: m, method: 'Account code' };
    }
    if (['R', 'A', 'L', 'Q'].includes(type)) return null;   // revenue / balance-sheet — not spend

    const named = matchByName(desc, chart);
    if (named) return { mapping: { ...named.mapping }, method: named.method };

    const base = { Stream: desc, Name: desc, Program: 'Unallocated', Donor: DEFAULT_DONOR };
    if (code.startsWith('D')) return { mapping: { ...base, Dept: 'Digital Financial Services' }, method: 'Code prefix D' };
    if (code.startsWith('K')) return { mapping: { ...base, Dept: 'Research, Marketing & Communications' }, method: 'Code prefix K' };
    if (code.startsWith('H') || code.startsWith('S')) return { mapping: { ...base, Dept: 'Administrative Expenses', Stream: 'Unmapped Admin' }, method: `Code prefix ${code[0]}` };
    return { mapping: { ...base, Dept: 'Unmapped Actuals', Stream: 'Unmapped', Program: 'Unmapped' }, method: 'Not mapped' };
}

function resolveTbDonor(row, col, mapping) {
    const blank = s => !s || ['nan', '0', 'undefined'].includes(s.toLowerCase());
    let d = clean(row[col.donor]);
    if (blank(d) && col.donorFallback) d = clean(row[col.donorFallback]);
    if (blank(d)) d = mapping.Donor || DEFAULT_DONOR;
    if (blank(d)) d = DEFAULT_DONOR;

    const low = d.toLowerCase();
    if (low.includes(' and ') || low.includes(' & ') || low.includes('+')) return DEFAULT_DONOR;   // mixed funding
    const isDfs = mapping.Dept === 'Digital Financial Services' || mapping.Dept === 'DFS';
    if (!isDfs && (low.includes('fcdo') || low.includes('n/a'))) return DEFAULT_DONOR;
    return d;
}

function parseTrialBalance(table, chart, ctx) {
    const col = resolveColumns(table.headers, COLUMN_SPECS.tb, 'ActualDonor.csv');
    table.rows.forEach(row => {
        const code = clean(row[col.code]).toUpperCase();
        const actual = getSafeNum(row[col.dr]) - getSafeNum(row[col.cr]);
        if (!actual) return;
        ctx.totals.tbAll += actual;
        if (!code) { ctx.totals.tbExcluded += actual; return; }

        const desc = clean(row[col.desc]) || code;
        const period = parseMonthLabel(row[col.period]);
        if (!period || !inFiscalYear(period, ctx.fyEnd)) {
            ctx.totals.tbExcluded += actual;
            ctx.flag({ severity: 'error', source: 'Trial balance', code, description: desc, amount: actual, month: clean(row[col.period]), reason: `Period is outside ${ctx.year}, so the row was ignored` });
            return;
        }

        const type = col.type ? clean(row[col.type]).toUpperCase() : '';
        const hit = mapTbAccount(code, desc, type, chart);
        if (!hit) { ctx.totals.tbExcluded += actual; return; }

        const mapping = { ...hit.mapping, Code: code };   // keep the real GL code for traceability
        const donor = resolveTbDonor(row, col, mapping);
        ctx.ledger.add(period.month, mapping, donor, { actual });
        ctx.totals.tbIncluded += actual;

        if (hit.method !== 'Account code') {
            const guessed = hit.method.startsWith('Partial') || hit.method.startsWith('Code prefix') || hit.method === 'Not mapped';
            ctx.flag({
                severity: guessed ? 'warn' : 'info', source: 'Trial balance', code, description: desc,
                month: period.month, amount: actual,
                mappedTo: `${mapping.Dept} / ${mapping.Stream}`, reason: `Code not in Budget.csv, placed by ${hit.method.charAt(0).toLowerCase()}${hit.method.slice(1)}`
            });
        }
    });
}

function parseInvestments(table, deptName, fileLabel, ctx) {
    if (!table) return;
    const col = resolveColumns(table.headers, COLUMN_SPECS.investment, fileLabel);
    const months = detectMonthColumns(table.headers, fileLabel, ctx);
    const prefix = deptName.split(/\s+/).map(w => w[0]).join('').toUpperCase();
    table.rows.forEach((row, i) => {
        const party = clean(row[col.party]);
        if (!party || /total/i.test(party)) return;
        const mapping = {
            Dept: deptName, Stream: clean(row[col.type]) || 'General', Name: party,
            Program: 'Unallocated', Donor: DEFAULT_DONOR, Code: `INV-${prefix}-${i + 2}`
        };
        months.forEach(({ month, header }) => {
            const v = getSafeNum(row[header]);
            if (!v) return;
            ctx.ledger.add(month, mapping, DEFAULT_DONOR, { actual: v });
            ctx.totals.investments += v;
        });
    });
}

/* CAPEX actuals are added as ACTUALS ONLY. Budget comes from Budget.csv when the
   item is found there; otherwise from CAPEX.csv's own Budget column (spread evenly). */
function parseCapex(table, chart, ctx) {
    if (!table) return;
    const col = resolveColumns(table.headers, COLUMN_SPECS.capex, 'CAPEX.csv');
    const months = detectMonthColumns(table.headers, 'CAPEX.csv', ctx);
    const capexDept = chart.deptOrder.find(d => /capex|capital/i.test(d)) || 'CAPEX';
    const seen = new Set();

    table.rows.forEach(row => {
        const desc = clean(row[col.description]);
        const rawCode = col.code ? clean(row[col.code]).toUpperCase() : '';
        const key = rawCode || desc.toUpperCase();
        if (!key || /\b(SUB-?TOTAL|TOTAL|BALANCE|NET)\b/.test(key)) return;
        if (seen.has(key)) return;
        seen.add(key);

        const hit = rawCode && chart.coa.has(rawCode) ? { mapping: chart.coa.get(rawCode), method: 'Account code' } : matchByName(desc, chart);
        let mapping;
        if (hit) {
            mapping = hit.mapping;
            if (hit.method.startsWith('Partial')) {
                ctx.flag({ severity: 'warn', source: 'CAPEX', description: desc, mappedTo: `${mapping.Dept} / ${mapping.Name}`, reason: 'Partial name match to Budget.csv' });
            }
        } else {
            mapping = { Dept: capexDept, Stream: desc, Name: desc, Program: 'Unallocated', Donor: DEFAULT_DONOR, Code: `CAPEX-${normName(desc).toUpperCase().slice(0, 24)}` };
            const annual = col.budget ? getSafeNum(row[col.budget]) : 0;
            if (annual) {
                FISCAL_MONTHS.forEach(m => ctx.ledger.add(m, mapping, DEFAULT_DONOR, { budget: annual / 12 }));
                ctx.flag({ severity: 'info', source: 'CAPEX', description: desc, amount: annual, mappedTo: capexDept, reason: 'Not in Budget.csv. CAPEX.csv budget used, spread evenly over 12 months' });
            }
        }

        months.forEach(({ month, header }) => {
            const v = getSafeNum(row[header]);
            if (!v) return;
            ctx.ledger.add(month, mapping, DEFAULT_DONOR, { actual: v });
            ctx.totals.capex += v;
        });
    });
}

function parseEod(table, ctx) {
    if (!table) return [];
    let col;
    try {
        col = resolveColumns(table.headers, COLUMN_SPECS.eod, 'EOD.csv');
    } catch (e) {
        ctx.flag({ severity: 'warn', source: 'EOD.csv', reason: `File could not be read, so the EOD panel is hidden. ${e.message}` });
        return [];
    }
    const out = [];
    table.rows.forEach(row => {
        const p = parseMonthLabel(row[col.month]);
        if (!p || p.year === null) return;   // skips summary rows like "Last 3 months avg"
        const avail = getSafeNum(row[col.available]);
        const dep = getSafeNum(row[col.deployed]);
        const pct = avail ? (dep / avail) * 100 : 0;
        if (col.statedPct) {
            const stated = getSafeNum(row[col.statedPct]);
            if (Math.abs(stated - pct) > 0.5) {
                ctx.flag({ severity: 'info', source: 'EOD.csv', month: clean(row[col.month]), reason: `Stated EOD ${stated.toFixed(2)}% differs from deployed ÷ available (${pct.toFixed(2)}%). The dashboard uses the calculated figure.` });
            }
        }
        out.push({ label: `${MONTH_LONG[p.month]} ${p.year}`, date: new Date(p.year, CALENDAR_MONTH[p.month], 1), avail, dep, pct });
    });
    return out.sort((a, b) => a.date - b.date);
}

function buildDataset(year, texts) {
    const fyEnd = parseInt((year.match(/\d{4}/) || ['2027'])[0], 10);
    const audit = [];
    const ctx = {
        year, fyEnd, ledger: createLedger(),
        totals: { tbAll: 0, tbIncluded: 0, tbExcluded: 0, investments: 0, capex: 0 },
        flag: entry => audit.push(entry)
    };

    const chart = parseBudget(readCSV(texts.budget), ctx);
    parseTrialBalance(readCSV(texts.tb), chart, ctx);
    parseInvestments(readCSV(texts.innovation), 'Innovation Investment', 'Innovation.csv', ctx);
    parseInvestments(readCSV(texts.cic), 'Corporate Investment and Credit', 'CIC.csv', ctx);
    parseCapex(readCSV(texts.capex), chart, ctx);
    const eod = parseEod(readCSV(texts.eod), ctx);

    const rows = ctx.ledger.values();
    const t = ctx.totals;
    const ledgerActual = sum(rows.map(r => r.Actual));
    const sourceActual = t.tbIncluded + t.investments + t.capex;
    const reconciled = Math.abs(ledgerActual - sourceActual) < 1;
    if (!reconciled) {
        audit.unshift({ severity: 'error', source: 'Reconciliation', amount: ledgerActual - sourceActual, reason: 'Dashboard actuals do not equal the sum of the source files' });
    }

    /* Departments that only appear in actuals go after the Budget.csv order. */
    const deptOrder = [...chart.deptOrder];
    [...new Set(rows.map(r => r.Department))].sort().forEach(d => { if (!deptOrder.includes(d)) deptOrder.push(d); });

    if (typeof console !== 'undefined' && audit.length) console.table(audit);

    return { rows, eod, audit, deptOrder, fyEnd, totals: { ...t, ledgerActual, sourceActual, reconciled } };
}

/* 5. STATE & SCOPE ======================================================== */

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
const donorColors = new Map();

function donorColor(d) {
    if (!donorColors.has(d)) donorColors.set(d, DONOR_PALETTE[donorColors.size % DONOR_PALETTE.length]);
    return donorColors.get(d);
}

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

function scopeMonths() {
    const { granularity: g, viewMode: v, period: p } = state;
    if (g === 'Yearly') return FISCAL_MONTHS;
    if (g === 'Monthly') {
        const idx = MONTH_INDEX[p];
        if (v === 'Period') return [p];
        if (v === 'QTD') return QUARTER_MONTHS[MONTH_QUARTER[p]].filter(m => MONTH_INDEX[m] <= idx);
        return FISCAL_MONTHS.slice(0, idx + 1);
    }
    const qIdx = QUARTERS.indexOf(p);
    if (v === 'YTD') return QUARTERS.slice(0, qIdx + 1).flatMap(q => QUARTER_MONTHS[q]);
    return QUARTER_MONTHS[p];
}

const scopeEndIdx = () => Math.max(...[...state.scope].map(m => MONTH_INDEX[m]));

function monthYearLabel(month) {
    return `${MONTH_LONG[month]} ${calendarYearOf(month, state.data.fyEnd)}`;
}

function periodLabel() {
    const { granularity: g, viewMode: v, period: p } = state;
    if (g === 'Yearly') return `Full year ${state.year}`;
    if (g === 'Quarterly') {
        if (v === 'YTD') return `Year to date through ${p} ${state.year}`;
        return `${p} ${state.year}`;
    }
    if (v === 'Period') return monthYearLabel(p);
    if (v === 'QTD') return `${MONTH_QUARTER[p]} to date, through ${monthYearLabel(p)}`;
    return `Year to date, through ${monthYearLabel(p)}`;
}

/* 6. AGGREGATION & STATUS ================================================= */

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

/* 7. COMPONENTS =========================================================== */

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

function trendFor(g) {
    const end = scopeEndIdx() + 1;
    return sparkline(g.trendA.slice(0, end), g.trendB.slice(0, end));
}

/* Thin utilisation bar with a plan-to-date marker. */
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

/* 8. RENDERING ============================================================ */

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

/* Tooltip: any element with a data-tip attribute. */
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

/* 10. EVENTS & INITIALISATION ============================================= */

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
    const asOfMonth = FISCAL_MONTHS[Math.max(0, state.asOfIdx)];
    state.granularity = g;
    if (g === 'Quarterly') {
        state.period = MONTH_QUARTER[prev] || (QUARTERS.includes(prev) ? prev : MONTH_QUARTER[asOfMonth]);
        if (state.viewMode === 'Period' && prev === 'FY') state.viewMode = 'QTD';
    } else if (g === 'Monthly') {
        if (QUARTERS.includes(prev)) {
            const ms = QUARTER_MONTHS[prev];
            state.period = ms.includes(asOfMonth) ? asOfMonth : ms[2];
        } else if (!(prev in MONTH_INDEX)) {
            state.period = asOfMonth;
            state.viewMode = 'QTD';
        }
    } else {
        state.period = 'FY';
        state.viewMode = 'Period';
    }
    populatePeriodDropdown();
    syncToggleButtons();
    render();
}

function populatePeriodDropdown() {
    const sel = $('periodDropdown');
    let options;
    if (state.granularity === 'Monthly') options = FISCAL_MONTHS.map(m => [m, monthYearLabel(m)]);
    else if (state.granularity === 'Quarterly') options = QUARTERS.map(q => [q, `${q} (${MONTH_LONG[QUARTER_MONTHS[q][0]]} to ${MONTH_LONG[QUARTER_MONTHS[q][2]]})`]);
    else options = [['FY', 'Full year (July to June)']];
    sel.innerHTML = options.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
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

/* Theme: remembered per browser; first visit follows the OS setting. */
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

function bindEvents() {
    $('yearDropdown').addEventListener('change', e => loadYear(e.target.value));
    $('donorDropdown').addEventListener('change', e => { state.donor = e.target.value; render(); });
    $('periodDropdown').addEventListener('change', e => { state.period = e.target.value; render(); });
    $('themeToggle').addEventListener('click', toggleTheme);
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

    /* Delegated clicks and keyboard activation — no inline onclick strings built from data. */
    const activate = (container, selector, fn) => {
        const handler = e => {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            const el = e.target.closest(selector);
            if (!el || !container.contains(el) || el.classList.contains('disabled-row')) return;
            if (e.type === 'keydown') e.preventDefault();
            fn(el);
        };
        container.addEventListener('click', handler);
        container.addEventListener('keydown', handler);
    };
    activate($('summaryTableBody'), 'tr[data-dept]', el => openDepartment(el.dataset.dept));
    activate($('deptListContainer'), '[data-dept]', el => { state.department = el.dataset.dept; render(); });
    activate($('streamListContainer'), '[data-stream]', el => openStreamModal(el.dataset.stream));

    document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

    document.addEventListener('mouseover', e => {
        const t = e.target.closest('[data-tip]');
        if (t) showTooltip(t, e); else hideTooltip();
    });
    document.addEventListener('mousemove', e => { if (tooltip().classList.contains('visible')) moveTooltip(e); });
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

async function loadYear(year) {
    state.year = year;
    setLoader(true, `Loading ${year}…`);
    try {
        const p = filePaths(year);
        const [budget, tb, innovation, cic, capex, eod] = await Promise.all([
            fetchText(p.budget, true), fetchText(p.tb, true),
            fetchText(p.innovation, false), fetchText(p.cic, false),
            fetchText(p.capex, false), fetchText(p.eod, false)
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
