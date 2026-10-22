import express from 'express';
import cors from 'cors';
import { Ollama } from 'ollama';
import { config } from './config/index.js';
import { toolsSchema, getActiveToolsSchema } from './services/tools.js';
import { mcpClientManager } from './services/mcpClientService.js';
import { chatController } from './controllers/chatController.js';
import { maximoController } from './controllers/maximoController.js';

import { authController } from './controllers/authController.js';
import { requireAuthApi, requireAuthPage } from './middleware/auth.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ragService } from './services/ragService.js';

// Setup file upload destination in knowledge_docs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const username = (req.user?.username || 'common').replace(/[^a-zA-Z0-9_-]/g, '_');
    const uploadDir = path.resolve('knowledge_docs', 'user_uploads', username);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB limit per PDF
});

import { conversationService } from './services/conversationService.js';

import { skillService } from './services/skillService.js';

// Protected API Routes
app.get('/api/skills', requireAuthApi, (req, res) => {
  const userRole = req.user?.role || 'user';
  const skills = skillService.getSkillsForUser(userRole);
  res.json({ success: true, skills });
});
app.get('/api/context', requireAuthApi, (req, res) => maximoController.getContext(req, res));
app.get('/api/memory', requireAuthApi, (req, res) => chatController.getMemory(req, res));
app.post('/api/memory/reset', requireAuthApi, (req, res) => chatController.resetMemory(req, res));
app.post('/api/approve-action', requireAuthApi, (req, res) => maximoController.approveAction(req, res, ollama, config.ollama.model, toolsSchema));
app.post('/api/chat', requireAuthApi, (req, res) => chatController.handleChat(req, res, ollama, config.ollama.model));

// User Conversation Management Endpoints
app.get('/api/conversations', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const data = conversationService.listConversations(username);
  res.json({ success: true, ...data });
});

app.get('/api/conversations/:id', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const conv = conversationService.getConversation(username, req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ success: true, conversation: conv });
});

app.post('/api/conversations', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const { title = 'New Conversation', site = 'TEST' } = req.body || {};
  const newConv = conversationService.createConversation(username, title, site);
  res.json({ success: true, conversation: newConv });
});

app.put('/api/conversations/:id/active', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const conv = conversationService.setActiveConversation(username, req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ success: true, conversation: conv });
});

app.delete('/api/conversations/:id', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const convId = req.params.id;
  const result = conversationService.deleteConversation(username, convId);
  try {
    ragService.deleteConversationDocs(convId);
  } catch (_) {}
  res.json(result);
});

app.put('/api/conversations/:id/rename', requireAuthApi, (req, res) => {
  const username = req.user?.username || 'admin';
  const { title } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }
  const updated = conversationService.renameConversation(username, req.params.id, title.trim());
  if (!updated) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ success: true, conversation: updated });
});

// Technical Knowledge Base & RAG Endpoints
app.get('/api/docs', requireAuthApi, (req, res) => {
  try {
    const { conversationId } = req.query;
    const username = req.user?.username || 'admin';
    const docs = ragService.listDocuments(conversationId || null, username);
    res.json({ success: true, count: docs.length, documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docs/upload', requireAuthApi, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No document file provided.' });
    const conversationId = req.body?.conversationId || 'global';
    const username = req.user?.username || 'admin';
    // Correct Arabic and non-ASCII filenames from multipart encoding
    let originalName = req.file.originalname;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (_) {}
    const result = await ragService.indexFile(req.file.path, originalName, conversationId, username);
    res.json({ 
      success: true, 
      message: `Successfully extracted and indexed ${result.chunkCount} passages from ${result.fileName}${conversationId !== 'global' ? ' for this conversation' : ''}.`, 
      ...result 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docs/sync', requireAuthApi, async (req, res) => {
  try {
    const results = await ragService.syncFolder();
    res.json({ success: true, synced: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/docs/:name', requireAuthApi, (req, res) => {
  try {
    const { conversationId } = req.query;
    const username = req.user?.username || 'admin';
    const result = ragService.deleteDocument(req.params.name, conversationId || null, username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const server = app.listen(config.port, async () => {
  // Initialize external MCP server connections from mcp_config.json
  await mcpClientManager.initialize();
  console.log(`=========================================`);
  console.log(`Maximo AI Agent running at http://localhost:${config.port}`);
  console.log(`Model: ${config.ollama.model} via Ollama`);
  console.log(`Registered Tools: ${toolsSchema.length}`);
  console.log(`=========================================`);
});

// Configure generous timeouts (5 minutes) for long RAG and LLM syntheses
server.timeout = 300000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;