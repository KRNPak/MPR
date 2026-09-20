// ========================================================================
// 1. STATE & CONSTANTS
// ========================================================================
const CURRENT_YEAR = 'FY2027';
let emp = null; 
let db = {}; 
window.advancesData = []; 

const trainingLimits = {
    10: 625000, 9: 375000, 8: 312500, 
    7: 250000, 6: 187500, 5: 150000, 4: 100000
};

// ========================================================================
// 2. INDUSTRIAL-GRADE CSV PARSER 
// ========================================================================
// This completely solves the "newline inside quotes" bug found in Advances.csv
function parseCSV(text) {
    let objects = [];
    let inQuotes = false;
    let currentRow = [];
    let currentCell = '';
    
    // Standardize line endings safely
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        let nextChar = text[i+1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentCell += '"'; // Handle escaped quotes inside quotes
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell.trim());
            if (currentRow.join('').trim() !== '') {
                objects.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    
    // Push the very last cell/row
    currentRow.push(currentCell.trim());
    if (currentRow.join('').trim() !== '') {
        objects.push(currentRow);
    }
    
    if (objects.length < 2) return [];
    
    // Destroy invisible characters, newlines, and spaces in headers
    const rawHeaders = objects[0];
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    
    const parsedData = [];
    for (let i = 1; i < objects.length; i++) {
        const row = objects[i];
        const obj = { _raw: {} };
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = row[j] || '';
            obj._raw[rawHeaders[j]] = row[j] || '';
        }
        parsedData.push(obj);
    }
    return parsedData;
}

function getSafeNum(val) {
    if (!val) return 0;
    let str = String(val).replace(/[^0-9.-]/g, '');
    let num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

// ========================================================================
// 3. AUTHENTICATION & DATA LOADING
// ========================================================================
async function authenticateUser() {
    const cnicInput = document.getElementById('cnicInput').value.trim();
    const errorMsg = document.getElementById('loginError');
    const btn = document.querySelector('.login-btn');
    
    if (cnicInput.length < 13) {
        errorMsg.innerText = "Please enter a valid 13-digit CNIC (no dashes).";
        errorMsg.style.display = "block"; return;
    }

    errorMsg.style.display = "none";
    btn.innerText = "Decrypting...";

    try {
        const path = `Data/${CURRENT_YEAR}/HR_Data`;
        const cb = '?v=' + new Date().getTime(); 
        
        const masterRes = await fetch(`${path}/Staff_Master.csv${cb}`);
        if (!masterRes.ok) throw new Error(`Staff_Master.csv not found.`);
        const masterData = parseCSV(await masterRes.text());
        
        emp = masterData.find(r => {
            let cnicKey = Object.keys(r).find(k => k.includes('cnic'));
            if (!cnicKey) return false;
            return String(r[cnicKey]).replace(/[^0-9]/g, '') === cnicInput;
        });

        if (!emp) throw new Error("CNIC not found in Master File.");
        
        const files = ['PF', 'Advances', 'Training', 'Gratuity', 'Tax', 'CPR_Master'];
        for (let file of files) {
            try {
                const res = await fetch(`${path}/${file}.csv${cb}`);
                db[file] = res.ok ? parseCSV(await res.text()) : [];
            } catch (e) { db[file] = []; }
        }

        let empCodeKey = Object.keys(emp).find(k => k === 'employeecode' || k === 'empcode');
        let empCode = empCodeKey ? String(emp[empCodeKey]).trim() : null;

        const matchCode = (r) => {
            if (!r) return false;
            let cleanKey = Object.keys(r).find(k => k === 'employeecode' || k === 'empcode' || k === 'code');
            return cleanKey ? String(r[cleanKey]).trim() === empCode : false;
        };

        db.myPF = (db.PF || []).find(matchCode) || {};
        db.myAdvances = (db.Advances || []).filter(matchCode) || [];
        db.myTraining = (db.Training || []).find(matchCode) || {};
        db.myGratuity = (db.Gratuity || []).find(matchCode) || {};
        db.myTax = (db.Tax || []).find(matchCode) || {};

        renderDashboard();
        
        document.getElementById('loginGate').style.display = "none";
        document.getElementById('portalDashboard').style.display = "block";

    } catch (err) {
        errorMsg.innerText = `Access Denied: ${err.message}`;
        errorMsg.style.display = "block";
        btn.innerText = "Secure Login →";
    }
}

function logout() {
    emp = null; db = {};
    document.getElementById('cnicInput').value = "";
    document.getElementById('portalDashboard').style.display = "none";
    document.getElementById('loginGate').style.display = "flex";
    document.getElementById('loginGate').querySelector('.login-btn').innerText = "Secure Login →";
}

// ========================================================================
// 4. DASHBOARD RENDERER & BUSINESS LOGIC
// ========================================================================
function renderDashboard() {
    const empName = emp.employeename || "Staff Member";
    const empGrade = parseInt(getSafeNum(emp.positiongrade)) || 0;
    const baseSalary = getSafeNum(emp.basesalary);
    
    const joinKey = Object.keys(emp).find(k => k.includes('join') || k.includes('date'));
    const joinDate = new Date(emp[joinKey]);
    const today = new Date();
    
    let tenureMonths = 0; let tenureYears = 0;
    if (!isNaN(joinDate)) {
        tenureMonths = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());
        tenureYears = tenureMonths / 12;
    }

    document.getElementById('empNameDisplay').innerText = empName;
    document.getElementById('empDesignationDisplay').innerText = emp.designation || "KRN Staff";
    document.getElementById('empGradeDisplay').innerText = empGrade;
    document.getElementById('empJoinDisplay').innerText = isNaN(joinDate) ? "Unknown" : joinDate.toLocaleDateString();

    // --- 1. PROVIDENT FUND ---
    let pfEmpCont = getSafeNum(db.myPF.totalaccumulatedcontributons) / 2; 
    let pfEmployerCont = pfEmpCont;
    let pfProfit = getSafeNum(db.myPF.totalaccumulatedprofit);
    
    if (tenureMonths < 3) {
        pfEmployerCont = 0; 
        document.getElementById('pfEmployerBox').style.opacity = '0.3';
        document.getElementById('pfEmployerBox').title = "Employer match locked during probation.";
    }
    
    let pfTotal = pfEmpCont + pfEmployerCont + pfProfit;
    document.getElementById('pfTotal').innerText = pfTotal.toLocaleString('en-PK');
    document.getElementById('pfEmployee').innerText = pfEmpCont.toLocaleString('en-PK');
    document.getElementById('pfEmployer').innerText = pfEmployerCont.toLocaleString('en-PK');
    document.getElementById('pfProfit').innerText = pfProfit.toLocaleString('en-PK');

    // --- 2. ACCRUED TRAINING BUDGET ---
    let trainingBaseline = getSafeNum(db.myTraining.accrued); 
    let trainingExpenses = getSafeNum(db.myTraining.expense);
    
    const baselineDate = new Date('2026-06-30');
    let annualLimit = trainingLimits[empGrade] || 0;
    let newAccrual = today > baselineDate ? ((today - baselineDate) / (1000 * 60 * 60 * 24) / 365.25) * annualLimit : 0;
    
    let totalAccrued = Math.min(trainingBaseline + newAccrual, annualLimit * 3); 
    let trainingAvailable = totalAccrued - trainingExpenses;
    let overUtilizedTraining = 0;

    if (trainingAvailable < 0) {
        overUtilizedTraining = Math.abs(trainingAvailable);
        trainingAvailable = 0;
        document.getElementById('trainAvailable').style.color = "var(--krn-orange)";
    }
    document.getElementById('trainAvailable').innerText = Math.round(trainingAvailable).toLocaleString('en-PK');
    
    const trainTextContainer = document.getElementById('trainAccrued').parentElement;
    trainTextContainer.innerHTML = `
        <span style="color: var(--text-secondary);">Baseline:</span> <strong>${Math.round(trainingBaseline).toLocaleString('en-PK')}</strong><br>
        <span style="color: var(--text-secondary);">Accrued Year:</span> <strong>${Math.round(newAccrual).toLocaleString('en-PK')}</strong><br>
        <span style="color: var(--text-secondary);">Total Accrued:</span> <strong>${Math.round(totalAccrued).toLocaleString('en-PK')}</strong><br>
        <span style="color: var(--text-secondary);">Utilized:</span> <strong>${Math.round(trainingExpenses).toLocaleString('en-PK')}</strong>
    `;

    // --- 3. GRATUITY PAYABLE ---
    let gratuityBaseline = getSafeNum(db.myGratuity.gratuitypayable);
    let gratAccrual = today > baselineDate ? (baseSalary * 0.5) * ((today - baselineDate) / (1000 * 60 * 60 * 24 * 365.25)) : 0;

    let gratuityTotal = Math.min(gratuityBaseline + gratAccrual, (baseSalary * 0.5) * 10);
    document.getElementById('gratuityTotal').innerText = Math.round(gratuityTotal).toLocaleString('en-PK');
    
    const gratuityCard = document.getElementById('gratuityCard');
    if (tenureYears < 3) {
        gratuityCard.classList.add('locked-card');
        gratuityCard.innerHTML += `<div class="locked-overlay" title="3-Year Vesting Cliff Policy"><span style="font-size: 2rem;">🔒</span><span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">Vests in ${Math.ceil((3 - tenureYears)*12)} Months</span></div>`;
        gratuityTotal = 0; 
    }

    // --- 4. ADVANCES & AMORTIZATION SCHEDULE ---
    let activeAdvancesTotal = 0;
    let advHtml = '';
    window.advancesData = []; 
    
    db.myAdvances.forEach(adv => {
        let principal = getSafeNum(adv.advances) || getSafeNum(adv.advance) || getSafeNum(adv.amount); 
        let settled = getSafeNum(adv.previouslysettled) || 0;
        let settledOutside = getSafeNum(adv.settledoutsideofpayroll) || 0;
        let totalSettled = settled + settledOutside;
        let remaining = principal - totalSettled;
        
        let tenure = getSafeNum(adv.tenuremonths) || 12; // Adjusted key to catch tenure(months)
        let emi = principal > 0 ? (principal / tenure) : 0;
        let monthsLeft = emi > 0 ? Math.ceil(remaining / emi) : 0;

        activeAdvancesTotal += remaining;
        
        if (remaining > 0) {
            window.advancesData.push({
                date: adv.dateofadvance || 'Unknown',
                principal: principal,
                emi: emi,
                remaining: remaining,
                monthsLeft: monthsLeft
            });

            let pct = Math.round((totalSettled / principal) * 100);
            advHtml += `
                <div style="margin-top: 10px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px;">
                        <span>Advance Balance</span> <strong>${remaining.toLocaleString('en-PK')} PKR</strong>
                    </div>
                    <div style="width:100%; background:var(--border-color); height:6px; border-radius:3px; overflow:hidden;">
                        <div style="width:${pct}%; background:var(--krn-blue); height:100%;"></div>
                    </div>
                    <div style="text-align:right; font-size:0.65rem; color:var(--text-secondary); margin-top:2px;">${pct}% Repaid</div>
                </div>
            `;
        }
    });
    
    let advContainer = document.getElementById('activeAdvancesContainer').parentElement;
    document.getElementById('activeAdvancesContainer').innerHTML = advHtml || '<div style="font-size:0.8rem; color:var(--text-secondary);">No active advances.</div>';
    
    if (window.advancesData.length > 0) {
        advContainer.style.cursor = 'pointer';
        advContainer.title = "Click to view Amortization Schedule";
        advContainer.onclick = openAdvancesModal;
    }

    let advAvailable = Math.max(0, Math.min(baseSalary * 5, pfTotal * 0.60) - activeAdvancesTotal);
    if (db.myAdvances.length >= 3) advAvailable = 0; 
    document.getElementById('advLimit').innerText = Math.round(advAvailable).toLocaleString('en-PK');

    // --- 5. LEASE FINANCE LIMIT ---
    const leaseCard = document.getElementById('leaseCard');
    if (empGrade < 8) {
        leaseCard.classList.add('locked-card');
        leaseCard.innerHTML += `<div class="locked-overlay"><span style="font-size: 1.5rem;">🔒</span><span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">ManCom Benefit</span></div>`;
    } else {
        let leaseLimit = (pfTotal + gratuityTotal) - (activeAdvancesTotal + overUtilizedTraining);
        document.getElementById('leaseLimit').innerText = Math.round(Math.max(0, leaseLimit)).toLocaleString('en-PK');
    }
}

// ========================================================================
// 5. MODAL GENERATOR (AMORTIZATION)
// ========================================================================
function openAdvancesModal() {
    let modal = document.getElementById('advModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'advModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        document.body.appendChild(modal);
    }
    
    let rows = window.advancesData.map(a => `
        <tr style="border-bottom: 1px solid var(--border-color);">
            <td style="padding:10px;">${a.date}</td>
            <td style="padding:10px; text-align:right;">${a.principal.toLocaleString('en-PK')}</td>
            <td style="padding:10px; text-align:right; font-weight:bold;">${Math.round(a.emi).toLocaleString('en-PK')}</td>
            <td style="padding:10px; text-align:right;">${a.remaining.toLocaleString('en-PK')}</td>
            <td style="padding:10px; text-align:center;">${a.monthsLeft}</td>
        </tr>
    `).join('');

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:30px; border-radius:12px; width:90%; max-width:700px; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <h2 style="margin:0 0 5px 0; color:var(--krn-blue);">Amortization Schedule</h2>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:20px;">Estimated Remaining Equated Monthly Installments (EMIs)</p>
            <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
                <thead>
                    <tr style="background:rgba(0,0,0,0.05); color:var(--text-secondary);">
                        <th style="padding:10px; text-align:left;">Advance Date</th>
                        <th style="padding:10px; text-align:right;">Principal (PKR)</th>
                        <th style="padding:10px; text-align:right;">Monthly EMI</th>
                        <th style="padding:10px; text-align:right;">Remaining Balance</th>
                        <th style="padding:10px; text-align:center;">Months Left</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="text-align:right; margin-top:25px;">
                <button onclick="document.getElementById('advModal').style.display='none'" style="background:var(--krn-orange); color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:bold;">Close Window</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

// ========================================================================
// 6. SECURE PDF GENERATOR (Section 149)
// ========================================================================
function generateTaxPDF() {
    if (!db.myTax || Object.keys(db.myTax).length === 0 || !db.myTax.annualtaxableincome) {
        alert("No tax records found for your profile to generate a PDF.");
        return;
    }

    const year = document.getElementById('taxYearSelect').value;
    const empName = emp.employeename || "Employee";
    const cnicKey = Object.keys(emp).find(k => k.includes('cnic'));
    const empCNIC = emp[cnicKey] || "XXXXX-XXXXXXX-X";
    
    const taxableIncome = getSafeNum(db.myTax.annualtaxableincome) || 0;
    let tableHtml = '';
    let totalDeducted = 0;

    const months = ['Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27', 'Feb-27', 'Mar-27', 'Apr-27', 'May-27', 'Jun-27'];
    
    months.forEach(m => {
        let mClean = m.toLowerCase().replace(/[^a-z0-9]/g, ''); 
        
        let cprRow = (db.CPR_Master || []).find(r => r.month && r.month.toLowerCase().includes(m.substring(0,3).toLowerCase()));
        let cprNo = cprRow ? cprRow._raw['CPR_Number'] : 'Pending';
        
        let amount = getSafeNum(db.myTax[mClean]);
        if (!amount && m.includes('Sep')) amount = getSafeNum(db.myTax['sept26']); 
        
        totalDeducted += amount;

        tableHtml += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${m}</td>
                <td style="padding: 8px;">${cprNo}</td>
                <td style="padding: 8px; text-align: right;">${amount.toLocaleString('en-PK')}</td>
            </tr>
        `;
    });

    const template = document.getElementById('pdfTemplate');
    template.style.display = "block"; 
    
    template.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="margin: 10px 0 5px 0;">CERTIFICATE OF COLLECTION OR DEDUCTION OF INCOME TAX</h2>
                <h4 style="margin: 0; font-weight: normal;">UNDER RULE 42</h4>
            </div>
            <p style="line-height: 1.6; text-align: justify;">
                Certified that <strong>PKR ${totalDeducted.toLocaleString('en-PK')}</strong> on account of Income Tax has been deducted/collected 
                on amount of <strong>PKR ${taxableIncome.toLocaleString('en-PK')}</strong> from <strong>${empName}</strong> having CNIC Number 
                <strong>${empCNIC}</strong> during the financial year 01 July 2026 to 30 June 2027 under section 149 (Tax on Salary Income).
            </p>
            <p style="line-height: 1.6; text-align: justify; margin-bottom: 30px;">
                This is to further certify that the tax collected/deducted by KARANDAAZ PAKISTAN (NTN:4369428-4) 
                has been deposited in different branches of National Bank of Pakistan and State Bank of Pakistan. Reference CPR's are as follows:
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 0.9rem;">
                <thead>
                    <tr style="background-color: #f5f5f5; border-bottom: 2px solid #ccc;">
                        <th style="padding: 10px; text-align: left;">Month</th>
                        <th style="padding: 10px; text-align: left;">CPR Reference No.</th>
                        <th style="padding: 10px; text-align: right;">Tax Withheld (PKR)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableHtml}
                    <tr style="font-weight: bold; background-color: #f5f5f5; border-top: 2px solid #ccc;">
                        <td style="padding: 10px;" colspan="2">TOTAL</td>
                        <td style="padding: 10px; text-align: right;">${totalDeducted.toLocaleString('en-PK')}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    const opt = {
        margin:       0.5,
        filename:     `Karandaaz_Tax_Certificate_${empCNIC}_${year}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(template).save().then(() => {
        template.style.display = "none";
    });
}
