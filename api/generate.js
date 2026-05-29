const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { email, password, consignmentId } = req.body;

    if (!email || !password || !consignmentId) {
        return res.status(400).json({ error: 'Missing email, password, or consignmentId in request body.' });
    }

    let browser = null;

    try {
        console.log(`Starting PDF generation for ${consignmentId}`);
        
        // This setup is required to run Puppeteer on Vercel Serverless Functions
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        console.log("Navigating to login page...");
        await page.goto('https://www.steadfast.com.bd/login', { waitUntil: 'networkidle2' });

        // Fill login details
        await page.waitForSelector('input[type="email"], input[name="email"]');
        const emailInput = await page.$('input[type="email"]') || await page.$('input[name="email"]');
        await emailInput.type(email);
        
        await page.waitForSelector('input[type="password"], input[name="password"]');
        const passInput = await page.$('input[type="password"]') || await page.$('input[name="password"]');
        await passInput.type(password);
        
        console.log("Submitting login...");
        const submitBtn = await page.$('button[type="submit"]') || await page.$('button:not([type="button"])');
        
        const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(e => console.log('Login nav timeout'));

        if (submitBtn) {
            await submitBtn.click();
        } else {
            await page.keyboard.press('Enter');
        }

        await navPromise;

        // Navigate to invoice
        const invoiceUrl = `https://www.steadfast.com.bd/user/consignment/invoice/${consignmentId}`;
        console.log("Navigating to invoice: " + invoiceUrl);
        await page.goto(invoiceUrl, { waitUntil: 'networkidle0' });

        await new Promise(resolve => setTimeout(resolve, 2000)); // wait for renders

        // DOM Manipulation (same as your original bot)
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a, .btn'));
            buttons.forEach(btn => { btn.remove(); });

            const headers = Array.from(document.querySelectorAll('header, nav, footer, .sidebar, .navbar, .topbar, .main-header, .page-title, .breadcrumb, .app-header'));
            headers.forEach(el => { el.remove(); });

            const elements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, b, strong, span, div, p'));
            let shipToEl = elements.find(el => el.textContent.trim().startsWith('Ship To') && el.children.length === 0);
            if (!shipToEl) {
                shipToEl = elements.find(el => el.textContent.trim().includes('Ship To'));
            }

            if (shipToEl) {
                let container = shipToEl.closest('.row') || shipToEl.closest('table') || shipToEl.parentElement.parentElement;
                
                if (container) {
                    let prevSibling = container.previousElementSibling;
                    while (prevSibling) {
                        let toRemove = prevSibling;
                        prevSibling = prevSibling.previousElementSibling;
                        toRemove.remove();
                    }
                    
                    let parent = container.parentElement;
                    while (parent && parent !== document.body) {
                        let pPrevSibling = parent.previousElementSibling;
                        while (pPrevSibling) {
                            let toRemove = pPrevSibling;
                            pPrevSibling = pPrevSibling.previousElementSibling;
                            toRemove.remove();
                        }
                        parent = parent.parentElement;
                    }

                    let p = container.parentElement;
                    while (p && p !== document.body) {
                        p.style.marginTop = '0';
                        p.style.paddingTop = '0';
                        p = p.parentElement;
                    }
                }
            }

            const noteElements = Array.from(document.querySelectorAll('*')).filter(el => 
                el.children.length === 0 && el.textContent && 
                el.textContent.toLowerCase().includes('note') && el.textContent.toLowerCase().includes('admin')
            );
            noteElements.forEach(el => {
                let targetToRemove = el.closest('p') || el.closest('div[class*="note"]') || el;
                targetToRemove.remove();
            });
        });

        // Generate PDF Buffer
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });

        console.log("PDF generated successfully!");

        // Send PDF back in response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${consignmentId}.pdf`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generating PDF:", error);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
};
