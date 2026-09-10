// ========================================================================
// 1. CONFIGURATION & STATE
// ========================================================================
const availableYears = ['FY2025', 'FY2026', 'FY2027']; // Add future years here
let selectedYear = availableYears[availableYears.length - 1]; // Defaults to highest year

function getFilePaths(year) {
    return {
        budgetMasterCSV: `Data/${year}/Budget.csv`, 
        tbDonorCSV: `Data/${year}/ActualDonor.csv`,      
        iiCSV: `Data/${year}/Innovation.csv`,
        cicCSV: `Data/${year}/CIC.csv`,
        eodCSV: `Data/${year}/EOD.csv`,
        capexCSV: `Data/${year}/CAPEX.csv`
    };
}

const fiscalMonths = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const quarterMap = {
    'Jul': 'Q1', 'Aug': 'Q1', 'Sep': 'Q1',
    'Oct': 'Q2', 'Nov': 'Q2', 'Dec': 'Q2',
    'Jan': 'Q3', 'Feb': 'Q3', 'Mar': 'Q3',
    'Apr': 'Q4', 'May': 'Q4', 'Jun': 'Q4'
};

let rawData = [];
let globalEODData = [];
let currentGranularity = 'Monthly';
let viewMode = 'QTD'; 
let selectedPeriod = 'Jul';
let selectedDepartment = '';
let isDarkMode = false; 
let isSummaryView = true;
let currentModalData = {}; 

const getBrandColors = () => ['#006890', '#4a96d2', '#f97316', '#f6a505', '#14532d', '#06969c'];

function getDeptSortIndex(deptName) {
    if (!deptName) return 999;
    const clean = deptName.trim().toUpperCase();
    if (clean === 'DFS' || clean.includes('DIGITAL FINANCIAL')) return 0;
    if (clean === 'CIC' || clean.includes('CHALLENGE INNOVATION') || clean.includes('CORPORATE INVESTMENT')) return 1;
    if (clean === 'II' || clean.includes('INCLUSIVE INNOVATION') || clean.includes('INNOVATION INVESTMENT')) return 2;
    if (clean === 'DI' || clean.includes('DIGITAL INCLUSION')) return 3;
    if (clean === 'RMC' || clean.includes('RESEARCH')) return 4;
    if (clean === 'STAFF AND ADMIN' || clean.includes('STAFF') || clean.includes('ADMIN')) return 5;
    if (clean === 'CAPEX' || clean.includes('CAPITAL')) return 6;
    return 999;
}

// ========================================================================
// 2. UTILITY & FORMATTING
// ========================================================================
function getFormattedParts(num) {
    const val = parseFloat(num) || 0;
    const absVal = Math.abs(val);
    if (absVal >= 1000000) return { v: (val / 1000000).toFixed(1), u: 'M PKR' };
    if (absVal >= 1000) return { v: (val / 1000).toFixed(1), u: 'K PKR' };
    return { v: val.toLocaleString('en-PK', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), u: 'PKR' };
}

function formatPKRInline(num) {
    const parts = getFormattedParts(num);
    return `<span class="val-unit-inline">${parts.u}</span> <span class="val-num-inline">${parts.v}</span>`;
}

function getSafeNum(val) {
    if (val === undefined || val === null) return 0;
    let str = String(val).trim();
    if (str === '' || str === '-') return 0;
    let isNegative = (str.includes('(') && str.includes(')')) || str.startsWith('-');
    let cleaned = str.replace(/[^0-9.-]/g, ''); 
    let num = parseFloat(cleaned);
    return isNaN(num) ? 0 : (isNegative && num > 0 ? -num : num);
}

function animateCounter(elementId, targetValue) {
    const elem = document.getElementById(elementId);
    if (!elem) return;
    const startVal = parseFloat(elem.getAttribute('data-val')) || 0;
    elem.setAttribute('data-val', targetValue);

    const duration = 1400;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const currentVal = startVal + (targetValue - startVal) * ease;
        
        const parts = getFormattedParts(currentVal);
        elem.innerHTML = `<span class="val-unit">${parts.u}</span><span class="val-num">${parts.v}</span>`;

        if (progress < 1) requestAnimationFrame(update);
        else {
            const finalParts = getFormattedParts(targetValue);
            elem.innerHTML = `<span class="val-unit">${finalParts.u}</span><span class="val-num">${finalParts.v}</span>`;
        }
    }
    requestAnimationFrame(update);
}

function animateCounterPct(elementId, targetValue) {
    const elem = document.getElementById(elementId);
    if (!elem) return;
    const startVal = parseFloat(elem.getAttribute('data-val')) || 0;
    elem.setAttribute('data-val', targetValue);
    const duration = 1400;
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const currentVal = startVal + (targetValue - startVal) * ease;
        elem.innerHTML = `<span class="val-unit">RATE</span><span class="val-num">${Math.round(currentVal)}%</span>`;
        if (progress < 1) requestAnimationFrame(update);
        else elem.innerHTML = `<span class="val-unit">RATE</span><span class="val-num">${Math.round(targetValue)}%</span>`;
    }
    requestAnimationFrame(update);
}

function generateSparkline(data) {
    if (!data || data.length < 2) return '<div style="width:40px; height:15px;"></div>';
    const max = Math.max(...data) || 1;
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 45, h = 18;
    const step = w / (data.length - 1);
    
    let d = `M 0 ${h - ((data[0] - min) / range) * h}`;
    for (let i = 1; i < data.length; i++) {
        d += ` L ${i * step} ${h - ((data[i] - min) / range) * h}`;
    }
    
    return `<svg width="${w}" height="${h}" style="overflow:visible;">
                <path d="${d}" fill="none" stroke="var(--krn-light-blue)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
}

function generateCardSparkline(data) {
    if (!data || data.length < 2) return '<div style="width:100px; height:25px;"></div>';
    const max = Math.max(...data) || 1;
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 100, h = 25;
    const step = w / (data.length - 1);
    
    let d = `M 0 ${h - ((data[0] - min) / range) * h}`;
    for (let i = 1; i < data.length; i++) {
        d += ` L ${i * step} ${h - ((data[i] - min) / range) * h}`;
    }
    
    return `<svg width="${w}" height="${h}" style="overflow:visible;">
                <path d="${d}" fill="none" stroke="var(--krn-light-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
}

function generateMiniSparkline(data) {
    if (!data || data.length < 2) return '<div style="width:70px; height:20px;"></div>';
    const max = Math.max(...data) || 1;
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 70, h = 20;
    const step = w / (data.length - 1);
    
    let d = `M 0 ${h - ((data[0] - min) / range) * h}`;
    for (let i = 1; i < data.length; i++) {
        d += ` L ${i * step} ${h - ((data[i] - min) / range) * h}`;
    }
    
    return `<svg width="${w}" height="${h}" style="overflow:visible;">
                <path d="${d}" fill="none" stroke="var(--krn-light-blue)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
}

const tooltip = document.getElementById('hoverTooltip');
function showTooltip(e, label, value, pct) {
    const parts = getFormattedParts(value);
    tooltip.innerHTML = `<strong>${label}</strong><span class="val-num-inline" style="color:inherit">${parts.v}</span> ${parts.u} (<span class="val-num-inline" style="color:inherit">${pct}</span>%)`;
    tooltip.classList.add('visible');
    moveTooltip(e);
}
function moveTooltip(e) {
    tooltip.style.left = (e.clientX + 15) + 'px';
    tooltip.style.top = (e.clientY + 15) + 'px';
}
function hideTooltip() { tooltip.classList.remove('visible'); }

// ========================================================================
// 3. SVG DONUT ENGINE
// ========================================================================
function renderSvgDonut(containerId, items, centerBadge = null, bottomLabel = null, showLegend = true) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const total = items.reduce((acc, it) => acc + (parseFloat(it.value) || 0), 0);
    const radius = 42; 
    const C = 2 * Math.PI * radius;

    let cumulativePercent = 0;
    let circlesHtml = `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="var(--border-color)" />`;
    let legendHtml = '';

    if (total === 0) {
        if (showLegend) legendHtml = `<div style="color: var(--text-secondary); text-align: center; width: 100%; margin-top:0px; font-size: 0.6rem;">No data</div>`;
    } else {
        items.forEach((it) => {
            const fraction = it.value / total;
            const sliceLen = fraction * C;
            const offset = cumulativePercent * C;
            cumulativePercent += fraction;

            circlesHtml += `
                <circle class="donut-slice-${containerId}" 
                    cx="50" cy="50" r="${radius}" fill="none" stroke="${it.color}" 
                    stroke-dasharray="0 ${C}" stroke-dashoffset="-${offset}" data-target-len="${sliceLen}"
                    onmouseenter="showTooltip(event, '${it.label.replace(/'/g, "\\'")}', ${it.value}, '${Math.round(fraction*100)}')"
                    onmousemove="moveTooltip(event)" onmouseleave="hideTooltip()"
                    style="transform: rotate(-90deg); transform-origin: 50% 50%; pointer-events: stroke; transition: stroke-dasharray 1.4s cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 1.4s cubic-bezier(0.16, 1, 0.3, 1);"
                />
            `;

            if (showLegend) {
                legendHtml += `
                    <div class="donut-legend-item">
                        <div class="donut-legend-item-left">
                            <div class="donut-legend-dot" style="background-color: ${it.color};"></div>
                            <span style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden; font-family: Calibri, sans-serif !important;">${it.label}</span>
                        </div>
                        <strong style="font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight:400;">${Math.round(fraction * 100)}%</strong>
                    </div>
                `;
            }
        });
    }

    let centerBadgeHtml = centerBadge ? `<div class="donut-center-badge"><div class="donut-center-pct">${centerBadge.pct}%</div><div class="donut-center-sub">${centerBadge.label}</div></div>` : '';
    let bottomBadgeHtml = bottomLabel ? `<div class="donut-bottom-badge">${bottomLabel}</div>` : '';

    container.innerHTML = `
        <div class="svg-donut-wrapper">
            <div class="donut-chart-box">
                <svg viewBox="0 0 100 100" class="donut-svg">
                    ${circlesHtml}
                </svg>
                ${centerBadgeHtml}
            </div>
            ${bottomBadgeHtml}
            ${showLegend && legendHtml ? `<div class="donut-legend-list">${legendHtml}</div>` : ''}
        </div>
    `;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.querySelectorAll(`.donut-slice-${containerId}`).forEach(slice => {
                const targetLen = parseFloat(slice.getAttribute('data-target-len')) || 0;
                slice.style.strokeDasharray = `${targetLen} ${C - targetLen}`;
            });
        });
    });
}

// ========================================================================
// 4. MULTI-LINK DATA PARSING ENGINE 
// ========================================================================
function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    
    function parseCSVLine(line) {
        let result = [];
        let inQuotes = false;
        let val = '';
        for (let c = 0; c < line.length; c++) {
            let char = line[c];
            if (char === '"' && inQuotes && line[c+1] === '"') { val += '"'; c++; }
            else if (char === '"') { inQuotes = !inQuotes; }
            else if (char === ',' && !inQuotes) { result.push(val); val = ''; }
            else { val += char; }
        }
        result.push(val);
        return result.map(v => v.trim());
    }

    const rawHeaders = parseCSVLine(lines[0]);
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    
    const objects = [];
    for(let i = 1; i < lines.length; i++) {
        const currentline = parseCSVLine(lines[i]);
        if (currentline.join('').trim() === '') continue;
        
        const obj = { _raw: {} };
        for(let j = 0; j < headers.length; j++){
            obj[headers[j]] = currentline[j] || '';
            obj._raw[rawHeaders[j]] = currentline[j] || ''; 
        }
        objects.push(obj);
    }
    return objects;
}

function parseMultiLinkData(budgetRows, donorTBRows, iiRows, cicRows, capexRows) {
    const masterRecords = {};
    function getKey(m, c, p, d) { return `${m}|${c}|${p}|${d}`; }

    const coaMap = {}; 
    let pseudoCounter = 1;

    budgetRows.forEach(r => {
        const codeKey = Object.keys(r._raw).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === 'accountcode' || k.toLowerCase().includes('natural') || k.toLowerCase() === 'code' || k.toLowerCase() === 'acct');
        const rawCode = codeKey ? r._raw[codeKey] : '';
        let code = String(rawCode).trim().toUpperCase();
        
        const accName = String(r['accountname'] || r['name'] || r['description'] || r['accountdescription'] || code || 'Unnamed');
        const dept = String(r['department'] || r['dept'] || 'Uncategorized');
        
        let isTotalRow = accName.toUpperCase() === 'TOTAL' || dept.toUpperCase() === 'TOTAL' || code.includes('SUBTOTAL') || accName.toUpperCase().includes('TOTAL EXPENSES');
        if (isTotalRow) return;

        if (!code || code === 'NAN' || code === '') {
            code = 'UNMAPPED_BUDGET_' + pseudoCounter++;
        }

        const stream = r['stream'] || r['expenseitems'] || r['workstream'] || 'General';
        const program = r['program'] || 'Unallocated';
        
        let donorKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('donor') || k.toLowerCase().includes('fund'));
        let donor = donorKey ? String(r._raw[donorKey] || '').trim() : 'OSR';
        if (!donor || donor === '') donor = 'OSR';

        coaMap[code] = { Dept: dept, Stream: stream, Name: accName, Program: program, Donor: donor, Code: code };

        let q1 = getSafeNum(r['q1budget']) || getSafeNum(r['q1']);
        let q2 = getSafeNum(r['q2budget']) || getSafeNum(r['q2']);
        let q3 = getSafeNum(r['q3budget']) || getSafeNum(r['q3']);
        let q4 = getSafeNum(r['q4budget']) || getSafeNum(r['q4']);
        
        let q4_1_key = Object.keys(r._raw).find(k => k.toLowerCase().replace(/\s/g, '') === 'q4budget1' || k.toLowerCase() === 'q4 budget.1');
        let q4_key = Object.keys(r._raw).find(k => k.toLowerCase().replace(/\s/g, '') === 'q4budget' || k.toLowerCase() === 'q4 budget');
        
        if (q3 === 0 && q4_key && q4_1_key) {
            q3 = getSafeNum(r._raw[q4_key]);
            q4 = getSafeNum(r._raw[q4_1_key]);
        }

        if (q1 === 0 && q2 === 0 && q3 === 0 && q4 === 0) {
            let yKey = Object.keys(r._raw).find(k => {
                let clean = k.toLowerCase().replace(/[^a-z]/g, '');
                return clean === 'yearlybudget' || clean === 'totalbudget' || clean === 'budget' || clean === 'total' || clean === 'annual' || clean === 'annualbudget';
            });
            if (yKey) {
                let yBud = getSafeNum(r._raw[yKey]);
                q1 = q2 = q3 = q4 = yBud / 4;
            }
        }

        const qToMonths = { 
            'Q1': ['Jul','Aug','Sep'], 
            'Q2': ['Oct','Nov','Dec'], 
            'Q3': ['Jan','Feb','Mar'], 
            'Q4': ['Apr','May','Jun'] 
        };

        const qs = {'Q1': q1, 'Q2': q2, 'Q3': q3, 'Q4': q4};
        Object.keys(qs).forEach(q => {
            if (qs[q] === 0) return;
            let monthlyBud = qs[q] / 3;
            qToMonths[q].forEach(m => {
                const key = getKey(m, code, program, donor);
                if (!masterRecords[key]) {
                    masterRecords[key] = {
                        Department: dept, Stream: stream, Program: program,
                        Code: code, NaturalAccount: accName, Month: m,
                        Actual: 0, Budget: 0, ActualDonors: {}, BudgetDonors: {}
                    };
                }
                masterRecords[key].Budget += monthlyBud;
                masterRecords[key].BudgetDonors[donor] = (masterRecords[key].BudgetDonors[donor] || 0) + monthlyBud;
            });
        });
    });

    donorTBRows.forEach(r => {
        const codeKey = Object.keys(r._raw).find(k => (k.toLowerCase().includes('natural') && k.toLowerCase().includes('value')) || k.toLowerCase() === 'naturalaccount' || k.toLowerCase() === 'accountcode');
        const code = String(r._raw[codeKey] || r['acct'] || r['code'] || '').trim().toUpperCase();
        if (!code) return;

        const periodKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('period') || k.toLowerCase().includes('month'));
        const month = String(r._raw[periodKey] || 'Jul').split('-')[0].substring(0, 3);
        
        const drKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('dr') || k.toLowerCase().includes('debit') || k.toLowerCase() === 'total_dr');
        const crKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('cr') || k.toLowerCase().includes('credit') || k.toLowerCase() === 'total_cr');
        const actual = getSafeNum(r._raw[drKey]) - getSafeNum(r._raw[crKey]);
        if (actual === 0) return;

        let mapping = coaMap[code];

        if (!mapping) {
            const typeKey = Object.keys(r._raw).find(k => k.toLowerCase() === 'acct_type' || k.toLowerCase() === 'accttype');
            if (typeKey) {
                let val = String(r._raw[typeKey]).trim().toUpperCase();
                if (val === 'R' || val === 'A' || val === 'L' || val === 'Q') return; 
            }
            
            const descKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('natural'));
            const desc = String(r._raw[descKey] || code).trim();
            
            let fuzzyKey = Object.keys(coaMap).find(k => {
                let bName = coaMap[k].Name.toUpperCase();
                return bName !== 'UNNAMED' && (bName === desc.toUpperCase() || bName.includes(desc.toUpperCase()) || desc.toUpperCase().includes(bName));
            });
            
            if (fuzzyKey) {
                mapping = coaMap[fuzzyKey];
            } else if (code.startsWith('D')) {
                mapping = { Dept: 'Digital Financial Services', Stream: desc, Name: desc, Program: 'Unallocated', Donor: 'OSR' };
            } else if (code.startsWith('K')) {
                mapping = { Dept: 'Research, Marketing & Communications', Stream: desc, Name: desc, Program: 'Unallocated', Donor: 'OSR' };
            } else if (code.startsWith('H') || code.startsWith('S') || code.startsWith('SS')) {
                mapping = { Dept: 'Administrative Expenses', Stream: 'Unmapped Admin', Name: desc, Program: 'Unallocated', Donor: 'OSR' };
            } else {
                mapping = { Dept: 'Unmapped Actuals', Stream: 'Unmapped', Name: desc, Program: 'Unmapped', Donor: 'OSR' };
            }
        } else {
            mapping = { ...mapping }; 
            if (code.startsWith('D')) mapping.Dept = 'Digital Financial Services';
        }

        const donorKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('additionalsegmentdesc') || k.toLowerCase() === 'donor' || k.toLowerCase() === 'fund');
        let rawDonor = String(r._raw[donorKey] || r['additionalsegmentdesc'] || r['donor'] || mapping.Donor || 'OSR').trim();
        if (rawDonor === '' || rawDonor.toLowerCase() === 'nan' || rawDonor === '0' || rawDonor === 'undefined') rawDonor = 'OSR';
        
        let finalDonor = rawDonor;
        let dLower = String(rawDonor).toLowerCase();
        
        if (dLower.includes(' and ') || dLower.includes(' & ') || dLower.includes('+')) {
            finalDonor = 'OSR';
        } else if (mapping.Dept !== 'Digital Financial Services' && mapping.Dept !== 'DFS') {
            if (dLower.includes('fcdo') || dLower.includes('n/a') || dLower.includes('nan') || dLower === '0') {
                finalDonor = 'OSR';
            }
        }

        const key = getKey(month, code, mapping.Program, finalDonor);
        if (!masterRecords[key]) {
            masterRecords[key] = {
                Department: mapping.Dept, Stream: mapping.Stream, Program: mapping.Program,
                Code: code, NaturalAccount: mapping.Name, Month: month,
                Actual: 0, Budget: 0, ActualDonors: {}, BudgetDonors: {}
            };
        }
        masterRecords[key].Actual += actual;
        masterRecords[key].ActualDonors[finalDonor] = (masterRecords[key].ActualDonors[finalDonor] || 0) + actual;
    });

    function processInvestmentRows(invRows, deptName) {
        invRows.forEach(r => {
            let party = String(r['party'] || r._raw['Party'] || '').trim();
            let stream = String(r['type'] || r._raw['Type'] || '').trim();
            
            if (!party || party.toUpperCase().includes('TOTAL')) return;
            if (!stream) stream = 'General';

            let pseudoCode = 'INV_' + pseudoCounter++;
            
            fiscalMonths.forEach(m => {
                let mKey = Object.keys(r._raw).find(k => k.toLowerCase().startsWith(m.toLowerCase()));
                if (mKey) {
                    let actual = getSafeNum(r._raw[mKey]);
                    if (actual !== 0) {
                        const key = getKey(m, pseudoCode, 'Unallocated', 'OSR');
                        if (!masterRecords[key]) {
                            masterRecords[key] = {
                                Department: deptName, Stream: stream, Program: 'Unallocated',
                                Code: pseudoCode, NaturalAccount: party, Month: m,
                                Actual: 0, Budget: 0, ActualDonors: {}, BudgetDonors: {}
                            };
                        }
                        masterRecords[key].Actual += actual;
                        masterRecords[key].ActualDonors['OSR'] = (masterRecords[key].ActualDonors['OSR'] || 0) + actual;
                    }
                }
            });
        });
    }
    processInvestmentRows(iiRows, 'Innovation Investment');
    processInvestmentRows(cicRows, 'Corporate Investment and Credit');

    const processedCapexCodes = new Set();
    if (capexRows) {
        capexRows.forEach(r => {
            const codeKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('account') || k.toLowerCase().includes('code') || k.toLowerCase().includes('natural')) || Object.keys(r._raw)[0];
            const descKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('item') || k.toLowerCase().includes('head') || k.toLowerCase().includes('name') || k.toLowerCase().includes('expense') || k.toLowerCase().includes('particular')) || Object.keys(r._raw)[1];
            
            let code = r._raw[codeKey];
            const desc = String(r._raw[descKey] || '').trim();

            if (!code || typeof code !== 'string' || code.trim() === '' || code.toUpperCase() === 'NAN') {
                if (!desc || desc.toUpperCase().includes('TOTAL') || desc.toUpperCase().includes('SUBTOTAL')) return;
                code = desc.toUpperCase(); 
            } else {
                code = code.trim().toUpperCase();
            }
            
            let isTotal = code.includes('TOTAL') || desc.toUpperCase().includes('TOTAL') || code.includes('BALANCE') || code.includes('SUBTOTAL') || code.includes('NET');
            if (isTotal) return;
            
            if (processedCapexCodes.has(code)) return;
            processedCapexCodes.add(code);

            fiscalMonths.forEach(m => {
                let mKey = Object.keys(r._raw).find(k => {
                    let lowerK = k.toLowerCase();
                    return lowerK.includes(m.toLowerCase());
                });
                
                if (mKey) {
                    let actual = getSafeNum(r._raw[mKey]);
                    if (actual !== 0) {
                         let mapping = coaMap[code];
                         
                         if (!mapping) {
                             let foundKey = Object.keys(coaMap).find(k => {
                                 let cleanName = coaMap[k].Name.toLowerCase().replace(/[^a-z0-9]/g, '');
                                 let cleanDesc = desc.toLowerCase().replace(/[^a-z0-9]/g, '');
                                 return cleanName && cleanDesc && (cleanName.includes(cleanDesc) || cleanDesc.includes(cleanName));
                             });
                             
                             if (foundKey) {
                                 mapping = coaMap[foundKey];
                             } else {
                                 let capexDeptName = 'CAPEX';
                                 let existingCapex = Object.values(coaMap).find(mapObj => mapObj.Dept.toUpperCase().includes('CAPEX') || mapObj.Dept.toUpperCase().includes('CAPITAL'));
                                 if (existingCapex) capexDeptName = existingCapex.Dept;

                                 mapping = { Dept: capexDeptName, Stream: desc || 'Capital Expenditure', Name: desc || code, Program: 'Unallocated', Donor: 'OSR', Code: code };
                             }
                         }

                         const key = getKey(m, mapping.Code || code, mapping.Program, 'OSR');
                         if (!masterRecords[key]) {
                             masterRecords[key] = { Department: mapping.Dept, Stream: mapping.Stream, Program: mapping.Program, Code: mapping.Code || code, NaturalAccount: mapping.Name, Month: m, Actual: 0, Budget: 0, ActualDonors: {}, BudgetDonors: {} };
                         }
                         
                         masterRecords[key].Actual += actual;
                         masterRecords[key].ActualDonors['OSR'] = (masterRecords[key].ActualDonors['OSR'] || 0) + actual;
                         
                         masterRecords[key].Budget += actual;
                         masterRecords[key].BudgetDonors['OSR'] = (masterRecords[key].BudgetDonors['OSR'] || 0) + actual;
                    }
                }
            });
        });
    }

    return Object.values(masterRecords);
}

// ========================================================================
// 5. CONTROL HANDLERS (Period, QTD, YTD)
// ========================================================================
function applyTheme() {
    const track = document.getElementById('themeTrack');
    const label = document.getElementById('themeLabel');
    
    if (isDarkMode) {
        document.body.classList.remove('light-mode');
        if (track) track.classList.add('active-toggle');
        if (label) label.innerText = 'Dark';
    } else {
        document.body.classList.add('light-mode');
        if (track) track.classList.remove('active-toggle');
        if (label) label.innerText = 'Light';
    }
}

function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    applyTheme();
    updateDashboard();
}

function toggleViewMode() {
    isSummaryView = !isSummaryView;
    if (isSummaryView) {
        document.body.classList.remove('view-details');
        document.getElementById('btnBackToSummary').style.display = 'none';
    } else {
        document.body.classList.add('view-details');
        document.getElementById('btnBackToSummary').style.display = 'inline-block';
    }
    updateDashboard(); 
}

function setGranularity(type, btn) {
    currentGranularity = type;
    document.getElementById('btnMonthly').classList.remove('active');
    document.getElementById('btnQuarterly').classList.remove('active');
    document.getElementById('btnQuarterly').nextElementSibling.classList.remove('active');
    btn.classList.add('active');
    populatePeriodDropdown();
    updateDashboard();
}

function setViewMode(mode, btn) {
    viewMode = mode;
    document.getElementById('btnPeriod').classList.remove('active');
    document.getElementById('btnQTD').classList.remove('active');
    document.getElementById('btnYTD').classList.remove('active');
    btn.classList.add('active');
    updateDashboard();
}

function populateYearDropdown() {
    const yearSelect = document.getElementById('yearDropdown');
    if (!yearSelect) return;
    yearSelect.innerHTML = '';
    const sortedYears = [...availableYears].sort().reverse();
    sortedYears.forEach(y => {
        yearSelect.add(new Option(y, y, false, y === selectedYear));
    });
}

function onYearChange() {
    selectedYear = document.getElementById('yearDropdown').value;
    init(); // Re-fetch the new year's data
}

function populatePeriodDropdown() {
    const dropdown = document.getElementById('periodDropdown');
    dropdown.innerHTML = '';
    if (currentGranularity === 'Monthly') {
        fiscalMonths.forEach(m => dropdown.add(new Option(m, m, false, m === selectedPeriod)));
        if (!fiscalMonths.includes(selectedPeriod)) selectedPeriod = 'Jul';
    } else if (currentGranularity === 'Quarterly') {
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        quarters.forEach(q => dropdown.add(new Option(q, q, false, q === selectedPeriod)));
        if (!quarters.includes(selectedPeriod)) selectedPeriod = 'Q1';
    } else {
        dropdown.add(new Option('Full Fiscal Year (Jul-Jun)', 'FY Total', false, true));
        selectedPeriod = 'FY Total';
        viewMode = 'Period'; 
        document.getElementById('btnPeriod').classList.add('active');
        document.getElementById('btnQTD').classList.remove('active');
        document.getElementById('btnYTD').classList.remove('active');
    }
}

function onPeriodChange() {
    selectedPeriod = document.getElementById('periodDropdown').value;
    updateDashboard();
}

function openDepartmentDetails(deptName) {
    if (isSummaryView) toggleViewMode();
    selectDepartment(deptName);
}

function selectDepartment(deptName) {
    selectedDepartment = deptName;
    const cards = document.getElementById('deptListContainer').getElementsByClassName('dept-grid-card');
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-dept') === deptName) cards[i].classList.add('active');
        else cards[i].classList.remove('active');
    }
    renderCard3Details();
}

function isRowInViewScope(r) {
    const monthStr = r.Month || r.Month;
    if (currentGranularity === 'Yearly' || selectedPeriod === 'FY Total') return true;
    const rMonthIdx = fiscalMonths.indexOf(monthStr);
    if (rMonthIdx === -1) return false;

    const selMonthIdx = fiscalMonths.indexOf(selectedPeriod);
    const rQtr = quarterMap[monthStr];
    const selQtr = quarterMap[selectedPeriod];

    if (viewMode === 'YTD') {
        if (currentGranularity === 'Monthly') return rMonthIdx <= selMonthIdx;
        if (currentGranularity === 'Quarterly') {
            const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
            return quarters.indexOf(rQtr) <= quarters.indexOf(selectedPeriod);
        }
    } else if (viewMode === 'QTD') {
        if (currentGranularity === 'Monthly') return rQtr === selQtr && rMonthIdx <= selMonthIdx;
        if (currentGranularity === 'Quarterly') return rQtr === selectedPeriod; 
    } else { 
        if (currentGranularity === 'Monthly') return monthStr === selectedPeriod;
        if (currentGranularity === 'Quarterly') return rQtr === selectedPeriod;
    }
    return false;
}

// ========================================================================
// 6. DASHBOARD RENDERING 
// ========================================================================
function updateDashboard() {
    if (!rawData || rawData.length === 0) return;

    const depts = [...new Set(rawData.map(r => r.Department))];
    if (!selectedDepartment && depts.length > 0) selectedDepartment = depts[0];

    let topBudget = 0, topActual = 0;
    rawData.forEach(r => { 
        topBudget += r.Budget; 
        topActual += r.Actual; 
    });

    document.getElementById('lblTopActual').innerText = 'FY Total Actual';
    document.getElementById('lblTopVariance').innerText = 'FY Variance';

    animateCounter('topKpiBudget', topBudget);
    animateCounter('topKpiActual', topActual);
    animateCounter('topKpiVariance', Math.abs(topBudget - topActual));
    
    const burnRate = topBudget > 0 ? (topActual / topBudget) * 100 : 0;
    animateCounterPct('topKpiBurn', burnRate);

    document.getElementById('lblPeriodBudget').innerText = `${viewMode} Budget`;
    document.getElementById('lblPeriodActual').innerText = `${viewMode} Actual`;

    const filteredRows = rawData.filter(r => isRowInViewScope(r));

    let card1Budget = 0, card1Actual = 0;
    const periodActualDonors = {};
    const periodBudgetDonors = {};

    filteredRows.forEach(r => {
        card1Budget += r.Budget; 
        card1Actual += r.Actual;
        
        Object.keys(r.ActualDonors).forEach(k => periodActualDonors[k] = (periodActualDonors[k] || 0) + r.ActualDonors[k]);
        Object.keys(r.BudgetDonors).forEach(k => periodBudgetDonors[k] = (periodBudgetDonors[k] || 0) + r.BudgetDonors[k]);
    });

    animateCounter('card1Budget', card1Budget);
    animateCounter('card1Actual', card1Actual);

    const bvaData = [];
    let bvaPct = card1Budget > 0 ? Math.round((card1Actual / card1Budget) * 100) : 0;

    bvaData.push({ label: 'Spent', value: card1Actual, color: 'var(--krn-blue)' });
    bvaData.push({ label: 'Remaining', value: Math.max(0, card1Budget - card1Actual), color: 'var(--border-color)' });
    
    const currentBrandColors = getBrandColors();
    const pActDonItems = Object.keys(periodActualDonors).filter(d => periodActualDonors[d] > 0).map((d, i) => ({ label: d, value: periodActualDonors[d], color: currentBrandColors[i % currentBrandColors.length] }));
    const pBudDonItems = Object.keys(periodBudgetDonors).filter(d => periodBudgetDonors[d] > 0).map((d, i) => ({ label: d, value: periodBudgetDonors[d], color: currentBrandColors[i % currentBrandColors.length] }));

    const summaryDonutContainer = document.getElementById('summaryDonutContainer');
    if (summaryDonutContainer) {
        
        let targetMonthStr = '';
        if (currentGranularity === 'Monthly') targetMonthStr = selectedPeriod;
        else if (currentGranularity === 'Quarterly') {
            if (selectedPeriod === 'Q1') targetMonthStr = 'Sep';
            if (selectedPeriod === 'Q2') targetMonthStr = 'Dec';
            if (selectedPeriod === 'Q3') targetMonthStr = 'Mar';
            if (selectedPeriod === 'Q4') targetMonthStr = 'Jun';
        } else {
            targetMonthStr = 'Jun';
        }
        
        // Year logic for EOD placeholder
        let endYearMatch = selectedYear.match(/\d+$/);
        let endYear = endYearMatch ? parseInt(endYearMatch[0]) : 27;
        let targetYearStr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].includes(targetMonthStr) ? String(endYear) : String(endYear - 1);
        let targetDate = new Date(targetMonthStr + ' 1, 20' + targetYearStr.slice(-2));
        
        let targetIdx = -1;
        for(let i=0; i<globalEODData.length; i++) {
            if (globalEODData[i].date <= targetDate) targetIdx = i;
        }
        
        let eodHtml = '';
        if (targetIdx >= 0) {
            let lastMonthObj = globalEODData[targetIdx];
            
            let sumDep3 = 0, sumAvail3 = 0, count3 = 0;
            for(let i = targetIdx; i >= 0 && count3 < 3; i--) { sumDep3 += globalEODData[i].dep; sumAvail3 += globalEODData[i].avail; count3++; }
            let avg3 = sumAvail3 !== 0 ? (sumDep3/sumAvail3)*100 : 0;
            
            let sumDep12 = 0, sumAvail12 = 0, count12 = 0;
            for(let i = targetIdx; i >= 0 && count12 < 12; i--) { sumDep12 += globalEODData[i].dep; sumAvail12 += globalEODData[i].avail; count12++; }
            let avg12 = sumAvail12 !== 0 ? (sumDep12/sumAvail12)*100 : 0;
            
            if (isSummaryView) {
                eodHtml = `
                <div style="margin-top: 20px; width: 100%;">
                    <div style="font-size: 0.8rem; font-weight: 500; color: var(--text-primary); margin-bottom: 8px;">EOD Tracking</div>
                    <div class="table-wrapper">
                        <table class="detail-table" style="font-size:0.75rem;">
                            <thead>
                                <tr>
                                    <th>Period</th>
                                    <th>EOD %</th>
                                    <th>Capital Available</th>
                                    <th>Capital Deployed</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="color: var(--text-primary);">This month</td>
                                    <td style="color: var(--krn-blue);"><b>${lastMonthObj.pct.toFixed(2)}%</b></td>
                                    <td style="font-variant-numeric:tabular-nums">${lastMonthObj.avail.toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                    <td style="font-variant-numeric:tabular-nums">${lastMonthObj.dep.toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                </tr>
                                <tr>
                                    <td style="color: var(--text-primary);">3 month avg</td>
                                    <td style="color: var(--krn-blue);"><b>${avg3.toFixed(2)}%</b></td>
                                    <td style="font-variant-numeric:tabular-nums">${(sumAvail3/count3).toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                    <td style="font-variant-numeric:tabular-nums">${(sumDep3/count3).toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                </tr>
                                <tr>
                                    <td style="color: var(--text-primary);">12 month avg</td>
                                    <td style="color: var(--krn-blue);"><b>${avg12.toFixed(2)}%</b></td>
                                    <td style="font-variant-numeric:tabular-nums">${(sumAvail12/count12).toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                    <td style="font-variant-numeric:tabular-nums">${(sumDep12/count12).toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>`;
                
            } else {
                eodHtml = `
                <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid var(--border-color); width: 100%; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;">EOD</div>
                    <div style="font-size: 1.6rem; font-weight: bold; color: var(--krn-blue); font-family: 'Oswald', 'Chivo', sans-serif; line-height: 1;">${lastMonthObj.pct.toFixed(2)}%</div>
                </div>`;
            }
        } else {
            eodHtml = '<div style="margin-top:20px; font-size:0.7rem; color:var(--text-secondary); text-align:center;">No EOD tracking data available.</div>';
        }

        if (isSummaryView) {
            summaryDonutContainer.style.display = 'grid';
            summaryDonutContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; flex:1;">
                    <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 0px;">BvA</div>
                    <div id="periodBvaDonut" style="width: 100%;"></div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; flex:1;">
                    <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 0px;">Spent (Donor)</div>
                    <div id="periodActualDonorDonut" style="width: 100%;"></div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; flex:1;">
                    <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 0px;">Budget (Donor)</div>
                    <div id="periodBudgetDonorDonut" style="width: 100%;"></div>
                </div>
            `;
            renderSvgDonut('periodBvaDonut', bvaData, { pct: bvaPct, label: 'SPENT' }, `Remaining: <strong>${Math.max(0, 100 - bvaPct)}%</strong>`, false);
            renderSvgDonut('periodActualDonorDonut', pActDonItems, null, null, true);
            renderSvgDonut('periodBudgetDonorDonut', pBudDonItems, null, null, true);
            
            let placeholder = document.getElementById('eodPlaceholder');
            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = 'eodPlaceholder';
                summaryDonutContainer.parentNode.appendChild(placeholder);
            }
            placeholder.innerHTML = eodHtml;
            
        } else {
            summaryDonutContainer.style.display = 'flex';
            summaryDonutContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; flex:1;">
                    <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 0px;">Spent (Donor)</div>
                    <div id="periodActualDonorDonut" style="width: 100%;"></div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; flex:1;">
                    <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 0px;">Budget (Donor)</div>
                    <div id="periodBudgetDonorDonut" style="width: 100%;"></div>
                </div>
            `;
            renderSvgDonut('periodActualDonorDonut', pActDonItems, { pct: bvaPct, label: 'SPENT' }, null, true);
            renderSvgDonut('periodBudgetDonorDonut', pBudDonItems, { pct: Math.max(0, 100 - bvaPct), label: 'REMAINING' }, null, true);
            
            let placeholder = document.getElementById('eodPlaceholder');
            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = 'eodPlaceholder';
                summaryDonutContainer.parentNode.appendChild(placeholder);
            }
            placeholder.innerHTML = eodHtml;
        }
    }

    renderSummaryTable(filteredRows);
    renderCard2Departments(filteredRows);
    renderCard3Details(filteredRows);
}

function renderSummaryTable(displayRows) {
    const tbody = document.getElementById('summaryTableBody');
    tbody.innerHTML = '';
    const deptAgg = {};
    
    displayRows.forEach(r => {
        if (!deptAgg[r.Department]) deptAgg[r.Department] = { b: 0, a: 0, monthlyTrend: {} };
        deptAgg[r.Department].b += r.Budget;
        deptAgg[r.Department].a += r.Actual;
    });

    rawData.forEach(r => {
        if (!deptAgg[r.Department]) return; 
        if (!deptAgg[r.Department].monthlyTrend[r.Month]) deptAgg[r.Department].monthlyTrend[r.Month] = 0;
        deptAgg[r.Department].monthlyTrend[r.Month] += r.Actual; 
    });

    const sortedDepts = Object.keys(deptAgg).sort((a, b) => getDeptSortIndex(a) - getDeptSortIndex(b));

    sortedDepts.forEach(d => {
        const item = deptAgg[d];
        if (item.b === 0 && item.a === 0) return; 

        // Safely handles division by zero if budget is 0 but actuals exist
        const pctDisplay = item.b > 0 ? `${Math.round((item.a / item.b) * 100)}%` : (item.a > 0 ? 'N/A' : '0%');
        const badgeClass = item.a > item.b ? 'badge-orange' : 'badge-primary';
        
        const trendData = fiscalMonths.map(m => item.monthlyTrend[m] || 0);
        const endIdx = fiscalMonths.indexOf(selectedPeriod === 'FY Total' ? 'Jun' : selectedPeriod.replace(/Q[1-4]/, function(match) { return {Q1:'Sep',Q2:'Dec',Q3:'Mar',Q4:'Jun'}[match]; }));
        const relevantTrendData = endIdx >= 0 ? trendData.slice(0, endIdx + 1) : trendData;
        
        tbody.innerHTML += `
            <tr class="clickable-tr summary-table-row" onclick="openDepartmentDetails('${d.replace(/'/g, "\\'")}')">
                <td style="color: var(--text-primary); vertical-align: middle;">${d}</td>
                <td style="vertical-align: middle;">${generateSparkline(relevantTrendData)}</td>
                <td style="font-variant-numeric: tabular-nums; vertical-align: middle;">${formatPKRInline(item.b)}</td>
                <td style="font-variant-numeric: tabular-nums; color: var(--krn-blue); font-weight: 500; vertical-align: middle;">${formatPKRInline(item.a)}</td>
                <td style="vertical-align: middle;"><span class="badge-pill ${badgeClass}">${pctDisplay}</span></td>
            </tr>
        `;
    });
}

function renderCard2Departments(displayRows) {
    const container = document.getElementById('deptListContainer');
    const sortMode = document.getElementById('sortDept').value;
    container.innerHTML = '';

    const deptAgg = {};
    displayRows.forEach(r => {
        if (!deptAgg[r.Department]) deptAgg[r.Department] = { b: 0, a: 0, monthlyTrend: {} };
        deptAgg[r.Department].b += r.Budget;
        deptAgg[r.Department].a += r.Actual;
    });

    rawData.forEach(r => {
        if (!deptAgg[r.Department]) return; 
        if (!deptAgg[r.Department].monthlyTrend[r.Month]) deptAgg[r.Department].monthlyTrend[r.Month] = 0;
        deptAgg[r.Department].monthlyTrend[r.Month] += r.Actual; 
    });

    let sortedDepts = Object.keys(deptAgg).filter(d => deptAgg[d].b !== 0 || deptAgg[d].a !== 0);

    if (sortMode === 'Spend') sortedDepts.sort((a, b) => deptAgg[b].a - deptAgg[a].a);
    else if (sortMode === 'Variance') sortedDepts.sort((a, b) => (deptAgg[b].a - deptAgg[b].b) - (deptAgg[a].a - deptAgg[a].b));

    const progressElements = [];

    sortedDepts.forEach((deptName, idx) => {
        const item = deptAgg[deptName];
        
        // Split visual text vs physical bar width for Zero-Budget rendering
        const pctNum = item.b > 0 ? Math.round((item.a / item.b) * 100) : (item.a > 0 ? 100 : 0);
        const pctDisplay = item.b > 0 ? `${pctNum}%` : (item.a > 0 ? 'N/A' : '0%');
        
        const badgeColor = item.a > item.b ? 'var(--krn-orange)' : 'var(--krn-blue)';
        const isActive = deptName === selectedDepartment ? 'active' : '';

        const actualParts = getFormattedParts(item.a);
        const budgetParts = getFormattedParts(item.b);
        
        const variance = item.b - item.a;
        
        const trendData = fiscalMonths.map(m => item.monthlyTrend[m] || 0);
        const endIdx = fiscalMonths.indexOf(selectedPeriod === 'FY Total' ? 'Jun' : selectedPeriod.replace(/Q[1-4]/, function(match) { return {Q1:'Sep',Q2:'Dec',Q3:'Mar',Q4:'Jun'}[match]; }));
        const relevantTrendData = endIdx >= 0 ? trendData.slice(0, endIdx + 1) : trendData;

        const card = document.createElement('div');
        card.className = `dept-grid-card ${isActive}`;
        card.style.animationDelay = `${idx * 0.05}s`;
        card.setAttribute('data-dept', deptName); 
        card.onclick = () => selectDepartment(deptName);
        
        card.innerHTML = `
            <div class="dept-card-title">${deptName}</div>
            
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px;">
                <div style="font-size: 0.8rem; font-weight: 500; color: ${variance >= 0 ? 'var(--text-secondary)' : 'var(--krn-orange)'}; font-family: Calibri, sans-serif !important;">
                    ${variance >= 0 ? 'Remaining:' : 'Over:'} ${formatPKRInline(Math.abs(variance))}
                </div>
                <div style="opacity: 0.8;">
                    ${generateCardSparkline(relevantTrendData)}
                </div>
            </div>

            <div class="dept-card-metrics">
                <div class="dept-card-metric-col">
                    <span class="dept-card-metric-val">${actualParts.v}</span>
                    <span class="dept-card-metric-unit">${actualParts.u}</span>
                    <span class="dept-card-metric-lbl">Actual</span>
                </div>
                <div class="dept-card-metric-col">
                    <span class="dept-card-metric-pct" style="color: ${badgeColor};">${pctDisplay}</span>
                    <span class="dept-card-metric-lbl">Spent</span>
                </div>
                <div class="dept-card-metric-col">
                    <span class="dept-card-metric-val">${budgetParts.v}</span>
                    <span class="dept-card-metric-unit">${budgetParts.u}</span>
                    <span class="dept-card-metric-lbl">Budget</span>
                </div>
            </div>
            <div class="progress-bg"><div class="progress-fill" id="deptProg-${idx}" style="background-color: ${badgeColor};"></div></div>
        `;
        container.appendChild(card);
        progressElements.push({ id: `deptProg-${idx}`, width: Math.min(100, pctNum) });
    });

    requestAnimationFrame(() => setTimeout(() => progressElements.forEach(p => { const el = document.getElementById(p.id); if(el) el.style.width = p.width+'%'; }), 50));
}

function renderCard3Details(displayRows = null) {
    if (!displayRows) displayRows = rawData.filter(r => isRowInViewScope(r));

    document.getElementById('card3Title').innerText = `Overview`;
    const sortMode = document.getElementById('sortStream').value;
    const viewGroup = 'Stream'; 

    const rows = displayRows.filter(r => r.Department === selectedDepartment);

    let dB = 0, dA = 0;
    const groupAgg = {};
    const dActDon = {};
    const dBudDon = {};

    rows.forEach(r => {
        dB += r.Budget; dA += r.Actual;
        
        let gKey = r.Stream;
        
        if (!groupAgg[gKey]) groupAgg[gKey] = { b: 0, a: 0, monthlyTrend: {} };
        groupAgg[gKey].b += r.Budget; groupAgg[gKey].a += r.Actual;
        
        if (r.Month !== 'ALL_MONTHS') {
            groupAgg[gKey].monthlyTrend[r.Month] = (groupAgg[gKey].monthlyTrend[r.Month] || 0) + r.Actual;
        }
        
        Object.keys(r.ActualDonors).forEach(k => dActDon[k] = (dActDon[k] || 0) + r.ActualDonors[k]);
        Object.keys(r.BudgetDonors).forEach(k => dBudDon[k] = (dBudDon[k] || 0) + r.BudgetDonors[k]);
    });

    // Zero-Budget protection for the Donut Chart
    const bvaPctNum = dB > 0 ? Math.round((dA / dB) * 100) : (dA > 0 ? 100 : 0);
    const bvaPctDisplay = dB > 0 ? `${bvaPctNum}` : (dA > 0 ? 'N/A' : '0'); 
    
    const card3DonutContainer = document.getElementById('card3DonutContainer');

    card3DonutContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 100px;">
            <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 5px;">Dept BvA</div>
            <div id="deptBvaDonut" style="width: 85px; height: 85px; display: flex; justify-content: center;"></div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 100px;">
            <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 5px;">Spent (Donor)</div>
            <div id="deptActualDonorDonut" style="width: 85px; height: 85px; display: flex; justify-content: center;"></div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 100px;">
            <div style="font-size: 0.65rem; text-align: center; font-weight: 500; color: var(--text-primary); margin-bottom: 5px;">Budget (Donor)</div>
            <div id="deptBudgetDonorDonut" style="width: 85px; height: 85px; display: flex; justify-content: center;"></div>
        </div>
    `;

    renderSvgDonut('deptBvaDonut', [
        { label: 'Spent', value: dA, color: 'var(--krn-blue)' },
        { label: 'Remaining', value: Math.max(0, dB - dA), color: 'var(--border-color)' }
    ], { pct: bvaPctDisplay, label: 'SPENT' }, `Remaining: <strong>${Math.max(0, 100 - bvaPctNum)}%</strong>`, false);

    const currentBrandColors = getBrandColors();
    const aDonItems = Object.keys(dActDon).filter(d => dActDon[d] > 0).map((d, i) => ({ label: d, value: dActDon[d], color: currentBrandColors[i % currentBrandColors.length] }));
    renderSvgDonut('deptActualDonorDonut', aDonItems, null, null, true);

    const bDonItems = Object.keys(dBudDon).filter(d => dBudDon[d] > 0).map((d, i) => ({ label: d, value: dBudDon[d], color: currentBrandColors[i % currentBrandColors.length] }));
    renderSvgDonut('deptBudgetDonorDonut', bDonItems, null, null, true);

    const streamContainer = document.getElementById('streamListContainer');
    streamContainer.innerHTML = '';
    
    let sortedGroups = Object.keys(groupAgg).filter(g => groupAgg[g].b !== 0 || groupAgg[g].a !== 0);
    if (sortMode === 'Spend') sortedGroups.sort((a, b) => groupAgg[b].a - groupAgg[a].a);
    else if (sortMode === 'Variance') sortedGroups.sort((a, b) => (groupAgg[b].a - groupAgg[b].b) - (groupAgg[a].a - groupAgg[a].b));

    const progs = [];
    sortedGroups.forEach((gName, idx) => {
        const st = groupAgg[gName];
        
        // Zero-Budget protection for the Stream Cards
        const pctNum = st.b > 0 ? Math.round((st.a / st.b) * 100) : (st.a > 0 ? 100 : 0);
        const pctDisplay = st.b > 0 ? `${pctNum}%` : (st.a > 0 ? 'N/A' : '0%');
        
        const badgeColor = st.a > st.b ? 'var(--krn-orange)' : 'var(--krn-blue)';
        const clickAttr = st.a > 0 ? `onclick="openGroupModal('${gName.replace(/'/g, "\\'")}', '${viewGroup}')"` : '';

        const actualParts = getFormattedParts(st.a);
        const budgetParts = getFormattedParts(st.b);
        const variance = st.b - st.a;
        
        const trendData = fiscalMonths.map(m => st.monthlyTrend[m] || 0);
        const endIdx = fiscalMonths.indexOf(selectedPeriod === 'FY Total' ? 'Jun' : selectedPeriod.replace(/Q[1-4]/, function(match) { return {Q1:'Sep',Q2:'Dec',Q3:'Mar',Q4:'Jun'}[match]; }));
        const relevantTrendData = endIdx >= 0 ? trendData.slice(0, endIdx + 1) : trendData;

        const card = document.createElement('div');
        card.className = `stream-grid-card ${st.a > 0 ? '' : 'disabled-row'}`;
        card.style.animationDelay = `${idx * 0.05}s`;
        if(clickAttr) card.setAttribute('onclick', `openGroupModal('${gName.replace(/'/g, "\\'")}', '${viewGroup}')`);
        
        card.innerHTML = `
            <div class="stream-card-title" title="${gName}">${gName}</div>
            
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 4px; margin: 8px 0;">
                <div style="font-size: 0.7rem; font-weight: 500; color: ${variance >= 0 ? 'var(--text-secondary)' : 'var(--krn-orange)'}; font-family: Calibri, sans-serif !important;">
                    ${variance >= 0 ? 'Remaining:' : 'Over:'} ${formatPKRInline(Math.abs(variance))}
                </div>
                <div style="opacity: 0.8;">
                    ${generateMiniSparkline(relevantTrendData)}
                </div>
            </div>

            <div class="stream-card-metrics">
                <div class="stream-card-metric-col">
                    <span class="stream-card-metric-val">${actualParts.v}</span>
                    <span class="stream-card-metric-unit">${actualParts.u}</span>
                    <span class="stream-card-metric-lbl">Actual</span>
                </div>
                <div class="stream-card-metric-col">
                    <span class="stream-card-metric-pct" style="color: ${badgeColor};">${pctDisplay}</span>
                    <span class="stream-card-metric-lbl">Spent</span>
                </div>
                <div class="stream-card-metric-col">
                    <span class="stream-card-metric-val">${budgetParts.v}</span>
                    <span class="stream-card-metric-unit">${budgetParts.u}</span>
                    <span class="stream-card-metric-lbl">Budget</span>
                </div>
            </div>
            <div class="progress-bg"><div class="progress-fill" id="groupProg-${idx}" style="background-color: ${badgeColor};"></div></div>
        `;
        streamContainer.appendChild(card);
        progs.push({ id: `groupProg-${idx}`, width: Math.min(100, pctNum) });
    });

    requestAnimationFrame(() => setTimeout(() => progs.forEach(p => { const el = document.getElementById(p.id); if(el) el.style.width = p.width+'%'; }), 50));
}
// ========================================================================
// 7. POPUP MODAL DRILL-DOWN & EXPORT
// ========================================================================
function openGroupModal(groupName, groupType) {
    document.getElementById('modalSearch').value = ''; 
    document.getElementById('streamModal').style.display = 'block';
    document.getElementById('modalStreamTitle').innerText = `Account Details: ${groupName}`;
    document.getElementById('modalStreamSubtitle').innerText = `${viewMode}: ${selectedPeriod}`;

    const rows = rawData.filter(r => r.Department === selectedDepartment && r[groupType] === groupName && isRowInViewScope(r));

    currentModalData = {};
    let tB = 0, tA = 0;
    
    window.activeModalMonths = fiscalMonths.filter(m => isRowInViewScope({Month: m}));

    rows.forEach(r => {
        const code = r.Code; 
        if (!currentModalData[code]) { 
            currentModalData[code] = { na: r.NaturalAccount, code: r.Code, budget: 0, actuals: {} };
            window.activeModalMonths.forEach(m => currentModalData[code].actuals[m] = 0);
        }
        currentModalData[code].budget += r.Budget;
        if(r.Month !== 'ALL_MONTHS') {
            currentModalData[code].actuals[r.Month] = (currentModalData[code].actuals[r.Month] || 0) + r.Actual;
        }
        tB += r.Budget; 
        tA += r.Actual;
    });

    const pct = tB > 0 ? Math.round((tA / tB) * 100) : 0;

    document.getElementById('modalSummaryStats').innerHTML = `
        <div style="background-color: transparent; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div class="val" id="mStatB" data-val="0"><span class="val-unit">M PKR</span><span class="val-num">0</span></div>
            <div style="font-size: 0.6rem; color: var(--text-secondary); font-weight: 400; text-transform: uppercase; font-family: Calibri, sans-serif !important; margin-top:4px;">Total Budget</div>
        </div>
        <div style="background-color: transparent; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div class="val" style="color:var(--krn-blue)" id="mStatA" data-val="0"><span class="val-unit">M PKR</span><span class="val-num">0</span></div>
            <div style="font-size: 0.6rem; color: var(--text-secondary); font-weight: 400; text-transform: uppercase; font-family: Calibri, sans-serif !important; margin-top:4px;">Total Spend (Actual)</div>
        </div>
        <div style="background-color: transparent; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div class="val" style="color:var(--krn-orange)" id="mStatPct" data-val="0"><span class="val-num">0%</span></div>
            <div style="font-size: 0.6rem; color: var(--text-secondary); font-weight: 400; text-transform: uppercase; font-family: Calibri, sans-serif !important; margin-top:4px;">Percentage Spent</div>
        </div>
        <div style="background-color: transparent; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px;">
            <div class="val" style="color: ${tB >= tA ? 'var(--krn-green)' : 'var(--krn-orange)'};" id="mStatV" data-val="0"><span class="val-unit">M PKR</span><span class="val-num">0</span></div>
            <div style="font-size: 0.6rem; color: var(--text-secondary); font-weight: 400; text-transform: uppercase; font-family: Calibri, sans-serif !important; margin-top:4px;">Variance</div>
        </div>
    `;
    animateCounter('mStatB', tB); 
    animateCounter('mStatA', tA); 
    animateCounter('mStatV', Math.abs(tB - tA));
    document.getElementById('mStatPct').innerHTML = `<span class="val-num">${pct}%</span>`;

    renderModalTable();
}

function renderModalTable(searchTerm = '') {
    const tbody = document.getElementById('modalTableBody');
    const thead = document.querySelector('#streamModal .detail-table thead');
    
    let activeMonths = window.activeModalMonths || [];
    
    let thHtml = `<tr><th>Account Name</th>`;
    activeMonths.forEach(m => thHtml += `<th>${m} (M PKR)</th>`);
    thHtml += `<th>Period Budget (M PKR)</th></tr>`;
    if (thead) thead.innerHTML = thHtml;

    tbody.innerHTML = '';
    const term = searchTerm.toLowerCase();

    const items = Object.values(currentModalData).filter(item => item.na.toLowerCase().includes(term) || item.code.toLowerCase().includes(term));

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${activeMonths.length + 2}" style="text-align:center; padding:18px; color:var(--text-secondary); font-size:0.75rem;">No relevant spend records found.</td></tr>`;
    } else {
        items.forEach(item => {
            let tr = `<tr>`;
            tr += `<td><strong style="color: var(--krn-blue); font-weight: 400;">${item.na}</strong><br><span style="font-size: 0.62rem; color: var(--text-secondary);">Code: ${item.code}</span></td>`;
            
            activeMonths.forEach(m => {
                let val = item.actuals[m] || 0;
                let valInMillions = val / 1000000;
                tr += `<td style="font-variant-numeric: tabular-nums;">${val === 0 ? '-' : valInMillions.toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>`;
            });
            
            let budgetInMillions = item.budget / 1000000;
            tr += `<td style="font-variant-numeric: tabular-nums; font-weight: 500;">${budgetInMillions.toLocaleString('en-PK', {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>`;
            tr += `</tr>`;
            tbody.innerHTML += tr;
        });
    }
}

function filterModalTable() {
    renderModalTable(document.getElementById('modalSearch').value);
}

function exportModalCSV() {
    if (!currentModalData || Object.keys(currentModalData).length === 0) return alert("No data to export.");
    let activeMonths = window.activeModalMonths || [];
    let csv = "Code,Account Name," + activeMonths.join(",") + ",Budget\n";
    
    Object.values(currentModalData).forEach(i => {
        let row = `"${i.code}","${i.na}",`;
        activeMonths.forEach(m => {
            row += `${i.actuals[m] || 0},`;
        });
        row += `${i.budget}\n`;
        csv += row;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", `LineItems_${selectedDepartment}_${selectedPeriod}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function closeModal() { document.getElementById('streamModal').style.display = 'none'; hideTooltip(); }
window.onclick = function(e) { if (e.target == document.getElementById('streamModal')) closeModal(); }

// ========================================================================
// 8. DASHBOARD INITIALIZATION 
// ========================================================================
async function init() {
    console.log("1. Init function triggered. Setting up loading screen...");
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.style.opacity = '1';
        loader.style.visibility = 'visible';
        loader.classList.remove('hidden');
    }

    try {
        const errElem = document.getElementById('loaderStatusText');
        const paths = getFilePaths(selectedYear); 
        console.log(`2. File paths generated for ${selectedYear}:`, paths);
        
        rawData = []; 
        globalEODData = [];
        
        console.log("3. Fetching Budget Master...");
        if (errElem) errElem.innerText = `FETCHING BUDGET (${selectedYear}) 1/6...`;
        const bRes = await fetch(paths.budgetMasterCSV);
        if (!bRes.ok) throw new Error(`Budget Master fetch failed (HTTP ${bRes.status})`);
        
        console.log("4. Fetching Trial Balance...");
        if (errElem) errElem.innerText = `FETCHING DONOR TB (${selectedYear}) 2/6...`;
        const tdRes = await fetch(paths.tbDonorCSV);
        if (!tdRes.ok) throw new Error(`Donor TB fetch failed (HTTP ${tdRes.status})`);
        
        console.log("5. Fetching Innovation...");
        if (errElem) errElem.innerText = `FETCHING INNOVATION (${selectedYear}) 3/6...`;
        const iiRes = await fetch(paths.iiCSV);
        if (!iiRes.ok) throw new Error(`Innovation fetch failed (HTTP ${iiRes.status})`);
        
        console.log("6. Fetching CIC...");
        if (errElem) errElem.innerText = `FETCHING CIC (${selectedYear}) 4/6...`;
        const cicRes = await fetch(paths.cicCSV);
        if (!cicRes.ok) throw new Error(`CIC fetch failed (HTTP ${cicRes.status})`);

        console.log("7. Fetching CAPEX...");
        if (errElem) errElem.innerText = `FETCHING CAPEX (${selectedYear}) 5/6...`;
        let capexRows = [];
        try {
            const capexRes = await fetch(paths.capexCSV);
            if (capexRes.ok) capexRows = parseCSV(await capexRes.text());
        } catch (e) {
            console.warn("CAPEX file skipped or missing.");
        }

        console.log("8. Fetching EOD...");
        if (errElem) errElem.innerText = `FETCHING EOD (${selectedYear}) 6/6...`;
        let eodRows = [];
        try {
            const eodRes = await fetch(paths.eodCSV);
            if (eodRes.ok) eodRows = parseCSV(await eodRes.text());
        } catch (e) {
            console.warn("EOD file skipped or missing.");
        }
        
        console.log("9. Parsing Data...");
        if (errElem) errElem.innerText = "PROCESSING DATA...";
        
        const bData = parseCSV(await bRes.text());
        const tdData = parseCSV(await tdRes.text());
        const iiData = parseCSV(await iiRes.text());
        const cicData = parseCSV(await cicRes.text());
        
        let parsedEOD = [];
        eodRows.forEach(r => {
            const mKey = Object.keys(r._raw).find(k => k.toLowerCase() === 'month');
            const availKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('available'));
            const depKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('deployed'));
            if (mKey && r._raw[mKey]) {
                let monthStr = String(r._raw[mKey]).trim();
                let parts = monthStr.split('-');
                if(parts.length >= 2) {
                    let m = parts[0].substring(0,3);
                    let y = parts[1];
                    let d = new Date(m + ' 1, 20' + y);
                    let avail = getSafeNum(r._raw[availKey]);
                    let dep = getSafeNum(r._raw[depKey]);
                    let pct = avail !== 0 ? (dep/avail)*100 : 0;
                    parsedEOD.push({ rawMonth: monthStr, date: d, avail: avail, dep: dep, pct: pct });
                }
            }
        });
        parsedEOD.sort((a,b) => a.date - b.date);
        globalEODData = parsedEOD;

        console.log("10. Assembling Master Ledger...");
        rawData = parseMultiLinkData(bData, tdData, iiData, cicData, capexRows);
        
        if (rawData.length === 0) throw new Error("No data parsed. Are the CSVs empty?");
        
        let maxMonthIdx = -1;
        rawData.forEach(r => {
            if (Math.abs(r.Actual) > 0 && r.Month !== 'ALL_MONTHS') {
                let idx = fiscalMonths.indexOf(r.Month);
                if (idx > maxMonthIdx) maxMonthIdx = idx;
            }
        });
        selectedPeriod = maxMonthIdx >= 0 ? fiscalMonths[maxMonthIdx] : 'Jul';

        if (errElem) errElem.innerHTML = `<span style="color:var(--krn-green); font-weight:bold;">Success!</span> Ready.`;
        
        console.log("11. Updating Dashboard UI...");
        populateYearDropdown();
        populatePeriodDropdown();
        applyTheme(); // Force correct visual sync on load
        updateDashboard();

        console.log("12. Initialization Complete!");

    } catch (err) {
        console.error("CRITICAL Initialization Error:", err);
        const errElem = document.getElementById('loaderStatusText');
        if (errElem) errElem.innerHTML = `<span style="color:var(--krn-orange); font-weight:bold;">ERROR:</span> ${err.message}`;
    } finally {
        setTimeout(() => {
            const l = document.getElementById('loadingOverlay');
            if (l) {
                l.style.opacity = '0';
                l.style.visibility = 'hidden';
                l.style.pointerEvents = 'none';
                l.classList.add('hidden');
                setTimeout(() => {
                    const txt = document.getElementById('loaderStatusText');
                    if (txt) txt.innerText = "INITIALIZING SYSTEM...";
                }, 800);
            }
        }, 1200); 
    }
}

// FORCE EXECUTION ON LOAD
console.log("Script loaded. Booting up dashboard...");
setTimeout(init, 500);
window.onresize = updateDashboard;
