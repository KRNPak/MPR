// ========================================================================
// 1. STATE & SECURITY PROTOCOL
// ========================================================================
let isDarkMode = false;
let availableYears = ['FY2025', 'FY2026', 'FY2027'];
let selectedYear = availableYears[availableYears.length - 1];
let selectedDepartment = 'All Departments';
let selectedDonor = 'All Donors';
let modalDepartment = '';

let positionMaster = {}; 
let unifiedLedger = []; 
let activeFilteredData = [];

// SECURITY: Intercepts and decrypts AES-256 encrypted CSVs
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
            if (!res.ok) return null; // File might not exist yet
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
// 2. DATA ENGINE (Master, Budget, Actuals Mapping)
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

function parsePercent(val) {
    let str = String(val).replace('%', '').trim();
    let num = parseFloat(str);
    return isNaN(num) ? 0 : (num > 1 ? num / 100 : num); // Handles both "50" and "0.5"
}

function getSafeNum(val) {
    let str = String(val || '').replace(/[^0-9.-]/g, '');
    let num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

function buildDataEngine(masterRows, budgetRows, actualRows) {
    positionMaster = {};
    const donorsList = new Set();

    // 1. Build Master Map
    masterRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        if (!code) return;
        
        let dept = r['department'] || 'Uncategorized';
        let name = r['employeename'] || 'Vacant';
        let grade = r['positiongrade'] || '';
        
        // Find Donor Columns dynamically (ignoring standard HR columns)
        let donorAllocations = {};
        Object.keys(r._raw).forEach(k => {
            let cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!['positioncode', 'employeecode', 'employeename', 'department', 'designation', 'positiongrade', 'gender', 'joiningdate', 'newagreementstartdate'].includes(cleanK)) {
                let pct = parsePercent(r._raw[k]);
                if (pct > 0) { donorAllocations[k] = pct; donorsList.add(k); }
            }
        });

        if (Object.keys(donorAllocations).length === 0) donorAllocations['OSR'] = 1.0;

        positionMaster[code] = { code, dept, name, grade, donorAllocations };
    });

    // 2. Process unified ledger
    const ledgerMap = {}; 
    const fiscalMonths = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

    const getBucket = (keyStr) => {
        if (keyStr.includes('base')) return 'Base';
        if (keyStr.includes('provident') || keyStr.includes('eobi') || keyStr.includes('gratuity') || keyStr.includes('tax')) return 'Benefits';
        if (keyStr.includes('gross') || keyStr.includes('total') || keyStr.includes('net') || keyStr.includes('month') || keyStr.includes('date') || keyStr.includes('position')) return 'Skip';
        return 'Allowances';
    };

    // Actuals
    actualRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        let mth = String(r['month'] || 'Jul').substring(0,3);
        if (!positionMaster[code]) return;

        let key = `${code}_${mth}`;
        if (!ledgerMap[key]) ledgerMap[key] = { code, month: mth, aBase: 0, aAllow: 0, aBen: 0, bBase: 0, bAllow: 0, bBen: 0 };
        
        Object.keys(r._raw).forEach(rawK => {
            let clean = rawK.toLowerCase();
            let bucket = getBucket(clean);
            if (bucket === 'Skip') return;
            let val = getSafeNum(r._raw[rawK]);
            if (bucket === 'Base') ledgerMap[key].aBase += val;
            if (bucket === 'Allowances') ledgerMap[key].aAllow += val;
            if (bucket === 'Benefits') ledgerMap[key].aBen += val;
        });
    });

    // Budget (Annual divided by 12)
    budgetRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        if (!positionMaster[code]) return;
        
        let monthlyBase = getSafeNum(r['updatedbaseannually']) / 12;
        let monthlyAllow = 0;
        let monthlyBen = 0;

        Object.keys(r._raw).forEach(rawK => {
            let clean = rawK.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (clean.includes('updatedbaseannually') || clean.includes('gross') || clean.includes('month') || clean.includes('position') || clean.includes('date') || clean.includes('name')) return;
            
            let bucket = getBucket(clean);
            let val = getSafeNum(r._raw[rawK]); 
            // Assuming allowance/benefit columns in budget are monthly. If annual, divide by 12 here.
            if (bucket === 'Allowances') monthlyAllow += val;
            if (bucket === 'Benefits') monthlyBen += val;
        });

        fiscalMonths.forEach(mth => {
            let key = `${code}_${mth}`;
            if (!ledgerMap[key]) ledgerMap[key] = { code, month: mth, aBase: 0, aAllow: 0, aBen: 0, bBase: 0, bAllow: 0, bBen: 0 };
            ledgerMap[key].bBase += monthlyBase;
            ledgerMap[key].bAllow += monthlyAllow;
            ledgerMap[key].bBen += monthlyBen;
        });
    });

    unifiedLedger = Object.values(ledgerMap);

    // Populate Donor Dropdown
    const dDrop = document.getElementById('donorDropdown');
    dDrop.innerHTML = '<option value="All Donors">All Donors</option>';
    Array.from(donorsList).sort().forEach(d => dDrop.add(new Option(d, d)));

    // Populate Dept Dropdown
    const deptDrop = document.getElementById('deptDropdown');
    deptDrop.innerHTML = '<option value="All Departments">All Departments</option>';
    let uniqueDepts = [...new Set(Object.values(positionMaster).map(p => p.dept))].sort();
    uniqueDepts.forEach(d => deptDrop.add(new Option(d, d)));
}

// ========================================================================
// 3. UI RENDERING & FILTERING
// ========================================================================
function onFilterChange() {
    selectedYear = document.getElementById('yearDropdown').value;
    selectedDepartment = document.getElementById('deptDropdown').value;
    selectedDonor = document.getElementById('donorDropdown').value;
    updateStaffDashboard();
}

function updateStaffDashboard() {
    activeFilteredData = [];
    let totBud = 0, totAct = 0;
    let deptSummary = {};
    let activeHeads = new Set();
    let budHeads = new Set();

    unifiedLedger.forEach(row => {
        let master = positionMaster[row.code];
        if (selectedDepartment !== 'All Departments' && master.dept !== selectedDepartment) return;

        let pct = selectedDonor === 'All Donors' ? 1.0 : (master.donorAllocations[selectedDonor] || 0);
        if (pct === 0) return; // Not funded by this donor

        let fRow = {
            code: row.code, dept: master.dept, name: master.name, month: row.month,
            bBase: row.bBase * pct, bAllow: row.bAllow * pct, bBen: row.bBen * pct,
            aBase: row.aBase * pct, aAllow: row.aAllow * pct, aBen: row.aBen * pct
        };
        
        let tB = fRow.bBase + fRow.bAllow + fRow.bBen;
        let tA = fRow.aBase + fRow.aAllow + fRow.aBen;

        if (tB > 0) budHeads.add(row.code);
        if (tA > 0) activeHeads.add(row.code);

        totBud += tB;
        totAct += tA;

        if (!deptSummary[fRow.dept]) deptSummary[fRow.dept] = { b: 0, a: 0 };
        deptSummary[fRow.dept].b += tB;
        deptSummary[fRow.dept].a += tA;

        activeFilteredData.push(fRow);
    });

    document.getElementById('topKpiHeadcount').innerHTML = `<span class="val-num">${activeHeads.size}</span><span class="val-unit-inline" style="font-size:1rem;">/ ${budHeads.size}</span>`;
    animateCounter('topKpiBudget', totBud);
    animateCounter('topKpiActual', totAct);
    animateCounter('topKpiVariance', Math.abs(totBud - totAct));

    renderStaffSummaryTable(deptSummary);
    renderDonuts();
}

function renderStaffSummaryTable(deptSummary) {
    const tbody = document.getElementById('staffSummaryTableBody');
    tbody.innerHTML = '';
    
    Object.keys(deptSummary).sort().forEach(d => {
        let item = deptSummary[d];
        if (item.b === 0 && item.a === 0) return;
        
        const pctDisplay = item.b > 0 ? `${Math.round((item.a / item.b) * 100)}%` : (item.a > 0 ? 'N/A' : '0%');
        const badgeClass = item.a > item.b ? 'badge-orange' : 'badge-primary';
        
        tbody.innerHTML += `
            <tr class="clickable-tr summary-table-row" onclick="openDepartmentModal('${d.replace(/'/g, "\\'")}')">
                <td style="color: var(--text-primary); font-weight:500;">${d}</td>
                <td><div style="width:40px; height:15px; background:rgba(74, 150, 210, 0.2); border-radius:4px;"></div></td>
                <td style="font-variant-numeric: tabular-nums;">${formatPKRInline(item.b)}</td>
                <td style="font-variant-numeric: tabular-nums; color: var(--krn-blue); font-weight: 500;">${formatPKRInline(item.a)}</td>
                <td><span class="badge-pill ${badgeClass}">${pctDisplay}</span></td>
            </tr>
        `;
    });
}

function renderDonuts() {
    let tBase = 0, tAllow = 0, tBen = 0;
    activeFilteredData.forEach(r => { tBase += r.aBase; tAllow += r.aAllow; tBen += r.aBen; });
    
    document.getElementById('staffDonutContainer').innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; width:100%;">
            <div id="compDonut" style="width: 120px; height: 120px;"></div>
        </div>
    `;

    renderSvgDonut('compDonut', [
        { label: 'Base Salary', value: tBase, color: 'var(--krn-blue)' },
        { label: 'Allowances', value: tAllow, color: 'var(--krn-light-blue)' },
        { label: 'Benefits', value: tBen, color: 'var(--krn-orange)' }
    ], { pct: 'COST', label: 'SPLIT' }, null, true);
}

// ========================================================================
// 4. MODAL & DRILL DOWN
// ========================================================================
function openDepartmentModal(deptName) {
    modalDepartment = deptName;
    document.getElementById('modalStaffTitle').innerText = `Employee Roster: ${deptName}`;
    document.getElementById('modalStaffSubtitle').innerText = `${selectedYear} | ${selectedDonor}`;
    document.getElementById('modalSearch').value = '';
    renderStaffModalTable();
    document.getElementById('staffModal').style.display = 'block';
}

function renderStaffModalTable() {
    const tbody = document.getElementById('staffModalTableBody');
    tbody.innerHTML = '';
    const term = document.getElementById('modalSearch').value.toLowerCase();

    // Group by Position
    let posAgg = {};
    activeFilteredData.forEach(r => {
        if (r.dept !== modalDepartment) return;
        if (!posAgg[r.code]) posAgg[r.code] = { name: r.name, bBase:0, bAllow:0, bBen:0, aBase:0, aAllow:0, aBen:0 };
        posAgg[r.code].bBase += r.bBase; posAgg[r.code].aBase += r.aBase;
        posAgg[r.code].bAllow += r.bAllow; posAgg[r.code].aAllow += r.aAllow;
        posAgg[r.code].bBen += r.bBen; posAgg[r.code].aBen += r.aBen;
    });

    Object.keys(posAgg).forEach(code => {
        let p = posAgg[code];
        if (term && !code.toLowerCase().includes(term) && !p.name.toLowerCase().includes(term)) return;
        
        let tB = p.bBase + p.bAllow + p.bBen;
        let tA = p.aBase + p.aAllow + p.aBen;
        let diff = tB - tA;

        tbody.innerHTML += `
            <tr>
                <td><strong style="color:var(--krn-blue)">${code}</strong></td>
                <td>${p.name}</td>
                <td style="font-variant-numeric:tabular-nums">${(p.aBase/1000000).toFixed(2)}</td>
                <td style="font-variant-numeric:tabular-nums">${(p.aAllow/1000000).toFixed(2)}</td>
                <td style="font-variant-numeric:tabular-nums">${(p.aBen/1000000).toFixed(2)}</td>
                <td style="font-variant-numeric:tabular-nums; font-weight:500;">${(tA/1000000).toFixed(2)}</td>
                <td style="font-variant-numeric:tabular-nums; color:var(--text-secondary)">${(tB/1000000).toFixed(2)}</td>
                <td style="font-variant-numeric:tabular-nums; color:${diff >= 0 ? 'var(--krn-green)' : 'var(--krn-orange)'}">${(Math.abs(diff)/1000000).toFixed(2)}</td>
            </tr>
        `;
    });
}

function filterStaffModal() { renderStaffModalTable(); }
function closeModal() { document.getElementById('staffModal').style.display = 'none'; }
window.onclick = function(e) { if (e.target == document.getElementById('staffModal')) closeModal(); }
function populateFilters() { populateYearDropdown(); } // Fallback
function populateYearDropdown() {
    const ys = document.getElementById('yearDropdown');
    ys.innerHTML = '';
    availableYears.slice().reverse().forEach(y => ys.add(new Option(y, y, false, y === selectedYear)));
}

// Utilities
function animateCounter(id, val) { 
    const el = document.getElementById(id); if(el) el.innerHTML = formatPKRInline(val); 
}
function formatPKRInline(num) {
    let p = getFormattedParts(num); return `<span class="val-unit-inline">${p.u}</span> <span class="val-num-inline">${p.v}</span>`;
}
function getFormattedParts(num) {
    let v = parseFloat(num)||0; let a = Math.abs(v);
    if(a>=1000000) return {v:(v/1000000).toFixed(1), u:'M PKR'};
    if(a>=1000) return {v:(v/1000).toFixed(1), u:'K PKR'};
    return {v:v.toLocaleString(), u:'PKR'};
}
function applyTheme() { document.body.classList.toggle('light-mode', !isDarkMode); }
function toggleDarkMode() { isDarkMode = !isDarkMode; applyTheme(); }

// Init lock state
applyTheme();
// ========================================================================
// 5. SVG DONUT & TOOLTIP ENGINE
// ========================================================================
const tooltip = document.getElementById('hoverTooltip');

function showTooltip(e, label, value, pct) {
    const parts = getFormattedParts(value);
    if(tooltip) {
        tooltip.innerHTML = `<strong>${label}</strong><span class="val-num-inline" style="color:inherit">${parts.v}</span> ${parts.u} (<span class="val-num-inline" style="color:inherit">${pct}</span>%)`;
        tooltip.classList.add('visible');
        moveTooltip(e);
    }
}

function moveTooltip(e) {
    if(tooltip) {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
    }
}

function hideTooltip() { 
    if(tooltip) tooltip.classList.remove('visible'); 
}

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
