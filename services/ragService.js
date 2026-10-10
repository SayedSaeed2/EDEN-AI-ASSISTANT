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
// Default embedding model: nomic-embed-text (or fallback to basic TF-IDF / term vectors if model not loaded)
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

  // Get list of indexed documents
  listDocuments() {
    const index = this.loadIndex();
    return index.documents.map(d => ({
      name: d.name,
      sizeBytes: d.sizeBytes,
      chunkCount: d.chunkCount,
      indexedAt: d.indexedAt
    }));
  },

  // Generate embedding using Ollama nomic-embed-text or lightweight fallback
  async getEmbedding(text) {
    try {
      const res = await ollama.embeddings({
        model: EMBED_MODEL,
        prompt: text.slice(0, 1500)
      });
      return res.embedding;
    } catch (err) {
      // Graceful term-vector fallback if nomic-embed-text isn't pulled yet
      return null;
    }
  },

  // Ingest and index a single file
  async indexFile(filePath, originalName) {
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

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(`Document ${fileName} contained no extractable text.`);
    }

    const chunks = chunkText(extractedText, fileName);
    console.log(`[RAG] Extracted ${chunks.length} chunks from ${fileName}`);

    // Compute embeddings for each chunk
    for (const chunk of chunks) {
      chunk.embedding = await this.getEmbedding(chunk.content);
    }

    // Update global index
    const index = this.loadIndex();
    // Remove previous version of doc if exists
    index.documents = index.documents.filter(d => d.name !== fileName);
    index.chunks = index.chunks.filter(c => c.docName !== fileName);

    const stat = fs.statSync(filePath);
    index.documents.push({
      name: fileName,
      sizeBytes: stat.size,
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString()
    });
    index.chunks.push(...chunks);

    this.saveIndex(index);
    return { fileName, chunkCount: chunks.length };
  },

  // Scan and index all files in knowledge_docs/ folder
  async syncFolder() {
    const files = fs.readdirSync(DOCS_DIR).filter(f => !f.startsWith('.'));
    const results = [];
    for (const f of files) {
      const fullPath = path.join(DOCS_DIR, f);
      if (fs.statSync(fullPath).isFile()) {
        try {
          const res = await this.indexFile(fullPath, f);
          results.push({ name: f, status: 'indexed', chunks: res.chunkCount });
        } catch (e) {
          results.push({ name: f, status: 'error', error: e.message });
        }
      }
    }
    return results;
  },

  // Delete a document from the index
  deleteDocument(fileName) {
    const index = this.loadIndex();
    index.documents = index.documents.filter(d => d.name !== fileName);
    index.chunks = index.chunks.filter(c => c.docName !== fileName);
    this.saveIndex(index);

    // Also delete from knowledge_docs if exists
    const diskPath = path.join(DOCS_DIR, fileName);
    if (fs.existsSync(diskPath)) {
      try { fs.unlinkSync(diskPath); } catch (_) {}
    }
    return { success: true, deleted: fileName };
  },

  // Search knowledge base for the most relevant excerpts
  async search(query, topK = 3) {
    const index = this.loadIndex();
    if (!index.chunks || index.chunks.length === 0) {
      return {
        query,
        count: 0,
        results: [],
        message: 'No technical documents or manuals are indexed yet. Please upload a PDF or add files to knowledge_docs/.'
      };
    }

    const queryEmbedding = await this.getEmbedding(query);
    const scoredChunks = [];

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    for (const chunk of index.chunks) {
      let score = 0;
      if (queryEmbedding && chunk.embedding) {
        score = cosineSimilarity(queryEmbedding, chunk.embedding);
      } else {
        // Keyword BM25/TF fallback if embeddings are unavailable
        const textLower = chunk.content.toLowerCase();
        let matches = 0;
        queryWords.forEach(w => {
          if (textLower.includes(w)) matches++;
        });
        score = matches / (queryWords.length || 1);
      }

      scoredChunks.push({
        docName: chunk.docName,
        content: chunk.content,
        score: Math.round(score * 100) / 100
      });
    }

    // Sort descending by relevance score
    scoredChunks.sort((a, b) => b.score - a.score);
    const topResults = scoredChunks.slice(0, topK);

    return {
      query,
      count: topResults.length,
      results: topResults
    };
  }
};
