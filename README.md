# ⚙️ IBM Maximo AI Assistant

An intelligent, production-ready AI copilot for **IBM Maximo Asset Management (7.6 / MAS 8 / MAS 9)** powered by local offline LLMs via **Ollama**, resilient **Redis session management**, and an ultra-fast **Deterministic Intent Router**.

Designed for enterprise reliability, offline security, human-in-the-loop safety, and high-speed execution even on CPU-only infrastructure.

---

## 🌟 Key Features

- **⚡ Fast Intent Router (<50ms Dispatch)**:
  - Bypasses LLM deliberation latency for routine queries (Work Order counts, Asset lists, Inventory alerts, Job Plans, KPIs, Overdue tasks).
  - Eliminates small-model hallucinations and pseudo-code leakage.
- **🛡️ Human-In-The-Loop (HITL) Safety Guard**:
  - Automatically intercepts data-mutating actions (`create_maximo_work_order`, `update_maximo_work_order_status`, `create_service_request`, `route_maximo_workflow`).
  - Requires explicit technician or supervisor confirmation before writing to Maximo OSLC APIs.
- **🧠 Concurrency-Safe Memory & Distributed Redis Store**:
  - Preserves working context (active site, last mentioned asset, location, department, work type).
  - Multi-user isolation using **Redis** with seamless automatic fallback to local memory & Markdown audit trail (`data/memory.md`).
- **🔒 100% On-Premise & Air-Gapped Ready**:
  - Runs with local open-weights LLMs (`qwen2.5:1.5b` or `qwen2.5:3b`) via Ollama. No proprietary cloud dependencies.
- **🌐 Bilingual Support**:
  - Full natural language querying in both **English** and **Arabic**.

---

## 🛠️ Registered Tools & Maximo Capabilities (31 Tools)

### 1. Work Orders & Maintenance Operations
- `get_maximo_work_orders`: Query filtered work orders by status (`INPRG`, `WAPPR`, `APPR`, etc.), location, and site.
- `get_work_order_count`: Fast count of work orders matching status filters.
- `create_maximo_work_order`: Create new work orders with automated department (`MECH`, `ELEC`, `CIVIL`, etc.) and work type (`CM`, `RT`, `EM`, `PRJ`) mapping *(Requires Confirmation)*.
- `update_maximo_work_order_status`: Change work order status *(Requires Confirmation)*.
- `get_overdue_work_orders`: Flag backlog work orders that missed their target completion dates.
- `route_maximo_workflow`: Progress work orders through active Maximo workflows.

### 2. Assets & Locations
- `get_asset_details`: Comprehensive operational metadata, status, and vendor info for a specific asset tag.
- `get_asset_count`: Instant asset counts by site or operational status.
- `get_assets`: Query lists of assets for an active site.
- `get_locations`: List operating locations across facilities and plants.
- `get_sites`: Retrieve all active IBM Maximo operating site IDs.

### 3. Storerooms & Spare Parts Inventory
- `check_inventory`: Check available current balances for parts across storerooms (e.g. `BEARING-01`).
- `get_inventory_alerts`: Proactive alerts for parts reaching or falling below safety stock/reorder thresholds.

### 4. Service Requests (SR)
- `get_service_request_count`: Backlog and status counts for incoming user tickets.
- `create_service_request`: Submit client/tenant service requests with automated category tagging *(Requires Confirmation)*.

### 5. Standards & Troubleshooting
- `get_job_plans`: Query standardized Job Plans (JPs), duration, and scheduled task templates.
- `get_failure_codes`: Lookup Maximo failure code hierarchies to standardize incident reporting.

### 6. Executive, Director & CEO Analytics
- `get_maintenance_kpis`: High-level operational health dashboard (active backlog, completion rate, status breakdown).
- `get_executive_cost_summary`: Maintenance financial spend breakdown across labor, materials, tools, and contractor services.
- `get_budget_variance_analysis`: Executive financial report comparing actual maintenance expenditure against estimated budgets with variance dollars and department breakdown.
- `get_vendor_sla_performance`: Third-party contractor scorecard measuring SLA compliance rates, on-time deliveries, and breach counts.
- `get_asset_lifecycle_forecast`: CAPEX replacement forecast identifying equipment where cumulative repairs exceed asset replacement value.
- `get_reliability_metrics`: MTTR (Mean Time to Repair), Proactive vs. Reactive maintenance ratios, and Top 5 Bad Actor assets.
- `get_multi_site_reliability_league`: Cross-site comprehensive league comparing CM Ratio %, PM Compliance %, Active Backlog, MTTR (hrs), and RT Comparison ratio side-by-side with industry targets.
- `get_asset_criticality_risk_matrix`: Operational risk matrix assessing high-consequence failure probability, RPN scores, and vulnerable single points of failure.
- `generate_executive_audit_brief`: Consolidated boardroom executive memo synthesizing budget variance, reliability adherence, contractor SLA breaches, and strategic decisions.

### 7. Technical Knowledge Base (RAG) & Document QA (Tool #31)
- `search_knowledge_base`: Semantic vector and keyword search across internal OEM equipment manuals, standard operating procedures (SOPs), HSE guidelines, and executive maintenance policy PDFs.
- **📎 Direct PDF Upload**: Upload manuals directly from the UI or drop them into `knowledge_docs/`.
- **📚 Explorer Knowledge Tab**: View indexed document chunks, file sizes, and sync or remove documents anytime.

### 8. Diagnostics & Advanced OSLC
- `advanced_maximo_query`: Custom OSLC REST where-clauses across `MXWO`, `MXSR`, `MXASSET`, and `MXINVENTORY`.
- `search_web`: External search for vendor manuals and troubleshooting guides (via Tavily).

---

## 🏗️ Architecture Overview

```
Technician (Chat UI / API)
        │
        ▼
   [Express.js Server]
        │
        ├───► [Fast Intent Router] ────► [Maximo OSLC REST API] (Direct <50ms)
        │            │ (Fallback for complex prompts)
        │            ▼
        ├───► [Ollama Local LLM]
        │       (qwen2.5:1.5b / qwen2.5:3b)
        │            │
        ├───► [HITL Safety Interceptor] ──► [Redis Store / In-Memory Fallback]
        │            │
        └───► [Memory & Context Service] ──► [data/memory.md Audit Trail]
```

---

## 🚀 Getting Started

### Prerequisites
1. **Node.js**: v18.x or later.
2. **Ollama**: Installed and running locally.
3. **IBM Maximo 7.6 / MAS**: With OSLC REST API enabled and an authorized API key or credentials.
4. *(Optional)* **Redis**: For multi-technician production clustering.

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/SayedSaeed2/Maximo-AI-Assistant.git
cd Maximo-AI-Assistant
npm install
```

### 2. Pull the Local Model
For standard CPU systems (recommended for fast inference):
```bash
ollama pull qwen2.5:1.5b
```

For GPU-accelerated workstations (4GB+ VRAM):
```bash
ollama pull qwen2.5:3b
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory:
```properties
PORT=3000

# Ollama local model
OLLAMA_MODEL=qwen2.5:1.5b
OLLAMA_HOST=http://127.0.0.1:11434

# Maximo 7.6 OSLC REST API Configuration
MAXIMO_BASE_URL=http://<YOUR_MAXIMO_HOST>:<PORT>/maximo
MAXIMO_API_KEY=<YOUR_MAXIMO_API_KEY>
MAXIMO_DEFAULT_SITE=TEST

# Optional: External Search
TAVILY_API_KEY=<YOUR_TAVILY_API_KEY>

# Optional: Distributed Redis (Defaults to in-memory fallback if not running)
REDIS_URL=redis://127.0.0.1:6379
ENABLE_REDIS=true
```

### 4. Start the Application
```bash
npm start
```
The application will be running at `http://localhost:3000`.

---

## 💬 Sample Prompts to Try

| Category | Example Prompt |
| :--- | :--- |
| **Work Orders** | *"Show in-progress work orders in location TEST"* |
| **Asset Count** | *"How many assets are registered in site TEST?"* |
| **Inventory** | *"Check inventory balance for item BEARING-01"* |
| **Critical Stock** | *"Show low stock inventory alerts"* |
| **Creation (HITL)** | *"Create a corrective work order for asset ASSET124 in department MECH"* |
| **Status Updates** | *"Update work order WO-499627 status to APPR"* |
| **Executive KPIs** | *"Show maintenance KPI dashboard"* |
| **Failure Analysis** | *"Lookup failure codes for pumps"* |

---

## 🛡️ License
Distributed under the MIT License. See `LICENSE` for more information.
