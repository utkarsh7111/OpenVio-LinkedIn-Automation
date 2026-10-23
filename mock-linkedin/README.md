# Mock LinkedIn provider

In-memory LinkedIn-compatible service for local development and tests. It uses Node's built-in HTTP server and listens on `127.0.0.1:4100` by default.

```powershell
cd mock-linkedin
npm ci
npm run check
npm test
npm start
```

Copy `.env.example` values into the process environment when you need different credentials or redirect URI. Defaults are `mock-client-id`, `mock-client-secret`, and `http://localhost:4000/api/linkedin/callback`. Set `MOCK_LINKEDIN_LATENCY_MS` to add delay to provider requests, or `MOCK_LINKEDIN_DROP_CONNECTION=true` to close provider connections. The built-in fault injector is `POST /admin/fail-next` with `{ "status": 429, "count": 2, "retryAfter": 5, "path": "/rest/posts", "method": "POST" }`; use `{ "count": 1, "dropConnection": true }` to drop the next matching connection. Admin endpoints are intentionally unauthenticated for local test control; do not expose this service publicly.

`POST /admin/reset` clears all in-memory users' tokens, grants, uploads, posts and queued faults. `GET /admin/posts` returns a snapshot of posts for assertions.

## Manual OAuth and post lifecycle

With the mock server running on port 4100, run:

```powershell
npm run manual:flow
```

The TypeScript script authorizes, exchanges the temporary code, fetches `/v2/userinfo`, creates a post, partially updates its commentary, then deletes it. It prints endpoint statuses and the post URN; it does not print the access token.
