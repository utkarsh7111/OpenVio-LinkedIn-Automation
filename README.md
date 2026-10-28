# OpenVio — LinkedIn Post Automation & Management Module

[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg?style=flat&logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg?style=flat&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey.svg?style=flat&logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue.svg?style=flat&logo=postgresql)](https://www.postgresql.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC.svg?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-ready, full-stack **LinkedIn Post Automation & Management** module for the **OpenVio** AI social management platform. Built with Next.js 14, Node.js, Express, PostgreSQL, and 100% strict TypeScript.

Supports end-to-end publishing to **Real LinkedIn Profiles** via official LinkedIn REST APIs, as well as an integrated **Local Mock Provider** for zero-cost offline development and testing.

---

## 🌟 Key Features

### 1. 📷 Multi-Media Upload & Publishing
- **Multi-Image Posts**: Select and attach up to 20 images (`.jpg`, `.jpeg`, `.png`, `.gif`).
  - **Primary Thumbnail Cover**: The first selected image is prominently featured as the hero preview cover.
  - **Drag/Click Reordering**: Reorder or set any image as primary with automatic fallback promotion upon removal.
  - **Native LinkedIn Format**: Automatically converts multi-image drafts into LinkedIn's `content.multiImage.images` payload.
- **Native Video Publishing**:
  - Supports `.mp4`, `.mov`, `.webm`, `.avi`, `.mkv`.
  - Implements LinkedIn's chunked video upload pipeline with chunk `ETag` collection, `finalizeUpload` handshake, and asynchronous transcoding status polling (`WAITING_UPLOAD` &rarr; `PROCESSING` &rarr; `AVAILABLE`).
- **Native Document Carousel**:
  - Supports `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx` (up to 100 MB / 300 pages).
  - Embeds directly into LinkedIn's native slide-through document viewer.
- **Security & Integrity**:
  - Magic-number byte sniffing guards against spoofed MIME extensions and malicious payloads.
  - Path-traversal sanitization and UUID-hashed storage filenames.

### 2. 🔐 Dual LinkedIn Engine: Real OAuth 2.0 & Local Mock Mode
- **Real LinkedIn OAuth**:
  - Standard OAuth 2.0 Authorization Code flow with PKCE-grade state hash verification.
  - Requests `openid`, `profile`, and `w_member_social` scopes.
  - Secure AES-256-GCM token encryption at rest.
  - Automatic expiration calculation and token lifecycle warnings.
- **Zero-Dependency Mock Engine**:
  - Built-in lightweight mock LinkedIn server running on port `4100`.
  - Simulates LinkedIn authorization, token grant, media chunking, and post creation for isolated offline development and automated testing.

### 3. ✍️ AI-Powered Post Composer & Live Preview
- **Post Composer**:
  - Character counter with real-time LinkedIn 3,000-character constraint monitoring.
  - Multi-attachment carousel and thumbnail tray.
- **AI Text Enhancer**:
  - Integrated Gemini / OpenAI integration with 6 quick actions: *Improve, Professional Tone, Friendly Tone, Shorten, Expand, Generate Hashtags*.
- **Pixel-Perfect Feed Simulation**:
  - Live preview mirroring LinkedIn desktop and mobile feed rendering (author headline, profile picture, post commentary formatting, media layout, and interaction bar).

### 4. 📅 Scheduling & Post Lifecycle Management
- **Drafts & Scheduled Queue**:
  - Save drafts, edit drafts, unschedule, or trigger instant *Publish Now*.
  - Background scheduler worker running transactional atomic database claims to prevent double-posting race conditions.
  - Exponential backoff and retry tracking on provider rate limits (`429`) or temporary downtime (`502`).
- **Post History Table**:
  - Comprehensive history tracking with status badges (`DRAFT`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`).
  - Search, filter by status, pagination, and direct LinkedIn live post links.

---

## 🏗️ Architecture

```
OpenVio LinkedIn Automation
├── frontend/                     # Next.js 14 App Router UI (Port 3000)
│   ├── app/                      # Next.js pages & dashboard routes
│   │   └── dashboard/linkedin/   # Main LinkedIn management console
│   ├── components/linkedin/      # PostComposer, MediaUploader, LinkedInPreviewCard, etc.
│   ├── services/                 # Frontend API client (linkedinApi.ts)
│   └── types/                    # Shared TypeScript interfaces & types
│
├── backend/                      # Node.js + Express API Server (Port 4000)
│   ├── src/
│   │   ├── adapters/             # Storage, AI, auth, and project adapters
│   │   ├── config/               # Environment & runtime configuration
│   │   ├── controllers/          # Connection and Post route controllers
│   │   ├── db/                   # PostgreSQL connection pool & data access layer
│   │   ├── jobs/                 # Background post scheduler worker
│   │   ├── middleware/           # Multipart upload, rate limiting, validation
│   │   ├── routes/               # Express REST API routes
│   │   ├── services/             # LinkedIn API client (Images, Videos, Docs, Posts)
│   │   └── utils/                # Crypto, URN parser, error normalization
│   ├── migrations/               # PostgreSQL schema migration scripts
│   └── tests/                    # Unit, integration, and E2E test suites
│
└── mock-linkedin/                # Standalone LinkedIn REST Mock Server (Port 4100)
    └── server.js                 # Simulated OAuth, Images, Videos, Documents & Posts API
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `v20.0.0+`
- **npm**: `v10.0.0+`
- **PostgreSQL**: `v16+` (or a hosted PostgreSQL service like Neon, Supabase, or Aiven)

### 1. Clone the Repository
```bash
git clone https://github.com/utkarsh7111/OpenVio-LinkedIn-Automation.git
cd OpenVio-LinkedIn-Automation
```

### 2. Configure Environment Variables
Copy the root `.env.example` to `.env`:
```bash
cp .env.example .env
```

Generate a 64-character hexadecimal encryption key for OAuth tokens:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Configure your `.env` values:
```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
DEV_AUTH_ENABLED=true

# Database Configuration
DATABASE_URL=postgres://user:password@localhost:5432/openvio_db

# Token Encryption
TOKEN_ENCRYPTION_KEY=your_64_character_hex_key_here

# Mode: 'real' (Live LinkedIn) or 'mock' (Local Mock Provider)
LINKEDIN_MODE=real
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:4000/api/linkedin/callback
LINKEDIN_API_VERSION=202601
LINKEDIN_API_BASE=https://api.linkedin.com

# AI Provider (Optional: 'gemini', 'openai', or 'mock')
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```

### 3. Install Dependencies & Setup Database
```bash
# Backend setup & database migration
cd backend
npm install
npm run migrate
npm run seed

# Frontend setup
cd ../frontend
npm install

# Mock LinkedIn provider setup (optional, for offline development)
cd ../mock-linkedin
npm install
```

---

## 🏃 Running the Application

### Option A: Real LinkedIn Mode

In separate terminals from the project root:

```bash
# Terminal 1 — Backend API (Port 4000)
cd backend
npm run dev

# Terminal 2 — Frontend Application (Port 3000)
cd frontend
npm run dev
```

Open your browser to: **[http://localhost:3000/dashboard/linkedin](http://localhost:3000/dashboard/linkedin)**

---

### Option B: Local Mock Development Mode (No LinkedIn Account Required)

If you don't have a LinkedIn Developer application or want to work completely offline, set `LINKEDIN_MODE=mock` in `.env` and start the mock provider:

```bash
# Terminal 1 — Mock LinkedIn Server (Port 4100)
cd mock-linkedin
npm start

# Terminal 2 — Backend API (Port 4000)
cd backend
npm run dev

# Terminal 3 — Frontend (Port 3000)
cd frontend
npm run dev
```

---

## 🔑 LinkedIn Developer App Configuration Guide

When publishing to real LinkedIn (`LINKEDIN_MODE=real`):

1. **Create an App**: Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) and create an application linked to your LinkedIn Company/Personal Page.
2. **Authorized Redirect URL**:
   - Go to your app &rarr; **Auth** tab &rarr; **OAuth 2.0 settings** &rarr; **Authorized redirect URLs for your app**.
   - Add:
     ```
     http://localhost:4000/api/linkedin/callback
     ```
3. **Products & Permissions**:
   - Under the **Products** tab, request access to:
     - **Sign In with LinkedIn using OpenID Connect** *(grants `openid`, `profile`, `email`)*
     - **Share on LinkedIn** *(grants `w_member_social` for personal publishing)*
     - *(Optional)* **Community Management API** *(for organization / company page publishing)*
4. **Team Members**:
   - If your LinkedIn App is in **Development Mode**, only accounts listed under **Team Members** can authorize and post.

---

## 📁 Supported Media Matrix

| Media Type | Formats | Count Limit | Size Limit | Publishing Behavior |
| :--- | :--- | :---: | :---: | :--- |
| **Images** | `.jpg`, `.jpeg`, `.png`, `.gif` | Up to 20 images | 10 MB / file | Primary cover preview thumbnail; publishes as LinkedIn `multiImage` gallery. |
| **Videos** | `.mp4`, `.mov`, `.webm`, `.avi`, `.mkv` | 1 video / post | 200 MB | Chunked binary upload &rarr; `finalizeUpload` &rarr; transcoded asynchronously until `AVAILABLE`. |
| **Documents** | `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx` | 1 document / post | 100 MB (up to 300 pages) | Embeds into LinkedIn slide-through carousel. |

---

## 🧪 Testing & Verification

The project includes unit, integration, and end-to-end publishing tests:

```bash
# Run complete media upload & publishing test suite
cd backend
node --import tsx --test tests/media.upload.publishing.test.ts

# Run LinkedIn service unit tests
node --import tsx --test tests/linkedin.service.test.ts

# Run OAuth connection flow tests
node --import tsx --test tests/connection.flow.test.ts

# Run Posts API endpoint tests
node --import tsx --test tests/posts.api.test.ts

# Type-check backend & frontend
cd ../backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit

# Production build check
cd ../frontend && npm run build
```

---

## 🛡️ Security & Reliability Best Practices

- **Zero Secrets Committed**: Strict `.gitignore` configuration guarantees no `.env`, database passwords, or certificates are tracked in version control.
- **Payload & SSRF Guards**: All LinkedIn calls strictly validate TLS hosts (`https://api.linkedin.com`).
- **Sanitized Diagnostics**: Backend logs correlation IDs, route paths, and HTTP statuses without exposing bearer tokens or raw file bodies.
- **Transactional Atomic Claims**: Scheduler executes `UPDATE ... WHERE status = 'SCHEDULED' RETURNING *` to eliminate duplicate post publishing across concurrent workers.

---

## 📜 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
