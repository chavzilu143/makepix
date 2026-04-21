# MakePix

AI image generation app using Google Flow's API directly.

## Features

- **Direct API calls** - No browser automation for generation
- **One-time login** - Sign in once, cookies are saved
- **Image attachments** - Upload reference images, get AI captions
- **Clean web UI** - Prompt input with aspect ratio selection

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

1. Browser opens - sign in to Google
2. Cookies are extracted and saved
3. Open http://localhost:3000

### Subsequent Runs

```bash
npm start
```

No browser needed. Direct API calls using saved cookies.

### Reset Auth

```bash
rm google-cookie.txt browser-data -rf
npm start
```

## Features Guide

### Text-to-Image
1. Enter a prompt describing your image
2. Select aspect ratio
3. Click "Make Pix!"

### Image Attachment
1. Click the file input to upload a reference image
2. Click "🔍 Get Caption" to analyze the image
3. AI generates a description and adds it to your prompt
4. Edit the caption as needed
5. Click "Make Pix!" to generate

## How It Works

### Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Web UI    │────▶│   Express API    │────▶│   Google Flow API   │
│ (localhost) │     │   (server.js)    │     │ (aisandbox-pa.api)  │
└─────────────┘     └──────────────────┘     └─────────────────────┘
                            │
                    ┌───────▼───────┐
                    │ imagefx-api   │
                    │   package     │
                    └───────────────┘
```

### API Details

Google Flow uses an internal API at `aisandbox-pa.googleapis.com`:
- **Generation**: `/v1:runImageFx` - Text-to-image
- **Captioning**: `backbone.captionImage` - Image-to-text
- **Model**: `IMAGEN_3_5`
- **Auth**: Google session cookies (OAuth-based)
- **Response**: Base64-encoded JPEG images

### Why Cookies?

Google's API requires OAuth authentication, not API keys. The `@rohitaryal/imagefx-api` package handles:
1. Cookie-based authentication
2. Request formatting
3. Response parsing

### Reverse Engineering

The API was discovered by:
1. Inspecting network requests on labs.google/fx
2. Analyzing HAR files from browser sessions
3. Identifying the `aisandbox-pa.googleapis.com` endpoint
4. Using the `imagefx-api` npm package that implements these findings

## Limitations

- Requires Google account with Flow access
- Cookies expire (re-login needed occasionally)
- Rate limits apply (Google's internal limits)
- No official API documentation
- Image attachment uses captioning (not direct image-to-image)

## Tech Stack

- **Backend**: Node.js, Express
- **API Client**: @rohitaryal/imagefx-api
- **Auth**: Playwright (one-time cookie extraction)
- **Frontend**: Vanilla HTML/CSS/JS
