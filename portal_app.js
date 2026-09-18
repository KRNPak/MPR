// ========================================================================
// 1. STATE & CONSTANTS
// ========================================================================
const CURRENT_YEAR = 'FY2027';
let emp = null; // Logged-in employee object
let db = {}; // Holds all loaded CSV data

// Training Limits by Grade
const trainingLimits = {
    10: 625000, 9: 375000, 8: 312500, 
    7: 250000, 6: 187500, 5: 150000, 4: 100000
};

// ========================================================================
// 2. CSV PARSER (Reused from Main Dashboard)
// ========================================================================
function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    
    function parseCSVLine(line) {
        let result = [], inQuotes = false, val = '';
        for (let c = 0; c < line.length; c++) {
            let char = line[c];
            if (char === '"' && inQuotes && line[c+1] === '"') { val += '"'; c++; }
            else if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) { result.push(val); val = ''; }
            else val += char;
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
        errorMsg.style.display = "block";
        return;
    }

    errorMsg.style.display = "none";
    btn.innerText = "Decrypting...";

    try {
        const path = `Data/${CURRENT_YEAR}/HR_Data`;
        
        // Load Master File first
        const masterRes = await fetch(`${path}/Staff_Master.csv`);
        const masterData = parseCSV(await masterRes.text());
        
        // CNIC Match (Checking raw headers to catch exact matches if normalized headers are weird)
        emp = masterData.find(r => {
            let cnicKey = Object.keys(r._raw).find(k => k.toLowerCase().includes('cnic'));
            let val = cnicKey ? String(r._raw[cnicKey]).replace(/[^0-9]/g, '') : '';
            return val === cnicInput;
        });

        if (!emp) throw new Error("CNIC not found.");

        // We have a match! Now load the specific operational files
        const files = ['PF', 'Advances', 'Training', 'Gratuity', 'Tax', 'CPR_Master'];
        for (let file of files) {
            try {
                const res = await fetch(`${path}/${file}.csv`);
                db[file] = parseCSV(await res.text());
            } catch (e) {
                console.warn(`Could not load ${file}.csv - ${e.message}`);
                db[file] = []; 
            }
        }

        // Get Employee's specific rows from the databases
        let empCodeKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('code') || k.toLowerCase().includes('id'));
        let empCode = emp._raw[empCodeKey];

        db.myPF = db.PF.find(r => r._raw[Object.keys(r._raw)[0]] == empCode) || {};
        db.myAdvances = db.Advances.filter(r => r._raw[Object.keys(r._raw)[0]] == empCode) || [];
        db.myTraining = db.Training.find(r => r._raw[Object.keys(r._raw)[0]] == empCode) || {};
        db.myGratuity = db.Gratuity.find(r => r._raw[Object.keys(r._raw)[0]] == empCode) || {};
        db.myTax = db.Tax.find(r => r._raw[Object.keys(r._raw)[1]] == empCode) || {}; // Using index 1 based on your image

        renderDashboard();
        
        document.getElementById('loginGate').style.display = "none";
        document.getElementById('portalDashboard').style.display = "block";

    } catch (err) {
        console.error(err);
        errorMsg.innerText = "Access Denied. CNIC not recognized or HR data unavailable.";
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
    // Standardize Master Data
    const nameKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('employee'));
    const desigKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('designation'));
    const gradeKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('grade'));
    const joinKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('join') || k.toLowerCase().includes('date'));
    const salaryKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('salary') || k.toLowerCase().includes('basic'));

    const empName = emp._raw[nameKey] || "Staff Member";
    const empGrade = parseInt(getSafeNum(emp._raw[gradeKey])) || 0;
    const baseSalary = getSafeNum(emp._raw[salaryKey]);
    
    // Parse Dates safely
    const joinDate = new Date(emp._raw[joinKey]);
    const today = new Date();
    
    let tenureMonths = 0; let tenureYears = 0;
    if (!isNaN(joinDate)) {
        tenureMonths = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());
        tenureYears = tenureMonths / 12;
    }

    document.getElementById('empNameDisplay').innerText = empName;
    document.getElementById('empDesignationDisplay').innerText = emp._raw[desigKey] || "KRN Staff";
    document.getElementById('empGradeDisplay').innerText = empGrade;
    document.getElementById('empJoinDisplay').innerText = isNaN(joinDate) ? "Unknown" : joinDate.toLocaleDateString();

    // --- 1. PROVIDENT FUND ---
    let pfEmpCont = getSafeNum(db.myPF['totalaccumulatedcontributons']) / 2; // Approximating split if not explicit
    let pfEmployerCont = pfEmpCont;
    let pfProfit = getSafeNum(db.myPF['totalaccumulatedprofit']);
    
    if (tenureMonths < 3) {
        pfEmployerCont = 0; // Probation rule
        document.getElementById('pfEmployerBox').style.opacity = '0.3';
        document.getElementById('pfEmployerBox').title = "Employer match locked during probation (unvested).";
    }
    
    let pfTotal = pfEmpCont + pfEmployerCont + pfProfit;
    document.getElementById('pfTotal').innerText = pfTotal.toLocaleString('en-PK');
    document.getElementById('pfEmployee').innerText = pfEmpCont.toLocaleString('en-PK');
    document.getElementById('pfEmployer').innerText = pfEmployerCont.toLocaleString('en-PK');
    document.getElementById('pfProfit').innerText = pfProfit.toLocaleString('en-PK');


    // --- 2. ACCRUED TRAINING BUDGET ---
    const tBaseKey = Object.keys(db.myTraining._raw || {}).find(k => k.toLowerCase().includes('accrued'));
    const tExpKey = Object.keys(db.myTraining._raw || {}).find(k => k.toLowerCase().includes('expenses'));
    
    let trainingBaseline = getSafeNum((db.myTraining._raw || {})[tBaseKey]); 
    let trainingExpenses = getSafeNum((db.myTraining._raw || {})[tExpKey]);
    
    // Calculate new accrual from June 30, 2026
    const baselineDate = new Date('2026-06-30');
    let annualLimit = trainingLimits[empGrade] || 0;
    let newAccrual = 0;
    
    if (today > baselineDate) {
        let daysSince = (today - baselineDate) / (1000 * 60 * 60 * 24);
        newAccrual = (daysSince / 365.25) * annualLimit;
    }
    
    let totalAccrued = Math.min(trainingBaseline + newAccrual, annualLimit * 3); // 3 Year Cap
    let trainingAvailable = totalAccrued - trainingExpenses;
    let overUtilizedTraining = 0;

    if (trainingAvailable < 0) {
        overUtilizedTraining = Math.abs(trainingAvailable);
        trainingAvailable = 0;
        document.getElementById('trainingWarning').style.display = "block";
        document.getElementById('trainAvailable').style.color = "var(--krn-orange)";
    }

    document.getElementById('trainAvailable').innerText = Math.round(trainingAvailable).toLocaleString('en-PK');
    document.getElementById('trainAccrued').innerText = Math.round(totalAccrued).toLocaleString('en-PK');
    document.getElementById('trainUtilized').innerText = Math.round(trainingExpenses).toLocaleString('en-PK');


    // --- 3. GRATUITY PAYABLE ---
    const gBaseKey = Object.keys(db.myGratuity._raw || {}).find(k => k.toLowerCase().includes('payable'));
    let gratuityBaseline = getSafeNum((db.myGratuity._raw || {})[gBaseKey]);
    
    // New Accrual from June 30, 2026
    let gratAccrual = 0;
    if (today > baselineDate) {
        let yearsSince = (today - baselineDate) / (1000 * 60 * 60 * 24 * 365.25);
        gratAccrual = (baseSalary * 0.5) * yearsSince;
    }

    let gratuityTotal = gratuityBaseline + gratAccrual;
    // 10 Year Cap
    let maxGratuity = (baseSalary * 0.5) * 10;
    gratuityTotal = Math.min(gratuityTotal, maxGratuity);

    document.getElementById('gratuityTotal').innerText = Math.round(gratuityTotal).toLocaleString('en-PK');
    
    const gratuityCard = document.getElementById('gratuityCard');
    if (tenureYears < 3) {
        gratuityCard.classList.add('locked-card');
        gratuityCard.innerHTML += `
            <div class="locked-overlay" title="3-Year Vesting Cliff Policy">
                <span style="font-size: 2rem;">🔒</span>
                <span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">Vests in ${Math.ceil((3 - tenureYears)*12)} Months</span>
            </div>
        `;
        gratuityTotal = 0; // Vested amount is 0 for calculations
    }


    // --- 4. ADVANCES ---
    let activeAdvancesTotal = 0;
    let advHtml = '';
    
    db.myAdvances.forEach(adv => {
        let principal = getSafeNum(adv._raw['amount']) || getSafeNum(adv._raw['advance']); // Map as needed
        let settled = getSafeNum(adv._raw['previously settled']) || 0;
        let remaining = principal - settled;
        activeAdvancesTotal += remaining;
        
        if (remaining > 0) {
            let pct = Math.round((settled / principal) * 100);
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
    
    document.getElementById('activeAdvancesContainer').innerHTML = advHtml || '<div style="font-size:0.8rem; color:var(--text-secondary);">No active advances.</div>';

    let advLimitRule1 = baseSalary * 5;
    let advLimitRule2 = pfTotal * 0.60;
    let maxAdvLimit = Math.min(advLimitRule1, advLimitRule2);
    let advAvailable = Math.max(0, maxAdvLimit - activeAdvancesTotal);
    
    // Hard Limit: Max 3 advances
    if (db.myAdvances.length >= 3) advAvailable = 0; 
    document.getElementById('advLimit').innerText = Math.round(advAvailable).toLocaleString('en-PK');


    // --- 5. LEASE FINANCE LIMIT ---
    const leaseCard = document.getElementById('leaseCard');
    if (empGrade < 8) {
        leaseCard.classList.add('locked-card');
        leaseCard.innerHTML += `
            <div class="locked-overlay" title="Restricted to Grades 8-10 (ManCom)">
                <span style="font-size: 1.5rem;">🔒</span>
                <span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">ManCom Benefit</span>
            </div>
        `;
    } else {
        let leaseLimit = (pfTotal + gratuityTotal) - (activeAdvancesTotal + overUtilizedTraining);
        document.getElementById('leaseLimit').innerText = Math.round(Math.max(0, leaseLimit)).toLocaleString('en-PK');
    }
}

// ========================================================================
// 5. SECURE PDF GENERATOR (Section 149)
// ========================================================================
function generateTaxPDF() {
    if (!db.myTax || Object.keys(db.myTax).length === 0) {
        alert("No tax records found for your profile.");
        return;
    }

    const year = document.getElementById('taxYearSelect').value;
    const nameKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('employee'));
    const cnicKey = Object.keys(emp._raw).find(k => k.toLowerCase().includes('cnic'));
    
    const empName = emp._raw[nameKey] || "Employee";
    const empCNIC = emp._raw[cnicKey] || "XXXXX-XXXXXXX-X";
    
    const taxableIncome = getSafeNum(db.myTax._raw['annual taxable income']) || 0;
    const taxLiability = getSafeNum(db.myTax._raw['annual tax liability']) || 0;

    const months = ['Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26', 'Jan-27', 'Feb-27', 'Mar-27', 'Apr-27', 'May-27', 'Jun-27'];
    
    let tableHtml = '';
    let totalDeducted = 0;

    months.forEach(m => {
        // Cross-reference CPR Master
        let cprRow = db.CPR_Master.find(r => r._raw['Month'] == m);
        let cprNo = cprRow ? cprRow._raw['CPR_Number'] : 'Pending';
        
        // Find matching month column in myTax
        let monthCol = Object.keys(db.myTax._raw).find(k => k.toLowerCase().includes(m.toLowerCase()));
        let amount = getSafeNum(db.myTax._raw[monthCol]);
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
    template.style.display = "block"; // Briefly show to render
    
    template.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <img src="https://www.karandaaz.com.pk/_next/static/media/navbar-logo.0ebe1390.svg" alt="Karandaaz" style="height: 60px;">
                <h2 style="margin: 10px 0 5px 0;">CERTIFICATE OF COLLECTION OR DEDUCTION OF INCOME TAX</h2>
                <h4 style="margin: 0; font-weight: normal;">UNDER RULE 42</h4>
            </div>
            
            <p style="line-height: 1.6; text-align: justify;">
                Certified that <strong>PKR ${totalDeducted.toLocaleString('en-PK')}</strong> on account of Income Tax has been deducted/collected 
                on amount of <strong>PKR ${taxableIncome.toLocaleString('en-PK')}</strong> from <strong>${empName}</strong> having CNIC Number 
                <strong>${empCNIC}</strong> during the financial year 01 July 2026 to 30 June 2027 under section 149 (Tax on Salary Income) 
                of Pakistan Income Tax Ordinance, 2001.
            </p>
            <p style="line-height: 1.6; text-align: justify; margin-bottom: 30px;">
                This is to further certify that the tax collected/deducted by KARANDAAZ PAKISTAN (NTN:4369428-4) 
                has been deposited in different branches of National Bank of Pakistan and State Bank of Pakistan. 
                Reference CPR's are as follows:
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

            <div style="margin-top: 50px;">
                <p style="margin: 0;"><strong>Issuing Authority:</strong></p>
                <p style="margin: 0;">Finance Department</p>
                <p style="margin: 0;">KARANDAAZ PAKISTAN</p>
                <p style="margin: 0;">NTN: 4369428-4</p>
                <p style="margin-top: 10px;"><em>Date: ${new Date().toLocaleDateString()}</em></p>
            </div>
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
        template.style.display = "none"; // Hide after rendering
    });
}
