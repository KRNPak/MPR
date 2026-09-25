'use strict';
/* ==========================================================================
   Karandaaz Pakistan — Staff cost dashboard (staff.html)
   Needs common.js and bva-data.js loaded first.
   --------------------------------------------------------------------------
   1. Configuration     5. View model (totals, forecast, bridge, headcount)
   2. Decryption        6. Rendering
   3. Dates & columns   7. Modals & data checks
   4. Parsing           8. Events & loading
   ========================================================================== */
(() => {

/* 1. CONFIGURATION ======================================================== */

const STAFF_FILES = { master: 'Staff_Master.enc', budget: 'Staff_Budget.enc', actuals: 'Staff_Actuals.enc' };
/* Header names each staff file should contain; used to find the right sheet and header row in workbooks. */
const STAFF_HINTS = {
    master: ['positioncode', 'employeename', 'department', 'designation'],
    budget: ['positioncode', 'budgetedmonths', 'basesalary', 'joiningdate'],
    actuals: ['positioncode', 'month', 'basesalary', 'grosssalary']
};
const LEGACY_CRYPTOJS_SOURCES = ['vendor/crypto-js.js', 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js'];
const ENC_PREFIX = 'KRNENC1';

/* Departments in Budget.csv whose trial-balance actuals should match payroll. */
const GL_STAFF_DEPARTMENTS = ['Staff cost'];
const RECON_TOLERANCE = 0.02;                // flag months where payroll and ledger differ by > 2%

const BASE = 'Base Salary (Inc. Encashments)';
/* Paid once or twice a year: judged against the full-year budget, not the monthly phasing. */
const LUMP_SUM = new Set(['LFA', 'Gratuity', 'Insurances (Health & Life)', 'Learning & Development', 'Performance']);

/* Staff amounts are smaller than programme lines, so tables show two decimals of M PKR. */
const DP = 2;

const SPIKE_MIN_PCT = 0.10;                  // a component "spikes" if it rises ≥ 10% on the month…
const SPIKE_MIN_PKR = 100000;                // …and by at least PKR 100k (or 1% of the month's payroll)

/* Set to e.g. ['OSR', 'GF', 'FIP'] to fix the donor columns in Staff_Master.
   Left as null, any column whose values are all percentages is treated as a donor split. */
const DONOR_COLUMNS = null;

/* Identifier columns, matched on normalised header names. */
const ID_FIELDS = {
    position: ['positioncode', 'positionid', 'position'],
    employeeCode: ['employeecode', 'empcode', 'employeeid'],
    name: ['employeename', 'name', 'employee'],
    department: ['department', 'dept'],
    designation: ['designation', 'jobtitle', 'title'],
    grade: ['positiongrade', 'grade', 'grades'],
    stream: ['streams', 'stream', 'costcentre', 'costcenter'],
    leaving: ['lastworkingday', 'lastworkingdate', 'lastworking', 'dateofleaving', 'leavingdate'],
    gender: ['gender'],
    joining: ['joiningdate', 'joiningdatenewagreementstartdate', 'dateofjoining', 'doj'],
    agreement: ['newagreementstartdate', 'agreementstartdate'],
    budgetedMonths: ['budgetedmonths'],
    month: ['month', 'payrollmonth', 'period'],
    cnic: ['cnic'],
    serial: ['sno', 'srno', 'serialno']
};

/* Pay-component columns. Checked in order against the lower-cased header text.
   Base salary is handled separately so only one base column is ever used. */
const EXCLUDE_RE = /\b(gross|net|payable|tax|taxes|advance|advances|deduction|deductions|total|other|others)\b/;
const COMPONENT_RULES = [
    [/\bchild care\b/, 'Child Care'],
    [/\bcar monet|\bcma\b/, 'Car Monetization'],
    [/\bcola\b/, 'COLA'],
    [/\bprovident\b|^pf$/, 'Provident Fund'],
    [/\beobi\b/, 'EOBI'],
    [/\bgratuity\b/, 'Gratuity'],
    [/\blfa\b|leave fare/, 'LFA'],
    [/\bwellness\b/, 'Wellness Allowance'],
    [/health ins|life ins/, 'Insurances (Health & Life)'],
    [/\blearning\b/, 'Learning & Development'],
    [/\bperformance\b|one-off|one off/, 'Performance'],
    [/\barrears?\b|\bovertime\b|leave encashment/, BASE]
];
/* When several base-salary columns exist, the first pattern that matches wins. */
const BASE_PREFERENCE = [/base salary after inflation/, /updated base/, /^base salary$/, /\bbase\b/];

/* 2. DECRYPTION =========================================================== */

class WrongKeyError extends Error {}
const keyCache = new Map();

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

let cryptoJsPromise = null;
function loadCryptoJS() {
    if (window.CryptoJS) return Promise.resolve();
    if (!cryptoJsPromise) {
        cryptoJsPromise = loadScriptFrom(LEGACY_CRYPTOJS_SOURCES).catch(() => {
            cryptoJsPromise = null;
            throw new Error('Could not load the decryption library for older files (vendor/crypto-js.js).');
        });
    }
    return cryptoJsPromise;
}

/* Files made with tools/encrypt.html:  KRNENC1$<iterations>$<salt>$<iv>$<ciphertext>  (AES-256-GCM, PBKDF2-SHA256).
   Older files from CryptoJS ("U2FsdGVkX1…") still open, and are flagged for re-encryption. */
/* Returns { data, legacy } where data is CSV text or .xlsx bytes. */
async function decryptText(text, passphrase) {
    const t = text.trim();
    if (t.startsWith(`${ENC_PREFIX}$`)) {
        const [, iterStr, saltB64, ivB64, ctB64] = t.split('$');
        const cacheKey = `${iterStr}$${saltB64}`;
        if (!keyCache.has(cacheKey)) keyCache.set(cacheKey, deriveKey(passphrase, b64ToBytes(saltB64), parseInt(iterStr, 10)));
        try {
            const key = await keyCache.get(cacheKey);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
            return { data: new Uint8Array(plain), legacy: false };
        } catch (e) {
            throw new WrongKeyError();
        }
    }
    if (t.startsWith('U2FsdGVkX1')) {
        await loadCryptoJS();
        let out = '';
        try { out = window.CryptoJS.AES.decrypt(t, passphrase).toString(window.CryptoJS.enc.Utf8); } catch (e) { out = ''; }
        if (!out || !/position/i.test(out.split(/\r?\n/, 1)[0])) throw new WrongKeyError();
        return { data: out, legacy: true };
    }
    throw new Error('A staff file is in an unrecognised format. Re-create it with tools/encrypt.html.');
}

/* 3. DATES & COLUMNS ====================================================== */

const MONTH_NUM = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const monthNum = s => MONTH_NUM[String(s).slice(0, 3).toLowerCase()];
const fullYear = y => (y < 100 ? 2000 + y : y);
const excelDate = n => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
/* Builds a date only if day and month are real (rejects 31/31/2020 instead of rolling it over). */
function makeDate(y, m, d) {
    const dt = new Date(y, m, d);
    return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? dt : null;
}

/* Accepts Excel serials, 05-Sept-22, 5 Sep 2022, Sep 5, 2022, 2022-09-05 and 05/09/2022 (day first). */
function parseDateLoose(raw) {
    const s = clean(raw);
    if (!s) return null;
    let m;
    if (/^\d{5}(\.\d+)?$/.test(s)) {
        const d = excelDate(parseFloat(s));
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    if ((m = s.match(/^(\d{1,2})[-\/\s.]([A-Za-z]{3,9})[-\/\s.,]*(\d{2,4})$/)) && monthNum(m[2]) !== undefined) {
        return makeDate(fullYear(+m[3]), monthNum(m[2]), +m[1]);
    }
    if ((m = s.match(/^([A-Za-z]{3,9})[-\s.]+(\d{1,2}),?[-\s]+(\d{4})$/)) && monthNum(m[1]) !== undefined) {
        return makeDate(+m[3], monthNum(m[1]), +m[2]);
    }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return makeDate(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) return makeDate(fullYear(+m[3]), +m[2] - 1, +m[1]);
    return null;
}

const FISCAL_OF_CAL = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];   // calendar month → fiscal index
const fiscalIdxOfDate = d => FISCAL_OF_CAL[d.getMonth()];

/* Payroll month: "Jul-26", "July 2026", "Sept-26", an Excel serial or a full date. */
function parsePayrollMonth(raw) {
    const s = clean(raw);
    if (!s) return null;
    const label = parseMonthLabel(s);
    if (label) return label;
    const d = parseDateLoose(s);
    if (!d) return null;
    return { month: FISCAL_MONTHS[fiscalIdxOfDate(d)], year: d.getFullYear() };
}

function resolveIds(headers) {
    const byNorm = new Map(headers.map(h => [normName(h), h]));
    const out = {};
    Object.entries(ID_FIELDS).forEach(([field, aliases]) => {
        out[field] = null;
        for (const a of aliases) if (byNorm.has(a)) { out[field] = byNorm.get(a); break; }
    });
    return out;
}

/* Maps pay-component columns and records what happened to every column. */
function mapComponents(table, ids, fileLabel, ctx, { detectSign = false } = {}) {
    const idHeaders = new Set(Object.values(ids).filter(Boolean));
    const map = {};
    const baseCandidates = [];
    const columnSum = h => sum(table.rows.map(r => Math.abs(getSafeNum(r[h]))));

    table.headers.forEach(h => {
        if (!h) return;
        const low = h.toLowerCase().replace(/\s+/g, ' ').trim();
        if (idHeaders.has(h)) return ctx.column(fileLabel, h, 'Identifier');
        if (EXCLUDE_RE.test(low)) return ctx.column(fileLabel, h, 'Not used (total, tax, net or deduction)');
        const rule = COMPONENT_RULES.find(([re]) => re.test(low));
        if (rule) { map[h] = rule[1]; return ctx.column(fileLabel, h, rule[1]); }
        if (/\bbase\b/.test(low)) { baseCandidates.push(h); return; }
        const total = columnSum(h);
        ctx.column(fileLabel, h, 'Not used (not recognised)');
        if (total > 0) {
            ctx.flag({ severity: 'warn', source: fileLabel, description: h, amount: total, reason: 'Column has amounts but is not a recognised pay component, so it is left out. Add a rule in staff_app.js if it should count.' });
        }
    });

    if (baseCandidates.length) {
        const rank = h => BASE_PREFERENCE.findIndex(re => re.test(h.toLowerCase().replace(/\s+/g, ' ').trim()));
        const chosen = [...baseCandidates].sort((x, y) => rank(x) - rank(y))[0];
        map[chosen] = BASE;
        baseCandidates.forEach(h => {
            if (h === chosen) return ctx.column(fileLabel, h, BASE);
            ctx.column(fileLabel, h, `Not used (second base-salary column; "${chosen}" is used)`);
            ctx.flag({ severity: 'info', source: fileLabel, description: h, reason: `Several base-salary columns found. Only "${chosen}" is counted, to avoid double counting.` });
        });
    }

    /* Some payroll exports store cost columns as negatives. If nearly every value in a
       column is negative, flip it; otherwise keep signs so reversals net off. */
    const invert = new Set();
    if (detectSign) {
        Object.keys(map).forEach(h => {
            const vals = table.rows.map(r => getSafeNum(r[h])).filter(v => v !== 0);
            const neg = vals.filter(v => v < 0).length;
            if (vals.length >= 3 && neg / vals.length > 0.8) {
                invert.add(h);
                ctx.flag({ severity: 'info', source: fileLabel, description: h, reason: 'Values are stored as negatives, so the sign was flipped.' });
            } else if (neg > 0) {
                ctx.flag({ severity: 'info', source: fileLabel, description: h, amount: sum(vals.filter(v => v < 0)), reason: `${neg} negative ${neg === 1 ? 'entry' : 'entries'} (reversals or recoveries) netted against spend.` });
            }
        });
    }
    return { map, invert };
}

/* 4. PARSING ============================================================== */

function isPercentLike(values) {
    const nonEmpty = values.map(clean).filter(Boolean);
    if (!nonEmpty.length) return false;
    let anyPositive = false;
    for (const v of nonEmpty) {
        if (!/^-?\d+(\.\d+)?\s*%?$/.test(v)) return false;
        const n = parseFloat(v);
        if (n < 0 || n > 100) return false;
        if (n > 0) anyPositive = true;
    }
    return anyPositive;
}

function parsePct(raw) {
    const s = clean(raw);
    if (!s) return 0;
    let n = parseFloat(s.replace('%', ''));
    if (isNaN(n)) return 0;
    if (s.includes('%') || n > 1) n /= 100;
    return n;
}

function parseMaster(table, ctx) {
    const ids = resolveIds(table.headers);
    if (!ids.position) throw new Error(`Staff_Master has no "Position code" column. ${describeHeaders(table)}`);
    const idHeaders = new Set(Object.values(ids).filter(Boolean));

    const donorCols = DONOR_COLUMNS
        ? table.headers.filter(h => DONOR_COLUMNS.map(normName).includes(normName(h)))
        : table.headers.filter(h => h && !idHeaders.has(h) && !/salary|amount|pkr|cnic|phone|email/i.test(h) && isPercentLike(table.rows.map(r => r[h])));
    table.headers.forEach(h => {
        if (!h) return;
        ctx.column('Staff_Master', h, idHeaders.has(h) ? 'Identifier' : donorCols.includes(h) ? `Donor split (${h})` : 'Not used');
    });

    const positions = new Map();
    const badSplits = [];
    let defaulted = 0;
    table.rows.forEach(r => {
        const code = clean(r[ids.position]).toUpperCase();
        if (!code) return;
        if (positions.has(code)) {
            ctx.flag({ severity: 'warn', source: 'Staff_Master', code, reason: 'Position code appears more than once; the last row is used.' });
        }
        const alloc = {};
        donorCols.forEach(h => { const p = parsePct(r[h]); if (p > 0) alloc[h.trim()] = p; });
        const total = sum(Object.values(alloc));
        if (!Object.keys(alloc).length) { alloc[DEFAULT_DONOR] = 1; defaulted++; }
        else if (Math.abs(total - 1) > 0.01) badSplits.push(`${code} (${Math.round(total * 100)}%)`);

        const name = clean(r[ids.name]);
        positions.set(code, {
            code,
            name: name || 'Vacant',
            isVacantName: !name || /^vacant/i.test(name),
            employeeCode: clean(r[ids.employeeCode]),
            dept: clean(r[ids.department]) || 'Uncategorized',
            designation: clean(r[ids.designation]),
            alloc
        });
    });
    if (badSplits.length) ctx.flag({ severity: 'warn', source: 'Staff_Master', description: badSplits.join(', '), reason: 'Donor split does not add up to 100%.' });
    if (defaulted) ctx.flag({ severity: 'info', source: 'Staff_Master', reason: `${defaulted} position(s) have no donor split and are treated as 100% ${DEFAULT_DONOR}.` });
    if (!donorCols.length) ctx.flag({ severity: 'info', source: 'Staff_Master', reason: `No donor split columns found; all positions treated as ${DEFAULT_DONOR}.` });
    return { positions, donors: donorCols.map(h => h.trim()) };
}

function createStaffLedger() {
    const rows = new Map();
    return {
        add(code, month, comp, { b = 0, a = 0 }) {
            const key = `${code}|${month}`;
            if (!rows.has(key)) rows.set(key, { code, month, comps: {} });
            const r = rows.get(key);
            if (!r.comps[comp]) r.comps[comp] = { b: 0, a: 0 };
            r.comps[comp].b += b;
            r.comps[comp].a += a;
        },
        values: () => [...rows.values()]
    };
}

function parseStaffBudget(table, master, ctx) {
    if (!table) return;
    const ids = resolveIds(table.headers);
    if (!ids.position) throw new Error(`Staff_Budget has no "Position code" column. ${describeHeaders(table)}`);
    const { map } = mapComponents(table, ids, 'Staff_Budget', ctx);
    const fyStart = new Date(ctx.fyEnd - 1, 6, 1);
    const fyEndDate = new Date(ctx.fyEnd, 5, 30);
    const unknown = new Set();
    const badDates = [];

    table.rows.forEach(r => {
        const code = clean(r[ids.position]).toUpperCase();
        if (!code) return;
        if (!master.positions.has(code)) { unknown.add(code); return; }

        const joinRaw = clean(r[ids.joining]) || clean(r[ids.agreement]);
        const join = parseDateLoose(joinRaw);
        if (joinRaw && !join) badDates.push(`${code} ("${joinRaw}")`);
        if (join && join > fyEndDate) {
            ctx.flag({ severity: 'info', source: 'Staff_Budget', code, reason: `Starts ${join.toDateString().slice(4)}, after ${ctx.year} ends; no budget placed this year.` });
            return;
        }
        const startIdx = join && join > fyStart ? fiscalIdxOfDate(join) : 0;
        let bMonths = parseInt(clean(r[ids.budgetedMonths]), 10) || 12;
        if (bMonths <= 0) bMonths = 12;

        const monthly = {};
        Object.entries(map).forEach(([h, comp]) => {
            let v = getSafeNum(r[h]);
            if (LUMP_SUM.has(comp)) v /= bMonths;   // annual amount spread over the budgeted months
            monthly[comp] = (monthly[comp] || 0) + v;
        });
        for (let i = startIdx; i < Math.min(12, startIdx + bMonths); i++) {
            Object.entries(monthly).forEach(([comp, v]) => { if (v) ctx.ledger.add(code, FISCAL_MONTHS[i], comp, { b: v }); });
        }
    });
    if (unknown.size) ctx.flag({ severity: 'warn', source: 'Staff_Budget', description: [...unknown].join(', '), reason: 'Position code not in Staff_Master; budget left out.' });
    if (badDates.length) ctx.flag({ severity: 'warn', source: 'Staff_Budget', description: badDates.join(', '), reason: 'Joining date could not be read; budget starts in July.' });
}

function parseStaffActuals(table, master, ctx) {
    if (!table) return;
    const ids = resolveIds(table.headers);
    if (!ids.position || !ids.month) throw new Error(`Staff_Actuals needs "Position code" and "Month" columns. ${describeHeaders(table)}`);
    const { map, invert } = mapComponents(table, ids, 'Staff_Actuals', ctx, { detectSign: true });
    const unknown = new Map();
    const outside = new Map();

    table.rows.forEach(r => {
        const code = clean(r[ids.position]).toUpperCase();
        if (!code) return;
        const rowTotal = () => sum(Object.keys(map).map(h => getSafeNum(r[h]) * (invert.has(h) ? -1 : 1)));
        if (!master.positions.has(code)) { unknown.set(code, (unknown.get(code) || 0) + rowTotal()); return; }
        const p = parsePayrollMonth(r[ids.month]);
        if (!p || !inFiscalYear(p, ctx.fyEnd)) {
            const label = clean(r[ids.month]) || '(blank)';
            outside.set(label, (outside.get(label) || 0) + rowTotal());
            return;
        }
        Object.entries(map).forEach(([h, comp]) => {
            const v = getSafeNum(r[h]) * (invert.has(h) ? -1 : 1);
            if (v) ctx.ledger.add(code, p.month, comp, { a: v });
        });
    });
    unknown.forEach((amt, code) => ctx.flag({ severity: 'warn', source: 'Staff_Actuals', code, amount: amt, reason: 'Position code not in Staff_Master; pay left out.' }));
    outside.forEach((amt, label) => ctx.flag({ severity: 'error', source: 'Staff_Actuals', description: `Month "${label}"`, amount: amt, reason: `Month is outside ${ctx.year} or unreadable; rows ignored.` }));
}

function buildStaffDataset(year, texts) {
    const fyEnd = parseInt((year.match(/\d{4}/) || ['2027'])[0], 10);
    const audit = [];
    const columns = [];
    const ctx = {
        year, fyEnd, ledger: createStaffLedger(),
        flag: e => audit.push(e),
        column: (file, column, use) => { columns.push({ file, column, use }); }
    };
    const asTable = x => (x && typeof x === 'object' ? x : readCSV(x));
    const master = parseMaster(asTable(texts.master), ctx);
    parseStaffBudget(asTable(texts.budget), master, ctx);
    parseStaffActuals(asTable(texts.actuals), master, ctx);

    const ledger = ctx.ledger.values();
    const asOfIdx = Math.max(-1, ...ledger.filter(r => Object.values(r.comps).some(c => c.a !== 0)).map(r => MONTH_INDEX[r.month]));
    const components = [...new Set(ledger.flatMap(r => Object.keys(r.comps)))];
    const payrollByMonth = Array(12).fill(0);
    ledger.forEach(r => { payrollByMonth[MONTH_INDEX[r.month]] += sum(Object.values(r.comps).map(c => c.a)); });

    return { year, fyEnd, positions: master.positions, donors: master.donors, ledger, components, asOfIdx, payrollByMonth, audit, columns, legacy: false, recon: null };
}

/* Compares payroll to the trial-balance departments in GL_STAFF_DEPARTMENTS, month by month. */
function reconcileToLedger(staff, bva) {
    const gl = Array(12).fill(0);
    bva.rows.forEach(r => { if (GL_STAFF_DEPARTMENTS.includes(r.Department)) gl[MONTH_INDEX[r.Month]] += r.Actual; });
    const months = FISCAL_MONTHS.filter((m, i) => i <= staff.asOfIdx);
    const byMonth = months.map(m => {
        const i = MONTH_INDEX[m];
        const payroll = staff.payrollByMonth[i];
        const ledger = gl[i];
        return { month: m, payroll, ledger, diff: payroll - ledger, ok: ledger ? Math.abs(payroll - ledger) / Math.abs(ledger) <= RECON_TOLERANCE : payroll === 0 };
    });
    byMonth.forEach(x => {
        staff.audit.push({
            severity: x.ok ? 'info' : 'warn', source: 'Ledger reconciliation', description: MONTH_LONG[x.month], amount: x.diff,
            reason: `Payroll ${fmtM(x.payroll)} vs ledger "${GL_STAFF_DEPARTMENTS.join(', ')}" ${fmtM(x.ledger)} M PKR${x.ok ? ', within tolerance' : ''}.`
        });
    });
    return { gl, byMonth };
}

/* 5. VIEW MODEL =========================================================== */

const S = {
    passphrase: null,
    years: [],
    year: null,
    data: null,
    dept: 'All Departments',
    donor: ALL_DONORS,
    granularity: 'Monthly',
    viewMode: 'QTD',
    period: 'Jul',
    tab: 'component',
    empSort: { key: 'fyVar', dir: 1 },
    modal: null,
    view: null
};
const ALL_DEPTS = 'All Departments';

function blank() { return { b: 0, a: 0, pace: 0 }; }

function computeView() {
    const d = S.data;
    const asOf = d.asOfIdx;
    const scope = new Set(scopeMonthsFor(S.granularity, S.viewMode, S.period));
    const scopeIdx = [...scope].map(m => MONTH_INDEX[m]);
    const scopeEnd = Math.max(...scopeIdx);
    const focusIdx = Math.min(scopeEnd, asOf);   // month used for headcount and month-on-month

    const total = blank();
    const comps = new Map();
    const emps = new Map();
    const donorB = {};
    const donorA = {};
    const monthA = Array(12).fill(0);
    const compMonthA = new Map();
    const paid = Array.from({ length: 12 }, () => new Set());
    const budgeted = Array.from({ length: 12 }, () => new Set());

    d.ledger.forEach(row => {
        const pos = d.positions.get(row.code);
        if (S.dept !== ALL_DEPTS && pos.dept !== S.dept) return;
        const share = S.donor === ALL_DONORS ? 1 : (pos.alloc[S.donor] || 0);
        if (!share) return;

        const mi = MONTH_INDEX[row.month];
        const inScope = scope.has(row.month);
        const closed = mi <= asOf;
        if (!emps.has(row.code)) {
            emps.set(row.code, { code: row.code, pos, pA: 0, pB: 0, pRegA: 0, pRegB: 0, ytdA: 0, fyB: 0, byComp: {}, vacantMonths: 0 });
        }
        const e = emps.get(row.code);
        let rowRegB = 0;
        let rowA = 0;
        let rowScopeB = 0;
        let rowScopeA = 0;

        Object.entries(row.comps).forEach(([name, v]) => {
            const b = v.b * share;
            const a = v.a * share;
            const lump = LUMP_SUM.has(name);
            if (!comps.has(name)) comps.set(name, { name, lump, ...blank(), fyB: 0, ytdA: 0 });
            const c = comps.get(name);
            if (!e.byComp[name]) e.byComp[name] = { tdA: 0, tdB: 0, restB: 0, fyB: 0 };
            const ec = e.byComp[name];

            c.fyB += b; ec.fyB += b; e.fyB += b;
            if (closed) { c.ytdA += a; ec.tdA += a; ec.tdB += b; e.ytdA += a; } else { ec.restB += b; }
            if (!lump) rowRegB += b;
            rowA += a;
            monthA[mi] += a;
            if (!compMonthA.has(name)) compMonthA.set(name, Array(12).fill(0));
            compMonthA.get(name)[mi] += a;

            if (inScope) {
                c.b += b; c.a += a; if (closed) c.pace += b;
                total.b += b; total.a += a; if (closed) total.pace += b;
                e.pB += b; e.pA += a;
                if (!lump) { e.pRegB += b; e.pRegA += a; }
                rowScopeB += b; rowScopeA += a;
            }
        });

        if (rowRegB > 0) budgeted[mi].add(row.code);
        if (rowA > 0) paid[mi].add(row.code);
        if (closed && rowRegB > 0 && rowA === 0) e.vacantMonths++;
        if (inScope) {
            const split = S.donor === ALL_DONORS ? pos.alloc : { [S.donor]: 1 };
            Object.entries(split).forEach(([don, p]) => {
                donorB[don] = (donorB[don] || 0) + rowScopeB * p;
                donorA[don] = (donorA[don] || 0) + rowScopeA * p;
            });
        }
    });

    /* Forecast = actual to date + budget for the months still to come.
       Lump-sum items: whichever is higher of paid so far and the full-year budget. */
    const bridge = { vacant: 0, filled: 0, unbudgeted: 0, lump: 0 };
    let fyB = 0;
    let forecast = 0;
    emps.forEach(e => {
        let regVar = 0;
        let regTdA = 0;
        let regTdB = 0;
        e.forecast = 0;
        Object.entries(e.byComp).forEach(([name, c]) => {
            if (LUMP_SUM.has(name)) {
                const f = Math.max(c.tdA, c.fyB);
                e.forecast += f;
                bridge.lump += c.fyB - f;
            } else {
                e.forecast += c.tdA + c.restB;
                regVar += c.tdB - c.tdA;
                regTdA += c.tdA;
                regTdB += c.tdB;
            }
        });
        e.fyVar = e.fyB - e.forecast;
        if (e.fyB === 0 && regTdA !== 0) bridge.unbudgeted += regVar;
        else if (regTdB > 0 && Math.abs(regTdA) < 1) bridge.vacant += regVar;
        else bridge.filled += regVar;
        fyB += e.fyB;
        forecast += e.forecast;
    });

    /* Headcount and cost per head, both for the same month. */
    const filled = paid[focusIdx] ? paid[focusIdx].size : 0;
    const budgetedHeads = budgeted[focusIdx] ? budgeted[focusIdx].size : 0;
    const unbudgetedPaid = focusIdx >= 0 ? [...paid[focusIdx]].filter(c => !budgeted[focusIdx].has(c)).length : 0;
    const costMonths = scopeIdx.filter(i => i <= asOf);
    const headMonths = sum(costMonths.map(i => paid[i].size));
    const avgCostPerHead = headMonths ? sum(costMonths.map(i => monthA[i])) / headMonths : null;

    /* Month on month: the focus month against the one before it. */
    let mom = null;
    const spikes = [];
    if (focusIdx >= 1) {
        const last = monthA[focusIdx];
        const prev = monthA[focusIdx - 1];
        mom = { last, prev, lastM: FISCAL_MONTHS[focusIdx], prevM: FISCAL_MONTHS[focusIdx - 1] };
        const minRise = Math.max(SPIKE_MIN_PKR, 0.01 * last);
        compMonthA.forEach((arr, name) => {
            if (LUMP_SUM.has(name)) return;
            const p = arr[focusIdx - 1];
            const l = arr[focusIdx];
            if (p > 0 && (l - p) / p >= SPIKE_MIN_PCT && l - p >= minRise) spikes.push({ name, pct: (l - p) / p, rise: l - p });
        });
        spikes.sort((x, y) => y.rise - x.rise);
    }

    return {
        scope, scopeEnd, focusIdx, total, comps, emps, donorB, donorA,
        fyB, forecast, bridge,
        filled, budgetedHeads, unbudgetedPaid, avgCostPerHead, mom, spikes: spikes.slice(0, 3)
    };
}

/* Status for a component. Lump-sum items are judged on the full year: over only if
   paid to date already exceeds the full-year budget. */
function compStatus(c) {
    if (c.lump) return c.fyB <= 0 ? (c.ytdA > 0 ? 'over' : 'neutral') : (c.ytdA > c.fyB ? 'over' : 'ontrack');
    return statusOf(c);
}

/* 6. RENDERING ============================================================ */

const periodLabel = () => periodLabelFor({ granularity: S.granularity, viewMode: S.viewMode, period: S.period, year: S.year, fyEnd: S.data.fyEnd });
const monthLabel = i => (i >= 0 ? monthYearLabelFor(FISCAL_MONTHS[i], S.data.fyEnd) : '');

function render() {
    if (!S.data) return;
    const v = computeView();
    S.view = v;
    renderHeader(v);
    renderPeriodCard(v);
    renderTeamCard(v);
    renderBridge(v);
    renderVacancies(v);
    if (S.tab === 'component') renderComponents(v); else renderEmployees(v);
}

function renderHeader(v) {
    const variance = v.fyB - v.forecast;
    animateNumber($('kpiFyBudget'), v.fyB, x => moneyHtml(x));
    animateNumber($('kpiForecast'), v.forecast, x => moneyHtml(x));
    animateNumber($('kpiForecastVar'), variance, x => `<span class="num">${fmtVariance(x, DP)}</span><span class="unit">M PKR</span>`);
    $('kpiForecastVar').classList.toggle('is-over', variance < 0);
    $('kpiForecastVarSub').textContent = variance < 0 ? 'Over budget' : 'Under budget';
    $('kpiHeadcount').innerHTML = `<span class="num">${v.filled}</span><span class="unit">of ${v.budgetedHeads}</span>`;
    $('kpiHeadcountSub').textContent = v.focusIdx >= 0
        ? `${monthLabel(v.focusIdx)}${v.unbudgetedPaid ? `, +${v.unbudgetedPaid} unbudgeted` : ''}`
        : 'No payroll yet';
    $('asOfStamp').textContent = S.data.asOfIdx >= 0 ? `Payroll through ${monthLabel(S.data.asOfIdx)}` : 'No payroll recorded yet';
}

function renderDataCheckChip() {
    const chip = $('dataCheckChip');
    const issues = S.data.audit.filter(a => a.severity !== 'info').length;
    chip.hidden = false;
    chip.classList.toggle('has-issues', issues > 0);
    chip.textContent = issues ? `${issues} data ${issues === 1 ? 'item' : 'items'} to review` : 'Data checks passed';
}

function renderPeriodCard(v) {
    const t = v.total;
    $('periodCaption').textContent = periodLabel();
    animateNumber($('periodBudget'), t.b, x => moneyHtml(x, DP));
    animateNumber($('periodActual'), t.a, x => moneyHtml(x, DP));
    animateNumber($('periodVariance'), t.b - t.a, x => `<span class="num">${fmtVariance(x, DP)}</span><span class="unit">M PKR</span>`);
    $('periodVariance').classList.toggle('is-over', t.b - t.a < 0);
    $('periodBullet').innerHTML = bulletChart(t);
    $('periodDonorBars').innerHTML = donorBars(v.donorB, v.donorA);

    /* Payroll vs ledger for the same months, only when nothing is filtered. */
    const note = $('reconNote');
    const recon = S.data.recon;
    if (!recon || S.dept !== ALL_DEPTS || S.donor !== ALL_DONORS) { note.hidden = true; return; }
    const months = [...v.scope].filter(m => MONTH_INDEX[m] <= S.data.asOfIdx);
    const payroll = sum(months.map(m => S.data.payrollByMonth[MONTH_INDEX[m]]));
    const ledger = sum(months.map(m => recon.gl[MONTH_INDEX[m]]));
    if (!months.length) { note.hidden = true; return; }
    const diffPct = ledger ? ((payroll - ledger) / Math.abs(ledger)) * 100 : null;
    const ok = diffPct !== null && Math.abs(diffPct) <= RECON_TOLERANCE * 100;
    note.hidden = false;
    note.className = `recon-note ${ok ? 'is-ok' : 'is-off'}`;
    note.innerHTML = `Ledger staff cost for these months: <strong>${fmtM(ledger, DP)}</strong> M PKR. `
        + (diffPct === null ? 'No ledger amount to compare.' : `Payroll is ${Math.abs(diffPct).toFixed(1)}% ${diffPct >= 0 ? 'higher' : 'lower'}.`);
}

function renderTeamCard(v) {
    $('avgCostPerHead').innerHTML = v.avgCostPerHead === null ? '<span class="num">—</span>' : moneyHtml(v.avgCostPerHead, 2);
    const momEl = $('momChange');
    const momSub = $('momSub');
    if (!v.mom || !v.mom.prev) {
        momEl.innerHTML = '<span class="num">—</span>';
        momEl.className = 'kpi-value';
        momSub.textContent = v.mom ? `No payroll in ${MONTH_LONG[v.mom.prevM]}` : 'Needs a previous month';
    } else {
        const diff = v.mom.last - v.mom.prev;
        const pct = (diff / v.mom.prev) * 100;
        momEl.innerHTML = `<span class="num">${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%</span>`;
        momEl.className = `kpi-value ${diff > 0 ? 'is-rise' : 'is-fall'}`;
        momSub.textContent = `${diff >= 0 ? '+' : '−'}${fmtM(Math.abs(diff), 2)} M PKR, ${MONTH_LONG[v.mom.prevM]} to ${MONTH_LONG[v.mom.lastM]}`;
    }
    $('spikeList').innerHTML = v.spikes.length
        ? v.spikes.map(s => `<li><span class="spike-name">${escapeHtml(s.name)}</span><span class="spike-val">+${Math.round(s.pct * 100)}% (+${fmtM(s.rise, 2)} M)</span></li>`).join('')
        : '<li class="empty-note">No component rose sharply on the month.</li>';
}

function renderBridge(v) {
    const b = v.bridge;
    const steps = [
        { label: 'Vacant positions', value: b.vacant, tip: 'Budget to date for positions with no payroll to date' },
        { label: 'Pay on filled positions', value: b.filled, tip: 'Budget to date minus payroll to date for everyone paid' },
        { label: 'Unbudgeted positions', value: b.unbudgeted, tip: 'Payroll for positions with no budget this year' },
        { label: 'Lump-sum overruns', value: b.lump, tip: 'Lump-sum items already paid above their full-year budget' }
    ].filter(s => Math.abs(s.value) >= 1000);
    /* Totals share one scale; steps share their own, so small steps stay visible. */
    const totalScale = Math.max(v.fyB, v.forecast, 1);
    const stepScale = Math.max(...steps.map(s => Math.abs(s.value)), 1);
    const pct = (x, scale) => `${((Math.abs(x) / scale) * 100).toFixed(2)}%`;
    const total = (label, value) => `<div class="bridge-row is-total">
        <span class="bridge-label">${label}</span>
        <span class="bridge-track"><span class="bridge-bar is-total" style="--w:${pct(value, totalScale)}"></span></span>
        <span class="bridge-val">${fmtM(value, DP)}</span>
    </div>`;
    const rows = steps.map(s => `<div class="bridge-row" data-tip="${escapeHtml(s.tip)}">
        <span class="bridge-label">${s.value >= 0 ? 'Less' : 'Add'}: ${escapeHtml(s.label.toLowerCase())}</span>
        <span class="bridge-track is-step"><span class="bridge-bar ${s.value >= 0 ? 'is-fav' : 'is-adv'}" style="--w:${pct(s.value, stepScale)}"></span></span>
        <span class="bridge-val ${s.value < 0 ? 'is-over' : 'is-fav-text'}">${s.value >= 0 ? '−' : '+'}${fmtM(Math.abs(s.value), DP)}</span>
    </div>`).join('');
    $('bridgeBody').innerHTML = total('FY budget', v.fyB)
        + (rows || '<p class="empty-note">No variance to date.</p>')
        + total('FY forecast', v.forecast);
}

function renderVacancies(v) {
    const list = [...v.emps.values()]
        .filter(e => e.pRegB > 0 && Math.abs(e.pRegA) < 1)
        .sort((x, y) => y.pRegB - x.pRegB);
    $('vacancyCount').textContent = list.length ? `${list.length}` : '';
    $('vacancyTotal').textContent = list.length ? `${fmtM(sum(list.map(e => e.pRegB)), DP)} M PKR unspent this period` : '';
    const show = list.slice(0, 6);
    $('vacancyList').innerHTML = show.length
        ? show.map(e => `<li>
            <div class="vac-main">
                <div class="vac-title">${escapeHtml(e.pos.designation || e.pos.code)}</div>
                <div class="vac-sub">${escapeHtml(e.pos.dept)}, ${escapeHtml(e.pos.code)}${e.pos.isVacantName ? '' : `, ${escapeHtml(e.pos.name)}`}</div>
            </div>
            <div class="vac-side">
                <div class="vac-amt">${fmtM(e.pRegB, DP)}</div>
                <div class="vac-sub">${e.vacantMonths} ${e.vacantMonths === 1 ? 'month' : 'months'} unpaid</div>
            </div>
        </li>`).join('') + (list.length > show.length ? `<li class="vac-more">and ${list.length - show.length} more</li>` : '')
        : '<li class="empty-note">Every budgeted position was paid in this period.</li>';
}

function renderComponents(v) {
    const term = $('mainSearch').value.trim().toLowerCase();
    const items = [...v.comps.values()]
        .filter(c => c.b !== 0 || c.a !== 0)
        .filter(c => !term || c.name.toLowerCase().includes(term))
        .sort((x, y) => y.a - x.a || y.b - x.b);
    const scale = Math.max(...items.map(c => Math.max(c.a, c.b)), 1);
    const totalA = v.total.a;

    $('componentBars').innerHTML = items.length ? items.map(c => {
        const s = compStatus(c);
        const variance = c.b - c.a;
        const tip = c.lump
            ? `${c.name}: paid as a lump sum. Paid to date ${fmtM(c.ytdA, DP)} of ${fmtM(c.fyB, DP)} M PKR full-year budget.`
            : statusTip(c).replace(/^[^:]+/, c.name);
        return `<div class="comp-row" tabindex="0" role="button" data-comp="${escapeHtml(c.name)}">
            <div class="comp-name">
                <span class="status-dot status-${s}" data-tip="${escapeHtml(tip)}"></span>
                <span class="comp-label">${escapeHtml(c.name)}${c.lump ? ' <span class="lump-tag" data-tip="Paid once or twice a year; status compares paid to date with the full-year budget">Lump sum</span>' : ''}</span>
            </div>
            <div class="comp-bars" data-tip="${escapeHtml(`Budget ${fmtM(c.b, DP)} M, actual ${fmtM(c.a, DP)} M PKR`)}">
                <span class="comp-budget" style="--w:${((Math.max(0, c.b) / scale) * 100).toFixed(2)}%"></span>
                <span class="comp-actual status-${s}" style="--w:${((Math.max(0, c.a) / scale) * 100).toFixed(2)}%"></span>
            </div>
            <div class="n comp-num">${fmtM(c.a, DP)}</div>
            <div class="n comp-num muted">${fmtM(c.b, DP)}</div>
            <div class="n comp-num ${variance < 0 ? 'is-over' : ''}">${fmtVariance(variance, DP)}</div>
            <div class="n comp-num muted">${fmtPct(pctOf(c.a, totalA))}</div>
        </div>`;
    }).join('') : `<p class="empty-note">${term ? `No component matches “${escapeHtml(term)}”.` : 'No payroll for this selection.'}</p>`;
}

const EMP_COLUMNS = [
    { key: 'name', label: 'Position', num: false },
    { key: 'pA', label: 'Period actual', num: true },
    { key: 'ytdA', label: 'Actual to date', num: true },
    { key: 'forecast', label: 'FY forecast', num: true },
    { key: 'fyB', label: 'FY budget', num: true },
    { key: 'fyVar', label: 'FY variance', num: true }
];

function renderEmployees(v) {
    const term = $('mainSearch').value.trim().toLowerCase();
    const { key, dir } = S.empSort;
    const list = [...v.emps.values()]
        .filter(e => e.pA !== 0 || e.fyB !== 0 || e.ytdA !== 0)
        .filter(e => !term || [e.code, e.pos.name, e.pos.designation, e.pos.dept].some(x => (x || '').toLowerCase().includes(term)))
        .sort((x, y) => {
            const a = key === 'name' ? x.pos.name.toLowerCase() : x[key];
            const b = key === 'name' ? y.pos.name.toLowerCase() : y[key];
            return (a < b ? -1 : a > b ? 1 : 0) * dir;
        });

    $('empTableHead').innerHTML = `<tr>${EMP_COLUMNS.map(c => {
        const active = c.key === key;
        const arrow = active ? (dir === 1 ? ' ▲' : ' ▼') : '';
        return `<th class="${c.num ? 'n' : ''}" aria-sort="${active ? (dir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="th-sort" data-sort="${c.key}">${c.label}${arrow}</button></th>`;
    }).join('')}</tr>`;

    $('empTableBody').innerHTML = list.length ? list.map(e => `<tr class="clickable-tr" tabindex="0" data-emp="${escapeHtml(e.code)}">
        <td>
            <div class="acc-name">${escapeHtml(e.pos.name)}</div>
            <div class="acc-code">${escapeHtml([e.code, e.pos.designation, e.pos.dept].filter(Boolean).join(', '))}</div>
        </td>
        <td class="n">${fmtM(e.pA, 2)}</td>
        <td class="n">${fmtM(e.ytdA, 2)}</td>
        <td class="n actual">${fmtM(e.forecast, 2)}</td>
        <td class="n">${fmtM(e.fyB, 2)}</td>
        <td class="n ${e.fyVar < 0 ? 'is-over' : ''}">${fmtVariance(e.fyVar, 2)}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty-note">${term ? `No one matches “${escapeHtml(term)}”.` : 'No positions for this selection.'}</td></tr>`;

    const t = list.reduce((acc, e) => { ['pA', 'ytdA', 'forecast', 'fyB', 'fyVar'].forEach(k => { acc[k] += e[k]; }); return acc; }, { pA: 0, ytdA: 0, forecast: 0, fyB: 0, fyVar: 0 });
    $('empTableFoot').innerHTML = `<tr>
        <td>Total, ${list.length} ${list.length === 1 ? 'position' : 'positions'}</td>
        <td class="n">${fmtM(t.pA, 2)}</td><td class="n">${fmtM(t.ytdA, 2)}</td>
        <td class="n actual">${fmtM(t.forecast, 2)}</td><td class="n">${fmtM(t.fyB, 2)}</td>
        <td class="n ${t.fyVar < 0 ? 'is-over' : ''}">${fmtVariance(t.fyVar, 2)}</td>
    </tr>`;
}

function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    $('componentView').hidden = tab !== 'component';
    $('employeeView').hidden = tab !== 'employee';
    $('mainSearch').value = '';
    $('mainSearch').placeholder = tab === 'component' ? 'Search components' : 'Search name, code, designation';
    render();
}

/* 7. MODALS & DATA CHECKS ================================================= */

function modalRows() {
    const { type, target } = S.modal;
    const months = FISCAL_MONTHS.filter(m => S.view.scope.has(m));
    const groups = new Map();
    S.data.ledger.forEach(row => {
        if (!S.view.scope.has(row.month)) return;
        const pos = S.data.positions.get(row.code);
        if (S.dept !== ALL_DEPTS && pos.dept !== S.dept) return;
        const share = S.donor === ALL_DONORS ? 1 : (pos.alloc[S.donor] || 0);
        if (!share) return;
        if (type === 'employee' && row.code !== target) return;
        Object.entries(row.comps).forEach(([name, v]) => {
            if (type === 'component' && name !== target) return;
            const key = type === 'component' ? row.code : name;
            if (!groups.has(key)) {
                groups.set(key, type === 'component'
                    ? { key, title: pos.name, sub: [row.code, pos.designation, pos.dept].filter(Boolean).join(', '), byMonth: {}, a: 0, b: 0 }
                    : { key, title: name, sub: LUMP_SUM.has(name) ? 'Lump sum' : '', byMonth: {}, a: 0, b: 0 });
            }
            const g = groups.get(key);
            g.byMonth[row.month] = (g.byMonth[row.month] || 0) + v.a * share;
            g.a += v.a * share;
            g.b += v.b * share;
        });
    });
    const list = [...groups.values()].filter(g => g.a !== 0 || g.b !== 0);
    if (type === 'employee') list.sort((x, y) => (x.key === BASE ? -1 : y.key === BASE ? 1 : y.a - x.a));
    else list.sort((x, y) => y.a - x.a);
    return { months, list };
}

function openBreakdown(type, target) {
    S.modal = { type, target };
    if (type === 'component') {
        $('modalTitle').textContent = target;
        $('modalSearch').placeholder = 'Search name, code, designation';
    } else {
        const pos = S.data.positions.get(target);
        $('modalTitle').textContent = pos.name;
        $('modalSearch').placeholder = 'Search components';
    }
    const scopeText = [periodLabel(), S.dept !== ALL_DEPTS ? S.dept : '', S.donor !== ALL_DONORS ? `${S.donor} share only` : ''].filter(Boolean).join(', ');
    $('modalSubtitle').textContent = type === 'employee'
        ? `${[target, S.data.positions.get(target).designation].filter(Boolean).join(', ')}. ${scopeText}`
        : scopeText;
    if (type === 'component' && LUMP_SUM.has(target) && S.view.comps.has(target)) {
        const c = S.view.comps.get(target);
        $('modalSubtitle').textContent += `. Paid as a lump sum: ${fmtM(c.ytdA, DP)} paid to date against a full-year budget of ${fmtM(c.fyB, DP)} M PKR.`;
    }
    $('modalSearch').value = '';

    const { list } = modalRows();
    const tB = sum(list.map(g => g.b));
    const tA = sum(list.map(g => g.a));
    $('modalStats').innerHTML = `
        <div class="stat"><div class="stat-val">${moneyHtml(tB, 2)}</div><div class="stat-lbl">Budget</div></div>
        <div class="stat"><div class="stat-val actual">${moneyHtml(tA, 2)}</div><div class="stat-lbl">Actual</div></div>
        <div class="stat"><div class="stat-val"><span class="num">${fmtPct(pctOf(tA, tB))}</span></div><div class="stat-lbl">Spent</div></div>
        <div class="stat"><div class="stat-val ${tB - tA < 0 ? 'is-over' : ''}"><span class="num">${fmtVariance(tB - tA, 2)}</span><span class="unit">M PKR</span></div><div class="stat-lbl">Variance</div></div>`;
    renderModalTable();
    openModal('breakdownModal');
}

function renderModalTable() {
    if (!S.modal) return;
    const { months, list } = modalRows();
    const term = $('modalSearch').value.trim().toLowerCase();
    const items = list.filter(g => !term || `${g.title} ${g.sub}`.toLowerCase().includes(term));
    const first = S.modal.type === 'component' ? 'Position' : 'Component';
    $('modalTableHead').innerHTML = `<tr><th>${first}</th>${months.map(m => `<th class="n">${m}</th>`).join('')}<th class="n">Actual</th><th class="n">Budget</th><th class="n">Variance</th></tr>`;
    $('modalTableBody').innerHTML = items.length ? items.map(g => `<tr>
        <td><div class="acc-name">${escapeHtml(g.title)}</div>${g.sub ? `<div class="acc-code">${escapeHtml(g.sub)}</div>` : ''}</td>
        ${months.map(m => `<td class="n">${g.byMonth[m] ? fmtM(g.byMonth[m], 2) : '–'}</td>`).join('')}
        <td class="n actual">${fmtM(g.a, 2)}</td>
        <td class="n">${fmtM(g.b, 2)}</td>
        <td class="n ${g.b - g.a < 0 ? 'is-over' : ''}">${fmtVariance(g.b - g.a, 2)}</td>
    </tr>`).join('') : `<tr><td colspan="${months.length + 4}" class="empty-note">Nothing matches “${escapeHtml(term)}”.</td></tr>`;
}

function openAuditModal() {
    const order = { error: 0, warn: 1, info: 2 };
    const sevLabel = { error: 'Error', warn: 'Review', info: 'Note' };
    const items = [...S.data.audit].sort((x, y) => order[x.severity] - order[y.severity]);
    $('auditTableBody').innerHTML = items.length ? items.map(a => `<tr>
        <td><span class="sev sev-${a.severity}">${sevLabel[a.severity]}</span></td>
        <td>${escapeHtml(a.source || '')}</td>
        <td><div class="acc-name">${escapeHtml(a.description || a.code || '—')}</div><div class="acc-code">${escapeHtml([a.description ? a.code : '', a.month].filter(Boolean).join(', '))}</div></td>
        <td class="n">${a.amount ? fmtM(a.amount, 2) : ''}</td>
        <td>${escapeHtml(a.reason || '')}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-note">No issues found.</td></tr>';
    $('columnTableBody').innerHTML = S.data.columns.map(c => `<tr>
        <td>${escapeHtml(c.file)}</td><td>${escapeHtml(c.column)}</td>
        <td class="${/^Not used/.test(c.use) ? 'muted' : ''}">${escapeHtml(c.use)}</td>
    </tr>`).join('');
    openModal('auditModal');
}

/* 8. EVENTS & LOADING ===================================================== */

function syncToggleButtons() {
    document.querySelectorAll('[data-granularity]').forEach(b => {
        const on = b.dataset.granularity === S.granularity;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-viewmode]').forEach(b => {
        const on = b.dataset.viewmode === S.viewMode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = S.granularity === 'Yearly' && b.dataset.viewmode !== 'Period';
    });
}

function populatePeriodDropdown() {
    const sel = $('periodDropdown');
    sel.innerHTML = periodOptionsFor(S.granularity, S.data.fyEnd).map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
    sel.value = S.period;
    sel.disabled = S.granularity === 'Yearly';
}

function setGranularity(g) {
    const prev = S.period;
    S.granularity = g;
    S.period = nextPeriodFor(g, prev, S.data.asOfIdx);
    if (g === 'Yearly') S.viewMode = 'Period';
    else if (prev === 'FY' && S.viewMode === 'Period') S.viewMode = 'QTD';
    populatePeriodDropdown();
    syncToggleButtons();
    render();
}

function populateFilters() {
    $('yearDropdown').innerHTML = [...S.years].sort().reverse()
        .map(y => `<option value="${escapeHtml(y)}" ${y === S.year ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('');
    const depts = [...new Set([...S.data.positions.values()].map(p => p.dept))].sort();
    if (!depts.includes(S.dept)) S.dept = ALL_DEPTS;
    $('deptDropdown').innerHTML = [ALL_DEPTS, ...depts].map(d => `<option value="${escapeHtml(d)}" ${d === S.dept ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
    const donors = [...S.data.donors];
    if (!donors.includes(DEFAULT_DONOR) && [...S.data.positions.values()].some(p => p.alloc[DEFAULT_DONOR])) donors.push(DEFAULT_DONOR);
    donors.sort().forEach(donorColor);
    if (S.donor !== ALL_DONORS && !donors.includes(S.donor)) S.donor = ALL_DONORS;
    $('donorDropdown').innerHTML = [ALL_DONORS, ...donors].map(d => `<option value="${escapeHtml(d)}" ${d === S.donor ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
}

function showNotice(msg) {
    const n = $('staffNotice');
    n.textContent = msg;
    n.hidden = !msg;
}

async function fetchStaffTexts(year) {
    const get = async name => {
        const res = await fetch(`Data/${year}/${name}`, { cache: 'no-cache' });
        return res.ok ? res.text() : null;
    };
    const [master, budget, actuals] = await Promise.all([get(STAFF_FILES.master), get(STAFF_FILES.budget), get(STAFF_FILES.actuals)]);
    if (!master) return null;
    return { master, budget, actuals };
}

/* Loads, decrypts and parses one year; the ledger reconciliation loads alongside. */
async function loadStaffYear(year, passphrase) {
    const enc = await fetchStaffTexts(year);
    if (!enc) return null;
    const plain = {};
    let legacy = false;
    for (const [k, text] of Object.entries(enc)) {
        if (!text) { plain[k] = ''; continue; }
        const out = await decryptText(text, passphrase);
        plain[k] = await toTable(out.data, STAFF_HINTS[k]);   // CSV or Excel inside the encrypted file
        legacy = legacy || out.legacy;
    }
    const data = buildStaffDataset(year, plain);
    data.legacy = legacy;
    if (legacy) {
        data.audit.unshift({ severity: 'warn', source: 'Encryption', reason: 'These files use the older, weaker encryption. Re-encrypt them with tools/encrypt.html and a long passphrase.' });
    }
    if (!enc.budget) data.audit.push({ severity: 'warn', source: 'Staff_Budget', reason: `${STAFF_FILES.budget} not found for ${year}.` });
    if (!enc.actuals) data.audit.push({ severity: 'warn', source: 'Staff_Actuals', reason: `${STAFF_FILES.actuals} not found for ${year}.` });

    try {
        const p = filePaths(year);
        const [budget, tb, innovation, cic, capex] = await Promise.all([
            fetchTable(p.budget, true, FILE_HINTS.budget), fetchTable(p.tb, true, FILE_HINTS.tb),
            fetchTable(p.innovation, false, FILE_HINTS.innovation), fetchTable(p.cic, false, FILE_HINTS.cic),
            fetchTable(p.capex, false, FILE_HINTS.capex)
        ]);
        data.recon = reconcileToLedger(data, buildDataset(year, { budget, tb, innovation, cic, capex, eod: '' }));
    } catch (e) {
        data.audit.push({ severity: 'info', source: 'Ledger reconciliation', reason: `Skipped: ${e.message}` });
    }
    return data;
}

function applyLoaded(data) {
    S.data = data;
    S.year = data.year;
    const asOfMonth = FISCAL_MONTHS[Math.max(0, data.asOfIdx)];
    if (S.granularity === 'Monthly') S.period = asOfMonth;
    else if (S.granularity === 'Quarterly') S.period = MONTH_QUARTER[asOfMonth];
    populateFilters();
    populatePeriodDropdown();
    syncToggleButtons();
    renderDataCheckChip();
    render();
}

async function unlock(e) {
    if (e) e.preventDefault();
    const pass = $('authPassword').value;
    const err = $('authError');
    err.hidden = true;
    if (!pass) { err.textContent = 'Enter the passphrase.'; err.hidden = false; return; }
    const btn = $('authSubmit');
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    keyCache.clear();
    try {
        const years = [...S.years].sort().reverse();
        let data = null;
        for (const y of years) {
            data = await loadStaffYear(y, pass);
            if (data) break;
        }
        if (!data) throw new Error(`No staff files found for ${years.join(' or ')}.`);
        S.passphrase = pass;
        $('authPassword').value = '';
        applyLoaded(data);
        $('authOverlay').hidden = true;
        document.body.classList.remove('is-locked');
    } catch (ex) {
        keyCache.clear();
        err.textContent = ex instanceof WrongKeyError ? 'That passphrase did not open the staff files.'
            : ex instanceof RangeError ? 'The browser ran out of memory reading a staff file. Check that each workbook holds just the data table, then re-encrypt it.'
            : ex.message;
        err.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Unlock';
    }
}

async function changeYear(year) {
    const prevYear = S.year;
    setLoader(true, `Loading ${year}…`);
    try {
        const data = await loadStaffYear(year, S.passphrase);
        if (!data) {
            showNotice(`No staff files for ${year}; still showing ${prevYear}.`);
            $('yearDropdown').value = prevYear;
        } else {
            showNotice('');
            applyLoaded(data);
        }
    } catch (ex) {
        showNotice(ex instanceof WrongKeyError ? `The ${year} files use a different passphrase; still showing ${prevYear}.` : ex.message);
        $('yearDropdown').value = prevYear;
    } finally {
        setLoader(false);
    }
}

/* Clears everything decrypted from memory by reloading the page. */
function lock() {
    S.passphrase = null;
    S.data = null;
    keyCache.clear();
    window.location.reload();
}

function bindEvents() {
    bindCommonEvents();
    $('authForm').addEventListener('submit', unlock);
    $('btnLock').addEventListener('click', lock);
    $('yearDropdown').addEventListener('change', e => changeYear(e.target.value));
    $('deptDropdown').addEventListener('change', e => { S.dept = e.target.value; render(); });
    $('donorDropdown').addEventListener('change', e => { S.donor = e.target.value; render(); });
    $('periodDropdown').addEventListener('change', e => { S.period = e.target.value; render(); });
    $('dataCheckChip').addEventListener('click', openAuditModal);
    $('mainSearch').addEventListener('input', debounce(render, 120));
    $('modalSearch').addEventListener('input', debounce(renderModalTable, 120));
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.querySelectorAll('[data-granularity]').forEach(b => b.addEventListener('click', () => setGranularity(b.dataset.granularity)));
    document.querySelectorAll('[data-viewmode]').forEach(b => b.addEventListener('click', () => {
        S.viewMode = b.dataset.viewmode;
        syncToggleButtons();
        render();
    }));
    $('empTableHead').addEventListener('click', e => {
        const btn = e.target.closest('[data-sort]');
        if (!btn) return;
        const key = btn.dataset.sort;
        S.empSort = S.empSort.key === key ? { key, dir: -S.empSort.dir } : { key, dir: key === 'name' || key === 'fyVar' ? 1 : -1 };
        render();
    });
    onActivate($('componentBars'), '[data-comp]', el => openBreakdown('component', el.dataset.comp));
    onActivate($('empTableBody'), 'tr[data-emp]', el => openBreakdown('employee', el.dataset.emp));
}

async function init() {
    initTheme();
    bindEvents();
    S.years = await loadYears();
    if (!window.crypto || !window.crypto.subtle) {
        $('authError').textContent = 'This page must be opened over https to unlock staff files.';
        $('authError').hidden = false;
    }
    $('authPassword').focus();
}

/* Exposed for tests only. */
window.__staffInternals = { buildStaffDataset, parseDateLoose, parsePayrollMonth, computeView, S, reconcileToLedger };

if (!window.__BVA_TEST__) {
    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
}
})();
