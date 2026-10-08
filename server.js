import express from 'express';
import cors from 'cors';
import { Ollama } from 'ollama';
import { config } from './config/index.js';
import { toolsSchema } from './services/tools.js';
import { chatController } from './controllers/chatController.js';
import { maximoController } from './controllers/maximoController.js';

import { authController } from './controllers/authController.js';
import { requireAuthApi, requireAuthPage } from './middleware/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

// Public Auth Endpoints (before static and protected routes)
app.post('/api/auth/login', (req, res) => authController.login(req, res));
app.post('/api/auth/logout', (req, res) => authController.logout(req, res));
app.get('/api/auth/me', (req, res) => authController.me(req, res));

// Protect Root Page (Redirect to /login.html if not authenticated)
app.get('/', requireAuthPage, (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Serve static assets (login.html, css, js)
app.use(express.static('public'));

const ollama = new Ollama({ host: config.ollama.host });

// Protected API Routes
app.get('/api/context', requireAuthApi, (req, res) => maximoController.getContext(req, res));
app.get('/api/memory', requireAuthApi, (req, res) => chatController.getMemory(req, res));
app.post('/api/memory/reset', requireAuthApi, (req, res) => chatController.resetMemory(req, res));
app.post('/api/approve-action', requireAuthApi, (req, res) => maximoController.approveAction(req, res, ollama, config.ollama.model, toolsSchema));
app.post('/api/chat', requireAuthApi, (req, res) => chatController.handleChat(req, res, ollama, config.ollama.model));


app.listen(config.port, () => {
  console.log(`=========================================`);
  console.log(`Maximo AI Agent running at http://localhost:${config.port}`);
  console.log(`Model: ${config.ollama.model} via Ollama`);
  console.log(`Registered Tools: ${toolsSchema.length}`);
  console.log(`=========================================`);
});