const express = require('express');
const multer = require('multer');
const path = require('path');
const { convertExcelToJson } = require('./excelToJson');
const { uploadToPortal } = require('./uploadPortal');
const { fetchUploadedRecords } = require('./fetchUpload');
const fs = require('fs');
const UPLOADS_DIR = path.join(__dirname, 'images');
const app = express();
const PORT = process.env.PORT || 3005;
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'images')));

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
        const studentRecordsPath = path.resolve('students.json');
        const allStudents = JSON.parse(fs.readFileSync(studentRecordsPath, 'utf-8'));
        const result = await uploadToPortal('students.json', executeUpload);

        const successfullGrs = result.successfulRecords;
        const successfullStudents = [];
        allStudents.forEach(student => {
            if (successfullGrs.includes(student.grNumber)) {
                successfullStudents.push({ grNumber: student.grNumber, studentName: student.name });
            }
        })
        if (successfullStudents.length) {
            // Append uploaded GR to uploaded_records.json locally so UI updates immediately
            fs.writeFileSync(path.resolve('uploaded_records.json'), JSON.stringify(successfullStudents, null, 2));
        }
        res.json({
            message: 'Portal automation complete.',
            successfulRecords: result.successfulRecords,
            failedRecords: result.failedRecords
        })
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Route: Scrape records from portal
app.get('/api/fetch-records', async (req, res) => {
    try {
        const { username, password, session } = req.query;

        // Ensure provided credentials take precedence
        const result = await fetchUploadedRecords({
            username: username || process.env.BISE_USERNAME,
            password: password || process.env.BISE_PASSWORD,
            session: session || process.env.BISE_SESSION
        });

        res.json(result);
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

// GET /api/images - List all uploaded image filenames
app.get('/api/images', (req, res) => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
        if (err) {
            if (err.code === 'ENOENT') return res.json([]);
            return res.status(500).json({ error: 'Failed to read uploads directory' });
        }

        // Filter out non-image files if needed
        const imageFiles = files.filter(file =>
            /\.(jpg|jpeg|png|webp|gif)$/i.test(file)
        );

        res.json(imageFiles);
    });
});

// DELETE /api/images/:filename - Delete a specific image
app.delete('/api/images/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // prevent directory traversal
    const filePath = path.join(UPLOADS_DIR, filename);

    fs.unlink(filePath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return res.status(404).json({ error: 'Image file not found' });
            }
            return res.status(500).json({ error: 'Failed to delete image' });
        }
        res.json({ message: `Image ${filename} deleted successfully` });
    });
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