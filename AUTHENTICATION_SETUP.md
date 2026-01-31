# Authentication Setup Guide

## Overview

The authentication system has been implemented to allow users to:
1. Register accounts on the web frontend
2. Login from web or mobile app
3. Access the backend from anywhere via Cloudflare Tunnel

## Backend Implementation

### Dependencies Added
- `python-jose[cryptography]` - JWT token handling
- `passlib[bcrypt]` - Password hashing

### New Files Created
- `app/services/user_service.py` - User database management (SQLite)
- `app/services/auth_service.py` - JWT authentication service
- `app/api/routes/auth.py` - Auth endpoints (register, login, verify)
- `app/api/dependencies.py` - Auth dependency for protecting routes

### Protected Routes
All API routes are now protected except:
- `/health` - Health check (public)
- `/auth/register` - User registration (public)
- `/auth/login` - User login (public)
- `/auth/me` - Get current user (requires auth)

### Configuration
Add to your `.env` file:
```env
JWT_SECRET_KEY=your-secret-key-change-in-production
```

**Important**: Change `JWT_SECRET_KEY` to a strong random string in production!

## Frontend (Web) Implementation

### New Components
- `frontend/src/components/LoginPage.tsx` - Login page
- `frontend/src/components/RegisterPage.tsx` - Registration page

### Updated Files
- `frontend/src/App.tsx` - Added authentication state management
- `frontend/src/services/api.ts` - Added auth API and token handling
- `frontend/src/components/Sidebar.tsx` - Added logout button

### Features
- Automatic token storage in localStorage
- Token validation on app load
- Login/Register pages with error handling
- Logout functionality

## Mobile App Implementation

### New Files
- `insp mob/utils/api.js` - API service with authentication

### Updated Files
- `insp mob/components/LoginScreen.js` - Real backend login integration
- `insp mob/App.js` - Real API calls instead of dummy responses

### Dependencies Added
- `@react-native-async-storage/async-storage` - Token storage for React Native

### Configuration
Update `insp mob/utils/api.js`:
```javascript
const API_BASE_URL = 'https://your-cloudflare-tunnel-url.cloudflare.app';
```

## Cloudflare Tunnel Setup

### Step 1: Install Cloudflare Tunnel
```bash
# On your Raspberry Pi or server
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

### Step 2: Login to Cloudflare
```bash
cloudflared tunnel login
```

### Step 3: Create a Tunnel
```bash
cloudflared tunnel create inspectre-backend
```

### Step 4: Create Config File
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <tunnel-id-from-step-3>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-backend.cloudflare.app
    service: http://localhost:8000
  - service: http_status:404
```

### Step 5: Run Tunnel
```bash
cloudflared tunnel run inspectre-backend
```

### Step 6: Update Mobile App
Update `insp mob/utils/api.js`:
```javascript
const API_BASE_URL = 'https://your-backend.cloudflare.app';
```

## Usage Flow

1. **User Registration** (Web Frontend):
   - User visits web app
   - Clicks "Register"
   - Enters email and password
   - Account created, automatically logged in

2. **User Login** (Web or Mobile):
   - User enters email and password
   - Backend validates credentials
   - JWT token issued and stored
   - User can now access protected endpoints

3. **API Calls**:
   - All API requests include `Authorization: Bearer <token>` header
   - Backend validates token on each request
   - If token invalid/expired, returns 401 Unauthorized

4. **Mobile App**:
   - User logs in with same credentials
   - Token stored securely in AsyncStorage
   - All API calls authenticated automatically

## Testing

### Test Registration
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "test123"}'
```

### Test Login
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "test123"}'
```

### Test Protected Endpoint
```bash
curl http://localhost:8000/search/stats \
  -H "Authorization: Bearer <token-from-login>"
```

## Security Notes

1. **JWT Secret**: Use a strong random secret in production
2. **HTTPS**: Cloudflare Tunnel provides HTTPS automatically
3. **Token Expiry**: Tokens expire after 7 days (configurable in `app/core/config.py`)
4. **Password Security**: Passwords are hashed with bcrypt
5. **CORS**: Currently allows all origins - restrict in production

## Troubleshooting

### Mobile app can't connect
- Check `API_BASE_URL` in `insp mob/utils/api.js`
- Verify Cloudflare Tunnel is running
- Check tunnel URL is correct

### Login fails
- Verify backend is running
- Check email/password are correct
- Check backend logs for errors

### Token expired
- User needs to login again
- Token expiry is 7 days by default

## Next Steps

1. Set up Cloudflare Tunnel on your Raspberry Pi
2. Update mobile app API URL
3. Test registration and login
4. Deploy and test from mobile device
