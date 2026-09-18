// ========================================================================
// 1. STATE & CONSTANTS
// ========================================================================
const CURRENT_YEAR = 'FY2027';
let employeeData = null; 
let allCSVs = {}; // Will hold loaded parsed data from HR_Data

// ========================================================================
// 2. AUTHENTICATION & DATA LOADING
// ========================================================================
async function authenticateUser() {
    const cnicInput = document.getElementById('cnicInput').value.trim();
    const errorMsg = document.getElementById('loginError');
    
    if (cnicInput.length < 13) {
        errorMsg.innerText = "Please enter a valid 13-digit CNIC.";
        errorMsg.style.display = "block";
        return;
    }

    errorMsg.style.display = "none";
    document.getElementById('loginGate').querySelector('.login-btn').innerText = "Decrypting...";

    try {
        // In a real environment, you load the encrypted CSVs here.
        // For scaffold, we simulate loading from Data/FY2027/HR_Data/
        const masterRes = await fetch(`Data/${CURRENT_YEAR}/HR_Data/Staff_Master.csv`);
        const masterText = await masterRes.text();
        const masterData = parseCSV(masterText); // Reusing your existing CSV parser

        // Find employee by CNIC
        const emp = masterData.find(r => String(r.CNIC).replace(/-/g, '') === cnicInput);
        
        if (!emp) {
            throw new Error("CNIC not found in Master File.");
        }

        employeeData = emp;
        
        // Fetch specific data files now that we are authenticated
        await loadEmployeeData();
        
        // Calculate Rules & Render Widgets
        renderDashboard();
        
        // Reveal UI
        document.getElementById('loginGate').style.display = "none";
        document.getElementById('portalDashboard').style.display = "block";

    } catch (err) {
        console.error(err);
        errorMsg.innerText = "Access Denied. CNIC not recognized or data unavailable.";
        errorMsg.style.display = "block";
        document.getElementById('loginGate').querySelector('.login-btn').innerText = "Secure Login →";
    }
}

async function loadEmployeeData() {
    // Scaffold: Fetch the rest of the files from Data/FY2027/HR_Data/
    // allCSVs.pf = parseCSV(await (await fetch(...)).text());
    // allCSVs.advances = parseCSV(await (await fetch(...)).text());
    // allCSVs.tax = parseCSV(await (await fetch(...)).text());
    // allCSVs.cpr = parseCSV(await (await fetch(...)).text());
}

function logout() {
    employeeData = null;
    allCSVs = {};
    document.getElementById('cnicInput').value = "";
    document.getElementById('portalDashboard').style.display = "none";
    document.getElementById('loginGate').style.display = "flex";
    document.getElementById('loginGate').querySelector('.login-btn').innerText = "Secure Login →";
}

// ========================================================================
// 3. HR POLICY BUSINESS LOGIC & RENDERING
// ========================================================================
function renderDashboard() {
    // --- Header ---
    document.getElementById('empNameDisplay').innerText = employeeData.Name || "Employee";
    document.getElementById('empDesignationDisplay').innerText = employeeData.Designation || "Staff";
    document.getElementById('empGradeDisplay').innerText = employeeData.Grade || "-";
    document.getElementById('empJoinDisplay').innerText = employeeData.JoinDate || "-";

    const joinDate = new Date(employeeData.JoinDate);
    const today = new Date();
    const tenureMonths = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());
    const tenureYears = tenureMonths / 12;
    const baseSalary = parseFloat(employeeData.BaseSalary) || 0;
    const grade = parseInt(employeeData.Grade) || 0;

    // --- 1. Provident Fund Rule ---
    // If tenure < 3 months, hide employer portion.
    let pfEmp = 50000; // Mock data from allCSVs.pf
    let pfEmployer = 50000;
    let pfProfit = 12000;

    if (tenureMonths < 3) {
        pfEmployer = 0; // Employer contribution does not vest
        document.getElementById('pfEmployerBox').style.opacity = '0.3';
        document.getElementById('pfEmployerBox').title = "Employer contribution locked during probation.";
    }
    
    let pfTotal = pfEmp + pfEmployer + pfProfit;
    document.getElementById('pfTotal').innerText = pfTotal.toLocaleString();
    document.getElementById('pfEmployee').innerText = pfEmp.toLocaleString();
    document.getElementById('pfEmployer').innerText = pfEmployer.toLocaleString();
    document.getElementById('pfProfit').innerText = pfProfit.toLocaleString();

    // --- 4. Gratuity Rule (Calculating this early for Lease Finance) ---
    // Cliff: 3 years continuous service. Max: 10 years.
    let gratuityAccrued = 0;
    const gratuityCard = document.getElementById('gratuityCard');
    
    // Simulate fetching June 2026 baseline from allCSVs.gratuity
    let baselineGratuity = 150000; 
    let newAccrual = (baseSalary * 0.5) * (tenureYears > 3 ? (tenureYears - 3) : 0); // Simplified for scaffold
    
    gratuityAccrued = baselineGratuity + newAccrual;
    document.getElementById('gratuityTotal').innerText = gratuityAccrued.toLocaleString();

    if (tenureYears < 3) {
        gratuityCard.classList.add('locked-card');
        gratuityCard.innerHTML += `
            <div class="locked-overlay" title="3-Year Vesting Cliff Policy (Section 125)">
                <span style="font-size: 2rem;">🔒</span>
                <span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">Vests in ${Math.ceil((3 - tenureYears)*12)} Months</span>
            </div>
        `;
    }

    // --- 2. Salary Advances Rule ---
    // Max = lower of (5 * base) OR (60% of PF Total)
    let maxAdvRule1 = baseSalary * 5;
    let maxAdvRule2 = pfTotal * 0.60;
    let maxLimit = Math.min(maxAdvRule1, maxAdvRule2);
    
    // Deduct existing active advances
    let activeAdvancesTotal = 0; // Summarize from allCSVs.advances
    let availableLimit = Math.max(0, maxLimit - activeAdvancesTotal);
    document.getElementById('advLimit').innerText = availableLimit.toLocaleString();

    // --- 3. Training Budget Rule ---
    let trainAccrued = 375000; // From allCSVs.training based on Grade
    let trainUtilized = 400000; 
    let trainAvailable = Math.max(0, trainAccrued - trainUtilized);
    let overUtilizedTraining = Math.max(0, trainUtilized - trainAccrued);
    
    document.getElementById('trainAvailable').innerText = trainAvailable.toLocaleString();
    document.getElementById('trainAccrued').innerText = trainAccrued.toLocaleString();
    document.getElementById('trainUtilized').innerText = trainUtilized.toLocaleString();
    
    if (overUtilizedTraining > 0) {
        document.getElementById('trainingWarning').style.display = "block";
        document.getElementById('trainAvailable').innerText = "0";
        document.getElementById('trainAvailable').style.color = "var(--krn-orange)";
    }

    // --- 5. Lease Finance Limit (ManCom Only) ---
    // Rule: LFL = (PF + Gratuity) - (Advances + OverUtilizedTraining)
    const leaseCard = document.getElementById('leaseCard');
    
    if (grade < 8) {
        leaseCard.classList.add('locked-card');
        leaseCard.innerHTML += `
            <div class="locked-overlay" title="Restricted to Grades 8-10 (ManCom)">
                <span style="font-size: 1.5rem;">🔒</span>
                <span style="font-weight: bold; margin-top: 5px; color: var(--text-primary);">ManCom Benefit</span>
            </div>
        `;
    } else {
        let lfl = (pfTotal + gratuityAccrued) - (activeAdvancesTotal + overUtilizedTraining);
        document.getElementById('leaseLimit').innerText = Math.max(0, lfl).toLocaleString();
    }
}

// ========================================================================
// 4. DYNAMIC PDF GENERATION (Section 149 Certificate)
// ========================================================================
function generateTaxPDF() {
    const year = document.getElementById('taxYearSelect').value;
    // In full implementation:
    // 1. Fetch employee's row from allCSVs.tax
    // 2. Cross-reference months with allCSVs.cpr (CPR_Master.csv)
    // 3. Inject data into the hidden #pdfTemplate HTML shell
    // 4. Call html2pdf() to download securely.
    
    alert(`Dynamically generating secure Section 149 PDF for ${employeeData.Name} for ${year} using CPR Master mapping...`);
    
    /* Example html2pdf usage:
    const element = document.getElementById('pdfTemplate');
    const opt = {
        margin:       0.5,
        filename:     `Tax_Certificate_${year}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
    */
}

// Re-use your existing parseCSV function from the main dashboard here.
function parseCSV(text) { /* ... */ }
