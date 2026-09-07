# Authentication & Security

### Authentication Flow Diagram

**Scenario 1: Online Login (First Time)**

```mermaid
sequenceDiagram
    participant User
    participant LoginForm as LoginForm.tsx
    participant ConnTest as ConnectionTest.tsx
    participant API as subsonicApi
    participant Server as Subsonic Server
    participant Main as electron.js<br/>(Main Process)
    participant Secure as secureCredentialService
    participant Auth as AuthContext
    participant App as App.tsx
    
    User->>LoginForm: Enter credentials<br/>(URL, username, password)
    User->>ConnTest: Click "Test Connection"
    ConnTest->>API: ping(credentials)
    API->>Server: HTTPS GET /rest/ping.view<br/>(MD5 salted token)
    Server-->>API: {status: 'ok'}
    API-->>ConnTest: Success
    ConnTest->>User: ✓ Connection successful
    
    User->>LoginForm: Click "Login"
    LoginForm->>Secure: storeCredentials()
    Secure->>Main: IPC: encrypt-credential
    Note over Main: Store in OS keychain:<br/>- Windows Credential Manager<br/>- macOS Keychain<br/>- Linux Secret Service
    Main-->>Secure: {success: true, encrypted}
    Secure->>Secure: Save to localStorage<br/>(encrypted + plaintext fallback)
    
    Secure->>Auth: login(credentials)
    Note over Auth: Set isAuthenticated = true<br/>Set currentUser<br/>Dispatch 'auth-changed'
    Auth->>App: Trigger re-render
    App->>User: Show MainApp<br/>(Library, Player, Header)
```

**Scenario 2: Offline Login (No Internet)**

```mermaid
sequenceDiagram
    participant User
    participant LoginForm as LoginForm.tsx
    participant ConnTest as ConnectionTest.tsx
    participant API as subsonicApi
    participant Main as electron.js
    participant Secure as secureCredentialService
    participant Cache as offlineCacheService
    participant Auth as AuthContext
    participant App as App.tsx
    
    User->>LoginForm: Enter credentials
    User->>ConnTest: Click "Test Connection"
    ConnTest->>API: ping(credentials)
    API->>API: Network timeout /<br/>connection refused
    API-->>ConnTest: Error: Connection failed
    
    ConnTest->>User: ❌ No connection<br/>Enter offline mode?
    Note over ConnTest: Enable "Enter Offline Mode" button
    
    User->>LoginForm: Click "Enter Offline Mode"
    LoginForm->>Secure: getStoredCredentials()
    Secure->>Main: IPC: decrypt-credential
    Note over Main: Retrieve from OS keychain
    Main-->>Secure: Decrypted password
    Secure->>Secure: Verify password matches input
    
    Secure->>Cache: checkUserCache()
    Cache->>Cache: Check cache_index.json exists?
    
    alt Cache exists
        Cache-->>LoginForm: Allow offline mode
        LoginForm->>Auth: login(credentials, offlineMode: true)
        Note over Auth: Set isAuthenticated = true<br/>Set isOfflineMode = true<br/>Dispatch 'auth-changed'
        Auth->>App: Trigger re-render
        App->>User: Show MainApp<br/>(cached library only)
    else No cache
        Cache-->>LoginForm: Reject: No cached data
        LoginForm->>User: Error: Cannot enter offline mode
    end
```

### Token-Based Authentication (Subsonic API)

Every API request uses **salted MD5 tokens** instead of sending passwords directly.

```typescript
// Authentication token generation
function generateAuthParams(username: string, password: string) {
  // 1. Generate random salt (changes every request)
  const salt = Math.random().toString(36).substring(7);
  
  // 2. Create token: MD5(password + salt)
  const token = md5(password + salt);
  
  // 3. Return URL parameters
  return {
    u: username,      // Username in plain text
    t: token,         // MD5 token (not the password!)
    s: salt,          // Salt used for this request
    v: '1.16.1',      // API version
    c: 'Xylonic',     // Client name
    f: 'json'         // Response format
  };
}

// Example API call
const params = generateAuthParams('john', 'password123');
// URL: /rest/ping.view?u=john&t=5f4dcc3b5aa765d61d8327deb882cf99&s=abc123&v=1.16.1&c=Xylonic&f=json
```

**Why This Is Secure:**
- Password never sent in plain text over network
- Salt ensures same password generates different tokens each request
- Even if an attacker intercepts the token, they can't reuse it (different salt next time)
- Server verifies: `MD5(stored_password + received_salt) == received_token`

### HTTPS Enforcement

```typescript
// subsonicApi.ts - Security validation
export const validateServerUrl = (url: string): boolean => {
  const parsedUrl = new URL(url);
  
  // Allow localhost for development
  if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
    return true;
  }
  
  // Require HTTPS for all external connections
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('External servers must use HTTPS');
  }
  
  return true;
};
```

---
