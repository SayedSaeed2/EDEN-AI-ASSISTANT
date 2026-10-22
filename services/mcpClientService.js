/**
 * External MCP Client Manager for Maximo AI Agent
 * 
 * Allows the Maximo Agent application to connect to external MCP servers
 * (such as Databases, Weather, SCADA, SAP, File Systems, Git, etc.),
 * dynamically import their tools into the agent's Ollama tool schema,
 * and dispatch execution requests directly over Stdio or SSE.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', 'mcp_config.json');

class ExternalMcpManager {
  constructor() {
    this.clients = new Map(); // serverKey -> { client, transport, config, tools }
    this.externalTools = [];   // Array of { name, description, schema, serverKey }
    this.isInitialized = false;
  }

  loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { mcpServers: {} };
    }
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[MCP Client Manager] Failed to parse mcp_config.json:', err.message);
      return { mcpServers: {} };
    }
  }

  async initialize() {
    if (this.isInitialized) return;
    const config = this.loadConfig();
    const servers = config.mcpServers || {};

    const serverKeys = Object.keys(servers);
    if (serverKeys.length === 0) {
      console.log('ℹ️ [MCP Client Manager] No external MCP servers configured in mcp_config.json.');
      this.isInitialized = true;
      return;
    }

    for (const key of serverKeys) {
      const srvConf = servers[key];
      if (srvConf.enabled === false) {
        console.log(`ℹ️ [MCP Client Manager] Server '${key}' is disabled. Skipping.`);
        continue;
      }

      await this.connectServer(key, srvConf);
    }

    this.isInitialized = true;
  }

  async connectServer(key, srvConf) {
    try {
      console.log(`🔌 [MCP Client Manager] Connecting to external MCP server: '${key}' (${srvConf.command})...`);

      const transport = new StdioClientTransport({
        command: srvConf.command,
        args: srvConf.args || [],
        env: {
          ...process.env,
          ...(srvConf.env || {})
        }
      });

      const client = new Client(
        {
          name: 'maximo-agent-client',
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      await client.connect(transport);
      console.log(`✅ [MCP Client Manager] Connected to external MCP server '${key}'!`);

      // Discover tools
      const toolsResult = await client.listTools();
      const discoveredTools = toolsResult.tools || [];
      console.log(`📦 [MCP Client Manager] Discovered ${discoveredTools.length} tools from '${key}'!`);

      const toolEntries = discoveredTools.map(t => ({
        name: t.name,
        description: t.description || `External MCP Tool provided by ${key}`,
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        serverKey: key
      }));

      this.clients.set(key, {
        client,
        transport,
        config: srvConf,
        tools: toolEntries
      });

      // Update aggregate tools
      this.refreshExternalTools();
    } catch (err) {
      console.error(`❌ [MCP Client Manager] Failed to connect to external MCP server '${key}':`, err.message);
    }
  }

  refreshExternalTools() {
    const list = [];
    for (const [key, entry] of this.clients.entries()) {
      for (const t of entry.tools) {
        list.push({
          ...t,
          serverKey: key
        });
      }
    }
    this.externalTools = list;
  }

  getExternalToolsSchema() {
    // If specific modules or tools are whitelisted in mcp_config.json, filter them; otherwise export all
    const config = this.loadConfig();
    const enabledModules = config.enabledModules || null; // e.g. ['po', 'inventory', 'labor', 'pm']

    let toolsToExport = this.externalTools;
    if (Array.isArray(enabledModules) && enabledModules.length > 0) {
      toolsToExport = this.externalTools.filter(t => {
        return enabledModules.some(mod => t.name.toLowerCase().includes(mod.toLowerCase()));
      });
    }

    return toolsToExport.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: `[MAS 9.x MCP] ${t.description}`,
        parameters: t.inputSchema
      }
    }));
  }

  hasTool(toolName) {
    return this.externalTools.some(t => t.name === toolName);
  }

  async executeExternalTool(toolName, args = {}) {
    const toolMeta = this.externalTools.find(t => t.name === toolName);
    if (!toolMeta) {
      throw new Error(`External MCP Tool '${toolName}' not found.`);
    }

    const entry = this.clients.get(toolMeta.serverKey);
    if (!entry || !entry.client) {
      throw new Error(`MCP Client for server '${toolMeta.serverKey}' is not active.`);
    }

    console.log(`⚡ [MCP Client Manager] Executing external MCP tool '${toolName}' on '${toolMeta.serverKey}'...`);
    const response = await entry.client.callTool({
      name: toolName,
      arguments: args
    });

    if (response.isError) {
      const errText = response.content?.map(c => c.text).join('\n') || 'Unknown MCP execution error';
      return { error: `[MCP Server Error: ${toolMeta.serverKey}] ${errText}` };
    }

    // Unwrap nested MCP text wrappers (handles servers that double-encode JSON)
    let extracted = response;
    let iterations = 0;
    while (extracted && typeof extracted === 'object' && Array.isArray(extracted.content) && extracted.content[0]?.text && iterations < 3) {
      iterations++;
      try {
        extracted = JSON.parse(extracted.content[0].text);
      } catch {
        extracted = { result: extracted.content[0].text };
        break;
      }
    }

    if (typeof extracted === 'string') {
      try { return JSON.parse(extracted); } catch { return { result: extracted }; }
    }

    return extracted;
  }

  async disconnectAll() {
    for (const [key, entry] of this.clients.entries()) {
      try {
        await entry.transport.close();
        console.log(`🔌 [MCP Client Manager] Disconnected external MCP server '${key}'.`);
      } catch (e) {
        // ignore
      }
    }
    this.clients.clear();
    this.externalTools = [];
    this.isInitialized = false;
  }
}

export const mcpClientManager = new ExternalMcpManager();
