# OpenVio - LinkedIn Automation

A modern full-stack web application to create, preview, schedule, and publish posts to LinkedIn with support for multiple images, videos, and documents.

---

## 🚀 Features

- **Media Publishing**: Upload up to 20 images with primary thumbnail cover selection, native chunked video uploads, and PDF documents.
- **Live Preview**: Real-time LinkedIn post preview (desktop & mobile) before publishing.
- **AI Assistant**: Generate and polish post captions using AI.
- **Post Scheduling**: Schedule posts with automated background publishing.
- **Mock & Real Modes**: Test locally offline with a built-in mock server, or connect to your real LinkedIn account.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS, TypeScript
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL
- **Integration**: LinkedIn REST APIs (Posts, Images, Videos, Documents)

---

## ⚡ Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/utkarsh7111/OpenVio-LinkedIn-Automation.git
cd OpenVio-LinkedIn-Automation

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Configure Environment (`.env`)

Create a `.env` file in the root directory:

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/openvio
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Set to 'real' for live LinkedIn or 'mock' for local offline testing
LINKEDIN_MODE=real
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:4000/api/linkedin/callback
LINKEDIN_API_BASE=https://api.linkedin.com
```

Run database migrations:
```bash
cd backend
npm run migrate
```

---

## 🏃 Running the Project

Open two terminal windows:

### Terminal 1: Backend
```bash
cd backend
npm run dev
```
> Runs at `http://localhost:4000`

### Terminal 2: Frontend
```bash
cd frontend
npm run dev
```
> Runs at `http://localhost:3000`

Open **[http://localhost:3000/dashboard/linkedin](http://localhost:3000/dashboard/linkedin)** in your browser!

---

## 🧪 Testing with Mock LinkedIn (Optional)

If you don't have LinkedIn API credentials, set `LINKEDIN_MODE=mock` in `.env` and run the mock server:

```bash
cd mock-linkedin
npm install
npm start
```
> Runs at `http://localhost:4100`

---

## 📁 Project Structure

```
├── backend/          # Express API & LinkedIn integration
├── frontend/         # Next.js UI dashboard & preview card
├── mock-linkedin/    # Offline LinkedIn API simulator
├── .env.example      # Sample environment variables
└── README.md
```


