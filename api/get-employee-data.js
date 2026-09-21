const fs = require('fs');
const path = require('path');

function parseCSV(text) {
    let objects = [];
    let inQuotes = false;
    let currentRow = [];
    let currentCell = '';
    
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        let nextChar = text[i+1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentCell += '"'; i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell.trim());
            if (currentRow.join('').trim() !== '') objects.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    currentRow.push(currentCell.trim());
    if (currentRow.join('').trim() !== '') objects.push(currentRow);
    
    if (objects.length < 2) return [];
    
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

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { cnic } = req.body || {};
        if (!cnic || cnic.length < 13) {
            return res.status(400).json({ error: 'Valid CNIC required.' });
        }

        const cleanCnic = String(cnic).replace(/[^0-9]/g, '');
        const CURRENT_YEAR = 'FY2027';
        const baseDir = path.join(process.cwd(), 'Data', CURRENT_YEAR, 'HR_Data');

        const readFile = (filename) => {
            const filePath = path.join(baseDir, filename);
            if (!fs.existsSync(filePath)) return [];
            const content = fs.readFileSync(filePath, 'utf-8');
            return parseCSV(content);
        };

        const masterData = readFile('Staff_Master.csv');
        const emp = masterData.find(r => {
            let cnicKey = Object.keys(r).find(k => k.includes('cnic'));
            if (!cnicKey) return false;
            return String(r[cnicKey]).replace(/[^0-9]/g, '') === cleanCnic;
        });

        if (!emp) {
            return res.status(404).json({ error: 'CNIC not found in Master Records.' });
        }

        let empCodeKey = Object.keys(emp).find(k => k === 'employeecode' || k === 'empcode');
        let empCode = empCodeKey ? String(emp[empCodeKey]).trim() : null;

        const matchCode = (r) => {
            if (!r) return false;
            let cleanKey = Object.keys(r).find(k => k === 'employeecode' || k === 'empcode' || k === 'code');
            return cleanKey ? String(r[cleanKey]).trim() === empCode : false;
        };

        const pfData = readFile('PF.csv');
        const advData = readFile('Advances.csv');
        const trainData = readFile('Training.csv');
        const gratData = readFile('Gratuity.csv');
        const taxData = readFile('Tax.csv');
        const cprData = readFile('CPR_Master.csv');

        return res.status(200).json({
            emp: emp,
            myPF: pfData.find(matchCode) || {},
            myAdvances: advData.filter(matchCode) || [],
            myTraining: trainData.find(matchCode) || {},
            myGratuity: gratData.find(matchCode) || {},
            myTax: taxData.find(matchCode) || {},
            cprMaster: cprData
        });

    } catch (err) {
        return res.status(500).json({ error: `Server Error: ${err.message}` });
    }
};
