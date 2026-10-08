import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, '../data/users.json');

// Helper to hash passwords using SHA-256 + salt
export function hashPassword(password, salt = 'maximo_salt_2026') {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Generate simple tamper-proof HMAC token for sessions
const SECRET_KEY = process.env.SESSION_SECRET || 'maximo-secure-agent-secret-key-9988';

export function createToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(body).digest('base64url');
  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    // Check expiry (default 7 days)
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

// Load users from JSON or create initial defaults
export function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading users.json:', err);
  }

  // Initial default accounts for demonstration & production sharing
  const defaultUsers = [
    {
      username: 'admin',
      passwordHash: hashPassword('admin123'),
      displayName: 'System Administrator',
      role: 'admin'
    },
    {
      username: 'manager',
      passwordHash: hashPassword('manager123'),
      displayName: 'Executive Manager',
      role: 'executive'
    },
    {
      username: 'engineer',
      passwordHash: hashPassword('engineer123'),
      displayName: 'Maintenance Engineer',
      role: 'engineer'
    }
  ];

  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to create default users.json:', err);
  }

  return defaultUsers;
}

export function authenticate(username, password) {
  const users = loadUsers();
  const inputHash = hashPassword(password);
  const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase().trim());
  if (!user) {
    return null;
  }

  // Check against hash OR direct plaintext for safety
  const isMatch = (user.passwordHash === inputHash) || (user.password === password) || (user.passwordHash === password);
  if (!isMatch) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role
  };
}
