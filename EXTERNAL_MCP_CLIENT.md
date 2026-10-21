# External Model Context Protocol (MCP) Client Guide

The Eden Copilot / Maximo AI Agent application can connect to **any external MCP server** (e.g. SCADA systems, Weather services, PostgreSQL/Oracle/DB2 databases, SAP, GitHub, Slack, local file systems, etc.).

When an external MCP server is enabled, its tools are automatically discovered and injected into the agent's LLM context alongside native Maximo tools.

---

## ⚙️ Configuration: `mcp_config.json`

External MCP servers are configured in [`mcp_config.json`](file:///d:/ss/WSH/maximo-agent/mcp_config.json) in the project root:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "enabled": false,
      "description": "Example reference MCP server"
    },
    "postgres_db": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:password@localhost:5432/maint_db"],
      "enabled": false,
      "description": "PostgreSQL read/write for external telemetry"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "d:/ss/WSH/knowledge_docs"],
      "enabled": false,
      "description": "Local file system access"
    }
  }
}
```

---

## 🚀 How It Works

1. **Server Startup**:
   - On `npm start` (or when `server.js` boots), [`services/mcpClientService.js`](file:///d:/ss/WSH/maximo-agent/services/mcpClientService.js) iterates through `mcp_config.json`.
   - Spawns and connects to enabled external MCP servers over standard `stdio`.
   - Calls `listTools()` on each server to retrieve their schemas.

2. **Dynamic Tool Injection**:
   - The discovered external tools are prefixed with `[External MCP: <server_name>]` and injected into the LLM tool array via `getActiveToolsSchema()`.

3. **Tool Execution Dispatch**:
   - When the user asks a question requiring an external tool (e.g. querying a database, reading weather forecasts, or reading a local file), `executeTool` detects it is an external MCP tool.
   - Forwards the arguments to the corresponding external MCP server over `client.callTool()` and returns the live result back to the chat loop.

---

## 🧪 Testing with a Real External MCP Server

To test:
1. Open [`mcp_config.json`](file:///d:/ss/WSH/maximo-agent/mcp_config.json).
2. Set `"enabled": true` on any server (or add your custom MCP server).
3. Restart the agent (`npm start`).
4. Ask the agent a question related to that server in the chat interface!
