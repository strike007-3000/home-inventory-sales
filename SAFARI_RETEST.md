# Safari M1 Local-Browser Session Persistence Fix - Retest Guide

## Summary of Changes

This fix addresses the issue where Safari on M1 MacBook Pro rejected HTTP cookies with the `Secure` flag, causing session persistence failures.

### Key Changes:

1. **Environment-Aware Cookie Security**
   - Production (HTTPS): Uses `__Host-session` and `__Host-csrf` with `Secure` flag
   - Development (HTTP): Uses `dev-session` and `dev-csrf` without `Secure` flag
   - Both cookies: `HttpOnly`, `SameSite=Lax`, 30-day Max-Age

2. **Login Flow Strengthening**
   - SPA now calls `/api/me` immediately after `/api/login` to verify the session
   - Only marks user as authenticated if `/api/me` returns 200 OK
   - Prevents race conditions where cookie is set but not yet accepted

3. **Tests Passing**
   - 19/19 worker tests passing
   - 49/49 unit tests passing
   - All TypeScript compilation errors fixed

---

## Manual Retest Steps (Safari M1)

### Prerequisites
- Safari 15+ on macOS Sequoia/Sonoma on M1/M2/M3 MacBook Pro
- `npm run dev` running on HTTP (not HTTPS)
- Browser cookies should be cleared before testing

### Test Scenario 1: Login → Refresh → Remains Authenticated

**Step 1: Clear Safari Cookies**
1. Open Safari → Preferences → Privacy
2. Click "Manage Website Data"
3. Remove all entries for `inventory.example.test` or `localhost:5173`
4. Confirm deletion

**Step 2: Open Application**
1. In a terminal, start the dev server:
   ```bash
   npm run dev
   ```
2. In Safari, navigate to `http://localhost:5173`

**Step 3: Attempt Login**
1. Enter the shared password (from `.dev.vars`)
2. Click "Enter Password"
3. **Expected behavior:**
   - Login succeeds, displays inventory dashboard
   - No error message about "Session verification failed"
   - Password field clears

**Step 4: Verify Session Persistence**
1. Open DevTools (Command + Option + I)
2. Go to Application → Cookies
3. For `localhost:5173`, verify both cookies exist:
   - `dev-session` (HttpOnly, SameSite=Lax, Max-Age=2592000)
   - `dev-csrf` (SameSite=Lax, Max-Age=2592000)
   - **No Secure flag** (critical for HTTP)

4. Navigate to `http://localhost:5173` → **Refresh (Command + R)**
5. **Expected behavior:**
   - Dashboard still visible
   - User is still logged in
   - Password prompt does **not** appear

**Step 5: Verify Logout**
1. Click the "Logout" button (top-right)
2. **Expected behavior:**
   - Returns to login screen
   - Both cookies deleted (show 0 cookies in DevTools)
3. Refresh page
4. **Expected behavior:**
   - Returns to login screen (not authenticated)

---

### Test Scenario 2: Network Tab Cookie Headers

**Step 1: Open Network Tab**
1. In Safari DevTools, go to Network tab
2. Clear any existing requests (⌘K)
3. Reload page (`http://localhost:5173`)

**Step 2: Login Request**
1. Enter password and submit
2. Look for the `/api/login` request in the Network tab
3. Click on it → Headers → Request Headers
4. **Expected headers:**
   - `Content-Type: application/json`
   - `Origin: http://localhost:5173`

**Step 3: Response Headers**
1. Click on the `/api/login` response
2. Go to Response → Set-Cookie headers
3. **Expected cookies:**
   ```
   dev-session=<hmac-signed-token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
   dev-csrf=<uuid>; SameSite=Lax; Path=/; Max-Age=2592000
   ```
   - **No `Secure` flag** for HTTP development mode

**Step 4: /api/me Request**
1. Look for the `/api/me` request immediately after login
2. Check Response:
   - **Status 200** with `{ "authenticated": true }`
   - Set-Cookie headers should be empty or include session refresh

---

### Test Scenario 3: No Session Cookie → Should Fail

**Step 1: Start Fresh**
1. Clear all Safari cookies
2. Refresh `http://localhost:5173`
3. User should see login screen

**Step 2: Access /api/me Directly**
1. In DevTools → Console, run:
   ```javascript
   fetch('/api/me').then(r => r.json()).then(console.log)
   ```
2. **Expected response:**
   ```json
   { "error": "Not authenticated" }
   ```
3. Status code: **401 Unauthorized**

**Step 3: Login Without /api/me Check**
1. Don't use the login form (simulates old buggy behavior)
2. Call `/api/login` directly:
   ```javascript
   fetch('/api/login', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     credentials: 'same-origin',
     body: JSON.stringify({ password: 'correct-password' })
   }).then(r => r.text()).then(console.log)
   ```
3. **Expected response:**
   - Status: 200 OK
   - Set-Cookie headers returned
   - But `/api/me` would return 401 (no authentication)

---

## Expected Behavior Summary

### ✅ Should Work:
- Login form accepts password
- `/api/login` returns 200 with both cookies
- `/api/me` returns 200 after successful login
- Refreshing page keeps user authenticated
- Both `dev-session` and `dev-csrf` cookies persist
- Logout clears both cookies
- Direct access to `/api/me` without cookies returns 401

### ❌ Should Not Happen:
- "Session verification failed" error message
- Password prompt reappearing after refresh
- Safari devtools showing `dev-session` with `Secure` flag over HTTP
- `__Host-session` cookies appearing in HTTP development mode
- Unauthorized access after logout

---

## Technical Details

### Cookie Security Modes

**Development (HTTP):**
```
dev-session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
dev-csrf=<uuid>; SameSite=Lax; Path=/; Max-Age=2592000
```

**Production (HTTPS):**
```
__Host-session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/
__Host-csrf=<uuid>; Secure; SameSite=Lax; Path=/
```

### Session Verification Flow

1. User submits login form → `POST /api/login`
2. Server validates password, creates session, returns both cookies
3. SPA calls `GET /api/me` immediately
4. Server verifies session cookie, returns `{ "authenticated": true }`
5. SPA marks user as authenticated, shows dashboard

If step 4 fails, user sees "Session verification failed" error.

---

## Debugging Tips

If issues persist:

1. **Check Safari Version:**
   - Safari → About Safari
   - Must be 15.0 or later (macOS Sequoia 15+)

2. **Disable Privacy Settings:**
   - Preferences → Privacy
   - Try "Allow All Websites" temporarily
   - If it works, check specific Safari privacy settings

3. **Check Developer Mode:**
   - System Settings → Developer
   - Ensure "Web Inspector" is enabled

4. **Test in Chrome (for comparison):**
   - Chrome should work the same (HTTP, no Secure flag)
   - Use Chrome to confirm it's Safari-specific behavior

5. **Check for Cookie Blockers:**
   - Safari has aggressive cookie blocking
   - DevTools → Privacy → "Block cookies" should be set to "Allow"

6. **Verify .dev.vars:**
   - Ensure password matches in `.dev.vars`
   - Run `npm run dev` to confirm it loads the file

---

## Test Results

Run the following to verify all automated tests pass:

```bash
npm run check
```

Expected output:
```
✓ built in 38ms
✓ test/unit/domain.test.ts (49 tests)
✓ test/worker/auth.test.ts (19 tests)
```

If these pass, proceed to manual Safari testing.
