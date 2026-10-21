# IBM Maximo Enterprise EAM — Model Context Protocol (MCP) Server

This project includes a native, full-featured **Model Context Protocol (MCP) Server** ([`mcp-server.js`](file:///d:/ss/WSH/maximo-agent/mcp-server.js)) adhering to the official [Anthropic MCP Specification](https://modelcontextprotocol.io/).

It allows any MCP-compatible AI client (Cursor, Claude Desktop, Claude Code, Google Antigravity, VS Code Copilot, or custom LLM agents) to directly interact with your IBM Maximo EAM environment.

---

## 🚀 Capabilities Provided by the MCP Server

1. **56 EAM Tools**:
   - **Work Order Management**: `get_maximo_work_orders`, `create_maximo_work_order`, `update_maximo_work_order_status`, `get_work_order_count`
   - **Asset & Machine Passport**: `get_asset_details`, `get_machine_card`, `get_asset_count`, `get_assets`
   - **Preventive Maintenance**: `get_ppm_forecast`, `propose_pm_frequency_update`
   - **Service Requests (SR Desk)**: `get_service_requests`, `create_service_request`, `get_service_request_count`
   - **Site Reliability & KPIs**: `get_site_kpi_scorecard` (CM Ratio, PM Compliance, Active Backlog, MTTR, MTBF, Availability)
   - **Multi-Site & Federation**: `get_multi_site_reliability_league`, `get_federated_portfolio_summary`, `get_federated_asset_count`
   - **FMEA & RCM Failure Modeling**: `calculate_fmea_rpn`, `build_iso14224_failure_hierarchy`, `generate_rcm_decision_logic`, `propose_fmea_jobplan_update`
   - **ISO 55000 / Db2 SQL**: `generate_maximo_kpi_manager_sql`, `calculate_reliability_availability_kpis`, `calculate_work_management_kpis`, `propose_iso55001_capa_action`

2. **Dynamic Resources**:
   - `maximo://sites` — Real-time list of all operating facility sites and descriptions.
   - `maximo://system-info` — Connected Maximo server instance URL, active site, and API telemetry.

3. **Pre-Engineered Prompts**:
   - `site_kpi_audit` — Prompts the AI model to conduct an audit-grade reliability scorecard for a site.
   - `rca_investigation` — Guides a structured 5-Whys root cause analysis on a failure work order.

---

## 🛠️ How to Connect to MCP Clients

### 1. Claude Desktop Configuration
Add the server configuration to your `claude_desktop_config.json`:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ibm-maximo-eam": {
      "command": "node",
      "args": ["d:/ss/WSH/maximo-agent/mcp-server.js"],
      "env": {
        "MAXIMO_BASE_URL": "http://172.16.128.18:9070/maximo",
        "MAXIMO_API_KEY": "kr87423897l3fu7qhffrl3q662kd2uec4gfue60c",
        "MAXIMO_DEFAULT_SITE": "TEST"
      }
    }
  }
}
```

### 2. Cursor IDE / Claude Code Configuration
In Cursor or Claude Code, configure an MCP server using:
- **Command**: `node`
- **Arguments**: `d:/ss/WSH/maximo-agent/mcp-server.js`

### 3. Standalone Verification
You can verify the MCP server directly via npm:
```bash
npm run mcp
```
*(The server connects to stdio transport and awaits standard JSON-RPC 2.0 messages).*
