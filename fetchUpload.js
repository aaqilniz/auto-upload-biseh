const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { chromium } = require('playwright');

/**
 * Log in to the BISE portal and extract all rows from the Enrollments table.
 */
async function fetchUploadedRecords(outputPath = 'uploaded_records.json') {
    const headless = false; // Set to true if you don't need visual debugging
    const browser = await chromium.launch({ headless, slowMo: 50 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    try {
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

        // Navigate to the Enrollments Index table page
        console.log('⟳ Navigating to Enrollments Index...');
        await page.goto('https://online.bisehyd.edu.pk/Enrollments/Index', { waitUntil: 'networkidle' });

        // Wait for table initialization
        await page.waitForSelector('table.dataTable', { timeout: 15000 });

        // Expand DataTable page size to show all rows if menu is available
        const lengthSelect = page.locator('select[name$="_length"]');
        if (await lengthSelect.count() > 0) {
            console.log('⟳ Changing table length menu to "All"...');
            await lengthSelect.selectOption('-1');
            await page.waitForTimeout(2000); // Allow DOM redraw
        }

        console.log('⟳ Scraping table data...');

        // Scrape table content from the DOM
        const records = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table.dataTable tbody tr'));

            return rows.map((row) => {
                const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
                if (cells.length < 10) return null; // Skip empty/loading indicator rows

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
                    cnic: cells[11] || null,
                    status: cells[12] || null,
                    challanNo: cells[13] || null,
                    fee: cells[14] || null,
                    createdDate: cells[15] || null
                };
            }).filter(Boolean);
        });

        // Save entire table output
        const absoluteOutputPath = path.resolve(outputPath);
        fs.writeFileSync(absoluteOutputPath, JSON.stringify(records, null, 2), 'utf-8');

        // Extract clean list of GR numbers
        const grNumbers = records.map((r) => r.grNumber).filter(Boolean);

        console.log(`\n✓ Extracted ${records.length} records.`);
        console.log(`- Full data written to: ${absoluteOutputPath}`);
        console.log(`- Found ${grNumbers.length} GR numbers uploaded on the portal.`);

        return { records, grNumbers };
    } finally {
        await browser.close();
    }
}

module.exports = { fetchUploadedRecords };