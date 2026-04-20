const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const USER_DATA_DIR = path.join(__dirname, 'browser-data');

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

let context = null;
let page = null;
let isInitializing = false;
let initError = null;

async function initBrowser() {
    if (page) return { success: true };
    if (isInitializing) return { success: false, message: 'Already initializing...' };
    
    isInitializing = true;
    initError = null;
    
    const hasSession = fs.existsSync(path.join(USER_DATA_DIR, 'Default', 'Cookies'));
    const isFirstRun = !hasSession;
    
    try {
        console.log('Launching browser...');
        console.log(isFirstRun ? 'First run - browser will be visible for sign-in' : 'Using saved session');
        
        context = await chromium.launchPersistentContext(USER_DATA_DIR, {
            headless: !isFirstRun,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });
        
        const pages = context.pages();
        page = pages.length > 0 ? pages[0] : await context.newPage();
        
        console.log('Loading page...');
        if (isFirstRun) {
            console.log('>>> Please sign in to Google in the browser window <<<');
        }
        
        await page.goto('https://labs.google/fx/tools/flow', { 
            waitUntil: 'networkidle',
            timeout: 120000
        });
        
        if (isFirstRun) {
            console.log('Waiting for sign-in...');
            
            let attempts = 0;
            const maxAttempts = 60;
            
            while (attempts < maxAttempts) {
                const url = page.url();
                
                if (url.includes('labs.google/fx')) {
                    const hasRecaptcha = await page.evaluate(() => {
                        return !!(window.grecaptcha && window.grecaptcha.enterprise);
                    }).catch(() => false);
                    
                    if (hasRecaptcha) {
                        console.log('Sign-in complete!');
                        break;
                    }
                }
                
                await page.waitForTimeout(2000);
                attempts++;
                
                if (attempts % 10 === 0) {
                    console.log(`Waiting... (${attempts * 2}s)`);
                }
            }
            
            if (attempts >= maxAttempts) {
                throw new Error('Timeout waiting for sign-in');
            }
        } else {
            console.log('Loading...');
            await page.waitForFunction(() => {
                return window.grecaptcha && window.grecaptcha.enterprise;
            }, { timeout: 60000 });
        }
        
        console.log('Session ready!');
        
        if (isFirstRun) {
            console.log('Switching to headless mode...');
            await context.close();
            context = null;
            page = null;
            
            console.log('');
            console.log('✓ You can now open http://localhost:3000 in your browser.');
            console.log('');
            
            context = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ],
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 800 }
            });
            
            const pages = context.pages();
            page = pages.length > 0 ? pages[0] : await context.newPage();
            
            await page.goto('https://labs.google/fx/tools/flow', { 
                waitUntil: 'networkidle',
                timeout: 60000
            });
            
            console.log('Ready.');
        }
        
        isInitializing = false;
        return { success: true };
    } catch (error) {
        console.error('Error:', error.message);
        initError = error.message;
        isInitializing = false;
        
        if (!isFirstRun && context) {
            await context.close().catch(() => {});
            context = null;
            page = null;
        }
        
        return { success: false, error: error.message };
    }
}

app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, aspectRatio = 'IMAGE_ASPECT_RATIO_LANDSCAPE' } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!page) {
            await initBrowser();
        }

        console.log(`Generating: "${prompt}"`);

        const currentUrl = page.url();
        
        if (!currentUrl.includes('labs.google/fx/tools/flow') && !currentUrl.includes('/project/')) {
            await page.goto('https://labs.google/fx/tools/flow', { 
                waitUntil: 'networkidle',
                timeout: 60000 
            });
        }

        await page.screenshot({ path: 'debug-screenshot.png' });

        const signInButton = await page.$('button:has-text("Sign in"), a:has-text("Sign in")');
        if (signInButton) {
            throw new Error('Session expired. Delete browser-data folder and restart.');
        }

        if (currentUrl.includes('/project/')) {
            console.log('Using existing project...');
        } else {
            console.log('Creating new project...');
            
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000);
            
            let newProjectButton = null;
            const btnSelectors = [
                'button:has-text("New project")',
                'a:has-text("New project")',
                '[aria-label*="New project"]',
                '[aria-label*="new project"]',
                'button:has-text("New")',
                '[data-testid*="new"]'
            ];
            
            for (const selector of btnSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn && await btn.isVisible()) {
                        newProjectButton = btn;
                        break;
                    }
                } catch (e) {}
            }
            
            if (!newProjectButton) {
                await page.screenshot({ path: 'debug-no-button.png' });
                throw new Error('Could not find New project button. Check debug-no-button.png');
            }
            
            await newProjectButton.click();
            await page.waitForURL(/\/project\//, { timeout: 30000 });
        }
        
        await page.waitForTimeout(2000);

        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Generation timeout')), 120000);
            
            const handler = async (response) => {
                const url = response.url();
                if (url.includes('batchGenerateImages')) {
                    try {
                        const json = await response.json();
                        if (json.media && json.media.length > 0) {
                            clearTimeout(timeout);
                            page.off('response', handler);
                            resolve(json);
                        }
                    } catch (e) {}
                }
            };
            page.on('response', handler);
        });

        await page.screenshot({ path: 'debug-screenshot.png' });

        let promptInput = await page.waitForSelector('div[contenteditable="true"]:not([aria-hidden="true"])', { timeout: 10000 });
        
        if (!promptInput) {
            throw new Error('Could not find prompt input');
        }

        await promptInput.click();
        await page.keyboard.type(prompt);
        
        await page.waitForTimeout(500);
        
        let generateButton = null;
        const genBtnSelectors = [
            'button[aria-label*="Generate"]',
            'button[aria-label*="Create"]', 
            'button:has-text("Generate")',
            'button:has(svg)',
        ];
        
        for (const selector of genBtnSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn && await btn.isVisible()) {
                    generateButton = btn;
                    break;
                }
            } catch (e) {}
        }
        
        if (!generateButton) {
            await page.keyboard.press('Enter');
        } else {
            await generateButton.click();
        }
        
        console.log('Generating...');

        const result = await responsePromise;

        const images = result.media?.map(m => ({
            id: m.name,
            url: m.image?.generatedImage?.fifeUrl,
            prompt: m.image?.generatedImage?.prompt,
            seed: m.image?.generatedImage?.seed
        })) || [];

        console.log(`Done! ${images.length} image(s)`);
        res.json({ success: true, images });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        browserReady: !!(page && !isInitializing),
        isInitializing,
        error: initError
    });
});

app.post('/api/init', async (req, res) => {
    try {
        const result = await initBrowser();
        if (result.success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, error: result.error || result.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

process.on('SIGINT', async () => {
    if (context) await context.close();
    process.exit();
});

app.listen(PORT, async () => {
    console.log(`Server: http://localhost:${PORT}`);
    
    const result = await initBrowser();
    if (result.success) {
        console.log('✓ Ready!');
    } else {
        console.log('✗ Init failed:', result.error);
    }
});
