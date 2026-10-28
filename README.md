# OpenVio LinkedIn Automation

A full-stack LinkedIn post management and automation tool built with Next.js, Express, and PostgreSQL. It allows users to connect their LinkedIn account, compose AI-assisted posts, upload multiple media formats (images, videos, and documents), schedule posts, and publish directly to LinkedIn.

---

## Features

- **Multi-Image Posts**: Upload up to 20 images with primary thumbnail cover selection and reordering.
- **Video & Document Support**: Native video uploading with chunked finalization and PDF/document carousels.
- **AI Post Enhancer**: Generate or polish post drafts using Gemini or OpenAI.
- **Post Scheduling**: Schedule posts with automated retry on network or rate-limit failures.
- **Real & Mock Modes**: Test offline with a built-in mock server, or connect to real LinkedIn via OAuth 2.0.
- **Live Feed Simulation**: Real-time desktop and mobile post preview card.

---

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (Prisma / `pg` connection pool)
- **APIs**: LinkedIn REST API (Posts, Images, Videos, Documents)

---

## Getting Started

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database
- (Optional) LinkedIn Developer App credentials

### 2. Installation

Clone the repository and install dependencies for each service:

```bash
git clone https://github.com/utkarsh7111/OpenVio-LinkedIn-Automation.git
cd OpenVio-LinkedIn-Automation

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# (Optional) Install mock-linkedin dependencies
cd ../mock-linkedin
npm install
```

### 3. Setup Environment Variables

Copy the example environment file at the root:

```bash
cp .env.example .env
```

Open `.env` and fill in your database URL and credentials:

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgres://user:password@localhost:5432/dbname
TOKEN_ENCRYPTION_KEY=your_64_character_hex_key

# Set mode to 'real' for live LinkedIn or 'mock' for local offline testing
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
npm run seed
```

---

## Running the Application

### 1. Backend API (Port 4000)

```bash
cd backend
npm run dev
```

### 2. Frontend (Port 3000)

In a separate terminal:

```bash
cd frontend
npm run dev
```

### 3. (Optional) Mock LinkedIn Server (Port 4100)

If using `LINKEDIN_MODE=mock`:

```bash
cd mock-linkedin
npm start
```

Visit **[http://localhost:3000/dashboard/linkedin](http://localhost:3000/dashboard/linkedin)** in your browser.

---

## Project Structure

```
├── backend/          # Express API, auth, scheduling, and LinkedIn service
├── frontend/         # Next.js 14 dashboard UI, composer, and preview card
├── mock-linkedin/    # Local mock LinkedIn server for offline testing
├── .env.example      # Environment variables template
└── README.md
```

---

## License

MIT
