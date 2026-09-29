const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config();
const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration || 10000));

/**
 * Reads JSON file and uploads data using Playwright.
 */
async function uploadToPortal(jsonFilePathOrArray = 'students.json', uploadData = false) {
    let validStudents = [];

    if (Array.isArray(jsonFilePathOrArray)) {
        validStudents = jsonFilePathOrArray;
    } else {
        const absoluteJsonPath = path.resolve(jsonFilePathOrArray);
        if (!fs.existsSync(absoluteJsonPath)) {
            throw new Error(`JSON data file not found at: ${absoluteJsonPath}`);
        }
        validStudents = JSON.parse(fs.readFileSync(absoluteJsonPath, 'utf-8'));
        console.log(`\n⟳ Loaded ${validStudents.length} student records from ${absoluteJsonPath}`);
    }

    const headless = false;
    const browser = await chromium.launch({ headless, slowMo: 50 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const failedRecords = [];
    const successfulRecords = [];

    try {
        const page = await context.newPage();

        await page.addInitScript(() => {
            window.alert = (message) => console.log('Intercepted window.alert:', message);
        });

        page.on('dialog', async (dialog) => {
            console.log(`Native dialog popped up: "${dialog.message()}" -> Accepting`);
            await dialog.accept();
        });

        console.log('⟳ Navigating to BISE Hyderabad login page...');
        await page.goto('https://online.bisehyd.edu.pk/Account/Login?ReturnUrl=%2F');

        await page.fill('input[name="email"]', process.env.BISE_USERNAME || 'your_username');
        await page.fill('input[name="password"]', process.env.BISE_PASSWORD || 'your_password');

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"], input[type="submit"]')
        ]);
        console.log('✓ Logged in successfully.');

        // Handle session selection safely whether it auto-submits on change or requires button click
        await page.selectOption('#session', '2027');

        // Check if a submit button exists inside the session form/container and click it if page hasn't navigated
        const sessionSubmitBtn = page.locator('#session').locator('xpath=./ancestor::form//button[@type="submit"] | ./ancestor::form//input[@type="submit"]');

        if (await sessionSubmitBtn.count() > 0 && await sessionSubmitBtn.isVisible()) {
            await Promise.all([
                page.waitForLoadState('networkidle').catch(() => { }),
                sessionSubmitBtn.click({ force: true })
            ]);
        } else {
            // If no submit button, allow network idle for auto-submit/AJAX navigation
            await page.waitForLoadState('networkidle');
        }

        console.log('✓ Session selected.');

        // Navigate to Enrollment
        console.log('⟳ Navigating to Enrollment Form...');
        await page.locator('a.dropdown-toggle', { hasText: 'Enrollment' }).click();
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.getByText('SSC-I Science (Bio/Computer)').click()
        ]);
        console.log('✓ Enrollment form loaded successfully.');

        for (let i = 0; i < validStudents.length; i++) {
            const student = validStudents[i];
            try {
                await page.fill('#sName', student.name);
                await page.fill('#fatherName', student.fatherName);
                await page.fill('#surname', student.surname);

                // Date of Birth
                const dobInput = page.locator('#dob');
                await dobInput.focus();
                await dobInput.clear();
                await page.keyboard.type(student.dateOfBirth, { delay: 50 });
                await page.keyboard.press('Tab');

                await page.fill('#Cnic', student.studentNadraId);
                await page.fill('#grNumber', student.grNumber);

                // Gender
                const genderVal = student.gender.toLowerCase() === 'g' ? 'Female' : 'Male';
                await page.locator(`input[name="rdoGender"][value="${genderVal}"]`).check();

                await page.fill('#cell', student.phoneNumber);
                await page.selectOption('#MOAID', { value: student.mediumOfAnswer });
                await page.fill('#address', student.address);

                // Religion
                const religionID = ['islam', 'muslim'].includes(student.religion.toLowerCase()) ? '1' : '2';
                await page.selectOption('#religionID', { value: religionID });

                // Date of Admission
                const dtAdmissionInput = page.locator('#dtAdmission');
                await dtAdmissionInput.focus();
                await dtAdmissionInput.clear();
                await page.keyboard.type(student.dateOfAdmission, { delay: 50 });
                await page.keyboard.press('Tab');

                // Image Upload
                await page.locator('#imgfile').setInputFiles(student.imageFilePath);

                // Subject Selection
                await page.selectOption('#mediumID', { value: '3' }); // 3 Sindhi
                await page.selectOption('#religionSubjectID', { value: '1' }); // 1 Islamiyat
                await page.selectOption('#subjectTemplateID', { value: '1' }); // 1 Biology
                await delay(3000);

                let isSuccess = false;
                if (uploadData) {
                    const dialogHandler = async (dialog) => {
                        console.log(`Dialog prompt popped up: "${dialog.message()}" -> Accepting`);
                        await dialog.accept();
                    };
                    page.once('dialog', dialogHandler);
                    await page.$eval('#btn-create', (el) => el.click());
                    await delay(5000);
                    await page.click('#btn-create', { force: true });
                    const successMsg = page.locator('p.msg-success:has-text("Enrollment Created Sucessfully")');
                    try {
                        await successMsg.waitFor({ state: 'visible', timeout: 5000 });
                        await page.getByRole('button', { name: 'Ok' }).click();
                        isSuccess = true;
                    } catch {
                        isSuccess = false;
                    }
                } else {
                    await delay(10000);
                    await page.reload({ waitUntil: 'networkidle' });
                }

                if (isSuccess) {
                    console.log(`✓ Processed record ${i + 1}/${validStudents.length} for GR# ${student.grNumber}`);
                    successfulRecords.push(student.grNumber);
                } else {
                    console.error(`❌ Failed to process record ${i + 1}/${validStudents.length} for GR# ${student.grNumber}`);
                    failedRecords.push({
                        grNumber: student.grNumber,
                        reasons: ['Enrollment creation failed or success message not detected']
                    });
                    await page.reload({ waitUntil: 'networkidle' });
                }
            } catch (recordError) {
                console.error(`❌ Error processing record GR# ${student.grNumber}:`, recordError.message);
                failedRecords.push({
                    grNumber: student.grNumber,
                    reasons: [`Browser error: ${recordError.message}`]
                });

                try {
                    await page.reload({ waitUntil: 'networkidle' });
                } catch (reloadError) {
                    console.error('Failed to reload page following record error:', reloadError.message);
                    break;
                }
            }
        }
    } finally {
        console.log('\n⟳ Closing browser...');
        await browser.close();
    }

    return { successfulRecords, failedRecords };
}

// Execute directly if run as a CLI script: node uploadPortal.js
if (require.main === module) {
    const uploadMode = process.argv.includes('--upload');
    uploadToPortal('students.json', uploadMode).catch((err) => {
        console.error('❌ Upload process failed:', err.message);
        process.exit(1);
    });
}

module.exports = { uploadToPortal };