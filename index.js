require('dotenv').config(); // Load environment variables from .env file
const path = require('path');
const { convertExcelToJson } = require('./excelToJson');
const { uploadToPortal } = require('./uploadPortal');
const { fetchUploadedRecords } = require('./fetchUpload');

async function main() {
    const args = process.argv.slice(2);
    const isUpload = args.includes('--upload');
    const isFetch = args.includes('--fetch');
    console.log(args, isFetch);

    if (isFetch) {
        console.log('🚀 Fetching Uploaded Table Data from Portal...');
        try {
            await fetchUploadedRecords('uploaded_records.json');
        } catch (err) {
            console.error('❌ Fetch failed:', err.message);
            process.exit(1);
        }
    } else if (isUpload) {
        console.log('🚀 Running Portal Uploader...');
        try {
            const result = await uploadToPortal('students.json', true);
            console.log(`\n✓ Upload execution complete.`);
            console.log(`- Successfully uploaded: ${result.successfulRecords.length}`);
            console.log(`- Failed uploads: ${result.failedRecords.length}`);
        } catch (err) {
            console.error('❌ Upload process failed:', err.message);
            process.exit(1);
        }
    } else {
        console.log('🔄 Running Excel Converter...');
        try {
            const excelArg = args.find((arg) => !['upload', 'fetch'].includes(arg) && /\.(xlsx|xls)$/i.test(arg)) || 'data.xlsx';
            const excelPath = path.resolve(excelArg);
            convertExcelToJson(excelPath, 'students.json', 'failed_records.json');
            
            console.log(`\n✓ Ready for portal upload.`);
            console.log(`Run "node index.js upload" to start uploading records.`);
        } catch (err) {
            console.error('❌ Conversion process failed:', err.message);
            process.exit(1);
        }
    }
}

main();