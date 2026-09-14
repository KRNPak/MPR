// ========================================================================
// 1. STATE & SECURITY PROTOCOL
// ========================================================================
let isDarkMode = false;
let availableYears = ['FY2025', 'FY2026', 'FY2027'];
let selectedYear = availableYears[availableYears.length - 1];
let selectedDepartment = 'All Departments';
let selectedDonor = 'All Donors';

const fiscalMonths = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
let selectedMonth = 'Jul'; 
let timeView = 'YTD'; 

let positionMaster = {}; 
let unifiedLedger = []; 
let activeFilteredData = [];
let activeMonths = [];

let widgetView = 'vacant'; 
let activeModalComponent = '';

async function unlockDashboard() {
    const pwdInput = document.getElementById('authPassword').value;
    const errObj = document.getElementById('authError');
    if (!pwdInput) { errObj.innerText = "Please enter the decryption key."; errObj.style.display = 'block'; return; }

    document.getElementById('authOverlay').style.display = 'none';
    const loader = document.getElementById('loadingOverlay');
    loader.classList.remove('hidden'); loader.style.opacity = '1'; loader.style.visibility = 'visible';

    try {
        const fetchAndDecrypt = async (filename) => {
            const res = await fetch(`Data/${selectedYear}/${filename}`);
            if (!res.ok) return null; 
            const encryptedText = await res.text();
            const decrypted = CryptoJS.AES.decrypt(encryptedText, pwdInput).toString(CryptoJS.enc.Utf8);
            if (!decrypted) throw new Error("Invalid Key");
            return parseCSV(decrypted);
        };

        document.getElementById('loaderStatusText').innerText = "DECRYPTING MASTER RECORDS...";
        const masterRows = await fetchAndDecrypt('Staff_Master.enc');
        if (!masterRows) throw new Error("Master file missing");

        document.getElementById('loaderStatusText').innerText = "DECRYPTING FINANCIALS...";
        const budgetRows = await fetchAndDecrypt('Staff_Budget.enc') || [];
        const actualRows = await fetchAndDecrypt('Staff_Actuals.enc') || [];

        buildDataEngine(masterRows, budgetRows, actualRows);

        document.getElementById('loaderStatusText').innerHTML = `<span style="color:var(--krn-green); font-weight:bold;">DECRYPTION SUCCESSFUL</span>`;
        
        populateFilters();
        applyTheme();
        updateStaffDashboard();
        
        setTimeout(() => { loader.style.opacity = '0'; loader.style.visibility = 'hidden'; loader.classList.add('hidden'); }, 800);
    } catch (err) {
        document.getElementById('authOverlay').style.display = 'flex';
        loader.classList.add('hidden');
        errObj.innerText = err.message === "Invalid Key" ? "Decryption Failed. Incorrect Password." : `Error: ${err.message}`;
        errObj.style.display = 'block';
    }
}

// ========================================================================
// 2. STRICT DATA ENGINE
// ========================================================================
function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const objects = [];
    for(let i = 1; i < lines.length; i++) {
        let vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
        let obj = { _raw: {} };
        headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; obj._raw[lines[0].split(',')[idx]] = vals[idx] || ''; });
        objects.push(obj);
    }
    return objects;
}

function getSafeNum(val) {
    let str = String(val || '').replace(/[^0-9.-]/g, '');
    let num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

// STRICT MAPPING: Prevents double-counting of calculated columns
function standardizeComponent(rawHeader) {
    let k = rawHeader.toLowerCase().trim();
    
    // 1. Explicitly ignore all summary, total, and non-financial columns
    if (k.includes('gross') || k.includes('net') || k.includes('payable') || 
        k.includes('annually') || k.includes('updated') || k.includes('after') || 
        k.includes('+') || k.includes('total') || k.includes('opening') || 
        k.includes('closing') || k.includes('months') || k.includes('date') || 
        k.includes('name') || k.includes('department') || k.includes('designation') || 
        k.includes('code') || k.includes('grade') || k.includes('stream') || 
        k.includes('tax') || k.includes('advance') || k.includes('extra') || 
        k.includes('other') || k.includes('budget fy') || k.includes('salary ad')) {
        return 'SKIP';
    }

    // 2. Map pure components
    if (k.includes('base salary')) return 'Base Salary';
    if (k.includes('car monetization') || k.includes('cma')) return 'Car Monetization';
    if (k.includes('cola')) return 'COLA';
    if (k.includes('child care')) return 'Child Care';
    if (k.includes('provident') || (k === 'pf')) return 'Provident Fund';
    if (k.includes('eobi')) return 'EOBI';
    if (k.includes('gratuity')) return 'Gratuity';
    if (k.includes('lfa') || k.includes('leave fare')) return 'LFA';
    if (k.includes('wellness')) return 'Wellness Allowance';
    
    // New Columns from latest snippet
    if (k.includes('health ins')) return 'Health Insurance';
    if (k.includes('life insura')) return 'Life Insurance';
    if (k.includes('learning')) return 'Learning & Development';

    if (k.includes('performance') || k.includes('one-off')) return 'Performance / Bonus';
    if (k.includes('arrears') || k.includes('overtime')) return 'Overtime & Arrears';
    if (k.includes('leave encashment')) return 'Leave Encashment';

    return 'SKIP';
}

function buildDataEngine(masterRows, budgetRows, actualRows) {
    positionMaster = {};
    const donorsList = new Set();
    const availableMonthsSet = new Set();

    masterRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        if (!code) return;
        
        let dept = r['department'] || 'Uncategorized';
        let name = r['employeename'] || 'Vacant';
        
        let donorAllocations = {};
        Object.keys(r._raw).forEach(k => {
            let cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!['positioncode', 'employeecode', 'employeename', 'department', 'designation', 'positiongrade', 'gender', 'joiningdate', 'newagreementstartdate', 'budgetedmonths'].includes(cleanK)) {
                let pct = parseFloat(String(r._raw[k]).replace('%', '')) || 0;
                if (pct > 1) pct = pct / 100;
                if (pct > 0) { donorAllocations[k] = pct; donorsList.add(k); }
            }
        });
        if (Object.keys(donorAllocations).length === 0) donorAllocations['OSR'] = 1.0;

        positionMaster[code] = { code, dept, name, donorAllocations };
    });

    const ledgerMap = {}; 
    const ensureLedgerEntry = (code, mth) => {
        let key = `${code}_${mth}`;
        if (!ledgerMap[key]) ledgerMap[key] = { code, month: mth, components: {} };
        return ledgerMap[key];
    };

    const addComponentVal = (entry, compName, isActual, val) => {
        if (!entry.components[compName]) entry.components[compName] = { b: 0, a: 0 };
        if (isActual) entry.components[compName].a += val;
        else entry.components[compName].b += val;
    };

    // Actuals (Monthly Values)
    actualRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        let mth = String(r['month'] || '').substring(0,3);
        if (!mth || !positionMaster[code]) return;
        
        mth = mth.charAt(0).toUpperCase() + mth.slice(1).toLowerCase(); 
        availableMonthsSet.add(mth);
        let entry = ensureLedgerEntry(code, mth);

        Object.keys(r._raw).forEach(rawK => {
            let compName = standardizeComponent(rawK);
            if (compName !== 'SKIP') {
                let val = getSafeNum(r._raw[rawK]);
                addComponentVal(entry, compName, true, val);
            }
        });
    });

    // Budget (Monthly Values + LFA/Gratuity Division)
    budgetRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        if (!positionMaster[code]) return;
        
        let joiningStr = r['joiningdate'] || r['joiningdatenewagreementstartdate'] || '';
        let bMonths = parseInt(r['budgetedmonths']) || 12;
        if (bMonths <= 0) bMonths = 12; // Safety fallback
        
        let startIdx = 0; 
        fiscalMonths.forEach((fm, idx) => { if (joiningStr.toLowerCase().includes(fm.toLowerCase())) startIdx = idx; });

        let monthlyComps = {};
        
        Object.keys(r._raw).forEach(rawK => {
            let compName = standardizeComponent(rawK);
            if (compName !== 'SKIP') {
                let val = getSafeNum(r._raw[rawK]);
                
                // If it is a yearly figure, convert to monthly run-rate based on budgeted months
                const annualComponents = ['LFA', 'Gratuity', 'Health Insurance', 'Life Insurance', 'Learning & Development'];
                if (annualComponents.includes(compName)) {
                    val = val / bMonths;
                }
                
                monthlyComps[compName] = (monthlyComps[compName] || 0) + val;
            }
        });

        // Apply dynamic budget ONLY to the active months window
        for (let i = startIdx; i < startIdx + bMonths; i++) {
            if (i < 12) {
                let mth = fiscalMonths[i];
                let entry = ensureLedgerEntry(code, mth);
                Object.keys(monthlyComps).forEach(compName => {
                    addComponentVal(entry, compName, false, monthlyComps[compName]);
                });
            }
        }
    });

    unifiedLedger = Object.values(ledgerMap);

    const dDrop = document.getElementById('donorDropdown');
    dDrop.innerHTML = '<option value="All Donors">All Donors</option>';
    Array.from(donorsList).sort().forEach(d => dDrop.add(new Option(d, d)));

    const deptDrop = document.getElementById('deptDropdown');
    deptDrop.innerHTML = '<option value="All Departments">All Departments</option>';
    let uniqueDepts = [...new Set(Object.values(positionMaster).map(p => p.dept))].sort();
    uniqueDepts.forEach(d => deptDrop.add(new Option(d, d)));

    let monthArr = Array.from(availableMonthsSet);
    if (monthArr.length > 0) {
        let latestIdx = -1;
        monthArr.forEach(m => { let idx = fiscalMonths.indexOf(m); if(idx > latestIdx) latestIdx = idx; });
        selectedMonth = latestIdx > -1 ? fiscalMonths[latestIdx] : 'Jul';
    }
}

// ========================================================================
// 3. UI RENDERING & AGGREGATION
// ========================================================================
function populateFilters() {
    const ys = document.getElementById('yearDropdown');
    ys.innerHTML = '';
    availableYears.slice().reverse().forEach(y => ys.add(new Option(y, y, false, y === selectedYear)));

    const ms = document.getElementById('monthDropdown');
    ms.innerHTML = '';
    fiscalMonths.forEach(m => ms.add(new Option(m, m, false, m === selectedMonth)));
}

function onGlobalFilterChange() {
    selectedYear = document.getElementById('yearDropdown').value;
    selectedDepartment = document.getElementById('deptDropdown').value;
    selectedDonor = document.getElementById('donorDropdown').value;
    updateStaffDashboard();
}

function onTimeFilterChange() {
    selectedMonth = document.getElementById('monthDropdown').value;
    updateStaffDashboard();
}

function setTimeView(view) {
    timeView = view;
    document.querySelectorAll('.time-toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.time-toggle-btn[data-view="${view}"]`).classList.add('active');
    updateStaffDashboard();
}

function updateStaffDashboard() {
    const endIdx = fiscalMonths.indexOf(selectedMonth);
    activeMonths = [];
    if (timeView === 'PTD') {
        activeMonths.push(selectedMonth);
    } else if (timeView === 'YTD') {
        for (let i = 0; i <= endIdx; i++) activeMonths.push(fiscalMonths[i]);
    } else if (timeView === 'QTD') {
        const qtrStart = Math.floor(endIdx / 3) * 3;
        for (let i = qtrStart; i <= endIdx; i++) activeMonths.push(fiscalMonths[i]);
    }

    activeFilteredData = [];
    let totBud = 0, totAct = 0;
    
    let compSummary = {};
    let activeHeads = new Set();
    let budHeads = new Set();
    let donorSpends = {};
    let positionSpends = {}; 

    unifiedLedger.forEach(row => {
        if (!activeMonths.includes(row.month)) return;
        
        let master = positionMaster[row.code];
        if (selectedDepartment !== 'All Departments' && master.dept !== selectedDepartment) return;

        let pct = selectedDonor === 'All Donors' ? 1.0 : (master.donorAllocations[selectedDonor] || 0);
        if (pct === 0) return;

        let rowTotB = 0, rowTotA = 0;

        Object.keys(row.components).forEach(cName => {
            let b = row.components[cName].b * pct;
            let a = row.components[cName].a * pct;
            
            if (b > 0 || a > 0) {
                if (!compSummary[cName]) compSummary[cName] = { b: 0, a: 0 };
                compSummary[cName].b += b;
                compSummary[cName].a += a;
                rowTotB += b;
                rowTotA += a;
            }
        });

        totBud += rowTotB;
        totAct += rowTotA;

        if (rowTotB > 0) budHeads.add(row.code);
        if (rowTotA > 0) activeHeads.add(row.code);

        let weight = rowTotA > 0 ? rowTotA : (rowTotB > 0 ? rowTotB : 0);
        if (weight > 0 && selectedDonor === 'All Donors') {
            Object.keys(master.donorAllocations).forEach(d => {
                if (!donorSpends[d]) donorSpends[d] = 0;
                donorSpends[d] += weight * master.donorAllocations[d];
            });
        }

        if (!positionSpends[row.code]) positionSpends[row.code] = { code: row.code, name: master.name, dept: master.dept, b: 0, a: 0 };
        positionSpends[row.code].b += rowTotB;
        positionSpends[row.code].a += rowTotA;
    });

    document.getElementById('headcountKpi').innerText = `${activeHeads.size} / ${budHeads.size}`;
    animateCounter('topKpiBudget', totBud);
    animateCounter('topKpiActual', totAct);
    animateCounter('topKpiVariance', Math.abs(totBud - totAct));

    renderComponentTable(compSummary);
    renderDonorDonut(donorSpends, totAct || totBud); 
    renderWidget(positionSpends);
}

function renderComponentTable(compSummary) {
    const tbody = document.getElementById('componentTableBody');
    tbody.innerHTML = '';
    
    let sortedComps = Object.keys(compSummary).sort((x, y) => {
        if (x === 'Base Salary') return -1;
        if (y === 'Base Salary') return 1;
        return compSummary[y].a - compSummary[x].a;
    });

    sortedComps.forEach(c => {
        let item = compSummary[c];
        if (item.b === 0 && item.a === 0) return;
        
        let varNum = item.b - item.a;
        let pctDisplay = item.b > 0 ? `${Math.round((item.a / item.b) * 100)}%` : (item.a > 0 ? 'N/A' : '0%');
        let badgeClass = item.a > item.b ? 'badge-orange' : 'badge-primary';
        
        tbody.innerHTML += `
            <tr class="clickable-tr summary-table-row" onclick="openComponentModal('${c.replace(/'/g, "\\'")}')">
                <td style="color: var(--text-primary); font-weight:500;">${c}</td>
                <td style="font-variant-numeric: tabular-nums;">${formatPKRInline(item.b)}</td>
                <td style="font-variant-numeric: tabular-nums; color: var(--krn-blue); font-weight: 500;">${formatPKRInline(item.a)}</td>
                <td style="font-variant-numeric: tabular-nums; color: ${varNum >= 0 ? 'var(--krn-green)' : 'var(--krn-orange)'};">${formatPKRInline(Math.abs(varNum))}</td>
                <td><span class="badge-pill ${badgeClass}">${pctDisplay}</span></td>
            </tr>
        `;
    });
}

function setWidgetView(view) {
    widgetView = view;
    document.getElementById('btnToggleVacant').classList.toggle('active', view === 'vacant');
    document.getElementById('btnToggleOverspend').classList.toggle('active', view === 'overspend');
    updateStaffDashboard(); 
}

function renderWidget(positionSpends) {
    const container = document.getElementById('widgetListContainer');
    container.innerHTML = '';
    
    let list = Object.values(positionSpends);
    let displayList = [];

    if (widgetView === 'vacant') {
        displayList = list.filter(p => p.b > 0 && p.a === 0).sort((x, y) => y.b - x.b);
        if (displayList.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:0.75rem;">No vacant positions in period.</div>'; return;
        }
        displayList.slice(0, 5).forEach(p => {
            container.innerHTML += `
                <div class="mini-list-item">
                    <div>
                        <div style="font-weight:bold; color:var(--text-primary);">${p.code}</div>
                        <div style="font-size:0.65rem; color:var(--text-secondary);">${p.dept}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:bold; color:var(--krn-green);">${formatPKRShort(p.b)}</div>
                        <div style="font-size:0.65rem; color:var(--text-secondary);">Saved (Bgt)</div>
                    </div>
                </div>
            `;
        });
    } else {
        displayList = list.filter(p => p.a > p.b).sort((x, y) => (y.a - y.b) - (x.a - x.b));
        if (displayList.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:0.75rem;">No over-spends detected.</div>'; return;
        }
        displayList.slice(0, 5).forEach(p => {
            container.innerHTML += `
                <div class="mini-list-item">
                    <div>
                        <div style="font-weight:bold; color:var(--text-primary);">${p.code}</div>
                        <div style="font-size:0.65rem; color:var(--text-secondary);">${p.name}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:bold; color:var(--krn-orange);">+${formatPKRShort(p.a - p.b)}</div>
                        <div style="font-size:0.65rem; color:var(--text-secondary);">Over Budget</div>
                    </div>
                </div>
            `;
        });
    }
}

function renderDonorDonut(donorSpends, totalVal) {
    if (Object.keys(donorSpends).length === 0) {
        document.getElementById('donorDonutContainer').innerHTML = '<div style="font-size:0.7rem; color:var(--text-secondary); text-align:center; margin-top:40px;">No Funding Data</div>'; return;
    }
    let colors = ['var(--krn-blue)', 'var(--krn-light-blue)', 'var(--krn-orange)', '#14b8a6', '#8b5cf6'];
    let items = Object.keys(donorSpends).sort((a,b) => donorSpends[b] - donorSpends[a]).map((d, i) => {
        return { label: d, value: donorSpends[d], color: colors[i % colors.length] };
    });
    renderSvgDonut('donorDonutContainer', items, null, null, true);
}

// ========================================================================
// 4. MODAL (Period Breakup Drill-Down)
// ========================================================================
function openComponentModal(compName) {
    activeModalComponent = compName;
    document.getElementById('modalStaffTitle').innerText = `${compName} Breakup by Employee`;
    document.getElementById('modalStaffSubtitle').innerText = `Period: ${timeView} (${selectedMonth} ${selectedYear}) | Dept: ${selectedDepartment}`;
    document.getElementById('modalSearch').value = '';
    renderStaffModalTable();
    document.getElementById('staffModal').style.display = 'block';
}

function renderStaffModalTable() {
    const thead = document.getElementById('modalTableHeader');
    const tbody = document.getElementById('staffModalTableBody');
    tbody.innerHTML = '';
    
    let headerHtml = `<tr><th>Position Code</th><th>Employee Name</th>`;
    activeMonths.forEach(m => headerHtml += `<th>${m} Actual (M PKR)</th>`);
    headerHtml += `<th>Total Actual</th><th>Total Budget</th><th>Variance</th></tr>`;
    thead.innerHTML = headerHtml;

    const term = document.getElementById('modalSearch').value.toLowerCase();
    let empData = {};

    unifiedLedger.forEach(row => {
        if (!activeMonths.includes(row.month)) return;
        
        let master = positionMaster[row.code];
        if (selectedDepartment !== 'All Departments' && master.dept !== selectedDepartment) return;
        
        let pct = selectedDonor === 'All Donors' ? 1.0 : (master.donorAllocations[selectedDonor] || 0);
        if (pct === 0) return;

        let comp = row.components[activeModalComponent];
        if (!comp || (comp.b === 0 && comp.a === 0)) return;

        if (!empData[row.code]) {
            empData[row.code] = { code: row.code, name: master.name, months: {}, tB: 0, tA: 0 };
            activeMonths.forEach(m => empData[row.code].months[m] = 0);
        }

        let aVal = comp.a * pct;
        let bVal = comp.b * pct;
        
        empData[row.code].months[row.month] += aVal;
        empData[row.code].tA += aVal;
        empData[row.code].tB += bVal;
    });

    Object.values(empData).sort((x, y) => y.tA - x.tA).forEach(p => {
        if (term && !p.code.toLowerCase().includes(term) && !p.name.toLowerCase().includes(term)) return;
        let diff = p.tB - p.tA;
        
        let rowHtml = `<tr>
            <td><strong style="color:var(--krn-blue)">${p.code}</strong></td>
            <td>${p.name}</td>`;
            
        activeMonths.forEach(m => {
            rowHtml += `<td style="font-variant-numeric:tabular-nums">${p.months[m] === 0 ? '-' : (p.months[m]/1000000).toFixed(2)}</td>`;
        });

        rowHtml += `
            <td style="font-variant-numeric:tabular-nums; font-weight:bold;">${(p.tA/1000000).toFixed(2)}</td>
            <td style="font-variant-numeric:tabular-nums; color:var(--text-secondary)">${(p.tB/1000000).toFixed(2)}</td>
            <td style="font-variant-numeric:tabular-nums; font-weight:bold; color:${diff >= 0 ? 'var(--krn-green)' : 'var(--krn-orange)'}">${(diff/1000000).toFixed(2)}</td>
        </tr>`;
        tbody.innerHTML += rowHtml;
    });
}

function filterStaffModal() { renderStaffModalTable(); }
function closeModal() { document.getElementById('staffModal').style.display = 'none'; }
window.onclick = function(e) { if (e.target == document.getElementById('staffModal')) closeModal(); }

function exportModalCSV() {
    const table = document.querySelector("#staffModal .detail-table");
    let csv = [];
    for (let i = 0; i < table.rows.length; i++) {
        let row = [], cols = table.rows[i].querySelectorAll("td, th");
        for (let j = 0; j < cols.length; j++) row.push('"' + cols[j].innerText.replace(/"/g, '""') + '"');
        csv.push(row.join(","));
    }
    const csvFile = new Blob([csv.join("\n")], {type: "text/csv"});
    const link = document.createElement("a");
    link.download = `HR_${activeModalComponent}_${timeView}_${selectedMonth}.csv`;
    link.href = window.URL.createObjectURL(csvFile);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
}

// ========================================================================
// 5. UTILS & SVG DONUT ENGINE
// ========================================================================
function animateCounter(id, val) { const el = document.getElementById(id); if(el) el.innerHTML = formatPKRInline(val); }
function formatPKRInline(num) { let p = getFormattedParts(num); return `<span class="val-unit-inline">${p.u}</span> <span class="val-num-inline">${p.v}</span>`; }
function formatPKRShort(num) { let p = getFormattedParts(num); return `${p.v} ${p.u.charAt(0)}`; }
function getFormattedParts(num) {
    let v = parseFloat(num)||0; let a = Math.abs(v);
    if(a>=1000000) return {v:(v/1000000).toFixed(1), u:'M PKR'};
    if(a>=1000) return {v:(v/1000).toFixed(1), u:'K PKR'};
    return {v:v.toLocaleString(), u:'PKR'};
}
function applyTheme() { document.body.classList.toggle('light-mode', !isDarkMode); }
function toggleDarkMode() { isDarkMode = !isDarkMode; applyTheme(); }

const tooltip = document.getElementById('hoverTooltip');
function showTooltip(e, label, value, pct) {
    const parts = getFormattedParts(value);
    if(tooltip) {
        tooltip.innerHTML = `<strong>${label}</strong><br><span class="val-num-inline" style="color:inherit">${parts.v}</span> ${parts.u} (<span class="val-num-inline" style="color:inherit">${pct}</span>%)`;
        tooltip.classList.add('visible'); moveTooltip(e);
    }
}
function moveTooltip(e) { if(tooltip) { tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px'; } }
function hideTooltip() { if(tooltip) tooltip.classList.remove('visible'); }

function renderSvgDonut(containerId, items, centerBadge = null, bottomLabel = null, showLegend = true) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const total = items.reduce((acc, it) => acc + (parseFloat(it.value) || 0), 0);
    const radius = 42; const C = 2 * Math.PI * radius;
    let cumulativePercent = 0;
    let circlesHtml = `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="var(--border-color)" />`;
    let legendHtml = '';
    if (total === 0) {
        if (showLegend) legendHtml = `<div style="color: var(--text-secondary); text-align: center; font-size: 0.6rem;">No data</div>`;
    } else {
        items.forEach((it) => {
            const fraction = it.value / total;
            const sliceLen = fraction * C;
            const offset = cumulativePercent * C;
            cumulativePercent += fraction;
            circlesHtml += `<circle class="donut-slice-${containerId}" cx="50" cy="50" r="${radius}" fill="none" stroke="${it.color}" stroke-dasharray="0 ${C}" stroke-dashoffset="-${offset}" data-target-len="${sliceLen}" onmouseenter="showTooltip(event, '${it.label.replace(/'/g, "\\'")}', ${it.value}, '${Math.round(fraction*100)}')" onmousemove="moveTooltip(event)" onmouseleave="hideTooltip()" style="transform: rotate(-90deg); transform-origin: 50% 50%; pointer-events: stroke; transition: stroke-dasharray 1.4s cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 1.4s cubic-bezier(0.16, 1, 0.3, 1);" />`;
            if (showLegend) {
                legendHtml += `<div class="donut-legend-item"><div class="donut-legend-item-left"><div class="donut-legend-dot" style="background-color: ${it.color};"></div><span style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden; font-family: Calibri, sans-serif !important;">${it.label}</span></div><strong style="font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight:400;">${Math.round(fraction * 100)}%</strong></div>`;
            }
        });
    }
    container.innerHTML = `<div class="svg-donut-wrapper"><div class="donut-chart-box"><svg viewBox="0 0 100 100" class="donut-svg">${circlesHtml}</svg></div>${showLegend && legendHtml ? `<div class="donut-legend-list">${legendHtml}</div>` : ''}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        container.querySelectorAll(`.donut-slice-${containerId}`).forEach(s => {
            const tl = parseFloat(s.getAttribute('data-target-len')) || 0;
            s.style.strokeDasharray = `${tl} ${C - tl}`;
        });
    }));
}

applyTheme();
