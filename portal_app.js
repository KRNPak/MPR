// ========================================================================
// 1. GLOBAL VARIABLES & HELPERS
// ========================================================================
let db = {};
let emp = null;

function getSafeNum(val) {
    if (typeof val === 'string') val = val.replace(/,/g, '');
    let num = parseFloat(val);
    return isNaN(num) ? 0 : num;
}

function formatShortDate(d) {
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${String(d.getDate()).padStart(2, '0')}-${m[d.getMonth()]}-${d.getFullYear()}`;
}

function formatDurationFromDays(days) {
    days = Math.max(0, Math.round(days));
    if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
    let months = Math.floor(days / 30.4375);
    let remDays = Math.round(days - months * 30.4375);
    if (remDays >= 30) { months += 1; remDays = 0; }
    let text = `${months} month${months === 1 ? '' : 's'}`;
    if (remDays > 0) text += ` ${remDays} day${remDays === 1 ? '' : 's'}`;
    return text;
}

// When training spend exceeds what has accrued, work out how long it takes
// (at the annual entitlement's daily accrual rate) for accrual to catch up
// and the employee to be entitled to training again. Approximate: assumes the
// annual entitlement stays the same.
function getTrainingRecovery(overage, annualBudget, today) {
    if (!(overage > 0)) return null;
    const dailyAccrual = annualBudget / 365.25;
    if (!(dailyAccrual > 0)) return { days: null, text: 'No annual training entitlement on record.' };
    const days = Math.ceil(overage / dailyAccrual);
    const date = new Date(today.getTime() + days * 86400000);
    return { days, date, text: `${formatDurationFromDays(days)} (approx. ${formatShortDate(date)})` };
}

// Advances.csv has 12 month-deduction columns headed by Excel serial-date
// numbers (e.g. "46204" = 01-Jul-2026). The old code tried to sum
// "every column after Settled outside of payroll" by position in
// Object.keys() — but JavaScript automatically reorders integer-like
// object keys to the FRONT of enumeration, regardless of insertion order.
// That silently made settleIdx land on the last key every time, so the
// month-wise deductions were never actually added — only "Previously
// settled" (prior-FY) ever counted. This identifies month columns by
// pattern instead of position, and only counts a month once its date has
// arrived (future scheduled deductions aren't "settled" yet).
function getAdvanceSettledAmount(rawA) {
    let histSettled = getSafeNum(rawA['Previously settled']) + getSafeNum(rawA['Settled outside of payroll']);
    let today = new Date();
    let currentFYDeductions = 0;

    Object.keys(rawA).forEach(key => {
        let trimmedKey = key.trim();
        if (!/^\d{4,6}$/.test(trimmedKey)) return; // not a serial-date column
        let serial = parseInt(trimmedKey, 10);
        let monthDate = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        if (monthDate <= today) {
            currentFYDeductions += getSafeNum(rawA[key]);
        }
    });

    return histSettled + currentFYDeductions;
}

function animateValue(id, end, duration = 1000) {
    let obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * end).toLocaleString('en-PK');
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// ========================================================================
// 2. AUTHENTICATION
// ========================================================================
async function authenticateUser() {
    const cnicInputEl = document.getElementById('cnicInput');
    const empCodeInputEl = document.getElementById('empCodeInput'); // New field
    
    const cnicInput = cnicInputEl ? cnicInputEl.value.trim() : "";
    const empCodeInput = empCodeInputEl ? empCodeInputEl.value.trim() : "";
    
    const btn = document.querySelector('.login-btn') || document.querySelector('button');
    const errorMsg = document.getElementById('loginError') || document.getElementById('errorMsg');

    // 1. Check if both fields are provided
    if (!cnicInput || !empCodeInput) {
        if (errorMsg) { 
            errorMsg.innerText = "Please enter both your Employee Code and CNIC."; 
            errorMsg.style.display = "block"; 
        }
        return;
    }

    if (btn) { btn.innerText = "Verifying..."; btn.disabled = true; }
    if (errorMsg) errorMsg.style.display = "none";

    try {
        // Send both to backend (in case your backend API uses both)
        const response = await fetch('/api/get-employee-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cnic: cnicInput, empCode: empCodeInput })
        });

        if (!response.ok) throw new Error("Invalid Credentials or Data Not Found");

        db = await response.json();
        emp = db.emp; 
        
        // 2. Strict Frontend Verification Check
        let rawEmp = emp?._raw || emp || {};
        let dbEmpCodeKey = Object.keys(rawEmp).find(k => k.toLowerCase().replace(/\s/g, '') === 'employeecode' || k.toLowerCase() === 'emp code');
        let actualEmpCode = dbEmpCodeKey ? rawEmp[dbEmpCodeKey] : "";
        
        // Compare input code against the master sheet code (case-insensitive)
        if (String(actualEmpCode).trim().toLowerCase() !== String(empCodeInput).toLowerCase()) {
            throw new Error("Invalid Employee Code or CNIC combination.");
        }

        const loginScreen = document.getElementById('loginScreen');
        const dashboardScreen = document.getElementById('dashboardScreen');
        if (loginScreen) loginScreen.style.display = 'none';
        if (dashboardScreen) dashboardScreen.style.display = 'block';
        
        renderDashboard();
    } catch (error) {
        if (errorMsg) { 
            errorMsg.innerText = error.message || "Access Denied. Please check your credentials."; 
            errorMsg.style.display = "block"; 
        }
        if (btn) { btn.innerText = "Secure Login \u2192"; btn.disabled = false; }
    }
}
// ========================================================================
// 3. RENDER MAIN DASHBOARD
// ========================================================================
function renderDashboard() {
    if (!emp) return;

    let rawEmp = db.emp?._raw || db.emp || {};
    let rawGrat = db.myGratuity?._raw || db.myGratuity || {};
    let rawPF = db.myPF?._raw || db.myPF || {};
    let rawTrain = db.myTraining?._raw || db.myTraining || {};

    let employeeName = rawEmp['Employee Name'] || rawGrat['Employee Name'] || rawPF['Employee'] || "Employee Name";
    let empCodeKey = Object.keys(rawEmp).find(k => k.toLowerCase().replace(/\s/g, '') === 'employeecode' || k.toLowerCase() === 'emp code');
    let empCode = (empCodeKey ? rawEmp[empCodeKey] : null) || "";
    let jobTitle = rawEmp['Designation'] || rawEmp['designation'] || "";
    let department = rawEmp['Department'] || rawEmp['department'] || "";
    let gradeNum = getSafeNum(rawEmp['Position Grade'] || rawEmp['Grade'] || 0);
    let baseSalary = getSafeNum(rawEmp['Base Salary'] || rawPF['Base Salary']);
    
    // Date parsing for dd/mm/yyyy
    let joinDateStr = rawEmp['Joining Date'] || "";
    let joinDateObj = new Date();
    let formattedJoinDate = "N/A";
    if (joinDateStr) {
        let parts = joinDateStr.split('/');
        if (parts.length === 3) {
            joinDateObj = new Date(parts[2], parts[1] - 1, parts[0]);
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            formattedJoinDate = `${parts[0]}-${months[joinDateObj.getMonth()]}-${parts[2]}`;
        }
    }

    // --- SIDEBAR IDENTITY DOM UPDATES ---
    if(document.getElementById('empNameDisplay')) document.getElementById('empNameDisplay').innerText = employeeName;
    if(document.getElementById('empGradeDisplay')) document.getElementById('empGradeDisplay').innerText = gradeNum;
    if(document.getElementById('empJoinDisplay')) document.getElementById('empJoinDisplay').innerText = formattedJoinDate;
    if(document.getElementById('empCodeDisplay')) document.getElementById('empCodeDisplay').innerText = empCode;
    if(document.getElementById('empPositionDisplay')) {
        document.getElementById('empPositionDisplay').innerText = [jobTitle, department].filter(Boolean).join(', ');
    }
    let initialsEl = document.getElementById('empInitials');
    if (initialsEl) {
        let words = String(employeeName).trim().split(/\s+/).filter(Boolean);
        let initials = words.length ? (words[0][0] + (words[words.length - 1][0] || '')).toUpperCase() : '--';
        initialsEl.innerText = initials;
    }

    // Time calculations based on financial year
    let today = new Date();
    let currentFYYear = today.getMonth() < 6 ? today.getFullYear() - 1 : today.getFullYear();
    let fyStart = new Date(currentFYYear, 6, 1); // July 1st
    let daysPassedInFY = Math.max(0, (today - fyStart) / (1000 * 60 * 60 * 24));
    
    let tenureMonths = (today.getFullYear() - joinDateObj.getFullYear()) * 12;
    tenureMonths -= joinDateObj.getMonth();
    tenureMonths += today.getMonth();

    // --- SIDEBAR: EMPLOYEE DETAILS (Compensation & Benefits) ---
    let sidebarList = document.getElementById('sidebarDetailsList');
    if (sidebarList) {
        let cma = getSafeNum(rawEmp['Car monetization']);
        let childCare = getSafeNum(rawEmp['Child care allowance']);
        let wellness = getSafeNum(rawEmp['Wellness allowance']);
        let cola = getSafeNum(rawEmp['COLA']);
        let comms = getSafeNum(rawEmp['Communication reimbursement']);
        let fuel = rawEmp['Fuel allowed in Liters'];
        let osr = rawEmp['OSR'];
        let gf = rawEmp['GF'];
        let fip = rawEmp['FIP'];

        function makeDetailRow(title, value, isText) {
            if (value === undefined || value === null || value === 0 || value === "0" || value === "" || value === "-") return '';
            let displayVal = typeof value === 'number' ? Math.round(value).toLocaleString('en-PK') : value;
            return `
                <div class="sidebar-detail-row">
                    <span class="sidebar-detail-label">${title}</span>
                    <span class="sidebar-detail-value${isText ? ' is-text' : ''}">${displayVal}</span>
                </div>`;
        }

        // Benefits (as opposed to pay & allowances above)
        let trainingEntitlement = getSafeNum(rawEmp['Training']);
        let gratuityApplies = tenureMonths >= 36; // same 3-year rule as the Gratuity card
        let leaseElig = String(rawEmp['Lease eligibility'] || '').trim().toLowerCase();
        let leaseEligible = leaseElig === 'yes' || leaseElig === 'y';
        let leaseAvailedAmt = getSafeNum(rawEmp['Lease amount availed']);

        let payRows = [
            makeDetailRow('Base Salary', baseSalary),
            makeDetailRow('Car Monetization', cma),
            makeDetailRow('Child Care Allowance', childCare),
            makeDetailRow('Wellness Allowance', wellness),
            makeDetailRow('COLA', cola),
            makeDetailRow('Communication', comms),
            fuel ? makeDetailRow('Fuel Allowance (L)', fuel) : '',
            makeDetailRow('OSR', osr),
            makeDetailRow('GF', gf),
            makeDetailRow('FIP', fip)
        ].join('');

        let benefitRows = [
            makeDetailRow('Training (per annum)', trainingEntitlement),
            gratuityApplies ? makeDetailRow('Gratuity (per annum)', baseSalary / 2) : '',
            makeDetailRow('Lease Finance (LFL)', leaseEligible ? 'Eligible' : 'Not eligible', true),
            leaseAvailedAmt > 0 ? makeDetailRow('Lease availed', leaseAvailedAmt) : ''
        ].join('');

        sidebarList.innerHTML = payRows + (benefitRows ? `<div class="sidebar-subhead">Benefits</div>` + benefitRows : '');
    }

    // --- A. PROVIDENT FUND ---
    let pf = db.myPF || {};
    let openingPF = getSafeNum(rawPF['Opening PF'] || pf.openingpf);
    let openingProfit = getSafeNum(rawPF['Opening Profit'] || pf.openingprofit);
    let openingWithdrawals = getSafeNum(rawPF['Opening Withdrawals']); 
    
    let pfEmpCont = 0;
    let pfEmployerCont = 0;
    let pfProfit = openingProfit;
    
    const monthPrefixes = ['July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June'];
    for (let month of monthPrefixes) {
        let mTotalCont = getSafeNum(rawPF[`${month} Contribution`]);
        let mProfit = getSafeNum(rawPF[`${month} Profit`]);
        pfEmpCont += (mTotalCont / 2);
        pfEmployerCont += (mTotalCont / 2);
        pfProfit += mProfit;
    }

    let currentWithdrawals = getSafeNum(rawPF['Permanent withdrawals']);
    if (tenureMonths < 3) pfEmployerCont = 0; 
    
    let pfTotal = (openingPF + pfEmpCont + pfEmployerCont + pfProfit) - currentWithdrawals;
    
    if(document.getElementById('pfTotal')) animateValue('pfTotal', pfTotal);
    if(document.getElementById('pfEmployee')) document.getElementById('pfEmployee').innerText = Math.round(openingPF/2 + pfEmpCont).toLocaleString('en-PK');
    if(document.getElementById('pfEmployer')) document.getElementById('pfEmployer').innerText = Math.round(openingPF/2 + pfEmployerCont).toLocaleString('en-PK');
    if(document.getElementById('pfProfit')) document.getElementById('pfProfit').innerText = Math.round(pfProfit).toLocaleString('en-PK');
    if(document.getElementById('pfWithdrawal')) document.getElementById('pfWithdrawal').innerText = Math.round(currentWithdrawals).toLocaleString('en-PK');

    // --- B. TRAINING BUDGET ---
    let histAccrued = getSafeNum(rawTrain['Accrued']);
    let histExpense = getSafeNum(rawTrain['Expense']);
    let annualBudget = getSafeNum(rawEmp['Training']);
    
    let currentFYAccrual = (annualBudget / 365.25) * daysPassedInFY;
    let totalAccrued = histAccrued + currentFYAccrual;
    let trAvailable = Math.max(0, totalAccrued - histExpense);
    
    if(document.getElementById('trainAvailable')) animateValue('trainAvailable', trAvailable);
    if(document.getElementById('trainAccrued')) document.getElementById('trainAccrued').innerText = Math.round(totalAccrued).toLocaleString('en-PK');
    if(document.getElementById('trainUtilized')) document.getElementById('trainUtilized').innerText = Math.round(histExpense).toLocaleString('en-PK');
    let trainWarningEl = document.getElementById('trainingWarning');
    if (trainWarningEl) trainWarningEl.style.display = (histExpense > totalAccrued) ? 'block' : 'none';

    let trainRecovery = getTrainingRecovery(histExpense - totalAccrued, annualBudget, today);
    let trainRecoveryEl = document.getElementById('trainingRecovery');
    if (trainRecoveryEl) {
        trainRecoveryEl.innerHTML = trainRecovery ? `<strong>Entitled to training again in:</strong> ${trainRecovery.text}` : '';
    }

    let trainUtilPct = totalAccrued > 0 ? Math.min(100, (histExpense / totalAccrued) * 100) : 0;
    if(document.getElementById('trainUtilBar')) document.getElementById('trainUtilBar').style.width = trainUtilPct + '%';
    if(document.getElementById('trainUtilPercent')) document.getElementById('trainUtilPercent').innerText = Math.round(trainUtilPct) + '% utilized';
    if(document.getElementById('trainEntitlement')) document.getElementById('trainEntitlement').innerText = Math.round(annualBudget).toLocaleString('en-PK');

    // --- C. GRATUITY ---
    // Per-year rate is Base Salary / 2, applied to years served counted from
    // 1-Jul-2023 (or the employee's actual joining date if later). This
    // replaces the old "opening balance + this year's accrual" approach —
    // Gratuity.csv's opening balance is no longer used at all.
    let gratAnchorDate = new Date(2023, 6, 1); // 1 July 2023
    let gratStartDate = joinDateObj > gratAnchorDate ? joinDateObj : gratAnchorDate;
    let gratYearsServed = Math.max(0, (today - gratStartDate) / (1000 * 60 * 60 * 24 * 365.25));
    let gratTotal = (baseSalary / 2) * gratYearsServed; // unconditional — Lease's formula uses this regardless of eligibility
    let gratuityEligible = tenureMonths >= 36; // still requires 3 real years' service, from the actual joining date

    let gratuityCard = document.getElementById('gratuityCard');
    let gratBreakdownEl = document.getElementById('gratuityBreakdown');

    if (!gratuityEligible) {
        if(document.getElementById('gratuityTotal')) document.getElementById('gratuityTotal').innerText = "0";
        if(gratBreakdownEl) gratBreakdownEl.innerHTML = '';

        if (gratuityCard) {
            gratuityCard.classList.add('locked-card');
            gratuityCard.setAttribute('aria-disabled', 'true');
            gratuityCard.tabIndex = -1;
            if (!gratuityCard.querySelector('.locked-overlay')) {
                gratuityCard.insertAdjacentHTML('beforeend', `<div class="locked-overlay"><span style="font-size:1.2rem; font-weight:bold; color:var(--text-primary);">Not Eligible</span></div>`);
            }
        }
    } else {
        if (gratuityCard) {
            gratuityCard.classList.remove('locked-card');
            gratuityCard.removeAttribute('aria-disabled');
            gratuityCard.tabIndex = 0;
            let lockedOverlay = gratuityCard.querySelector('.locked-overlay');
            if (lockedOverlay) lockedOverlay.remove();
        }

        if(document.getElementById('gratuityTotal')) animateValue('gratuityTotal', gratTotal);
        if(gratBreakdownEl) {
            gratBreakdownEl.innerHTML = `
                <span style="color: var(--text-secondary);">Years Served:</span> <strong>${gratYearsServed.toFixed(2)}</strong><br>
                <span style="color: var(--text-secondary);">Rate (Base Salary &divide; 2):</span> <strong>${Math.round(baseSalary / 2).toLocaleString('en-PK')}</strong>
            `;
        }
    }

    // Tenure line stays informative either way — it's what tells an
    // ineligible employee how much longer until they qualify.
    let gratuityTenureEl = document.getElementById('gratuityTenure');
    if (gratuityTenureEl) {
        let tYears = Math.floor(tenureMonths / 12);
        let tMonthsRem = tenureMonths % 12;
        let parts = [];
        if (tYears > 0) parts.push(`${tYears} yr${tYears !== 1 ? 's' : ''}`);
        parts.push(`${tMonthsRem} mo${tMonthsRem !== 1 ? 's' : ''}`);
        gratuityTenureEl.innerText = parts.join(' ');
    }

    // --- D. SALARY ADVANCES ---
    let validAdvances = [];
    if (Array.isArray(db.myAdvances)) {
        validAdvances = db.myAdvances.filter(adv => adv && Object.keys(adv).length > 0 && getSafeNum(adv?._raw?.['Advances']) > 0);
    } else if (db.myAdvances && typeof db.myAdvances === 'object') {
        if (getSafeNum(db.myAdvances._raw?.['Advances']) > 0) validAdvances = [db.myAdvances];
    }

    let existingAdvancesAmount = 0; 
    let existingAdvancesCount = validAdvances.length;

    let advancesContainer = document.getElementById('activeAdvancesContainer');
    if (advancesContainer) {
        advancesContainer.innerHTML = ''; 
        if (validAdvances.length > 0) {
            let advancesHTML = '<div style="margin-top: 15px;">';
            
            validAdvances.forEach((adv, index) => {
                let rawA = adv._raw || adv;
                let advAmount = getSafeNum(rawA['Advances']);
                let totalSettled = getAdvanceSettledAmount(rawA);
                let balance = Math.max(0, advAmount - totalSettled);
                existingAdvancesAmount += balance;
                
                let percent = advAmount > 0 ? (totalSettled / advAmount) * 100 : 0;

                let advDateStr = rawA['Date of advance'] || '';
                let advDateDisplay = advDateStr;
                let dParts = String(advDateStr).split('/');
                if (dParts.length === 3) {
                    const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                    let gracePeriodMonths = getSafeNum(rawA['Grace period']);
                    let startDateObj = new Date(dParts[2], parseInt(dParts[1], 10) - 1, parseInt(dParts[0], 10));
                    startDateObj.setMonth(startDateObj.getMonth() + gracePeriodMonths);
                    let dd = String(startDateObj.getDate()).padStart(2, '0');
                    advDateDisplay = `${dd}-${monthsShort[startDateObj.getMonth()]}-${startDateObj.getFullYear()}`;
                }
                
                advancesHTML += `
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: var(--fs-label); margin-bottom: 4px;">
                            <span style="color: var(--text-secondary);">Advance ${index + 1} Balance${advDateDisplay ? ` <span style="font-size: var(--fs-note);">&middot; Deductions from ${advDateDisplay}</span>` : ''}</span>
                            <strong style="color: var(--krn-orange);">${Math.round(balance).toLocaleString('en-PK')} PKR</strong>
                        </div>
                        <div style="width: 100%; background: rgba(0,0,0,0.1); border-radius: 4px; height: 6px; overflow: hidden;">
                            <div style="width: ${percent}%; background: var(--krn-blue); height: 100%; border-radius: 4px;"></div>
                        </div>
                    </div>
                `;
            });
            advancesHTML += '</div>';
            advancesContainer.innerHTML = advancesHTML;
        } else {
            advancesContainer.innerHTML = '<div style="margin-top: 15px; font-size: var(--fs-label); color: var(--text-secondary);">No active advances.</div>';
        }
    }

    let advMax = 0;
    let advCapReason = '';
    if (existingAdvancesCount >= 3) {
        advCapReason = '3 active advances already on record';
    } else {
        let condition1 = baseSalary > 0 ? (baseSalary * 5) : (pfTotal * 0.6); 
        let condition2 = (pfTotal * 0.6) - existingAdvancesAmount;
        advMax = Math.max(0, Math.min(condition1, condition2));
        if (condition1 <= condition2) {
            advCapReason = baseSalary > 0 ? '5\u00d7 Base Salary' : '60% of Provident Fund';
        } else {
            advCapReason = '60% of Provident Fund (net of active advances)';
        }
    }
    if(document.getElementById('advLimit')) animateValue('advLimit', advMax);
    if(document.getElementById('advCapReason')) document.getElementById('advCapReason').innerText = advCapReason;

    // --- E2. EXPENSE CLAIMS ---
    let validExpenses = [];
    if (Array.isArray(db.myExpenses)) {
        validExpenses = db.myExpenses.filter(x => x && Object.keys(x).length > 0);
    } else if (db.myExpenses && typeof db.myExpenses === 'object' && Object.keys(db.myExpenses).length > 0) {
        validExpenses = [db.myExpenses];
    }

    let expPaidTotal = 0, expPendingCount = 0, expPendingAmount = 0;
    validExpenses.forEach(x => {
        let rawX = x._raw || x;
        let amt = getSafeNum(rawX['Report Total (PKR)']);
        let status = String(rawX['Report Status'] || '').trim().toLowerCase();
        if (status === 'paid') {
            expPaidTotal += amt;
        } else {
            expPendingCount += 1;
            expPendingAmount += amt;
        }
    });
    if(document.getElementById('expPaidTotal')) animateValue('expPaidTotal', expPaidTotal);
    if(document.getElementById('expPendingCount')) document.getElementById('expPendingCount').innerText = expPendingCount;
    if(document.getElementById('expPendingAmount')) document.getElementById('expPendingAmount').innerText = Math.round(expPendingAmount).toLocaleString('en-PK');

    // --- E. LEASE FINANCE LIMIT ---
    let leaseLimitEl = document.getElementById('leaseLimit');
    let leaseCard = document.getElementById('leaseCard');
    let leaseVal = String(rawEmp['Lease eligibility']).trim().toLowerCase();
    let isEligible = leaseVal === 'yes' || leaseVal === 'y';
    let leaseAvailed = getSafeNum(rawEmp['Lease amount availed']);
    
    if (!isEligible) {
        if (leaseLimitEl) leaseLimitEl.innerText = "0";
        if (leaseCard) {
            leaseCard.classList.add('locked-card');
            if (!leaseCard.querySelector('.locked-overlay')) {
                leaseCard.insertAdjacentHTML('beforeend', `<div class="locked-overlay"><span style="font-size:1.2rem; font-weight:bold; color:var(--text-primary);">Not Eligible</span></div>`);
            }
        }
    } else {
        if (leaseCard) leaseCard.classList.remove('locked-card');
        let lockedOverlay = leaseCard?.querySelector('.locked-overlay');
        if (lockedOverlay) lockedOverlay.remove();

        let overageTraining = histExpense > totalAccrued ? (histExpense - totalAccrued) : 0;
        let leaseLimit = (pfTotal + gratTotal) - (existingAdvancesAmount + overageTraining + leaseAvailed);
        leaseLimit = Math.max(0, leaseLimit);
        
        if (leaseLimitEl) {
            leaseLimitEl.style.fontSize = ""; 
            animateValue('leaseLimit', leaseLimit);
        }
    }
}

// ========================================================================
// 4. MODALS (PF LEDGER & ADVANCES)
// ========================================================================
function openPFModal() {
    let modal = document.getElementById('pfModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'pfModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.body.appendChild(modal);
    }
    
    let rawPF = db.myPF?._raw || db.myPF || {};
    if (Object.keys(rawPF).length === 0) return;

    let openingPF = getSafeNum(rawPF['Opening PF']);
    let openingProfit = getSafeNum(rawPF['Opening Profit']);
    let openingWithdrawals = getSafeNum(rawPF['Opening Withdrawals']);
    let currentEmpTotal = openingPF / 2;
    let currentErTotal = openingPF / 2;
    let currentProfitTotal = openingProfit;

    const displayMonths = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const monthPrefixes = ['July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June'];
    
    let monthlyRows = '';
    for (let i = 0; i < 12; i++) {
        let mTotalCont = getSafeNum(rawPF[`${monthPrefixes[i]} Contribution`]);
        let mProfit = getSafeNum(rawPF[`${monthPrefixes[i]} Profit`]);
        let mEmp = mTotalCont / 2;
        let mEr = mTotalCont / 2;
        
        currentEmpTotal += mEmp;
        currentErTotal += mEr;
        currentProfitTotal += mProfit;

        if (mTotalCont > 0 || mProfit > 0) {
            monthlyRows += `
                <tr style="border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.01);">
                    <td style="padding:6px 0; color:var(--text-secondary);">${displayMonths[i]}</td>
                    <td style="padding:6px 0; text-align:right;">${Math.round(mEmp).toLocaleString('en-PK')}</td>
                    <td style="padding:6px 0; text-align:right;">${Math.round(mEr).toLocaleString('en-PK')}</td>
                    <td style="padding:6px 0; text-align:right; color:var(--krn-green);">${Math.round(mProfit).toLocaleString('en-PK')}</td>
                </tr>
            `;
        }
    }

    let currentWithdrawals = getSafeNum(rawPF['Permanent withdrawals']);
    let grandTotal = (currentEmpTotal + currentErTotal + currentProfitTotal) - currentWithdrawals;

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:25px; border-radius:12px; width:90%; max-width:550px; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                <h2 style="margin:0; color:var(--krn-blue);">Provident Fund Ledger</h2>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.92rem; margin-bottom:10px;">
                <tr style="border-bottom: 1px dashed var(--border-color);">
                    <td style="padding:8px 0; color:var(--text-secondary);">Historical Opening Withdrawals</td>
                    <td style="padding:8px 0; text-align:right;"><strong>${Math.round(openingWithdrawals).toLocaleString('en-PK')}</strong></td>
                </tr>
                <tr style="border-bottom: 1px dashed var(--border-color);">
                    <td style="padding:8px 0; color:var(--text-secondary);">Opening PF (Net)</td>
                    <td style="padding:8px 0; text-align:right;"><strong>${Math.round(openingPF).toLocaleString('en-PK')}</strong></td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding:8px 0; color:var(--text-secondary);">Opening Profits</td>
                    <td style="padding:8px 0; text-align:right;"><strong>${Math.round(openingProfit).toLocaleString('en-PK')}</strong></td>
                </tr>
            </table>
            
            ${monthlyRows ? `
            <div style="margin-top: 15px; margin-bottom: 15px; max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead style="background: var(--bg-page); position: sticky; top: 0;">
                        <tr>
                            <th style="padding:8px 5px; text-align:left; color:var(--text-secondary);">Month</th>
                            <th style="padding:8px 5px; text-align:right; color:var(--text-secondary);">Emp Cont.</th>
                            <th style="padding:8px 5px; text-align:right; color:var(--text-secondary);">Er Cont.</th>
                            <th style="padding:8px 5px; text-align:right; color:var(--text-secondary);">Profit</th>
                        </tr>
                    </thead>
                    <tbody style="padding: 0 5px;">${monthlyRows}</tbody>
                </table>
            </div>` : ''}
            
            <table style="width:100%; border-collapse:collapse; font-size:0.97rem;">
                <tbody>
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding:6px 0; color:var(--krn-orange);">Less: Current FY Withdrawals</td>
                        <td style="padding:6px 0; text-align:right; font-weight:bold; color:var(--krn-orange);">- ${Math.round(currentWithdrawals).toLocaleString('en-PK')}</td>
                    </tr>
                    <tr style="background:rgba(0,0,0,0.02);">
                        <td style="padding:15px 5px; font-weight:bold; color:var(--krn-blue);">Net Closing Balance</td>
                        <td style="padding:15px 5px; text-align:right; font-weight:bold; color:var(--krn-blue); font-size:1.1rem;">${Math.round(grandTotal).toLocaleString('en-PK')} PKR</td>
                    </tr>
                </tbody>
            </table>
            <div style="text-align:right; margin-top:20px;">
                <button onclick="document.getElementById('pfModal').style.display='none'" style="background:var(--krn-blue); color:white; border:none; padding:8px 20px; border-radius:6px; cursor:pointer; font-weight:bold;">Close</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function openAdvancesModal() {
    let modal = document.getElementById('advModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'advModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.body.appendChild(modal);
    }
    
    let validAdvances = (Array.isArray(db.myAdvances) ? db.myAdvances : [db.myAdvances]).filter(adv => adv && getSafeNum(adv?._raw?.['Advances']) > 0);

    let rows = '';
    validAdvances.forEach((adv, i) => {
        let rawA = adv._raw || adv;
        let amt = getSafeNum(rawA['Advances']);
        let totalSettled = getAdvanceSettledAmount(rawA);
        let balance = Math.max(0, amt - totalSettled);

        rows += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding:8px 0;">Advance ${i+1}<br><small style="color:var(--text-secondary);">${rawA['Date of advance'] || '-'}</small></td>
                <td style="padding:8px 0; text-align:right;">${Math.round(amt).toLocaleString('en-PK')}</td>
                <td style="padding:8px 0; text-align:right;">${Math.round(totalSettled).toLocaleString('en-PK')}</td>
                <td style="padding:8px 0; text-align:right; font-weight:bold; color:var(--krn-orange);">${Math.round(balance).toLocaleString('en-PK')}</td>
            </tr>
        `;
    });

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:25px; border-radius:12px; width:90%; max-width:600px; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                <h2 style="margin:0; color:var(--krn-blue);">Advances Ledger Breakdown</h2>
            </div>
            ${rows ? `
            <table style="width:100%; border-collapse:collapse; font-size:0.97rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color); color:var(--text-secondary);">
                        <th style="text-align:left; padding:8px 0;">Detail</th>
                        <th style="text-align:right; padding:8px 0;">Total</th>
                        <th style="text-align:right; padding:8px 0;">Settled</th>
                        <th style="text-align:right; padding:8px 0;">Balance</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>` : '<p style="color:var(--text-secondary);">No active advances.</p>'}
            <div style="text-align:right; margin-top:20px;">
                <button onclick="document.getElementById('advModal').style.display='none'" style="background:var(--krn-blue); color:white; border:none; padding:8px 20px; border-radius:6px; cursor:pointer;">Close</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function openExpensesModal() {
    let modal = document.getElementById('expModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'expModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.body.appendChild(modal);
    }

    let validExpenses = (Array.isArray(db.myExpenses) ? db.myExpenses : [db.myExpenses]).filter(x => x && Object.keys(x._raw || x).length > 0);
    // Most recent first
    validExpenses.sort((a, b) => new Date((b._raw||b)['Expense Report Date']) - new Date((a._raw||a)['Expense Report Date']));

    let rows = '';
    validExpenses.forEach(x => {
        let rawX = x._raw || x;
        let amt = getSafeNum(rawX['Report Total (PKR)']);
        let status = rawX['Report Status'] || '-';
        let statusColor = String(status).toLowerCase() === 'paid' ? 'var(--krn-green)' : 'var(--krn-orange)';
        rows += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding:8px 0;">${rawX['Purpose'] || '-'}<br><small style="color:var(--text-secondary);">${rawX['Expense Report Date'] || '-'}</small></td>
                <td style="padding:8px 0; text-align:right;">${Math.round(amt).toLocaleString('en-PK')}</td>
                <td style="padding:8px 0; text-align:right; font-weight:bold; color:${statusColor};">${status}</td>
            </tr>
        `;
    });

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:25px; border-radius:12px; width:90%; max-width:600px; max-height:80vh; overflow-y:auto; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                <h2 style="margin:0; color:var(--krn-blue);">Expense Claims History</h2>
            </div>
            ${rows ? `
            <table style="width:100%; border-collapse:collapse; font-size:0.97rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color); color:var(--text-secondary);">
                        <th style="text-align:left; padding:8px 0;">Claim</th>
                        <th style="text-align:right; padding:8px 0;">Amount</th>
                        <th style="text-align:right; padding:8px 0;">Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>` : '<p style="color:var(--text-secondary);">No expense claims on record.</p>'}
            <div style="text-align:right; margin-top:20px;">
                <button onclick="document.getElementById('expModal').style.display='none'" style="background:var(--krn-blue); color:white; border:none; padding:8px 20px; border-radius:6px; cursor:pointer;">Close</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

setTimeout(() => {
    let advCardEl = document.getElementById('advancesCard');
    if (advCardEl) {
        advCardEl.style.cursor = 'pointer';
        advCardEl.onclick = openAdvancesModal;
    }
}, 500);

function openGratuityModal() {
    let gratCardEl = document.getElementById('gratuityCard');
    if (gratCardEl && gratCardEl.classList.contains('locked-card')) return;

    let modal = document.getElementById('gratModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gratModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.body.appendChild(modal);
    }

    let rawEmp = db.emp?._raw || db.emp || {};
    let rawGrat = db.myGratuity?._raw || db.myGratuity || {};
    if (Object.keys(rawGrat).length === 0) return;

    let today = new Date();
    let baseSalary = getSafeNum(rawEmp['Base Salary']);

    let joinDateObj = new Date();
    let joinDateStr = rawEmp['Joining Date'] || "";
    let joinParts = String(joinDateStr).split('/');
    if (joinParts.length === 3) joinDateObj = new Date(joinParts[2], joinParts[1] - 1, joinParts[0]);

    let gratAnchorDate = new Date(2023, 6, 1); // 1 July 2023
    let gratStartDate = joinDateObj > gratAnchorDate ? joinDateObj : gratAnchorDate;
    let gratYearsServed = Math.max(0, (today - gratStartDate) / (1000 * 60 * 60 * 24 * 365.25));
    let gratTotal = (baseSalary / 2) * gratYearsServed;

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:25px; border-radius:12px; width:90%; max-width:500px; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                <h2 style="margin:0; color:var(--krn-blue);">Gratuity Accrual Detail</h2>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.97rem;">
                <tbody>
                    <tr style="border-bottom: 1px dashed var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Calculation start date</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${String(gratStartDate.getDate()).padStart(2,'0')}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][gratStartDate.getMonth()]}-${gratStartDate.getFullYear()}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px dashed var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Years Served (for gratuity)</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${gratYearsServed.toFixed(2)}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Rate (Base Salary &divide; 2)</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${Math.round(baseSalary / 2).toLocaleString('en-PK')}</strong></td>
                    </tr>
                    <tr style="background:rgba(0,0,0,0.02);">
                        <td style="padding:15px 5px; font-weight:bold; color:var(--krn-blue);">Accrued Amount</td>
                        <td style="padding:15px 5px; text-align:right; font-weight:bold; color:var(--krn-blue); font-size:1.1rem;">${Math.round(gratTotal).toLocaleString('en-PK')} PKR</td>
                    </tr>
                </tbody>
            </table>
            <div style="font-size:var(--fs-note); color:var(--text-secondary); margin-top:12px;">Accrual formula: Base Salary &divide; 2, multiplied by years served counted from 1-Jul-2023 (or your joining date, if later). Requires at least 3 years' actual service to be eligible.</div>
            <div style="text-align:right; margin-top:20px;">
                <button onclick="document.getElementById('gratModal').style.display='none'" style="background:var(--krn-blue); color:white; border:none; padding:8px 20px; border-radius:6px; cursor:pointer; font-weight:bold;">Close</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function openTrainingModal() {
    let modal = document.getElementById('trainModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'trainModal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(4px);";
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.body.appendChild(modal);
    }

    let rawEmp = db.emp?._raw || db.emp || {};
    let rawTrain = db.myTraining?._raw || db.myTraining || {};
    if (Object.keys(rawTrain).length === 0) return;

    let today = new Date();
    let currentFYYear = today.getMonth() < 6 ? today.getFullYear() - 1 : today.getFullYear();
    let fyStart = new Date(currentFYYear, 6, 1);
    let daysPassedInFY = Math.max(0, (today - fyStart) / (1000 * 60 * 60 * 24));

    let histAccrued = getSafeNum(rawTrain['Accrued']);
    let histExpense = getSafeNum(rawTrain['Expense']);
    let annualBudget = getSafeNum(rawEmp['Training']);
    let currentFYAccrual = (annualBudget / 365.25) * daysPassedInFY;
    let totalAccrued = histAccrued + currentFYAccrual;
    let trAvailable = Math.max(0, totalAccrued - histExpense);
    let isOverdrawn = histExpense > totalAccrued;
    let trainRecovery = getTrainingRecovery(histExpense - totalAccrued, annualBudget, today);

    modal.innerHTML = `
        <div style="background:var(--bg-card); padding:25px; border-radius:12px; width:90%; max-width:500px; color:var(--text-primary); box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                <h2 style="margin:0; color:var(--krn-blue);">Training Budget Detail</h2>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.97rem;">
                <tbody>
                    <tr style="border-bottom: 1px dashed var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Annual Entitlement</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${Math.round(annualBudget).toLocaleString('en-PK')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px dashed var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Historical Accrued (opening)</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${Math.round(histAccrued).toLocaleString('en-PK')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding:8px 0; color:var(--text-secondary);">Current FY Accrual (to date)</td>
                        <td style="padding:8px 0; text-align:right;"><strong>${Math.round(currentFYAccrual).toLocaleString('en-PK')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding:8px 0; color:var(--krn-orange);">Less: Utilized</td>
                        <td style="padding:8px 0; text-align:right; font-weight:bold; color:var(--krn-orange);">- ${Math.round(histExpense).toLocaleString('en-PK')}</td>
                    </tr>
                    <tr style="background:rgba(0,0,0,0.02);">
                        <td style="padding:15px 5px; font-weight:bold; color:var(--krn-blue);">Available Limit</td>
                        <td style="padding:15px 5px; text-align:right; font-weight:bold; color:var(--krn-blue); font-size:1.1rem;">${Math.round(trAvailable).toLocaleString('en-PK')} PKR</td>
                    </tr>
                </tbody>
            </table>
            <div style="font-size:var(--fs-note); color:var(--text-secondary); margin-top:12px;">Accrual formula: Annual Entitlement &divide; 365.25 &times; days elapsed in the current fiscal year, plus any historical opening balance, less amounts already utilized.</div>
            ${isOverdrawn ? `<div style="background: rgba(241, 98, 34, 0.1); color: var(--krn-orange); padding: 10px 12px; border-radius: 6px; font-size: var(--fs-label); line-height: 1.45; margin-top: 12px; border: 1px solid var(--krn-orange);"><strong>Advance Utilized:</strong> You have dipped into un-accrued funds. A Training Bond is currently active.${trainRecovery ? `<div style="margin-top:6px;"><strong>Entitled to training again in:</strong> ${trainRecovery.text}</div>` : ''}</div>` : ''}
            <div style="text-align:right; margin-top:20px;">
                <button onclick="document.getElementById('trainModal').style.display='none'" style="background:var(--krn-blue); color:white; border:none; padding:8px 20px; border-radius:6px; cursor:pointer; font-weight:bold;">Close</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

// Escape closes whichever modal (PF, Gratuity, Training or Advances ledger) is currently open.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['pfModal', 'gratModal', 'trainModal', 'advModal', 'expModal'].forEach(id => {
        let modal = document.getElementById(id);
        if (modal && modal.style.display !== 'none') modal.style.display = 'none';
    });
});

// ========================================================================
// 5. TAX CERTIFICATE GENERATION
// ========================================================================
function numberToWords(num) {
    let a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
    let b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
    if ((num = num.toString()).length > 9) return 'overflow';
    let n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return ''; 
    let str = '';
    str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
    str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
    str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
    str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
    str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
    return str.trim();
}

function generateTaxPDF() {
    if (!emp) return;
    
    let yearSelect = document.getElementById('taxYearSelect');
    let yearText = yearSelect ? yearSelect.options[yearSelect.selectedIndex].text : "July 2026 - June 2027";
    
    let rawTax = db.myTax?._raw || db.myTax || {};
    let empName = rawTax['Employee Name'] || document.getElementById('empNameDisplay')?.innerText || 'Employee';
    let cnic = document.getElementById('cnicInput')?.value || 'N/A';
    
    let formattedCnic = cnic;
    if (cnic.length === 13) formattedCnic = `${cnic.substring(0, 5)}-${cnic.substring(5, 12)}-${cnic.substring(12, 13)}`;
    
    let cprMaster = db.cprMaster || [];
    let grossSalary = getSafeNum(rawTax['Annual Taxable Income'] || rawTax['Gross Salary'] || rawTax['Taxable Income'] || rawTax['Taxable Salary']) || 0;
    
    let totalTax = 0;
    const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    let rowsHTML = '';
    
    months.forEach((m) => {
        let cprObj = cprMaster.find(c => {
             let cMonth = c._raw?.['Month'] || c.month || '';
             return cMonth.toLowerCase().startsWith(m.toLowerCase());
        }) || {};
        let cprRef = cprObj._raw?.['CPR_Number'] || cprObj.cpr_number || '-';
        
        let mTaxKey = Object.keys(rawTax).find(k => k.toLowerCase().startsWith(m.toLowerCase()) && !k.toLowerCase().includes('cpr'));
        let mTax = getSafeNum(mTaxKey ? rawTax[mTaxKey] : 0);
        totalTax += mTax;
        
        rowsHTML += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 6px 8px; border: 1px solid #ddd;">${m}</td>
                <td style="padding: 6px 8px; border: 1px solid #ddd;">${cprRef}</td>
                <td style="padding: 6px 8px; border: 1px solid #ddd; text-align: right;">${Math.round(mTax).toLocaleString('en-PK')}</td>
            </tr>
        `;
    });
    
    let taxWords = numberToWords(Math.round(totalTax)) || "Zero";
    let formattedToday = new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
    
    // Build the exact HTML layout for the document
    let contentHTML = `
        <div style="font-family: 'Arial', sans-serif; color: #333; background: white; font-size: 11px; line-height: 1.4; max-width: 800px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 15px;">
                <img src="https://www.karandaaz.com.pk/_next/static/media/navbar-logo.0ebe1390.svg" style="height: 45px; margin-bottom: 10px;" alt="Karandaaz">
                <h3 style="margin: 0; font-size: 14px; text-decoration: underline;">CERTIFICATE OF COLLECTION OR DEDUCTION OF INCOME TAX</h3>
                <h4 style="margin: 3px 0 0 0; font-size: 12px;">UNDER RULE 42</h4>
            </div>
            
            <p style="text-align: justify; margin-bottom: 10px;">
                Certified that PKR. <strong>${Math.round(totalTax).toLocaleString('en-PK')}</strong> (Rupees ${taxWords} only.) on account of
                Income Tax has been deducted/collected on amount of PKR. <strong>${Math.round(grossSalary).toLocaleString('en-PK')}</strong> from <strong>${empName}</strong> having CNIC
                Number <strong>${formattedCnic}</strong> during the financial year <strong>${yearText}</strong> under section 149
                (Tax on Salary Income) of Pakistan Income Tax Ordinance, 2001.
            </p>
            <p style="text-align: justify; margin-bottom: 15px;">
                This is to further certify that the tax collected/deducted by KARANDAAZ PAKISTAN (NTN:4369428-4)
                has been deposited in different branches of National Bank of Pakistan and State Bank of Pakistan.<br>
                Reference CPR's are as follows:
            </p>
            <p style="margin: 0 0 15px 0;"><strong>Total Taxable Salary (Annual):</strong> PKR ${Math.round(grossSalary).toLocaleString('en-PK')}</p>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; text-align: left;">
                <thead>
                    <tr style="background-color: #f9f9f9;">
                        <th style="padding: 6px 8px; border: 1px solid #ddd; width: 20%;">Month</th>
                        <th style="padding: 6px 8px; border: 1px solid #ddd; width: 50%;">CPR Reference No.</th>
                        <th style="padding: 6px 8px; border: 1px solid #ddd; text-align: right; width: 30%;">Tax Withheld (PKR amount)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                    <tr style="font-weight: bold; background-color: #f9f9f9;">
                        <td colspan="2" style="padding: 6px 8px; border: 1px solid #ddd; text-align: right;">TOTAL</td>
                        <td style="padding: 6px 8px; border: 1px solid #ddd; text-align: right;">${Math.round(totalTax).toLocaleString('en-PK')}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="margin-top: 15px;">
                <p style="margin: 0 0 3px 0;">Issuing Authority:</p>
                <p style="margin: 0 0 3px 0; font-weight: bold;">Finance Department</p>
                <p style="margin: 0 0 3px 0; font-weight: bold;">KARANDAAZ PAKISTAN</p>
                <p style="margin: 0 0 10px 0;">NTN: 4369428-4</p>
                <p style="margin: 0;">${formattedToday}</p>
            </div>
            
            <div style="margin-top: 25px; padding-top: 10px; border-top: 1px solid #ccc; text-align: center; font-size: 9px; color: #666;">
                <p style="margin: 0; font-weight: bold; font-size: 10px; color: #005A9C;">KARANDAAZ PAKISTAN</p>
                <p style="margin: 2px 0;">1E Ali Plaza, Nazimuddin Road, D-Chowk, Islamabad</p>
                <p style="margin: 2px 0;">T: +92 (51) 8449761 | E: info@karandaaz.com.pk | www.karandaaz.com.pk</p>
                <p style="margin: 2px 0; font-style: italic;">A company set up under Section 42 of the Companies Act 2017</p>
            </div>
        </div>
    `;

    // Create a hidden iframe for native, text-selectable printing
    let printFrame = document.createElement('iframe');
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-10000px';
    printFrame.style.left = '-10000px';
    document.body.appendChild(printFrame);

    let frameDoc = printFrame.contentWindow ? printFrame.contentWindow.document : printFrame.contentDocument;
    frameDoc.open();
    frameDoc.write(`
        <html>
            <head>
                <title>Tax_Certificate_${formattedCnic}</title>
                <style>
                    /* Ensure backgrounds and margins print perfectly */
                    @media print {
                        @page { margin: 0.5in; }
                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                ${contentHTML}
            </body>
        </html>
    `);
    frameDoc.close();

    // Wait a brief moment for the logo image to fetch, then trigger the print dialogue
    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
        // Clean up the iframe after closing the dialogue
        setTimeout(() => {
            document.body.removeChild(printFrame);
        }, 1000);
    }, 500);
}
// ========================================================================
// 6. THEME MANAGEMENT
// ========================================================================
function toggleTheme() {
    const body = document.body;
    const label = document.getElementById('themeLabel');
    const checkbox = document.getElementById('themeToggleCheckbox');
    
    if (body.classList.contains('light-mode')) {
        body.classList.replace('light-mode', 'dark-mode');
        localStorage.setItem('krnTheme', 'dark-mode');
        if(label) label.innerText = 'DARK';
        if(checkbox) checkbox.checked = true;
    } else {
        body.classList.replace('dark-mode', 'light-mode');
        localStorage.setItem('krnTheme', 'light-mode');
        if(label) label.innerText = 'LIGHT';
        if(checkbox) checkbox.checked = false;
    }
}

(function initializeTheme() {
    const savedTheme = localStorage.getItem('krnTheme') || 'light-mode';
    document.body.className = savedTheme;
    setTimeout(() => {
        const label = document.getElementById('themeLabel');
        const checkbox = document.getElementById('themeToggleCheckbox');
        if (savedTheme === 'dark-mode') {
            if(label) label.innerText = 'DARK';
            if(checkbox) checkbox.checked = true;
        } else {
            if(label) label.innerText = 'LIGHT';
            if(checkbox) checkbox.checked = false;
        }
    }, 100);
})();

// Mobile tab groups — only visually relevant under the 900px breakpoint
// (see .mobile-tabs / [data-tab-group] rules in index.html), but harmless
// to wire up unconditionally since it's plain class-toggling.
(function initMobileTabs() {
    const tabBtns = document.querySelectorAll('.mobile-tab-btn');
    const groupedCards = document.querySelectorAll('[data-tab-group]');
    if (!tabBtns.length) return;

    function setActiveTab(tab) {
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        groupedCards.forEach(c => c.classList.toggle('tab-visible', c.dataset.tabGroup === tab));
    }

    tabBtns.forEach(b => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));
    setActiveTab('benefits');
})();


// ========================================================================
// 7. LOGOUT
// ========================================================================
function logoutUser() {
    // Clear session state so a stale record can't linger in memory.
    db = {};
    emp = null;

    // Close any open modals.
    ['pfModal', 'gratModal', 'trainModal', 'advModal', 'expModal'].forEach(id => {
        let modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
    });

    // Reset the login form for the next person.
    let cnicEl = document.getElementById('cnicInput');
    let codeEl = document.getElementById('empCodeInput');
    if (cnicEl) cnicEl.value = '';
    if (codeEl) codeEl.value = '';
    let errorMsg = document.getElementById('loginError');
    if (errorMsg) errorMsg.style.display = 'none';
    let btn = document.querySelector('.login-btn');
    if (btn) { btn.innerText = 'Secure Login \u2192'; btn.disabled = false; }

    let loginScreen = document.getElementById('loginScreen');
    let dashboardScreen = document.getElementById('dashboardScreen');
    if (dashboardScreen) dashboardScreen.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'flex';
}
