# MakePix

AI image generation app powered by Google's Flow.

## Setup

### Requirements
- Node.js v18+
- npm

### Install

```bash
npm install
npx playwright install chromium
```

## Usage

### First Run

```bash
npm start
```

1. A browser window opens - sign in to Google
2. Wait for Flow page to load
3. Terminal shows "Ready" when done
4. Open http://localhost:3000

### After First Run

```bash
npm start
```

Browser runs invisibly. Just open http://localhost:3000.

### Reset Session

```bash
rm -rf browser-data
npm start
```

## How to Use

1. Enter a prompt
2. Select aspect ratio
3. Click "Make Pix!"
4. Wait ~30-60 seconds
5. Download your image

## Notes

- First run requires Google sign-in (session saves automatically)
- One image at a time
- Keep the server running while generating
