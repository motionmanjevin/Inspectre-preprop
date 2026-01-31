/**
 * Preload script for Electron
 * This script runs in a context that has access to both the DOM and Node.js APIs
 * but is isolated from the main renderer process for security
 */

const { contextBridge } = require('electron');

// Expose protected methods that allow the renderer process to use
// the APIs without exposing the entire Node.js API
contextBridge.exposeInMainWorld('electron', {
  // You can add custom APIs here if needed
  // For example:
  // getVersion: () => process.versions.electron,
  // platform: process.platform,
});
