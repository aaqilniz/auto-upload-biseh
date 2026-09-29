const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { convertExcelToJson } = require('./excelToJson');
const { uploadToPortal } = require('./uploadPortal');
const { fetchUploadedRecords } = require('./fetchUpload');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'excelFile') {
            cb(null, './');
        } else if (file.fieldname === 'images') {
            const imgDir = path.join(__dirname, 'images');
            if (!fs.existsSync(imgDir)) {
                fs.mkdirSync(imgDir, { recursive: true });
            }
            cb(null, imgDir);
        }
    },
    filename: (req, file, cb) => {
        if (file.fieldname === 'excelFile') {
            cb(null, 'data.xlsx');
        } else {
            cb(null, file.originalname);
        }
    }
});

const upload = multer({ storage });

// API: Parse Excel
app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No Excel file provided.' });
        const excelPath = path.resolve(req.file.path);
        const result = convertExcelToJson(excelPath, 'students.json', 'failed_records.json');
        res.json({
            message: 'Excel parsed successfully.',
            validStudents: result.validStudents,
            failedRecords: result.failedRecords
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Upload Images
app.post('/api/upload-images', upload.array('images', 500), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No images provided.' });
        res.json({ message: `Successfully uploaded ${req.files.length} images to ./images directory.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Execute Portal Upload
app.post('/api/run-upload', async (req, res) => {
    try {
        const executeUpload = req.body.uploadData ?? true;
        const result = await uploadToPortal('students.json', executeUpload);
        res.json({
            message: 'Portal automation complete.',
            successfulRecords: result.successfulRecords,
            failedRecords: result.failedRecords
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Scrape Portal Data
app.get('/api/fetch-records', async (req, res) => {
    try {
        const result = await fetchUploadedRecords('uploaded_records.json');
        res.json({ message: 'Portal records scraped successfully.', records: result.records });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Route: Single Record Upload
app.post('/api/upload-single', async (req, res) => {
    try {
        const { grNumber } = req.body;
        if (!grNumber) return res.status(400).json({ error: 'GR Number is required.' });

        const students = readJsonFile('students.json');
        const targetStudent = students.find(s => String(s.grNumber) === String(grNumber));

        if (!targetStudent) {
            return res.status(404).json({ error: `Student with GR# ${grNumber} not found in processed data.` });
        }

        // Run upload for the single target record
        const result = await uploadToPortal([targetStudent], true);

        if (result.successfulRecords.includes(String(grNumber))) {
            // Append uploaded GR to uploaded_records.json locally so UI updates immediately
            const uploadedRecords = readJsonFile('uploaded_records.json');
            if (!uploadedRecords.some(r => String(r.grNumber) === String(grNumber))) {
                uploadedRecords.push({ grNumber: targetStudent.grNumber, studentName: targetStudent.name });
                fs.writeFileSync(path.resolve('uploaded_records.json'), JSON.stringify(uploadedRecords, null, 2));
            }

            res.json({ message: `Successfully uploaded GR# ${grNumber} to portal.` });
        } else {
            res.status(500).json({ error: `Failed to upload GR# ${grNumber}. Check logs for details.` });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to safely read JSON files
const readJsonFile = (filePath) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
    } catch {
        return [];
    }
};

// Data Retrieval Endpoints for Tables
app.get('/api/data/processed', (req, res) => res.json(readJsonFile('students.json')));
app.get('/api/data/uploaded', (req, res) => res.json(readJsonFile('uploaded_records.json')));
app.get('/api/data/failed', (req, res) => res.json(readJsonFile('failed_records.json')));

app.listen(PORT, () => {
    console.log(`🚀 BISE Automation UI running at http://localhost:${PORT}`);
});