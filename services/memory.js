import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.join(__dirname, '..', 'data');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.md');

// Session and Working Memory Store for Maximo AI Agent
// Persists working memory and conversation audit trail directly to Markdown (.md)
class MemoryService {
  constructor() {
    this.sessions = new Map();
    this.ensureDirectory();
    this.loadFromMarkdown();
  }

  ensureDirectory() {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
  }

  // Parse existing Markdown file on startup
  loadFromMarkdown() {
    if (!fs.existsSync(MEMORY_FILE)) {
      return;
    }

    try {
      const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
      const sessionBlocks = content.split(/^## Session: /m).slice(1);

      for (const block of sessionBlocks) {
        const lines = block.split('\n');
        const sessionId = lines[0].trim();

        const session = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          workingContext: {
            activeSite: 'TEST',
            lastMentionedAsset: null,
            lastMentionedLocation: null,
            lastMentionedDepartment: null,
            lastMentionedWorkType: null,
            lastMentionedWonum: null
          },
          messages: []
        };

        // Extract working context values from markdown table/bullets
        for (const line of lines) {
          const siteMatch = line.match(/- \*\*Active Site\*\*:\s*`([^`]+)`/);
          if (siteMatch) session.workingContext.activeSite = siteMatch[1];

          const assetMatch = line.match(/- \*\*In-Focus Asset\*\*:\s*`([^`]+)`/);
          if (assetMatch) session.workingContext.lastMentionedAsset = assetMatch[1];

          const locMatch = line.match(/- \*\*In-Focus Location\*\*:\s*`([^`]+)`/);
          if (locMatch) session.workingContext.lastMentionedLocation = locMatch[1];

          const deptMatch = line.match(/- \*\*Department\*\*:\s*`([^`]+)`/);
          if (deptMatch) session.workingContext.lastMentionedDepartment = deptMatch[1];

          const wtMatch = line.match(/- \*\*Work Type\*\*:\s*`([^`]+)`/);
          if (wtMatch) session.workingContext.lastMentionedWorkType = wtMatch[1];

          const woMatch = line.match(/- \*\*Recent Work Order\*\*:\s*`([^`]+)`/);
          if (woMatch) session.workingContext.lastMentionedWonum = woMatch[1];
        }

        this.sessions.set(sessionId, session);
      }
    } catch (err) {
      console.warn('Could not read memory.md on startup:', err.message);
    }
  }

  // Write all active sessions and context into human-readable Markdown
  saveToMarkdown() {
    try {
      this.ensureDirectory();
      let md = `# IBM Maximo AI Agent — Persistent Working Memory\n\n`;
      md += `> Automatically managed by MemoryService. Last synchronized: ${new Date().toISOString()}\n\n`;

      for (const [sessionId, session] of this.sessions.entries()) {
        const ctx = session.workingContext;
        md += `## Session: ${sessionId}\n\n`;
        md += `### 🧠 Active Working Context\n`;
        md += `- **Active Site**: \`${ctx.activeSite || 'N/A'}\`\n`;
        md += `- **In-Focus Asset**: \`${ctx.lastMentionedAsset || 'None'}\`\n`;
        md += `- **In-Focus Location**: \`${ctx.lastMentionedLocation || 'None'}\`\n`;
        md += `- **Department**: \`${ctx.lastMentionedDepartment || 'None'}\`\n`;
        md += `- **Work Type**: \`${ctx.lastMentionedWorkType || 'None'}\`\n`;
        md += `- **Recent Work Order**: \`${ctx.lastMentionedWonum || 'None'}\`\n\n`;
        md += `- *Last Active*: ${session.lastActive || new Date().toISOString()}\n\n`;
        md += `---\n\n`;
      }

      fs.writeFileSync(MEMORY_FILE, md, 'utf-8');
    } catch (err) {
      console.error('Failed to save memory to Markdown:', err.message);
    }
  }

  // Get or initialize a session
  getSession(sessionId = 'default-session') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        workingContext: {
          activeSite: 'TEST',
          lastMentionedAsset: null,
          lastMentionedLocation: null,
          lastMentionedDepartment: null,
          lastMentionedWorkType: null,
          lastMentionedWonum: null
        },
        messages: []
      });
      this.saveToMarkdown();
    }
    const session = this.sessions.get(sessionId);
    session.lastActive = new Date().toISOString();
    return session;
  }

  // Update working memory with detected entities from conversation or tool results
  updateWorkingContext(sessionId, updates = {}) {
    const session = this.getSession(sessionId);
    session.workingContext = {
      ...session.workingContext,
      ...updates
    };
    this.saveToMarkdown();
    return session.workingContext;
  }

  // Append user or assistant message to memory
  addMessage(sessionId, message) {
    const session = this.getSession(sessionId);
    session.messages.push({
      ...message,
      timestamp: new Date().toISOString()
    });
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }
    return session.messages;
  }

  // Clear or reset memory for a session
  clearSession(sessionId = 'default-session') {
    this.sessions.delete(sessionId);
    const session = this.getSession(sessionId);
    this.saveToMarkdown();
    return session;
  }

  // Format current memory into a prompt context block
  formatMemoryPrompt(sessionId) {
    const session = this.getSession(sessionId);
    const ctx = session.workingContext;
    
    const lines = [];
    if (ctx.activeSite) lines.push(`- Active Site: ${ctx.activeSite}`);
    if (ctx.lastMentionedAsset) lines.push(`- In-Focus Asset: ${ctx.lastMentionedAsset}`);
    if (ctx.lastMentionedLocation) lines.push(`- In-Focus Location: ${ctx.lastMentionedLocation}`);
    if (ctx.lastMentionedDepartment) lines.push(`- Selected Department: ${ctx.lastMentionedDepartment}`);
    if (ctx.lastMentionedWorkType) lines.push(`- Selected Work Type: ${ctx.lastMentionedWorkType}`);
    if (ctx.lastMentionedWonum) lines.push(`- Recently Handled Work Order: ${ctx.lastMentionedWonum}`);

    if (lines.length === 0) return 'No prior entities in memory.';
    return lines.join('\n');
  }
}

export const memoryService = new MemoryService();
