const fs = require('fs');
const path = require('path');
const xlsx = require('node-xlsx').default;
require('dotenv').config();
const DEFAULT_MEDIUM_OF_ANSWER = '3'; // 1 English, 2 Urdu, 3 Sindhi

// Utility to format Date objects or strings to DD/MM/YYYY
const formatDate = (dateVal) => {
    if (!dateVal) return null;
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return null;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// Utility to format 13-digit CNIC/NADRA IDs with hyphens
const formatCnic = (cnic) => {
    if (cnic && !cnic.includes('-') && cnic.length === 13) {
        return `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`;
    }
    return cnic;
};

/**
 * Converts Excel records into structured JSON files.
 */
function convertExcelToJson(excelFilePath, outputValidPath = 'students.json', outputFailedPath = 'failed_records.json') {
    const absoluteExcelPath = path.resolve(excelFilePath);

    if (!fs.existsSync(absoluteExcelPath)) {
        throw new Error(`Excel file not found at path: ${absoluteExcelPath}`);
    }

    console.log(`\n⟳ Parsing Excel data from: ${absoluteExcelPath}...`);
    const enrollmentData = xlsx.parse(absoluteExcelPath, { cellDates: true });
    const allRecords = enrollmentData[0]['data'];

    const validStudents = [];
    const failedRecords = [];

    for (let i = 1; i < allRecords.length; i++) {
        const record = allRecords[i];
        if (!record || record.length === 0) continue;

        const currentClass = record[14];
        const remarks = record[16];
        if (currentClass !== 'IX' || remarks === 'Relieved') continue; // Process Currently Studying Class IX records only

        const grNumber = record[1] ? record[1].toString().trim() : null;

        const rawStudent = {
            grNumber,
            name: record[2] ? String(record[2]).trim() : null,
            fatherName: record[3] ? String(record[3]).trim() : null,
            religion: record[4] ? String(record[4]).trim() : null,
            surname: record[5] ? String(record[5]).trim() : null,
            address: record[6] ? String(record[6]).trim() : null,
            dateOfBirth: formatDate(record[7]),
            dateOfAdmission: formatDate(record[12]),
            studentNadraId: (record[17] || '').toString().trim(),
            parentCnic: (record[18] || '').toString().trim(),
            phoneNumber: (record[19] || '').toString().trim(),
            gender: record[22] ? String(record[22]).trim() : null,
            mediumOfAnswer: record[23] ? String(record[23]).trim() : DEFAULT_MEDIUM_OF_ANSWER
        };

        const reasons = [];
        if (!rawStudent.grNumber) reasons.push('GR Number');
        if (!rawStudent.name) reasons.push('Student Name');
        if (!rawStudent.fatherName) reasons.push("Student Father Name");
        if (!rawStudent.surname) reasons.push('Surname');
        if (!rawStudent.religion) reasons.push('Religion');
        if (!rawStudent.address) reasons.push('Address');
        if (!rawStudent.dateOfBirth) reasons.push('Date of Birth');
        if (!rawStudent.dateOfAdmission) reasons.push('Date of Admission');
        if (!rawStudent.gender) reasons.push('Gender');
        if (!rawStudent.studentNadraId) reasons.push("B Form");

        // Verify image presence relative to working execution folder
        const imageFilePath = path.resolve(__dirname, 'images', `${rawStudent.grNumber}.jpg`);
        if (rawStudent.grNumber && !fs.existsSync(imageFilePath)) {
            reasons.push('Image');
        }

        if (reasons.length > 0) {
            failedRecords.push({
                grNumber: grNumber || `row-${i + 1}`,
                name: rawStudent.name,
                fatherName: rawStudent.fatherName,
                surname: rawStudent.surname,
                gender: rawStudent.gender,
                reasons });
            continue;
        }

        // Apply transformations for verified records
        rawStudent.parentCnic = formatCnic(rawStudent.parentCnic);
        rawStudent.studentNadraId = formatCnic(rawStudent.studentNadraId);

        if (!rawStudent.phoneNumber.startsWith('0') && rawStudent.phoneNumber.length === 10) {
            rawStudent.phoneNumber = `0${rawStudent.phoneNumber}`;
        }

        rawStudent.imageFilePath = imageFilePath;
        validStudents.push(rawStudent);
    }

    fs.writeFileSync(path.resolve(outputValidPath), JSON.stringify(validStudents, null, 2), 'utf-8');
    fs.writeFileSync(path.resolve(outputFailedPath), JSON.stringify(failedRecords, null, 2), 'utf-8');

    console.log(`✓ Conversion complete.`);
    console.log(`- Valid records written to: ${outputValidPath} (${validStudents.length})`);
    console.log(`- Failed validation records written to: ${outputFailedPath} (${failedRecords.length})`);

    return { validStudents, failedRecords };
}

// Execute directly if run as a CLI script: node excelToJson.js <path_to_excel>
if (require.main === module) {
    const inputExcel = process.argv[2] || 'data.xlsx';
    try {
        convertExcelToJson(inputExcel);
    } catch (err) {
        console.error('❌ Conversion failed:', err.message);
        process.exit(1);
    }
}

module.exports = { convertExcelToJson };
