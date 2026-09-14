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

let granularity = 'Monthly'; 
let periodView = 'QTD'; 
let timeLabel = 'QTD'; 

let tableView = 'Component'; // 'Component' or 'Employee'

let positionMaster = {}; 
let unifiedLedger = []; 
let activeMonths = [];
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

        const masterRows = await fetchAndDecrypt('Staff_Master.enc');
        if (!masterRows) throw new Error("Master file missing");
        const budgetRows = await fetchAndDecrypt('Staff_Budget.enc') || [];
        const actualRows = await fetchAndDecrypt('Staff_Actuals.enc') || [];

        buildDataEngine(masterRows, budgetRows, actualRows);

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
// 2. DATA ENGINE
// ========================================================================
function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.replace(/"/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const objects = [];
    
    for(let i = 1; i < lines.length; i++) {
        let vals = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/"/g, '').trim());
        let obj = { _raw: {} };
        let rawHeaders = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        
        headers.forEach((h, idx) => { 
            obj[h] = vals[idx] || ''; 
            obj._raw[rawHeaders[idx] ? rawHeaders[idx].trim() : ''] = vals[idx] || ''; 
        });
        objects.push(obj);
    }
    return objects;
}

function getSafeNum(val) { 
    let str = String(val || '').replace(/[^0-9.-]/g, ''); 
    let num = parseFloat(str); 
    return isNaN(num) ? 0 : num; 
}

function getStandardMonth(mthRaw) {
    let m = String(mthRaw).trim();
    if (!m) return '';
    if (/^\d{4,5}$/.test(m)) {
        let d = new Date((parseInt(m) - 25569) * 86400 * 1000);
        return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    }
    let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 0; i < months.length; i++) { if (m.toLowerCase().includes(months[i].toLowerCase())) return months[i]; }
    return m.substring(0,3).charAt(0).toUpperCase() + m.substring(1,3).toLowerCase();
}

function createHeaderMap(rawKeys) {
    let map = {};
    let lowerKeys = rawKeys.map(k => ({ orig: k, low: k.toLowerCase().trim() }));
    
    let baseMatch = lowerKeys.find(k => k.low.includes('base salary after inflation')) || lowerKeys.find(k => k.low.includes('updated base')) || lowerKeys.find(k => k.low === 'base salary') || lowerKeys.find(k => k.low.includes('base'));
    if (baseMatch) map[baseMatch.orig] = 'Base Salary';

    lowerKeys.forEach(k => {
        if (baseMatch && k.orig === baseMatch.orig) return; 
        let lower = k.low;
        if (lower.includes('gross') || lower.includes('net') || lower.includes('payable') || lower.includes('tax') || lower.includes('advance') || lower.includes('deduction') || lower.includes('other')) return;
        
        if (lower.includes('child care')) map[k.orig] = 'Child Care';
        else if (lower.includes('car monet') || lower.includes('cma')) map[k.orig] = 'Car Monetization';
        else if (lower.includes('cola')) map[k.orig] = 'COLA';
        else if (lower.includes('provident') || lower === 'pf') map[k.orig] = 'Provident Fund';
        else if (lower.includes('eobi')) map[k.orig] = 'EOBI';
        else if (lower.includes('gratuity')) map[k.orig] = 'Gratuity';
        else if (lower.includes('lfa') || lower.includes('leave fare')) map[k.orig] = 'LFA';
        else if (lower.includes('wellness')) map[k.orig] = 'Wellness Allowance';
        else if (lower.includes('health ins')) map[k.orig] = 'Health Insurance';
        else if (lower.includes('life insura')) map[k.orig] = 'Life Insurance';
        else if (lower.includes('learning')) map[k.orig] = 'Learning & Development';
        else if (lower.includes('performance') || lower.includes('one-off')) map[k.orig] = 'Performance / Bonus';
        else if (lower.includes('arrears') || lower.includes('overtime')) map[k.orig] = 'Overtime & Arrears';
        else if (lower.includes('leave encashment')) map[k.orig] = 'Leave Encashment';
    });
    return map;
}

function buildDataEngine(masterRows, budgetRows, actualRows) {
    positionMaster = {};
    const donorsList = new Set();
    const availableMonthsSet = new Set();

    masterRows.forEach(r => {
        let code = String(r['positioncode'] || '').trim().toUpperCase();
        if (!code) return;
        let dept = r['department'] || 'Uncategorized'; let name = r['employeename'] || 'Vacant';
        let donorAllocations = {};
        Object.keys(r._raw).forEach(k => {
            let cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!['positioncode', 'employeecode', 'employeename', 'department', 'designation', 'positiongrade', 'gender', 'joiningdate', 'newagreementstartdate', 'budgetedmonths'].includes(cleanK)) {
                let pct = parseFloat(String(r._raw[k]).replace('%', '')) || 0; if (pct > 1) pct = pct / 100;
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
        if (isActual) entry.components[compName].a += val; else entry.components[compName].b += val;
    };

    if (actualRows.length > 0) {
        let actualMap = createHeaderMap(Object.keys(actualRows[0]._raw));
        actualRows.forEach(r => {
            let code = String(r['positioncode'] || '').trim().toUpperCase();
            if (!code || !positionMaster[code]) return;
            let mth = getStandardMonth(r['month']);
            if (!mth || !fiscalMonths.includes(mth)) return;
            
            availableMonthsSet.add(mth);
            let entry = ensureLedgerEntry(code, mth);
            Object.keys(r._raw).forEach(rawK => {
                let compName = actualMap[rawK];
                if (compName) addComponentVal(entry, compName, true, Math.abs(getSafeNum(r._raw[rawK])));
            });
        });
    }

    if (budgetRows.length > 0) {
        let budgetMap = createHeaderMap(Object.keys(budgetRows[0]._raw));
        let fyStartYear = parseInt(selectedYear.replace('FY', '')) - 1; 
        let fyStartDate = new Date(fyStartYear, 6, 1); 
        
        budgetRows.forEach(r => {
            let code = String(r['positioncode'] || '').trim().toUpperCase();
            if (!positionMaster[code]) return;
            
            let joinStr = r['joiningdate'] || r['joiningdatenewagreementstartdate'] || '';
            let joinDate = new Date(joinStr);
            let startIdx = 0;
            if (!isNaN(joinDate.getTime()) && joinDate > fyStartDate) {
                let m = joinDate.getMonth(); startIdx = m >= 6 ? m - 6 : m + 6; 
            }
            
            let bMonths = parseInt(r['budgetedmonths']) || 12; if (bMonths <= 0) bMonths = 12;
            let monthlyComps = {};
            
            Object.keys(r._raw).forEach(rawK => {
                let compName = budgetMap[rawK];
                if (compName) {
                    let val = getSafeNum(r._raw[rawK]);
                    if (['LFA', 'Gratuity', 'Health Insurance', 'Life Insurance', 'Learning & Development'].includes(compName)) val = val / bMonths; 
                    monthlyComps[compName] = (monthlyComps[compName] || 0) + val;
                }
            });
            
            for (let i = startIdx; i < startIdx + bMonths; i++) {
                if (i < 12) {
                    let entry = ensureLedgerEntry(code, fiscalMonths[i]);
                    Object.keys(monthlyComps).forEach(cName => { addComponentVal(entry, cName, false, monthlyComps[cName]); });
                }
            }
        });
    }

    unifiedLedger = Object.values(ledgerMap);

    const dDrop = document.getElementById('donorDropdown'); dDrop.innerHTML = '<option value="All Donors">All Donors</option>';
    Array.from(donorsList).sort().forEach(d => dDrop.add(new Option(d, d)));
    const deptDrop = document.getElementById('deptDropdown'); deptDrop.innerHTML = '<option value="All Departments">All Departments</option>';
    [...new Set(Object.values(positionMaster).map(p => p.dept))].sort().forEach(d => deptDrop.add(new Option(d, d)));

    let monthArr = Array.from(availableMonthsSet);
    if (monthArr.length > 0) {
        let latestIdx = -1; monthArr.forEach(m => { let idx = fiscalMonths.indexOf(m); if(idx > latestIdx) latestIdx = idx; });
        selectedMonth = latestIdx > -1 ? fiscalMonths[latestIdx] : 'Jul';
    }
}

// ========================================================================
// 3. UI RENDERING & FILTERING
// ========================================================================
function populateFilters() {
    const ys = document.getElementById('yearDropdown'); ys.innerHTML = '';
    availableYears.slice().reverse().forEach(y => ys.add(new Option(y, y, false, y === selectedYear)));
    const ms = document.getElementById('monthDropdown'); ms.innerHTML = '';
    fiscalMonths.forEach(m => ms.add(new Option(m, m, false, m === selectedMonth)));
}

function onGlobalFilterChange() {
    selectedYear = document.getElementById('yearDropdown').value;
    selectedDepartment = document.getElementById('deptDropdown').value;
    selectedDonor = document.getElementById('donorDropdown').value;
    updateStaffDashboard();
}

function onTimeFilterChange() { selectedMonth = document.getElementById('monthDropdown').value; updateStaffDashboard(); }

function setGranularity(val) {
    granularity = val;
    document.querySelectorAll('button[data-group="granularity"]').forEach(btn => btn.classList.toggle('active', btn.dataset.val === val));
    const pRow = document.getElementById('periodToggleRow');
    if (val === 'Yearly') {
        pRow.style.opacity = '0.3'; pRow.style.pointerEvents = 'none'; document.getElementById('monthDropdown').disabled = true;
    } else {
        pRow.style.opacity = '1'; pRow.style.pointerEvents = 'auto'; document.getElementById('monthDropdown').disabled = false;
    }
    updateStaffDashboard();
}

function setPeriod(val) {
    periodView = val;
    document.querySelectorAll('button[data-group="period"]').forEach(btn => btn.classList.toggle('active', btn.dataset.val === val));
    updateStaffDashboard();
}

function setTableView(view) {
    tableView = view;
    document.getElementById('btnViewComp').classList.toggle('active', view === 'Component');
    document.getElementById('btnViewEmp').classList.toggle('active', view === 'Employee');
    document.getElementById('mainTableSearch').value = ''; // Reset search on toggle
    updateStaffDashboard();
}

function onMainTableSearch() {
    updateStaffDashboard(); // Re-render table with search term applied
}

function updateStaffDashboard() {
    const endIdx = fiscalMonths.indexOf(selectedMonth);
    activeMonths = [];

    if (granularity === 'Yearly') {
        activeMonths = [...fiscalMonths]; timeLabel = 'FY';
    } else if (granularity === 'Quarterly') {
        const qtrIndex = Math.floor(endIdx / 3);
        if (periodView === 'PTD') { activeMonths = fiscalMonths.slice(qtrIndex * 3, qtrIndex * 3 + 3); timeLabel = 'Qtr'; }
        else if (periodView === 'YTD') { activeMonths = fiscalMonths.slice(0, qtrIndex * 3 + 3); timeLabel = 'YTD'; }
        else { activeMonths = fiscalMonths.slice(qtrIndex * 3, qtrIndex * 3 + 3); timeLabel = 'QTD'; }
    } else { 
        if (periodView === 'PTD') { activeMonths = [selectedMonth]; timeLabel = 'Monthly'; }
        else if (periodView === 'QTD') { const qtrStart = Math.floor(endIdx / 3) * 3; activeMonths = fiscalMonths.slice(qtrStart, endIdx + 1); timeLabel = 'QTD'; }
        else if (periodView === 'YTD') { activeMonths = fiscalMonths.slice(0, endIdx + 1); timeLabel = 'YTD'; }
    }

    document.getElementById('leftLblBudget').innerText = `${timeLabel} BUDGET`;
    document.getElementById('leftLblActual').innerText = `${timeLabel} ACTUAL`;

    let totBud = 0, totAct = 0;
    let compSummary = {};
    let empSummary = {}; 
    
    let activeHeads = new Set(), budHeads = new Set();
    let donorSpent = {}; let donorBudget = {}; 

    // Forecast requires knowing how many months of actuals have elapsed
    const elapsedMonths = endIdx + 1; 
    const searchTerm = document.getElementById('mainTableSearch').value.toLowerCase();

    unifiedLedger.forEach(row => {
        let master = positionMaster[row.code];
        if (selectedDepartment !== 'All Departments' && master.dept !== selectedDepartment) return;
        let pct = selectedDonor === 'All Donors' ? 1.0 : (master.donorAllocations[selectedDonor] || 0);
        if (pct === 0) return;

        if (!empSummary[row.code]) empSummary[row.code] = { code: row.code, name: master.name, periodAct: 0, ytdAct: 0, fyBud: 0 };

        let rowTotB = 0, rowTotA = 0;
        let isActiveMonth = activeMonths.includes(row.month);
        let isYtdMonth = fiscalMonths.indexOf(row.month) <= endIdx;

        Object.keys(row.components).forEach(cName => {
            let b = row.components[cName].b * pct;
            let a = row.components[cName].a * pct;
            
            empSummary[row.code].fyBud += b;
            if (isYtdMonth) empSummary[row.code].ytdAct += a;
            
            if (isActiveMonth) {
                if (!compSummary[cName]) compSummary[cName] = { b: 0, a: 0 };
                compSummary[cName].b += b; compSummary[cName].a += a;
                rowTotB += b; rowTotA += a;
                empSummary[row.code].periodAct += a;
            }
        });

        if (isActiveMonth) {
            totBud += rowTotB; totAct += rowTotA;
            if (rowTotB > 0) budHeads.add(row.code);
            if (rowTotA > 0) activeHeads.add(row.code);

            if (selectedDonor === 'All Donors') {
                Object.keys(master.donorAllocations).forEach(d => {
                    if (rowTotA > 0) donorSpent[d] = (donorSpent[d] || 0) + (rowTotA * master.donorAllocations[d]);
                    if (rowTotB > 0) donorBudget[d] = (donorBudget[d] || 0) + (rowTotB * master.donorAllocations[d]);
                });
            }
        }
    });

    document.getElementById('headcountKpi').innerText = `${activeHeads.size}/${budHeads.size}`;
    
    document.getElementById('leftKpiBudget').innerText = (totBud >= 1000000) ? (totBud/1000000).toFixed(1) : (totBud/1000).toFixed(1);
    document.getElementById('leftKpiActual').innerText = (totAct >= 1000000) ? (totAct/1000000).toFixed(1) : (totAct/1000).toFixed(1);
    document.querySelectorAll('#leftKpiBudget').forEach(el => el.previousElementSibling.firstElementChild.innerText = (totBud >= 1000000) ? 'M PKR' : 'K PKR');
    document.querySelectorAll('#leftKpiActual').forEach(el => el.previousElementSibling.firstElementChild.innerText = (totAct >= 1000000) ? 'M PKR' : 'K PKR');

    document.getElementById('mainTableVariance').innerText = formatPKRShort(Math.abs(totBud - totAct));

    if (tableView === 'Component') renderComponentTable(compSummary, searchTerm);
    else renderEmployeeTable(empSummary, elapsedMonths, searchTerm);

    renderDonorDonut('spentDonutContainer', donorSpent); 
    renderDonorDonut('budgetDonutContainer', donorBudget); 
}

function renderComponentTable(compSummary, searchTerm) {
    const thead = document.getElementById('mainTableHeader');
    thead.innerHTML = `<tr><th>Component</th><th>${timeLabel} Budget</th><th>${timeLabel} Actual</th><th>Variance</th><th>% Spent</th></tr>`;
    
    const tbody = document.getElementById('componentTableBody'); tbody.innerHTML = '';
    let sortedComps = Object.keys(compSummary).sort((x, y) => {
        if (x === 'Base Salary') return -1; if (y === 'Base Salary') return 1;
        return compSummary[y].a - compSummary[x].a;
    });

    sortedComps.forEach(c => {
        if (searchTerm && !c.toLowerCase().includes(searchTerm)) return;
        
        let item = compSummary[c]; if (item.b === 0 && item.a === 0) return;
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

function renderEmployeeTable(empSummary, elapsedMonths, searchTerm) {
    const thead = document.getElementById('mainTableHeader');
    thead.innerHTML = `<tr><th>Position & Name</th><th>${timeLabel} Actual</th><th>FY Forecast (Run-Rate)</th><th>FY Budget</th><th>FY Variance</th></tr>`;
    
    const tbody = document.getElementById('componentTableBody'); tbody.innerHTML = '';
    
    // Sort strictly by Variance (Most negative / Highest overspend first)
    let sortedEmps = Object.keys(empSummary).sort((x, y) => {
        let eX = empSummary[x]; let eY = empSummary[y];
        let vX = eX.fyBud - ((eX.ytdAct / elapsedMonths) * 12);
        let vY = eY.fyBud - ((eY.ytdAct / elapsedMonths) * 12);
        return vX - vY; 
    });

    sortedEmps.forEach(code => {
        let e = empSummary[code]; 
        if (e.periodAct === 0 && e.fyBud === 0) return;
        
        if (searchTerm && !code.toLowerCase().includes(searchTerm) && !e.name.toLowerCase().includes(searchTerm)) return;
        
        let forecast = (e.ytdAct / elapsedMonths) * 12;
        let varNum = e.fyBud - forecast;
        
        tbody.innerHTML += `
            <tr class="summary-table-row">
                <td>
                    <div style="font-weight: bold; color: var(--krn-blue); font-size: 0.8rem;">${code}</div>
                    <div style="font-size: 0.95rem; font-weight: 500; color: var(--text-primary); margin-top: 3px;">${e.name}</div>
                </td>
                <td style="font-variant-numeric: tabular-nums;">${formatPKRInline(e.periodAct)}</td>
                <td style="font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 500;">${formatPKRInline(forecast)}</td>
                <td style="font-variant-numeric: tabular-nums; color: var(--text-secondary);">${formatPKRInline(e.fyBud)}</td>
                <td style="font-variant-numeric: tabular-nums; font-weight: bold; color: ${varNum >= 0 ? 'var(--krn-green)' : 'var(--krn-orange)'};">${formatPKRInline(Math.abs(varNum))}</td>
            </tr>
        `;
    });
}
function renderDonorDonut(containerId, donorObj) {
    if (Object.keys(donorObj).length === 0) { 
        document.getElementById(containerId).innerHTML = '<div style="font-size:0.7rem; color:var(--text-secondary); text-align:center; margin-top:40px;">N/A</div>'; 
        return; 
    }
    let colors = ['var(--krn-blue)', '#14b8a6', 'var(--krn-orange)', '#8b5cf6', 'var(--krn-light-blue)'];
    let items = Object.keys(donorObj).sort((a,b) => donorObj[b] - donorObj[a]).map((d, i) => { 
        return { label: d, value: donorObj[d], color: colors[i % colors.length] }; 
    });
    renderSvgDonut(containerId, items, null, null, true);
}
// ========================================================================
// 4. MODAL & SVG DRILL DOWN LOGIC
// ========================================================================
function openComponentModal(compName) {
    if (tableView === 'Employee') return; 
    activeModalComponent = compName;
    document.getElementById('modalStaffTitle').innerText = `${compName} Breakup`;
    document.getElementById('modalStaffSubtitle').innerText = `Period: ${timeLabel} | Dept: ${selectedDepartment}`;
    document.getElementById('modalSearch').value = '';
    renderStaffModalTable(); document.getElementById('staffModal').style.display = 'block';
}

function renderStaffModalTable() {
    const thead = document.getElementById('modalTableHeader');
    const tbody = document.getElementById('staffModalTableBody'); tbody.innerHTML = '';
    
    let headerHtml = `<tr><th>Code</th><th>Name</th>`;
    activeMonths.forEach(m => headerHtml += `<th>${m} Actual (M PKR)</th>`);
    headerHtml += `<th>Tot Actual</th><th>Tot Budget</th><th>Var</th></tr>`;
    thead.innerHTML = headerHtml;

    const term = document.getElementById('modalSearch').value.toLowerCase();
    let empData = {};

    unifiedLedger.forEach(row => {
        if (!activeMonths.includes(row.month)) return;
        let master = positionMaster[row.code];
        if (selectedDepartment !== 'All Departments' && master.dept !== selectedDepartment) return;
        let pct = selectedDonor === 'All Donors' ? 1.0 : (master.donorAllocations[selectedDonor] || 0); if (pct === 0) return;
        let comp = row.components[activeModalComponent]; if (!comp || (comp.b === 0 && comp.a === 0)) return;

        if (!empData[row.code]) {
            empData[row.code] = { code: row.code, name: master.name, months: {}, tB: 0, tA: 0 };
            activeMonths.forEach(m => empData[row.code].months[m] = 0);
        }
        
        empData[row.code].months[row.month] += comp.a * pct;
        empData[row.code].tA += comp.a * pct; empData[row.code].tB += comp.b * pct;
    });

    Object.values(empData).sort((x, y) => y.tA - x.tA).forEach(p => {
        if (term && !p.code.toLowerCase().includes(term) && !p.name.toLowerCase().includes(term)) return;
        let diff = p.tB - p.tA;
        let rowHtml = `<tr><td><strong style="color:var(--krn-blue)">${p.code}</strong></td><td>${p.name}</td>`;
        activeMonths.forEach(m => { rowHtml += `<td style="font-variant-numeric:tabular-nums">${p.months[m] === 0 ? '-' : (p.months[m]/1000000).toFixed(2)}</td>`; });
        rowHtml += `<td style="font-variant-numeric:tabular-nums; font-weight:bold;">${(p.tA/1000000).toFixed(2)}</td><td style="font-variant-numeric:tabular-nums; color:var(--text-secondary)">${(p.tB/1000000).toFixed(2)}</td><td style="font-variant-numeric:tabular-nums; font-weight:bold; color:${diff >= 0 ? 'var(--krn-green)' : 'var(--krn-orange)'}">${(diff/1000000).toFixed(2)}</td></tr>`;
        tbody.innerHTML += rowHtml;
    });
}

function filterStaffModal() { renderStaffModalTable(); }
function closeModal() { document.getElementById('staffModal').style.display = 'none'; }
window.onclick = function(e) { if (e.target == document.getElementById('staffModal')) closeModal(); }

function formatPKRInline(num) { let p = getFormattedParts(num); return `<span class="val-unit-inline">${p.u}</span> <span class="val-num-inline">${p.v}</span>`; }
function formatPKRShort(num) { let p = getFormattedParts(num); return `${p.v} ${p.u.charAt(0)}`; }
function getFormattedParts(num) {
    let v = parseFloat(num)||0; let a = Math.abs(v);
    if(a>=1000000) return {v:(v/1000000).toFixed(1), u:'M PKR'}; if(a>=1000) return {v:(v/1000).toFixed(1), u:'K PKR'}; return {v:v.toLocaleString(), u:'PKR'};
}
function applyTheme() { document.body.classList.toggle('light-mode', !isDarkMode); }
function toggleDarkMode() { isDarkMode = !isDarkMode; applyTheme(); }

const tooltip = document.getElementById('hoverTooltip');
function showTooltip(e, label, value, pct) {
    const parts = getFormattedParts(value);
    if(tooltip) { tooltip.innerHTML = `<strong>${label}</strong><br><span class="val-num-inline" style="color:inherit">${parts.v}</span> ${parts.u} (<span class="val-num-inline" style="color:inherit">${pct}</span>%)`; tooltip.classList.add('visible'); moveTooltip(e); }
}
function moveTooltip(e) { if(tooltip) { tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px'; } }
function hideTooltip() { if(tooltip) tooltip.classList.remove('visible'); }

// THICK SVG DONUT RENDERER
function renderSvgDonut(containerId, items, centerBadge = null, bottomLabel = null, showLegend = true) {
    const container = document.getElementById(containerId); if (!container) return;
    const total = items.reduce((acc, it) => acc + (parseFloat(it.value) || 0), 0);
    const radius = 38; // Reduced slightly to leave room for the ultra-thick stroke
    const C = 2 * Math.PI * radius; let cumulativePercent = 0;
    const strokeWidth = 14; // Massive thickness increase
    
    // Faint base circle for empty background
    let circlesHtml = `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="var(--border-color)" stroke-width="${strokeWidth}" opacity="0.3" />`; 
    let legendHtml = '';
    
    if (total > 0) {
        items.forEach((it) => {
            const fraction = it.value / total; const sliceLen = fraction * C; const offset = cumulativePercent * C; cumulativePercent += fraction;
            circlesHtml += `<circle class="donut-slice-${containerId}" cx="50" cy="50" r="${radius}" fill="none" stroke="${it.color}" stroke-width="${strokeWidth}" stroke-dasharray="0 ${C}" stroke-dashoffset="-${offset}" data-target-len="${sliceLen}" onmouseenter="showTooltip(event, '${it.label.replace(/'/g, "\\'")}', ${it.value}, '${Math.round(fraction*100)}')" onmousemove="moveTooltip(event)" onmouseleave="hideTooltip()" style="transform: rotate(-90deg); transform-origin: 50% 50%; pointer-events: stroke; transition: stroke-dasharray 1.4s cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 1.4s cubic-bezier(0.16, 1, 0.3, 1);" />`;
            if (showLegend) legendHtml += `<div class="donut-legend-item"><div class="donut-legend-item-left"><div class="donut-legend-dot" style="background-color: ${it.color};"></div><span style="white-space:nowrap; font-size:0.75rem; font-family: Calibri, sans-serif;">${it.label}</span></div><strong style="font-variant-numeric: tabular-nums; color: var(--text-primary); font-size:0.75rem;">${Math.round(fraction * 100)}%</strong></div>`;
        });
    }
    
    container.innerHTML = `<div class="svg-donut-wrapper" style="margin-top:-10px;"><div class="donut-chart-box"><svg viewBox="0 0 100 100" class="donut-svg">${circlesHtml}</svg></div>${showLegend && legendHtml ? `<div class="donut-legend-list">${legendHtml}</div>` : ''}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => { container.querySelectorAll(`.donut-slice-${containerId}`).forEach(s => { const tl = parseFloat(s.getAttribute('data-target-len')) || 0; s.style.strokeDasharray = `${tl} ${C - tl}`; }); }));
}
applyTheme();
