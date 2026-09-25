'use strict';
/* ==========================================================================
   Karandaaz Pakistan — BvA data engine
   Reads Budget, trial balance, investments, CAPEX and EOD files for a year
   and returns one ledger. Used by app.js, and by staff_app.js to reconcile
   payroll to the "Staff cost" line in the trial balance. Needs common.js.
   ========================================================================== */

/* Header names each file should contain, used to find the right sheet and header row in .xlsx files. */
const FILE_HINTS = {
    budget: ['department', 'accountcode', 'accountname', 'donor', 'q1budget'],
    tb: ['naturalacctsegmentvalue', 'totaldr', 'totalcr', 'accountingperiodparam'],
    innovation: ['party', 'type'],
    cic: ['party', 'type'],
    capex: ['description', 'budget'],
    eod: ['month', 'capitalavailablepkrmillion', 'capitaldeployedpkrmillion']
};

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


/* PARSING ========================================================= */

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
    const col = resolveColumns(table.headers, COLUMN_SPECS.budget, 'Budget');
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
    const col = resolveColumns(table.headers, COLUMN_SPECS.tb, 'ActualDonor');
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
                mappedTo: `${mapping.Dept} / ${mapping.Stream}`, reason: `Code not in the budget file, placed by ${hit.method.charAt(0).toLowerCase()}${hit.method.slice(1)}`
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
    const col = resolveColumns(table.headers, COLUMN_SPECS.capex, 'CAPEX');
    const months = detectMonthColumns(table.headers, 'CAPEX', ctx);
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
                ctx.flag({ severity: 'warn', source: 'CAPEX', description: desc, mappedTo: `${mapping.Dept} / ${mapping.Name}`, reason: 'Partial name match to the budget file' });
            }
        } else {
            mapping = { Dept: capexDept, Stream: desc, Name: desc, Program: 'Unallocated', Donor: DEFAULT_DONOR, Code: `CAPEX-${normName(desc).toUpperCase().slice(0, 24)}` };
            const annual = col.budget ? getSafeNum(row[col.budget]) : 0;
            if (annual) {
                FISCAL_MONTHS.forEach(m => ctx.ledger.add(m, mapping, DEFAULT_DONOR, { budget: annual / 12 }));
                ctx.flag({ severity: 'info', source: 'CAPEX', description: desc, amount: annual, mappedTo: capexDept, reason: 'Not in the budget file. The CAPEX file budget is used, spread evenly over 12 months' });
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
        col = resolveColumns(table.headers, COLUMN_SPECS.eod, 'EOD');
    } catch (e) {
        ctx.flag({ severity: 'warn', source: 'EOD', reason: `File could not be read, so the EOD panel is hidden. ${e.message}` });
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
            let stated = getSafeNum(row[col.statedPct]);
            if (Math.abs(stated) <= 1.5 && pct > 1.5) stated *= 100;   // Excel % cells arrive as fractions
            if (Math.abs(stated - pct) > 0.5) {
                ctx.flag({ severity: 'info', source: 'EOD', month: clean(row[col.month]), reason: `Stated EOD ${stated.toFixed(2)}% differs from deployed ÷ available (${pct.toFixed(2)}%). The dashboard uses the calculated figure.` });
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

    /* Each input is a table from fetchTable/toTable, or raw CSV text. */
    const asTable = x => (x && typeof x === 'object' ? x : readCSV(x));
    const chart = parseBudget(asTable(texts.budget), ctx);
    parseTrialBalance(asTable(texts.tb), chart, ctx);
    parseInvestments(asTable(texts.innovation), 'Innovation Investment', 'Innovation', ctx);
    parseInvestments(asTable(texts.cic), 'Corporate Investment and Credit', 'CIC', ctx);
    parseCapex(asTable(texts.capex), chart, ctx);
    const eod = parseEod(asTable(texts.eod), ctx);

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

