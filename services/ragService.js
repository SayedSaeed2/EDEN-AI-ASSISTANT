import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { Ollama } from 'ollama';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DOCS_DIR = path.join(ROOT_DIR, 'knowledge_docs');
const INDEX_FILE = path.join(ROOT_DIR, 'data', 'knowledge_index.json');

// Ensure directories exist
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
const dataDir = path.dirname(INDEX_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const ollama = new Ollama({ host: config.ollama.host });
// Embedding model: use nomic-embed-text (fast dedicated 137M vector embedder)
const EMBED_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Simple chunking utility (500 words with 100 word overlap)
function chunkText(text, docName, chunkSize = 400, overlap = 80) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const chunks = [];
  let i = 0;
  let chunkIndex = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    const content = chunkWords.join(' ').trim();
    if (content.length > 30) {
      chunks.push({
        id: `${docName}_chunk_${chunkIndex}`,
        docName,
        chunkIndex,
        content
      });
      chunkIndex++;
    }
    i += (chunkSize - overlap);
  }
  return chunks;
}

export const ragService = {
  // Load saved vector index from disk
  loadIndex() {
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const raw = fs.readFileSync(INDEX_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[RAG] Failed to load index file, resetting:', e.message);
    }
    return { documents: [], chunks: [] };
  },

  // Save index to disk
  saveIndex(indexData) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2), 'utf8');
  },

  // Get list of indexed documents (filtered by conversation and user privacy)
  listDocuments(conversationId = null, username = null) {
    const index = this.loadIndex();
    const docs = index.documents || [];
    const filtered = docs.filter(d => {
      // Global organization docs are accessible to everyone
      const isGlobal = !d.conversationId || d.conversationId === 'global';
      if (isGlobal) return true;

      // If document was uploaded by a user, ensure it belongs to the requesting user
      if (d.uploadedBy && username && d.uploadedBy !== username) {
        return false;
      }

      // If conversationId is specified, match it
      if (conversationId) {
        return d.conversationId === conversationId;
      }

      return true;
    });

    return filtered.map(d => ({
      name: d.name,
      sizeBytes: d.sizeBytes,
      chunkCount: d.chunkCount,
      indexedAt: d.indexedAt,
      conversationId: d.conversationId || 'global',
      uploadedBy: d.uploadedBy || 'system'
    }));
  },

  // Generate embedding using Ollama nomic-embed-text or lightweight fallback
  async getEmbedding(text) {
    try {
      const res = await ollama.embeddings({
        model: EMBED_MODEL,
        prompt: text.slice(0, 2000)
      });
      return res.embedding;
    } catch (err) {
      // Graceful term-vector fallback if model isn't pulled yet
      return null;
    }
  },

  // Ingest and index a single file with optional conversationId and user scope
  async indexFile(filePath, originalName, conversationId = 'global', username = 'system') {
    const fileName = originalName || path.basename(filePath);
    let extractedText = '';

    if (fileName.toLowerCase().endsWith('.pdf')) {
      const dataBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const textResult = await parser.getText();
      extractedText = textResult.text || '';
      await parser.destroy();
    } else {
      // Text / Markdown / Word-text
      extractedText = fs.readFileSync(filePath, 'utf8');
    }

    // Check for scanned / empty PDFs that only contain page number markers (e.g. "-- 1 of 42 --")
    const substantiveText = extractedText.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').trim();
    if (!substantiveText || substantiveText.length < 50) {
      throw new Error(`The document "${fileName}" appears to be a scanned PDF (image-only) with no selectable text. Please upload a PDF with an embedded text (OCR) layer.`);
    }

    const chunks = chunkText(extractedText, fileName);
    console.log(`[RAG] Extracted ${chunks.length} chunks from ${fileName} (Conversation: ${conversationId}, User: ${username})`);

    // Compute embeddings for chunks in concurrent batches
    const BATCH_SIZE = 8;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (chunk) => {
          chunk.conversationId = conversationId;
          chunk.uploadedBy = username;
          chunk.embedding = await this.getEmbedding(chunk.content);
        })
      );
    }

    // Update global index
    const index = this.loadIndex();
    // Remove previous version of doc if exists within the same scope
    index.documents = (index.documents || []).filter(d => !(d.name === fileName && (d.conversationId || 'global') === conversationId && (d.uploadedBy || 'system') === username));
    index.chunks = (index.chunks || []).filter(c => !(c.docName === fileName && (c.conversationId || 'global') === conversationId && (c.uploadedBy || 'system') === username));

    const stat = fs.statSync(filePath);
    index.documents.push({
      name: fileName,
      sizeBytes: stat.size,
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString(),
      conversationId: conversationId || 'global',
      uploadedBy: username || 'system'
    });
    index.chunks.push(...chunks);

    this.saveIndex(index);
    return { fileName, chunkCount: chunks.length, conversationId, uploadedBy: username };
  },

  // Scan and index all files in knowledge_docs/ folder
  async syncFolder() {
    const files = fs.readdirSync(DOCS_DIR).filter(f => !f.startsWith('.'));
    const results = [];
    for (const f of files) {
      const fullPath = path.join(DOCS_DIR, f);
      if (fs.statSync(fullPath).isFile()) {
        try {
          const res = await this.indexFile(fullPath, f, 'global', 'system');
          results.push({ name: f, status: 'indexed', chunks: res.chunkCount });
        } catch (e) {
          results.push({ name: f, status: 'error', error: e.message });
        }
      }
    }
    return results;
  },

  // Delete a document from the index with owner check
  deleteDocument(fileName, conversationId = null, username = null) {
    const index = this.loadIndex();
    index.documents = (index.documents || []).filter(d => {
      if (d.name !== fileName) return true;
      if (conversationId && d.conversationId && d.conversationId !== conversationId) return true;
      if (username && d.uploadedBy && d.uploadedBy !== 'system' && d.uploadedBy !== username) return true;
      return false;
    });
    index.chunks = (index.chunks || []).filter(c => {
      if (c.docName !== fileName) return true;
      if (conversationId && c.conversationId && c.conversationId !== conversationId) return true;
      if (username && c.uploadedBy && c.uploadedBy !== 'system' && c.uploadedBy !== username) return true;
      return false;
    });
    this.saveIndex(index);

    // If global doc, also clean from knowledge_docs
    if (!conversationId || conversationId === 'global') {
      const diskPath = path.join(DOCS_DIR, fileName);
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch (_) {}
      }
    }
    return { success: true, deleted: fileName };
  },

  // Delete all documents associated with a deleted conversation thread
  deleteConversationDocs(conversationId) {
    if (!conversationId) return;
    const index = this.loadIndex();
    index.documents = (index.documents || []).filter(d => d.conversationId !== conversationId);
    index.chunks = (index.chunks || []).filter(c => c.conversationId !== conversationId);
    this.saveIndex(index);
  },

  // Search knowledge base with optional conversationId and user privacy filtering
  async search(query, topK = 4, conversationId = null, username = null) {
    const index = this.loadIndex();
    if (!index.chunks || index.chunks.length === 0) {
      return {
        query,
        count: 0,
        results: [],
        message: 'No technical documents or manuals are indexed yet. Please upload a PDF or add files to knowledge_docs/.'
      };
    }

    // Filter chunks by user authorization & conversation scope:
    // 1. Never show other users' private uploads
    let accessibleChunks = index.chunks.filter(c => {
      if (!c.uploadedBy || c.uploadedBy === 'system') return true;
      if (username && c.uploadedBy === username) return true;
      return false;
    });

    let candidateChunks = accessibleChunks;
    if (conversationId) {
      const convChunks = accessibleChunks.filter(c => c.conversationId === conversationId);
      const globalChunks = accessibleChunks.filter(c => !c.conversationId || c.conversationId === 'global');
      candidateChunks = convChunks.length > 0 ? [...convChunks, ...globalChunks] : accessibleChunks;
    }

    if (candidateChunks.length === 0) {
      return {
        query,
        count: 0,
        results: [],
        message: 'No documents attached to this conversation or global knowledge base.'
      };
    }

    const queryEmbedding = await this.getEmbedding(query);
    const scoredChunks = [];

    // Clean query words for Arabic & English keyword matching
    const queryWords = query
      .replace(/[؟?.,!،;:()[\]{}"]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length >= 2);

    for (const chunk of candidateChunks) {
      let vectorScore = 0;
      if (queryEmbedding && chunk.embedding) {
        vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      }

      // Keyword match score (TF-IDF approximation)
      const textLower = chunk.content.toLowerCase();
      let matches = 0;
      let exactBonus = 0;

      queryWords.forEach(w => {
        if (textLower.includes(w)) {
          matches++;
          // Give higher weight if term appears multiple times or is a specialized keyword
          const count = (textLower.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          exactBonus += Math.min(count, 3) * 0.05;
        }
      });

      const keywordRatio = queryWords.length > 0 ? (matches / queryWords.length) : 0;
      const keywordScore = Math.min(1.0, keywordRatio + exactBonus);

      // Prioritize conversation-specific uploads over global docs
      const scopeMultiplier = (conversationId && chunk.conversationId === conversationId) ? 1.25 : 1.0;

      // Hybrid scoring: 60% semantic embedding + 40% keyword match
      const finalScore = queryEmbedding && chunk.embedding
        ? ((vectorScore * 0.6) + (keywordScore * 0.4)) * scopeMultiplier
        : (keywordScore) * scopeMultiplier;

      scoredChunks.push({
        docName: chunk.docName,
        conversationId: chunk.conversationId || 'global',
        content: chunk.content,
        score: Math.round(finalScore * 100) / 100,
        isChatSpecific: chunk.conversationId === conversationId
      });
    }

    // Sort descending by relevance score
    scoredChunks.sort((a, b) => b.score - a.score);
    const topResults = scoredChunks.slice(0, topK);

    return {
      query,
      count: topResults.length,
      conversationId,
      results: topResults
    };
  }
};
