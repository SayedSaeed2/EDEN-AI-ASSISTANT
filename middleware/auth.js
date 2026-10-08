import { verifyToken } from '../services/auth.js';

// Cookie parser helper without external dependency
export function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

// Middleware to protect API routes
export function requireAuthApi(req, res, next) {
  // Check authorization header Bearer or cookie
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = getCookie(req, 'maximo_token');
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }

  req.user = user;
  next();
}

// Middleware to protect UI pages (redirect to /login.html if not authenticated)
export function requireAuthPage(req, res, next) {
  const token = getCookie(req, 'maximo_token');
  const user = verifyToken(token);
  if (!user) {
    return res.redirect('/login.html');
  }
  req.user = user;
  next();
}
