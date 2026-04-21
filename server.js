const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const USER_DATA_DIR = path.join(__dirname, 'browser-data');
const COOKIE_FILE = path.join(__dirname, 'google-cookie.txt');

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

let context = null;
let page = null;
let isInitializing = false;
let initError = null;
let imageFX = null;

async function extractAndSaveCookies() {
    if (!context) throw new Error('Browser not initialized');
    
    const labsCookies = await context.cookies('https://labs.google');
    const googleCookies = await context.cookies('https://google.com');
    const accountsCookies = await context.cookies('https://accounts.google.com');
    const apisCookies = await context.cookies('https://googleapis.com');
    
    const allCookies = [...labsCookies, ...googleCookies, ...accountsCookies, ...apisCookies];
    
    const uniqueCookies = {};
    allCookies.forEach(c => {
        uniqueCookies[c.name] = c.value;
    });
    
    const cookieString = Object.entries(uniqueCookies).map(([k, v]) => `${k}=${v}`).join('; ');
    
    fs.writeFileSync(COOKIE_FILE, cookieString);
    console.log(`Cookies saved (${Object.keys(uniqueCookies).length} cookies)`);
    
    return cookieString;
}

async function initImageFX() {
    const { ImageFX } = await import('@rohitaryal/imagefx-api');
    
    let cookieString;
    if (fs.existsSync(COOKIE_FILE)) {
        cookieString = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
    } else {
        cookieString = await extractAndSaveCookies();
    }
    
    imageFX = new ImageFX(cookieString);
    console.log('ImageFX initialized with cookies');
}

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
        
        await page.goto('https://labs.google/fx/tools/image-fx', { 
            waitUntil: 'networkidle',
            timeout: 120000
        });
        
        if (isFirstRun) {
            console.log('Waiting for sign-in...');
            console.log('(Browser will stay open until you sign in and the page loads)');
            
            let attempts = 0;
            const maxAttempts = 150;
            
            while (attempts < maxAttempts) {
                const url = page.url();
                
                if (url.includes('labs.google/fx')) {
                    const isSignedIn = await page.evaluate(() => {
                        const noSignInBtn = !document.body.innerText.includes('Sign in');
                        return noSignInBtn;
                    }).catch(() => false);
                    
                    if (isSignedIn) {
                        console.log('Sign-in complete!');
                        break;
                    }
                }
                
                await page.waitForTimeout(2000);
                attempts++;
                
                if (attempts % 15 === 0) {
                    console.log(`Still waiting for sign-in... (${attempts * 2}s)`);
                }
            }
            
            if (attempts >= maxAttempts) {
                throw new Error('Timeout waiting for sign-in');
            }
        }
        
        console.log('Session ready!');
        
        await extractAndSaveCookies();
        await initImageFX();
        
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

        if (!imageFX) {
            await initBrowser();
            if (!imageFX) {
                await initImageFX();
            }
        }

        console.log(`Generating: "${prompt}"`);
        console.log('Calling ImageFX API directly...');
        
        const { Prompt } = await import('@rohitaryal/imagefx-api');
        
        const promptObj = new Prompt({
            prompt: prompt,
            aspectRatio: aspectRatio,
            numberOfImages: 1,
            generationModel: 'IMAGEN_3_5'
        });
        
        const generatedImages = await imageFX.generateImage(promptObj);
        
        const images = generatedImages.map((img, i) => {
            let imageUrl;
            
            if (img.encodedImage) {
                imageUrl = `data:image/jpeg;base64,${img.encodedImage}`;
            } else if (img.image) {
                imageUrl = `data:image/jpeg;base64,${img.image}`;
            } else if (typeof img === 'string' && img.startsWith('/9j/')) {
                imageUrl = `data:image/jpeg;base64,${img}`;
            } else if (img.url) {
                imageUrl = img.url;
            } else if (img.imageUrl) {
                imageUrl = img.imageUrl;
            } else if (img.fifeUrl) {
                imageUrl = img.fifeUrl;
            } else {
                const imgStr = JSON.stringify(img);
                if (imgStr.startsWith('"/9j/')) {
                    imageUrl = `data:image/jpeg;base64,${imgStr.slice(1, -1)}`;
                } else {
                    imageUrl = `data:image/jpeg;base64,${imgStr}`;
                }
            }
            
            return {
                id: `img-${Date.now()}-${i}`,
                url: imageUrl,
                prompt: prompt
            };
        });

        console.log(`Done! ${images.length} image(s)`);
        res.json({ success: true, images });
    } catch (error) {
        console.error('Error:', error.message);
        
        if (error.message.includes('cookie') || error.message.includes('auth') || error.message.includes('401')) {
            fs.unlinkSync(COOKIE_FILE);
            imageFX = null;
        }
        
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        browserReady: !!imageFX,
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
