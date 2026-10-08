# IBM Maximo 7.6 AI Assistant & Reliability Agent

An enterprise agentic AI maintenance assistant that connects local Large Language Models (via **Ollama**) with **IBM Maximo 7.6** using native **OSLC REST APIs**, augmented with **Diagnostic Reasoning**, **Working Memory**, **Tavily Web Search**, and **Human-in-the-Loop (HITL)** governance.

---

## 🚀 Key Capabilities

1. **Diagnostic Reasoning (Chain-of-Thought)**:
   - Displays transparent, expandable `<thought>` blocks showing step-by-step diagnostic logic, entity resolution, and tool selection before executing actions.

2. **Session & Working Memory**:
   - Tracks operational entities across conversational turns:
     - Active Site (`activeSite`)
     - In-Focus Asset (`lastMentionedAsset`, e.g., `PUMP-101`)
     - Operating Location (`lastMentionedLocation`)
     - Executing Department (`lastMentionedDepartment`: `CIVIL`, `ELEC`, `ELEC-LC`, `HK`, `LS`, `MECH`)
     - Work Type (`lastMentionedWorkType`: `RT`, `CM`, `EM`, `PRJ`)
     - Handled Work Order (`lastMentionedWonum`)
   - Visual Memory status bar with real-time entity chips and a "Reset Memory" button.

3. **Maximo Explorer Sidebar**:
   - Browse live Maximo **Assets** and **Locations** directly in the interface.
   - Click any item to automatically populate actionable prompts.
   - Live search/filtering and Site Switcher.

4. **Human-In-The-Loop (HITL) Safety Guardrails**:
   - Mutating operations (`POST`/`PATCH` for Work Orders, Status updates, Service Requests, Workflows) are automatically intercepted.
   - Generates interactive **Approval Cards** with parameter inspection (`Confirm & Execute` or `Reject`).

5. **Executive Maintenance KPIs & Reliability Dashboard**:
   - Parallel site-wide KPI compilation (Active Backlog, Completion Rate, Status Breakdown).
   - Overdue Work Order detection.
   - Inventory low stock/reorder alerts.

6. **Strict Maximo 7.6 Field Compliance**:
   - Work Order / SR summary mapped directly to `DESCRIPTION`.
   - Executing department mapped to `EXEDEPT`.
   - Enforced Department validation: `CIVIL`, `ELEC`, `ELEC-LC`, `HK`, `LS`, `MECH`.
   - Enforced Work Type validation: `RT`, `CM`, `EM`, `PRJ`.

---

## 🛠️ Registered Tools & OSLC Mapping

| Tool Name | Maximo OSLC Object | Description | HITL Guard |
| :--- | :--- | :--- | :---: |
| `get_maximo_work_orders` | `MXWO` | Query work orders by status and site | No |
| `get_work_order_count` | `MXWO` | Exact total count of work orders | No |
| `create_maximo_work_order` | `MXWO` | Create WO with `DESCRIPTION`, `EXEDEPT`, `WORKTYPE`, `ASSETNUM`, `JPNUM` | **Yes** |
| `update_maximo_work_order_status` | `MXWO` | Update status (e.g., approve WO) | **Yes** |
| `route_maximo_workflow` | `MXWO` | Route record through Maximo Workflow | **Yes** |
| `get_maintenance_kpis` | `MXWO` / `MXSR` | Multi-metric dashboard & plant health | No |
| `get_overdue_work_orders` | `MXWO` | Active WOs past target completion date | No |
| `get_asset_details` | `MXASSET` | Technical specs and vendor details for target asset | No |
| `get_asset_count` | `MXASSET` | Total count of assets registered in site | No |
| `get_assets` | `MXASSET` | List assets with status, location, and vendor | No |
| `get_sites` | `MXSITE` | Active operational site IDs | No |
| `get_locations` | `MXOPERLOC` | Operating locations list for placement | No |
| `check_inventory` | `MXINVENTORY` | Current storeroom balance for a spare part | No |
| `get_inventory_alerts` | `MXINVENTORY` | Items below safety stock reorder thresholds | No |
| `get_service_request_count`| `MXSR` | Total Service Request ticket counts | No |
| `create_service_request` | `MXSR` | Log ticket with `DESCRIPTION`, `EXEDEPT`, `WORKTYPE` | **Yes** |
| `get_job_plans` | `MXJOBPLAN` | Search standard maintenance tasks & durations | No |
| `get_failure_codes` | `MXFAILURE` | Problem / Cause / Remedy hierarchy | No |
| `advanced_maximo_query` | Dynamic | Flexible OSLC `oslc.where` & `oslc.select` query | No |
| `search_web` | External | Tavily search for OEM manuals & troubleshooting | No |

---

## 📁 Project Architecture

```
maximo-agent/
├── config/
│   └── index.js              # Centralized environment configurations
├── controllers/
│   ├── chatController.js    # Agent reasoning loop, memory injection & prompt rules
│   └── maximoController.js  # Sites/Assets/Locations context & HITL approval handler
├── services/
│   ├── maximo.js            # IBM Maximo 7.6 OSLC REST client & business logic
│   ├── memory.js            # In-memory session tracking & working context store
│   ├── tools.js             # Declarative tool schema registry & dispatcher
│   └── tavily.js            # Tavily external search integration
├── public/
│   ├── css/
│   │   └── style.css        # Clean UI styling, reasoning accordions & memory chips
│   ├── js/
│   │   └── app.js           # Frontend logic, sidebar browsing & approval interactions
│   └── index.html           # Modular semantic layout with Maximo Explorer
├── server.js                # Express application entry point
├── package.json
├── .env                     # Environment variables (Maximo credentials, Ollama model)
└── README.md                # Documentation & Architecture Reference
```

---

## ⚙️ Configuration (`.env`)

```ini
PORT=3000

# Ollama local model
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_HOST=http://127.0.0.1:11434

# Tavily API Key
TAVILY_API_KEY=your-tavily-api-key

# Maximo 7.6 OSLC REST API
MAXIMO_BASE_URL=http://<maximo-host>:<port>/maximo
MAXIMO_API_KEY=your-maximo-api-key
MAXIMO_DEFAULT_SITE=TEST
```

---

## 🚦 Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Ensure Ollama is running**:
   ```bash
   ollama run qwen2.5:3b
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Access the application**:
   Open [http://localhost:3000](http://localhost:3000) in your browser.
