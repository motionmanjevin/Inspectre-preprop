# Electron Setup for Inspectre

This guide explains how to run and build the Inspectre application as a desktop app using Electron.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Backend server running on `http://localhost:8000`

## Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Backend

Make sure the Python backend is running:

```bash
# From the project root
python run.py
```

### 3. Start Vite Dev Server (Terminal 1)

```bash
npm run dev
```

This starts the Vite dev server on `http://localhost:3000`

### 4. Start Electron (Terminal 2)

```bash
npm run electron:dev
```

This opens the Electron window connected to the Vite dev server.

## Building for Production

### Build the Frontend

```bash
npm run build
```

This creates optimized production files in the `build/` directory.

### Package Electron App

#### For Testing (Unpacked)

```bash
npm run electron:pack
```

This creates an unpacked version in `dist-electron/` for testing.

#### For Distribution

```bash
npm run electron:build
```

This creates platform-specific installers:
- **Windows**: NSIS installer in `dist-electron/`
- **macOS**: DMG file in `dist-electron/`
- **Linux**: AppImage and DEB packages in `dist-electron/`

## Project Structure

```
frontend/
├── electron/
│   ├── main.js          # Electron main process
│   └── preload.js       # Preload script (security bridge)
├── src/                 # React application source
├── build/               # Production build output
├── dist-electron/       # Electron packaged apps
└── package.json         # Dependencies and scripts
```

## Important Notes

1. **Backend Connection**: The Electron app connects to `http://localhost:8000` for the backend API. Make sure the backend is running.

2. **Development vs Production**:
   - **Development**: Electron loads from Vite dev server (`http://localhost:3000`)
   - **Production**: Electron loads from built files in `build/` directory

3. **Security**: The app uses context isolation and preload scripts for security. Node.js APIs are not directly exposed to the renderer process.

4. **Cross-Platform**: The app works on Windows, macOS, and Linux. Platform-specific builds are created automatically.

## Troubleshooting

### Electron window doesn't open
- Make sure Vite dev server is running (`npm run dev`)
- Check that port 3000 is not in use
- Verify Electron is installed: `npm list electron`

### Backend connection fails
- Ensure backend is running on `http://localhost:8000`
- Check CORS settings in backend if needed
- Verify network connectivity

### Build fails
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check that all dependencies are installed
- Verify Node.js version is compatible

## Customization

### App Icon

Place your app icons in:
- `assets/icon.png` (Linux)
- `assets/icon.ico` (Windows)
- `assets/icon.icns` (macOS)

Then update the `build` section in `package.json` if needed.

### Window Size

Edit `electron/main.js` to change the default window size:

```javascript
mainWindow = new BrowserWindow({
  width: 1400,  // Change this
  height: 900,  // Change this
  // ...
});
```
