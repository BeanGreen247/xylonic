# Security Considerations

### 1. Credential Storage

- **Best effort security**: OS-native keychain when available
- **Fallback**: Plaintext localStorage for compatibility
- **Never in code**: No hardcoded passwords or API keys

### 2. HTTPS Enforcement

- All external connections require HTTPS
- Only localhost allowed with HTTP (development)

### 3. Content Security Policy (CSP)

```javascript
// electron.js - Restricts loading external resources
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "img-src 'self' data: https:; " +
        "media-src 'self' blob: https:; " +
        "style-src 'self' 'unsafe-inline';"
      ]
    }
  });
});
```

### 4. Renderer Sandbox

- Node integration disabled in renderer
- Context isolation enabled
- Preload script as secure IPC bridge

---
