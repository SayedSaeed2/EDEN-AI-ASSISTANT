import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CONV_DIR = path.join(ROOT_DIR, 'data', 'conversations');

// Ensure data/conversations directory exists
if (!fs.existsSync(CONV_DIR)) {
  fs.mkdirSync(CONV_DIR, { recursive: true });
}

function getUserFilePath(username) {
  const safeName = (username || 'default_user').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CONV_DIR, `${safeName}.json`);
}

function loadUserStore(username) {
  const file = getUserFilePath(username);
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`[ConversationService] Corrupt file for ${username}, resetting.`);
    }
  }
  return { activeConversationId: null, conversations: [] };
}

function saveUserStore(username, data) {
  const file = getUserFilePath(username);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

export const conversationService = {
  // List all conversations for a user (summary without heavy message content)
  listConversations(username) {
    const store = loadUserStore(username);
    return {
      activeConversationId: store.activeConversationId,
      conversations: store.conversations.map(c => ({
        id: c.id,
        title: c.title,
        site: c.site,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: (c.messages || []).length
      }))
    };
  },

  // Get active or specific conversation
  getConversation(username, conversationId = null) {
    const store = loadUserStore(username);
    const targetId = conversationId || store.activeConversationId;
    if (!targetId) return null;
    return store.conversations.find(c => c.id === targetId) || null;
  },

  // Create a new conversation thread
  createConversation(username, initialTitle = 'New Conversation', site = 'TEST') {
    const store = loadUserStore(username);
    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newConv = {
      id,
      title: initialTitle,
      site,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };

    store.conversations.unshift(newConv);
    store.activeConversationId = id;
    saveUserStore(username, store);
    return newConv;
  },

  // Switch active conversation
  setActiveConversation(username, conversationId) {
    const store = loadUserStore(username);
    const exists = store.conversations.some(c => c.id === conversationId);
    if (!exists) return null;
    store.activeConversationId = conversationId;
    saveUserStore(username, store);
    return this.getConversation(username, conversationId);
  },

  // Save/Append messages to conversation
  saveMessages(username, conversationId, messages, executedTools = [], site = null) {
    const store = loadUserStore(username);
    let conv = store.conversations.find(c => c.id === conversationId);

    if (!conv) {
      // Auto-create if not exists
      const id = conversationId || `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      conv = {
        id,
        title: 'New Conversation',
        site: site || 'TEST',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      store.conversations.unshift(conv);
      store.activeConversationId = id;
    }

    conv.messages = messages;
    conv.updatedAt = new Date().toISOString();
    if (site) conv.site = site;

    // Auto-generate title from first user message if title is default
    if ((conv.title === 'New Conversation' || !conv.title) && messages.length > 0) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content) {
        const rawTitle = firstUserMsg.content.trim().replace(/\n/g, ' ');
        conv.title = rawTitle.length > 35 ? rawTitle.substring(0, 35) + '...' : rawTitle;
      }
    }

    saveUserStore(username, store);
    return conv;
  },

  // Delete a conversation thread
  deleteConversation(username, conversationId) {
    const store = loadUserStore(username);
    store.conversations = store.conversations.filter(c => c.id !== conversationId);
    if (store.activeConversationId === conversationId) {
      store.activeConversationId = store.conversations[0]?.id || null;
    }
    saveUserStore(username, store);
    return { success: true, activeConversationId: store.activeConversationId };
  },

  // Rename a conversation thread
  renameConversation(username, conversationId, newTitle) {
    const store = loadUserStore(username);
    const conv = store.conversations.find(c => c.id === conversationId);
    if (!conv) return null;
    conv.title = (newTitle || 'Untitled Chat').trim();
    conv.updatedAt = new Date().toISOString();
    saveUserStore(username, store);
    return conv;
  },

  // Clear all conversations for a user
  clearAllConversations(username) {
    const store = { activeConversationId: null, conversations: [] };
    saveUserStore(username, store);
    return { success: true };
  }
};
