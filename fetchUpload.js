const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function fetchUploadedRecords(config = {}, outputPath = 'uploaded_records.json') {
    const {
        username = process.env.BISE_USERNAME || '424699',
        password = process.env.BISE_PASSWORD || '424699',
        session = process.env.BISE_SESSION || String(new Date().getFullYear() + 1),
    } = config;
    const headless = false;
    const browser = await chromium.launch({
        headless,
        slowMo: 50
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    try {
        // 1. Initial Login
        console.log('⟳ Navigating to BISE Hyderabad login page...');
        await page.goto('https://online.bisehyd.edu.pk/Account/Login?ReturnUrl=%2F');

        await page.fill('input[name="email"]', username);
        await page.fill('input[name="password"]', password);

        console.log('⟳ Submitting login form...');
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForTimeout(3000); // Allow login redirect to process

        console.log('✓ Logged in successfully. Current URL:', page.url());

        // 2. Direct navigation to SetupSession page
        console.log('⟳ Navigating directly to /Home/SetupSession...');
        await page.goto('https://online.bisehyd.edu.pk/Home/SetupSession');

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
        console.log(`✓ Session set to ${session}.`);

        // 3. Direct navigation to Enrollments Index
        console.log('⟳ Manually navigating to Enrollments Index...');
        await page.goto('https://online.bisehyd.edu.pk/Enrollments/Index');

        console.log('⟳ Waiting for table data...');
        await page.waitForSelector('#DataTables_Table_0, table.dataTable', { timeout: 30000 });
        await page.waitForTimeout(2000);

        // 4. Expand DataTable length menu to "All"
        const lengthSelect = page.locator('select[name$="_length"]');
        if (await lengthSelect.count() > 0) {
            console.log('⟳ Changing table length menu to "All"...');
            await lengthSelect.selectOption('-1');
            await page.waitForTimeout(1500);
        }

        console.log('⟳ Scraping table data...');
        const records = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#DataTables_Table_0 tbody tr, table.dataTable tbody tr'));

            return rows.map((row) => {
                const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
                if (cells.length < 10) return null;

                return {
                    studentName: cells[1] || null,
                    fatherName: cells[2] || null,
                    surname: cells[3] || null,
                    gender: cells[4] || null,
                    isRegular: cells[5] || null,
                    birthDate: cells[7] || null,
                    enrollmentNo: cells[8] || null,
                    grNumber: cells[9] || null,
                    serialNo: cells[10] || null,
                    cnic: cells[11] || cells[6] || null,
                    status: cells[12] || 'Uploaded',
                    challanNo: cells[13] || null,
                    fee: cells[14] || null,
                    createdDate: cells[15] || null
                };
            }).filter(Boolean);
        });

        const absoluteOutputPath = path.resolve(outputPath);
        fs.writeFileSync(absoluteOutputPath, JSON.stringify(records, null, 2), 'utf-8');

        const grNumbers = records.map((r) => r.grNumber).filter(Boolean);

        console.log(`✓ Extracted ${records.length} records.`);
        console.log(`- Data saved to: ${absoluteOutputPath}`);

        return { records, grNumbers };

    } catch (error) {
        console.error('❌ Scraper failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

module.exports = { fetchUploadedRecords };