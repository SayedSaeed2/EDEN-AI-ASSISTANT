import { authenticate, createToken, verifyToken } from '../services/auth.js';
import { getCookie } from '../middleware/auth.js';

export const authController = {
  // POST /api/auth/login
  login(req, res) {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Token valid for 7 days
    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const token = createToken({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      allowedSites: user.allowedSites || ['*'],
      exp
    });

    // Set secure cookie
    res.setHeader('Set-Cookie', `maximo_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);

    return res.json({
      success: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        allowedSites: user.allowedSites || ['*']
      },
      token
    });
  },

  // POST /api/auth/logout
  logout(req, res) {
    res.setHeader('Set-Cookie', 'maximo_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.json({ success: true, message: 'Logged out successfully.' });
  },

  // GET /api/auth/me
  me(req, res) {
    const token = getCookie(req, 'maximo_token');
    const user = verifyToken(token);
    if (!user) {
      return res.status(401).json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        allowedSites: user.allowedSites || ['*']
      }
    });
  }
};
