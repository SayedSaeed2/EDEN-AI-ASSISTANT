// Client-side Application Logic for Maximo AI Agent
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const siteSelect = document.getElementById('site-select');
const itemsList = document.getElementById('items-list');
const sidebarSearch = document.getElementById('sidebar-search');

let history = [];
let currentContext = { sites: [], assets: [], locations: [] };
let activeTab = 'assets';

// Initialize context from backend
async function loadContext(siteId = '') {
  try {
    const url = siteId ? `/api/context?siteid=${encodeURIComponent(siteId)}` : '/api/context';
    console.log('[loadContext] Fetching context from:', url);
    const res = await fetch(url);
    currentContext = await res.json();
    console.log('[loadContext] Received sites:', currentContext.sites);

    const el = document.getElementById('site-select') || siteSelect;
    const elMobile = document.getElementById('site-select-mobile');
    const selects = [el, elMobile].filter(Boolean);

    if (selects.length > 0) {
      const currentVal = siteId || currentContext.activeSite || (currentContext.sites?.[0]?.siteid) || 'TEST';

      selects.forEach(selectEl => {
        selectEl.innerHTML = '';
        if (Array.isArray(currentContext.sites) && currentContext.sites.length > 0) {
          currentContext.sites.forEach(s => {
            const opt = document.createElement('option');
            const id = typeof s === 'string' ? s : (s.siteid || s.id || '');
            const desc = typeof s === 'string' ? s : (s.description ? `${id} — ${s.description}` : id);
            opt.value = id;
            opt.textContent = desc;
            if (id === currentVal) opt.selected = true;
            selectEl.appendChild(opt);
          });
          selectEl.value = currentVal;
        } else {
          const opt = document.createElement('option');
          opt.value = currentVal;
          opt.textContent = currentVal;
          selectEl.appendChild(opt);
        }
      });
    }

    // Update memory chips to reflect active site
    renderMemoryChips({ activeSite: currentContext.activeSite });

    // Render Assets and Locations for this specific site
    renderSidebarItems();
  } catch (err) {
    console.error('[loadContext] Failed to load Maximo context:', err);
  }
}

// Render Assets or Locations in sidebar
function renderSidebarItems() {
  const query = (sidebarSearch.value || '').toLowerCase();
  itemsList.innerHTML = '';

  const items = activeTab === 'assets' ? currentContext.assets : currentContext.locations;

  const filtered = items.filter(item => {
    const code = (activeTab === 'assets' ? item.assetnum : item.location) || '';
    const desc = item.description || '';
    return code.toLowerCase().includes(query) || desc.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    itemsList.innerHTML = `<div style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">No ${activeTab} found</div>`;
    return;
  }

  filtered.forEach(item => {
    const code = activeTab === 'assets' ? item.assetnum : item.location;
    const desc = item.description || 'No description';
    const status = item.status || '';
    const extra = activeTab === 'assets' ? (item.location ? `Loc: ${item.location}` : '') : (item.type || '');

    const div = document.createElement('div');
    div.className = 'item-card';
    div.innerHTML = `
      <div class="item-code">${escapeHtml(code)}</div>
      <div class="item-desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>
      <div class="item-meta">
        <span>${escapeHtml(status)}</span>
        <span>${escapeHtml(extra)}</span>
      </div>
    `;

    // Click to insert into prompt and close mobile drawer
    div.onclick = () => {
      userInput.value = activeTab === 'assets'
        ? `Create a work order for asset ${code} in department MECH with work type CM`
        : `Check work orders in location ${code}`;
      userInput.focus();

      // If on mobile, dismiss the bottom drawer
      if (window.innerWidth <= 768) {
        toggleSidebar();
      }
    };

    itemsList.appendChild(div);
  });
}

// Switch between Assets and Locations tabs
window.switchTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderSidebarItems();
};

// Handle site change
siteSelect.addEventListener('change', () => {
  loadContext(siteSelect.value);
});

// Sidebar search filter
sidebarSearch.addEventListener('input', () => {
  renderSidebarItems();
});

// Chat submit handler
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = userInput.value.trim();
  if (!val) return;

  appendMessage(val, 'user');
  userInput.value = '';

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'msg-row';
  loadingDiv.innerHTML = `
    <div class="bubble bubble-agent">
      <div style="display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 13px;">
        <span class="pulse-indicator" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #6366f1; box-shadow: 0 0 10px #6366f1;"></span>
        <span>Processing request...</span>
      </div>
    </div>
  `;
  chatBox.appendChild(loadingDiv);
  chatBox.scrollTop = chatBox.scrollHeight;

  history.push({ role: 'user', content: val });

  try {
    const activeSite = siteSelect.value || 'TEST';
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: history,
        sessionId: 'default-session',
        siteid: activeSite
      })
    });

    loadingDiv.remove();
    const data = await res.json();
    if (data.memory) renderMemoryChips(data.memory);

    if (data.error) {
      appendMessage("Error: " + data.error, 'agent');
    } else if (data.requiresApproval) {
      appendApprovalCard(data);
    } else {
      history.push({ role: 'assistant', content: data.reply });
      appendMessage(data.reply, 'agent', data.executedTools);
    }
  } catch (err) {
    loadingDiv.remove();
    appendMessage("Network failure connecting to Express backend.", 'agent');
  }
});

// Render approval card for mutating action
function appendApprovalCard(data) {
  const row = document.createElement('div');
  row.className = 'msg-row';

  const cardId = `card_${data.actionId}`;
  const argsFormatted = JSON.stringify(data.toolArgs, null, 2);

  let reasoningHtml = '';
  if (data.reasoning) {
    reasoningHtml = `
      <div class="reasoning-box">
        <div class="reasoning-toggle" onclick="toggleReasoning(this)">
          <span>🧠 Thought Process</span> <span style="font-size: 10px;">▼</span>
        </div>
        <div class="reasoning-content">${escapeHtml(data.reasoning)}</div>
      </div>
    `;
  }

  row.innerHTML = `
    <div class="bubble bubble-agent" id="${cardId}">
      <div class="tool-badge">🛡️ Human Confirmation Required</div>
      ${reasoningHtml}
      <p>${escapeHtml(data.reply)}</p>
      <div class="approval-card">
        <div class="approval-title">⚡ Proposed Operation: <code>${escapeHtml(data.toolName)}</code></div>
        <div class="approval-details">${escapeHtml(argsFormatted)}</div>
        <div class="approval-btns">
          <button class="btn-approve" onclick="handleApproval('${data.actionId}', true, '${cardId}')">✓ Confirm & Execute</button>
          <button class="btn-reject" onclick="handleApproval('${data.actionId}', false, '${cardId}')">✕ Reject</button>
        </div>
      </div>
    </div>
  `;
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Execute or reject approved action
window.handleApproval = async function(actionId, approved, cardId) {
  const container = document.getElementById(cardId);
  if (container) {
    container.innerHTML = `<div style="color: #94a3b8; font-style: italic;">${approved ? 'Executing approved change in Maximo...' : 'Cancelling action...'}</div>`;
  }

  try {
    const res = await fetch('/api/approve-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionId,
        approved,
        conversation: history
      })
    });

    const data = await res.json();
    if (data.reply) {
      history.push({ role: 'assistant', content: data.reply });
      if (container) {
        const content = window.marked ? marked.parse(data.reply) : escapeHtml(data.reply);
        container.innerHTML = `<div class="tool-badge">${approved ? '✅ Executed with Approval' : '🚫 Cancelled'}</div>` + content;
      }
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div style="color: #f87171;">Failed to process action: ${escapeHtml(err.message)}</div>`;
    }
  }
};

// Append message bubble with reasoning thoughts & rich dashboard visual cards
function appendMessage(text, role, tools, reasoning) {
  const row = document.createElement('div');
  row.className = `msg-row ${role === 'user' ? 'msg-user' : ''}`;
  
  let toolHtml = '';
  let dashboardWidgetsHtml = '';

  if (tools && tools.length > 0) {
    toolHtml = tools.map(t => `<div class="tool-badge">⚡ Executed: ${t.tool}</div>`).join('');
    dashboardWidgetsHtml = renderDashboardWidgets(tools);
  }

  let reasoningHtml = '';
  if (role === 'agent' && reasoning) {
    reasoningHtml = `
      <div class="reasoning-box">
        <div class="reasoning-toggle" onclick="toggleReasoning(this)">
          <span>⛓️ Reasoning Chain (Thought Process)</span> <span style="font-size: 10px;">▼</span>
        </div>
        <div class="reasoning-content">${escapeHtml(reasoning)}</div>
      </div>
    `;
  }

  const content = role === 'agent' && window.marked ? marked.parse(text) : escapeHtml(text);
  row.innerHTML = `<div class="bubble bubble-${role}">${toolHtml}${reasoningHtml}${dashboardWidgetsHtml}${content}</div>`;
  chatBox.appendChild(row);

  // Automatically attach export action bars to all rendered data tables in agent bubble
  if (role === 'agent') {
    const bubble = row.querySelector('.bubble-agent');
    if (bubble) {
      const tables = bubble.querySelectorAll('table');
      tables.forEach((tbl, idx) => {
        // Skip if already has an export bar
        if (tbl.previousElementSibling && tbl.previousElementSibling.classList.contains('table-export-bar')) return;
        const exportBar = createTableExportBar(tbl, `maximo_report_${Date.now()}_${idx + 1}`);
        tbl.parentNode.insertBefore(exportBar, tbl);
      });
    }
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

// Build rich dashboard cards from tool execution outputs
function renderDashboardWidgets(tools) {
  if (!tools || !Array.isArray(tools)) return '';

  let html = '';

  for (const t of tools) {
    const res = t.result;
    if (!res || res.error) continue;

    // 1. Maintenance KPI Dashboard Widget
    if (t.tool === 'get_maintenance_kpis') {
      const summary = res.summary || {};
      const status = res.healthStatus || 'HEALTHY';
      const statusClass = status === 'HEALTHY' ? 'healthy' : (status === 'ATTENTION_NEEDED' ? 'warning' : 'critical');
      const breakdown = res.workOrderStatusBreakdown || {};

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>📊 Maintenance Operations KPI Dashboard</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${statusClass}">${escapeHtml(status.replace('_', ' '))}</span>
          </div>

          <div class="kpi-stat-grid">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Total Work Orders</span>
              <span class="kpi-stat-number">${summary.totalWorkOrders ?? 0}</span>
              <span class="kpi-stat-sub">Tracked in Maximo</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Active Backlog</span>
              <span class="kpi-stat-number" style="color: #fbbf24;">${summary.activeBacklog ?? 0}</span>
              <span class="kpi-stat-sub">WAPPR + APPR + INPRG</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Completion Rate</span>
              <span class="kpi-stat-number" style="color: #34d399;">${escapeHtml(String(summary.completionRate || '0%'))}</span>
              <span class="kpi-stat-sub">Resolved / Total</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Service Requests</span>
              <span class="kpi-stat-number" style="color: #38bdf8;">${summary.serviceRequestsBacklog ?? 0}</span>
              <span class="kpi-stat-sub">Active SR Queue</span>
            </div>
          </div>

          <div style="font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 8px; margin-bottom: 6px;">Work Order Status Distribution:</div>
          <div class="aging-bands-grid" style="grid-template-columns: repeat(5, 1fr);">
            <div class="aging-band-box" style="border-top-color: #f59e0b;"><div class="aging-band-val">${breakdown.waitingApproval_WAPPR ?? 0}</div><div class="aging-band-title">WAPPR</div></div>
            <div class="aging-band-box" style="border-top-color: #3b82f6;"><div class="aging-band-val">${breakdown.approved_APPR ?? 0}</div><div class="aging-band-title">APPR</div></div>
            <div class="aging-band-box" style="border-top-color: #8b5cf6;"><div class="aging-band-val">${breakdown.inProgress_INPRG ?? 0}</div><div class="aging-band-title">INPRG</div></div>
            <div class="aging-band-box" style="border-top-color: #10b981;"><div class="aging-band-val">${breakdown.completed_COMP ?? 0}</div><div class="aging-band-title">COMP</div></div>
            <div class="aging-band-box" style="border-top-color: #64748b;"><div class="aging-band-val">${breakdown.closed_CLOSE ?? 0}</div><div class="aging-band-title">CLOSE</div></div>
          </div>
        </div>
      `;
    }

    // 2. Reliability & Availability Dashboard Widget
    else if (t.tool === 'get_reliability_metrics') {
      const mix = res.maintenanceMix || {};
      const proactivePct = parseFloat(mix.proactiveRatio) || 0;
      const reactivePct = parseFloat(mix.reactiveRatio) || 0;
      const badActors = res.topBadActorAssets || [];

      let badActorsRows = '';
      if (badActors.length > 0) {
        badActorsRows = badActors.map(ba => `
          <tr>
            <td><span class="asset-tag-badge">${escapeHtml(ba.assetnum)}</span></td>
            <td><span class="breakdown-counter">${ba.breakdownWorkOrders} failures</span></td>
            <td style="color: #94a3b8; font-size: 11px;">Corrective / Breakdown</td>
          </tr>
        `).join('');
      } else {
        badActorsRows = `<tr><td colspan="3" style="text-align: center; color: #64748b;">No high-frequency bad actor assets recorded.</td></tr>`;
      }

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>📈 Reliability & Equipment Health Dashboard</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${proactivePct >= 70 ? 'healthy' : 'warning'}">${escapeHtml(res.proactivityRating || 'ANALYSIS')}</span>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(3, 1fr);">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">MTTR (Mean Time to Repair)</span>
              <span class="kpi-stat-number" style="color: #38bdf8;">${escapeHtml(res.meanTimeToRepair_MTTR || 'N/A')}</span>
              <span class="kpi-stat-sub">Target: ${escapeHtml(res.targetMTTR || '< 4.0 hrs')}</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Proactive Ratio (RT/PM)</span>
              <span class="kpi-stat-number" style="color: #10b981;">${escapeHtml(mix.proactiveRatio || '0%')}</span>
              <span class="kpi-stat-sub">${mix.plannedCount ?? 0} Planned Orders</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Reactive Ratio (CM/EM)</span>
              <span class="kpi-stat-number" style="color: #f87171;">${escapeHtml(mix.reactiveRatio || '0%')}</span>
              <span class="kpi-stat-sub">${mix.reactiveCount ?? 0} Breakdown Orders</span>
            </div>
          </div>

          <div class="mix-bar-container">
            <div class="mix-bar-labels">
              <span class="proactive-lbl">🛡️ Proactive Maintenance: ${escapeHtml(mix.proactiveRatio || '0%')}</span>
              <span class="reactive-lbl">⚠️ Reactive Firefighting: ${escapeHtml(mix.reactiveRatio || '0%')}</span>
            </div>
            <div class="mix-progress-track">
              <div class="mix-segment-proactive" style="width: ${proactivePct}%;"></div>
              <div class="mix-segment-reactive" style="width: ${reactivePct}%;"></div>
            </div>
          </div>

          <div style="margin-top: 14px;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">Top Bad Actor Assets (Highest Failure Frequency):</div>
            <table class="bad-actors-table">
              <thead>
                <tr>
                  <th>Asset Tag</th>
                  <th>Breakdown Count</th>
                  <th>Maintenance Strategy Focus</th>
                </tr>
              </thead>
              <tbody>
                ${badActorsRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // 3. Executive Financial Cost Breakdown Widget
    else if (t.tool === 'get_executive_cost_summary') {
      const breakdown = res.costBreakdown || {};
      const depts = Object.entries(res.departmentSpend || {});

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>💰 Executive Maintenance Spend & Cost Analysis</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill healthy">FISCAL OVERVIEW</span>
          </div>

          <div class="kpi-stat-grid">
            <div class="kpi-stat-box" style="grid-column: span 2;">
              <span class="kpi-stat-label">Total Actual Maintenance Spend</span>
              <span class="kpi-stat-number" style="color: #34d399; font-size: 24px;">${escapeHtml(res.totalCostFormatted || '$0.00')}</span>
              <span class="kpi-stat-sub">${res.workOrdersSampled || 0} Work Orders Sampled</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Labor Spend</span>
              <span class="kpi-stat-number" style="font-size: 17px;">$${(breakdown.labor?.amount || 0).toLocaleString()}</span>
              <span class="kpi-stat-sub">${breakdown.labor?.percentage || '0%'} of total</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Materials Spend</span>
              <span class="kpi-stat-number" style="font-size: 17px;">$${(breakdown.materials?.amount || 0).toLocaleString()}</span>
              <span class="kpi-stat-sub">${breakdown.materials?.percentage || '0%'} of total</span>
            </div>
          </div>

          <div class="aging-bands-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Contractor & Services Spend</span>
              <span class="kpi-stat-number" style="font-size: 16px; color: #38bdf8;">$${(breakdown.services_contractors?.amount || 0).toLocaleString()}</span>
              <span class="kpi-stat-sub">${breakdown.services_contractors?.percentage || '0%'}</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Tools & Machinery Rental</span>
              <span class="kpi-stat-number" style="font-size: 16px; color: #a78bfa;">$${(breakdown.tools?.amount || 0).toLocaleString()}</span>
              <span class="kpi-stat-sub">${breakdown.tools?.percentage || '0%'}</span>
            </div>
          </div>
        </div>
      `;
    }

    // 4. Backlog Aging Distribution Widget
    else if (t.tool === 'get_backlog_aging') {
      const dist = res.agingDistribution || {};
      const statusClass = res.backlogHealth === 'STABLE' ? 'healthy' : 'critical';

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>⏳ Backlog Aging Distribution Analysis</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${statusClass}">${escapeHtml((res.backlogHealth || 'STABLE').replace(/_/g, ' '))}</span>
          </div>

          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">
            Active Work Orders Backlog: <strong style="color: #f8fafc;">${res.totalActiveBacklog || 0}</strong>
          </div>

          <div class="aging-bands-grid">
            <div class="aging-band-box" style="border-top-color: #10b981;">
              <div class="aging-band-val">${dist['< 7 Days (Fresh)'] ?? 0}</div>
              <div class="aging-band-title">&lt; 7 Days (Fresh)</div>
            </div>
            <div class="aging-band-box" style="border-top-color: #3b82f6;">
              <div class="aging-band-val">${dist['7 - 30 Days (Normal)'] ?? 0}</div>
              <div class="aging-band-title">7 - 30 Days (Normal)</div>
            </div>
            <div class="aging-band-box" style="border-top-color: #f59e0b;">
              <div class="aging-band-val">${dist['30 - 90 Days (Aging)'] ?? 0}</div>
              <div class="aging-band-title">30 - 90 Days (Aging)</div>
            </div>
            <div class="aging-band-box urgent">
              <div class="aging-band-val" style="color: #f87171;">${dist['> 90 Days (Stagnant Risk)'] ?? 0}</div>
              <div class="aging-band-title">&gt; 90 Days (Stagnant Risk)</div>
            </div>
          </div>
        </div>
      `;
    }

    // 5. Cross-Site Benchmark Widget
    else if (t.tool === 'get_multi_site_benchmark') {
      const rankings = res.crossSiteRankings || [];
      const rows = rankings.map((r, i) => {
        const pillClass = r.healthRating === 'HEALTHY' ? 'healthy' : (r.healthRating === 'WARNING' ? 'warning' : 'critical');
        return `
          <tr>
            <td style="font-weight: 700; color: #94a3b8;">#${i + 1}</td>
            <td><span class="asset-tag-badge">${escapeHtml(r.siteid)}</span> <span style="font-size: 11px; color: #94a3b8;">${escapeHtml(r.description || '')}</span></td>
            <td style="font-weight: 700;">${r.totalWorkOrders}</td>
            <td style="color: #fbbf24;">${r.pendingApproval_WAPPR}</td>
            <td><span class="health-pill ${pillClass}" style="font-size: 9.5px; padding: 2px 6px;">${r.healthRating}</span></td>
          </tr>
        `;
      }).join('');

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>🌐 Cross-Site Multi-Site Benchmark League Table</span>
            </div>
            <span class="health-pill healthy">${res.sitesEvaluated || rankings.length} Sites Ranked</span>
          </div>

          <table class="bad-actors-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Site ID / Location</th>
                <th>Total Work Orders</th>
                <th>Unapproved Backlog (WAPPR)</th>
                <th>Health Rating</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }

    // 6. Executive Budget Variance Analysis Widget
    else if (t.tool === 'get_budget_variance_analysis') {
      const fin = res.financialSummary || {};
      const depts = res.spendByDepartment || [];
      const isOver = fin.budgetHealth === 'OVER_BUDGET';

      const deptRows = depts.map(d => `
        <tr>
          <td><span class="asset-tag-badge">${escapeHtml(d.department)}</span></td>
          <td style="font-weight: 700; color: #f1f5f9;">${escapeHtml(d.spend)}</td>
        </tr>
      `).join('');

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>📊 OPEX & Budget Variance Financial Analysis</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${isOver ? 'critical' : 'healthy'}">${escapeHtml(fin.budgetHealth || 'ON_TRACK')}</span>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(3, 1fr);">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Actual Expenditure</span>
              <span class="kpi-stat-number" style="color: #38bdf8;">${escapeHtml(fin.totalActualExpenditure || '$0')}</span>
              <span class="kpi-stat-sub">${res.sampleRecordsAnalyzed || 0} Records Analyzed</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Estimated Budget</span>
              <span class="kpi-stat-number" style="color: #94a3b8;">${escapeHtml(fin.totalEstimatedBudget || '$0')}</span>
              <span class="kpi-stat-sub">Baseline Allocation</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Budget Variance</span>
              <span class="kpi-stat-number" style="color: ${isOver ? '#f87171' : '#34d399'};">${escapeHtml(fin.varianceDollars || '$0')} (${escapeHtml(fin.variancePercent || '0%')})</span>
              <span class="kpi-stat-sub">${isOver ? '⚠️ Over Allocated Budget' : '✓ Under Budget'}</span>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">Expenditure by Executing Department:</div>
            <table class="bad-actors-table">
              <thead><tr><th>Department</th><th>Cumulative Actual Spend</th></tr></thead>
              <tbody>${deptRows || '<tr><td colspan="2">No spend recorded.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    // 7. Vendor & Contractor SLA Scorecard Widget
    else if (t.tool === 'get_vendor_sla_performance') {
      const cards = res.vendorScorecards || [];
      const cardRows = cards.map(v => {
        const pClass = v.performanceRating === 'EXCELLENT' ? 'healthy' : (v.performanceRating === 'SATISFACTORY' ? 'warning' : 'critical');
        return `
          <tr>
            <td><strong>${escapeHtml(v.vendor)}</strong></td>
            <td>${v.workOrdersAssigned}</td>
            <td>${v.onTimeDeliveries}</td>
            <td style="color: ${v.slaBreaches > 0 ? '#f87171' : '#34d399'}; font-weight: 700;">${v.slaBreaches}</td>
            <td style="font-weight: 700; color: #38bdf8;">${escapeHtml(v.slaComplianceRate)}</td>
            <td><span class="health-pill ${pClass}" style="font-size: 9.5px; padding: 2px 6px;">${v.performanceRating}</span></td>
          </tr>
        `;
      }).join('');

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>🤝 Contractor & Vendor SLA Performance League</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill healthy">${res.vendorsEvaluated || cards.length} Vendors Evaluated</span>
          </div>

          <table class="bad-actors-table" style="margin-top: 8px;">
            <thead>
              <tr>
                <th>Vendor / Contractor</th>
                <th>Assigned</th>
                <th>On-Time</th>
                <th>SLA Breaches</th>
                <th>Compliance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${cardRows || '<tr><td colspan="6" style="text-align: center; color: #64748b;">No external contractors logged.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    // 8. Asset Lifecycle & CAPEX Replacement Widget
    else if (t.tool === 'get_asset_lifecycle_forecast') {
      const cands = res.topReplacementCandidates || [];
      const candRows = cands.map(c => `
        <tr>
          <td><span class="asset-tag-badge">${escapeHtml(c.assetnum)}</span></td>
          <td style="font-size: 11px;">${escapeHtml(c.description)}</td>
          <td style="color: #f87171; font-weight: 700;">${escapeHtml(c.historicalMaintenanceCost)}</td>
          <td style="color: #38bdf8;">${escapeHtml(c.estimatedReplacementCost)}</td>
          <td><span class="breakdown-counter">${escapeHtml(c.repairVsReplacementRatio)}</span></td>
          <td><span class="health-pill ${c.recommendation.includes('IMMEDIATE') ? 'critical' : 'warning'}" style="font-size: 9px; padding: 2px 5px;">${c.recommendation.replace(/_/g, ' ')}</span></td>
        </tr>
      `).join('');

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>🏗️ Asset Lifecycle & CAPEX Renewal Forecast</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${res.highRiskLifecycleAssetsCount > 0 ? 'warning' : 'healthy'}">${res.highRiskLifecycleAssetsCount || 0} High-Risk Units</span>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(2, 1fr);">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Forecasted CAPEX Renewal Required</span>
              <span class="kpi-stat-number" style="color: #fbbf24;">${escapeHtml(res.forecastedCapexRequired || '$0')}</span>
              <span class="kpi-stat-sub">Based on cumulative repair ratio &gt; 60%</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Total Assets Inspected</span>
              <span class="kpi-stat-number" style="color: #f1f5f9;">${res.totalAssetsInspected || 0}</span>
              <span class="kpi-stat-sub">${res.highRiskLifecycleAssetsCount || 0} exceed maintenance threshold</span>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">Top CAPEX Replacement Candidates ("Money Pits"):</div>
            <table class="bad-actors-table">
              <thead>
                <tr>
                  <th>Asset Tag</th>
                  <th>Description</th>
                  <th>Past Repairs</th>
                  <th>New Unit Est.</th>
                  <th>Repair Ratio</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                ${candRows || '<tr><td colspan="6" style="text-align: center; color: #64748b;">No high-risk asset replacements detected.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // 9. Cross-Site Comprehensive Reliability League Widget
    else if (t.tool === 'get_multi_site_reliability_league') {
      const rankings = res.leagueRankings || [];
      const tg = res.industryTargets || {};

      const rows = rankings.map((r, i) => {
        const pClass = r.healthRating === 'TOP_PERFORMER' ? 'healthy' : (r.healthRating === 'ATTENTION_NEEDED' ? 'warning' : 'critical');
        const cmVal = parseFloat(r.cmRatio) || 0;
        const pmVal = parseFloat(r.pmCompliance) || 100;
        const cmColor = cmVal > 35 ? '#f87171' : (cmVal > 20 ? '#fbbf24' : '#34d399');
        const pmColor = pmVal >= 90 ? '#34d399' : (pmVal >= 80 ? '#fbbf24' : '#f87171');

        return `
          <tr>
            <td style="font-weight: 700; color: #94a3b8;">#${i + 1}</td>
            <td><strong>${escapeHtml(r.siteid)}</strong> <span style="font-size: 10.5px; color: #94a3b8;">(${escapeHtml(r.description)})</span></td>
            <td style="color: ${cmColor}; font-weight: 700;">${escapeHtml(r.cmRatio)}</td>
            <td style="color: ${pmColor}; font-weight: 700;">${escapeHtml(r.pmCompliance)}</td>
            <td style="color: ${r.activeBacklog > 30 ? '#f87171' : '#f1f5f9'}; font-weight: 700;">${r.activeBacklog}</td>
            <td style="color: #38bdf8;">${escapeHtml(r.mttrHours)}</td>
            <td style="color: #10b981; font-weight: 600;">${escapeHtml(r.rtRatio)}</td>
            <td><span class="health-pill ${pClass}" style="font-size: 9px; padding: 2px 6px;">${escapeHtml(r.healthRating.replace(/_/g, ' '))}</span></td>
          </tr>
        `;
      }).join('');

      const activePeriod = res.activePeriod || '30d';
      const periodLabel = res.periodLabel || 'Last 30 Days';

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>🏆 All Sites Reliability League (CM, PM, Backlog, MTTR, RT)</span>
              <span class="dash-site-badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4);">⏳ ${escapeHtml(periodLabel)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="period-toggle-pills">
                <button type="button" class="btn-period ${activePeriod === '30d' ? 'active' : ''}" onclick="sendPrompt('Compare all sites for the last 30 days')">30D</button>
                <button type="button" class="btn-period ${activePeriod === '90d' ? 'active' : ''}" onclick="sendPrompt('Compare all sites for the last 90 days quarter')">90D</button>
                <button type="button" class="btn-period ${activePeriod === '365d' ? 'active' : ''}" onclick="sendPrompt('Compare all sites for the past year')">1 Year</button>
                <button type="button" class="btn-period ${activePeriod === 'all' ? 'active' : ''}" onclick="sendPrompt('Compare all sites all time historical')">All</button>
              </div>
              <span class="health-pill healthy">${res.sitesEvaluated || rankings.length} Sites Benchmarked</span>
            </div>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 8px;">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">CM Ratio Benchmark</span>
              <span class="kpi-stat-number" style="font-size: 14px; color: #34d399;">${escapeHtml(tg.cmRatioTarget || '< 20%')}</span>
              <span class="kpi-stat-sub">SMRP World-Class</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">PM Compliance Target</span>
              <span class="kpi-stat-number" style="font-size: 14px; color: #34d399;">${escapeHtml(tg.pmComplianceTarget || '>= 90%')}</span>
              <span class="kpi-stat-sub">Schedule Adherence</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Target MTTR</span>
              <span class="kpi-stat-number" style="font-size: 14px; color: #38bdf8;">${escapeHtml(tg.mttrTarget || '< 3.5 hrs')}</span>
              <span class="kpi-stat-sub">Restore Speed</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">RT Proactivity Target</span>
              <span class="kpi-stat-number" style="font-size: 14px; color: #10b981;">${escapeHtml(tg.rtProactiveTarget || '>= 80%')}</span>
              <span class="kpi-stat-sub">Planned vs Reactive</span>
            </div>
          </div>

          <table class="bad-actors-table" style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Site ID</th>
                <th>CM Ratio (%)</th>
                <th>PM Compliance (%)</th>
                <th>Active Backlog</th>
                <th>MTTR (hrs)</th>
                <th>RT Ratio (%)</th>
                <th>Health Rating</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="8" style="text-align: center; color: #64748b;">No sites evaluated.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    // 10. Asset Criticality & Operational Risk Priority Matrix Widget
    else if (t.tool === 'get_asset_criticality_risk_matrix') {
      const dist = res.riskDistribution || {};
      const criticals = res.topCriticalVulnerableAssets || [];
      const statusClass = res.plantRiskHealth === 'CONTROLLED_RISK' ? 'healthy' : 'critical';

      const critRows = criticals.map(c => `
        <tr>
          <td><span class="asset-tag-badge">${escapeHtml(c.assetnum)}</span></td>
          <td style="font-size: 11px;">${escapeHtml(c.description)}</td>
          <td><span style="color: #f87171; font-weight: 700;">Priority ${c.priorityRating}</span></td>
          <td style="color: #fbbf24; font-weight: 700;">${c.activeBacklog} WOs</td>
          <td><span class="breakdown-counter" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">RPN ${c.calculatedRiskScore}</span></td>
          <td><span class="health-pill ${c.recommendation.includes('IMMEDIATE') ? 'critical' : 'warning'}" style="font-size: 9px; padding: 2px 6px;">${escapeHtml(c.recommendation.replace(/_/g, ' '))}</span></td>
        </tr>
      `).join('');

      html += `
        <div class="kpi-dashboard-card">
          <div class="dash-header">
            <div class="dash-title">
              <span>🎯 Asset Criticality & Operational Risk Matrix</span>
              <span class="dash-site-badge">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${statusClass}">${escapeHtml((res.plantRiskHealth || 'STABLE').replace(/_/g, ' '))}</span>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 8px;">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">High-Risk Vulnerable Units</span>
              <span class="kpi-stat-number" style="color: #f87171;">${dist.criticalHighRisk ?? 0}</span>
              <span class="kpi-stat-sub">High Consequence + Backlog</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Moderate Risk Assets</span>
              <span class="kpi-stat-number" style="color: #fbbf24;">${dist.moderateRisk ?? 0}</span>
              <span class="kpi-stat-sub">Scheduled Watchlist</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Stable Assets</span>
              <span class="kpi-stat-number" style="color: #34d399;">${dist.lowRiskStable ?? 0}</span>
              <span class="kpi-stat-sub">Controlled Status</span>
            </div>
          </div>

          <div style="margin-top: 10px;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">Top Vulnerable Single-Points-of-Failure:</div>
            <table class="bad-actors-table">
              <thead>
                <tr>
                  <th>Asset Tag</th>
                  <th>Description</th>
                  <th>Maximo Priority</th>
                  <th>Active Backlog</th>
                  <th>Risk Score (RPN)</th>
                  <th>Action Required</th>
                </tr>
              </thead>
              <tbody>
                ${critRows || '<tr><td colspan="6" style="text-align: center; color: #64748b;">No high-risk critical assets found.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // 11. C-Suite Consolidated Executive Audit Brief Widget
    else if (t.tool === 'generate_executive_audit_brief') {
      const tel = res.keyPerformanceTelemetry || {};
      const findings = res.strategicExecutiveFindings || [];
      const actions = res.immediateActionItems || [];
      const isAttn = res.overallPlantStatus === 'ATTENTION_REQUIRED';

      const findingsList = findings.map(f => `<li style="margin-bottom: 4px; font-size: 12px; color: #e2e8f0;">${escapeHtml(f)}</li>`).join('');
      const actionList = actions.map(a => `<li style="margin-bottom: 4px; font-size: 12px; color: #38bdf8;">✓ ${escapeHtml(a)}</li>`).join('');

      html += `
        <div class="kpi-dashboard-card" style="border: 2px solid #6366f1; background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));">
          <div class="dash-header">
            <div class="dash-title">
              <span>📑 C-Suite Executive Maintenance & Reliability Brief</span>
              <span class="dash-site-badge" style="background: #4f46e5; color: #fff;">${escapeHtml(res.site || 'SITE')}</span>
            </div>
            <span class="health-pill ${isAttn ? 'warning' : 'healthy'}">${escapeHtml((res.overallPlantStatus || 'STABLE').replace(/_/g, ' '))}</span>
          </div>

          <div class="kpi-stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;">
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Total OPEX Spend</span>
              <span class="kpi-stat-number" style="color: #34d399; font-size: 15px;">${escapeHtml(tel.totalActualSpend || '$0')}</span>
              <span class="kpi-stat-sub">${escapeHtml(tel.budgetHealth || 'ON_TRACK')}</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">CM Breakdown Ratio</span>
              <span class="kpi-stat-number" style="color: ${parseFloat(tel.cmRatio) > 30 ? '#f87171' : '#34d399'}; font-size: 15px;">${escapeHtml(tel.cmRatio || '0%')}</span>
              <span class="kpi-stat-sub">Target &lt; 20%</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">PM Schedule Compliance</span>
              <span class="kpi-stat-number" style="color: #38bdf8; font-size: 15px;">${escapeHtml(tel.pmCompliance || '100%')}</span>
              <span class="kpi-stat-sub">Target &ge; 90%</span>
            </div>
            <div class="kpi-stat-box">
              <span class="kpi-stat-label">Mean Restore Time (MTTR)</span>
              <span class="kpi-stat-number" style="color: #fbbf24; font-size: 15px;">${escapeHtml(tel.meanTimeToRepair_MTTR || '2.4h')}</span>
              <span class="kpi-stat-sub">Target &lt; 3.5h</span>
            </div>
          </div>

          <div style="margin-top: 14px; background: rgba(15, 23, 42, 0.6); padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px;">🔍 Strategic Executive Findings:</div>
            <ul style="padding-left: 18px; margin: 0;">${findingsList}</ul>
          </div>

          <div style="margin-top: 10px; background: rgba(15, 23, 42, 0.6); padding: 10px 14px; border-radius: 8px; border: 1px solid #334155;">
            <div style="font-size: 11.5px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px;">⚡ Recommended Executive Decisions:</div>
            <ul style="padding-left: 0; list-style: none; margin: 0;">${actionList}</ul>
          </div>
        </div>
      `;
    }
  }

  return html ? `<div class="dashboard-widget-container">${html}</div>` : '';
}

// Toggle accordion for reasoning thoughts
window.toggleReasoning = function(el) {
  const content = el.nextElementSibling;
  const arrow = el.querySelector('span:last-child');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    arrow.textContent = '▼';
  } else {
    content.style.display = 'none';
    arrow.textContent = '▶';
  }
};

// Render working memory chips
function renderMemoryChips(mem = {}) {
  const chipsContainer = document.getElementById('memory-chips');
  if (!chipsContainer) return;

  const chips = [];
  if (mem.activeSite) chips.push(`<span class="mem-chip"><span>Site:</span>${escapeHtml(mem.activeSite)}</span>`);
  if (mem.lastMentionedAsset) chips.push(`<span class="mem-chip"><span>Asset:</span>${escapeHtml(mem.lastMentionedAsset)}</span>`);
  if (mem.lastMentionedLocation) chips.push(`<span class="mem-chip"><span>Loc:</span>${escapeHtml(mem.lastMentionedLocation)}</span>`);
  if (mem.lastMentionedDepartment) chips.push(`<span class="mem-chip"><span>Dept:</span>${escapeHtml(mem.lastMentionedDepartment)}</span>`);
  if (mem.lastMentionedWorkType) chips.push(`<span class="mem-chip"><span>Type:</span>${escapeHtml(mem.lastMentionedWorkType)}</span>`);
  if (mem.lastMentionedWonum) chips.push(`<span class="mem-chip"><span>WO:</span>${escapeHtml(mem.lastMentionedWonum)}</span>`);

  if (chips.length === 0) {
    chipsContainer.innerHTML = `<span style="color: #64748b;">No active entities yet</span>`;
  } else {
    chipsContainer.innerHTML = chips.join('');
  }
}

// Reset memory
window.clearMemory = async function() {
  try {
    const res = await fetch('/api/memory/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'default-session' })
    });
    const data = await res.json();
    renderMemoryChips(data.memory);
    appendMessage("🧠 Working memory cleared. Context has been reset.", 'agent');
  } catch (err) {
    console.error('Failed to reset memory:', err);
  }
};

// Send quick prompt from button
window.sendPrompt = function(text) {
  userInput.value = text;
  chatForm.dispatchEvent(new Event('submit'));
};

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Check current session & display user info
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return false;
    }
    const data = await res.json();
    if (data.user) {
      const nameEl = document.getElementById('user-display-name');
      const nameElMobile = document.getElementById('user-display-name-mobile');
      const userText = `${data.user.displayName || data.user.username} (${data.user.role || 'user'})`;
      if (nameEl) nameEl.textContent = userText;
      if (nameElMobile) nameElMobile.textContent = userText;
    }
    return true;
  } catch (err) {
    window.location.href = '/login.html';
    return false;
  }
}

// Sign out with user confirmation
window.handleLogout = async function() {
  const confirmed = window.confirm("Are you sure you want to sign out of IBM Maximo EAM Assistant?");
  if (!confirmed) {
    return;
  }

  try {
    await fetch('/api/auth/logout', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Logout error:', err);
  }

  // Clear cookie from client side as well and redirect
  document.cookie = "maximo_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  window.location.replace('/login.html');
};

// Mobile Sidebar Toggle
window.toggleSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
};

// Mobile Hamburger Navigation Menu Toggle
window.toggleMobileMenu = function() {
  const btn = document.getElementById('btn-burger');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (btn) btn.classList.toggle('active');
  if (drawer) drawer.classList.toggle('open');
};

// Sync Mobile Site select with Desktop Site select & reload context
window.syncMobileSite = function(val) {
  const desktopSelect = document.getElementById('site-select');
  if (desktopSelect) desktopSelect.value = val;
  loadContext(val);
  toggleMobileMenu();
};

// Register PWA Service Worker for mobile performance & offline capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service Worker registered with scope:', reg.scope))
      .catch(err => console.log('[PWA] Service Worker registration failed:', err));
  });
}

// Voice Dictation (Arabic & English) via HTML5 Web Speech API
let speechRecognition = null;
let isListening = false;

window.toggleVoiceInput = function() {
  const voiceBtn = document.getElementById('voice-btn');
  const input = document.getElementById('user-input');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
    return;
  }

  if (isListening) {
    if (speechRecognition) speechRecognition.stop();
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = true;
  // Support mixed Arabic/English or default to Arabic (ar-EG / ar-SA) or user's system language
  speechRecognition.lang = navigator.language.startsWith('ar') ? 'ar-EG' : 'en-US';

  speechRecognition.onstart = () => {
    isListening = true;
    if (voiceBtn) voiceBtn.classList.add('listening');
    if (input) input.placeholder = "Listening... تكلم الآن (عربي / English)...";
  };

  speechRecognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    if (input) {
      input.value = transcript;
    }
  };

  speechRecognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    stopListening();
  };

  speechRecognition.onend = () => {
    stopListening();
    if (input && input.value.trim().length > 0) {
      // Auto-focus input ready for send
      input.focus();
    }
  };

  function stopListening() {
    isListening = false;
    if (voiceBtn) voiceBtn.classList.remove('listening');
    if (input) input.placeholder = "Type or speak a message for IBM Maximo (English or بالعربي)...";
  }

  try {
    speechRecognition.start();
  } catch (err) {
    console.error('Failed to start speech recognition:', err);
    stopListening();
  }
};

// ==========================================
// EXPORT & REPORTING UTILITIES (CSV, EXCEL, PDF)
// ==========================================

// Create export toolbar DOM element for a given table
function createTableExportBar(tableEl, baseName = 'maximo_report') {
  const bar = document.createElement('div');
  bar.className = 'table-export-bar';
  bar.innerHTML = `
    <span>📥 Export:</span>
    <button type="button" class="btn-export btn-export-csv" title="Export as CSV spreadsheet">📄 CSV</button>
    <button type="button" class="btn-export btn-export-excel" title="Export as Microsoft Excel (.xlsx)">📊 Excel</button>
    <button type="button" class="btn-export btn-export-pdf" title="Export as PDF Document">📑 PDF</button>
  `;

  bar.querySelector('.btn-export-csv').onclick = () => exportTableToCSV(tableEl, `${baseName}.csv`);
  bar.querySelector('.btn-export-excel').onclick = () => exportTableToExcel(tableEl, `${baseName}.xlsx`);
  bar.querySelector('.btn-export-pdf').onclick = () => exportTableToPDF(tableEl, 'IBM Maximo Maintenance Report', `${baseName}.pdf`);

  return bar;
}

// 1. Export Table to CSV
window.exportTableToCSV = function(tableEl, filename = 'report.csv') {
  if (!tableEl) return;
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  const csvLines = [];

  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    const line = cells.map(c => {
      let text = c.innerText.trim().replace(/"/g, '""');
      return `"${text}"`;
    }).join(',');
    csvLines.push(line);
  });

  const csvContent = '\uFEFF' + csvLines.join('\r\n'); // Include UTF-8 BOM for Arabic & symbols
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// 2. Export Table to Excel (.xlsx) using SheetJS
window.exportTableToExcel = function(tableEl, filename = 'report.xlsx') {
  if (!tableEl) return;
  if (typeof XLSX === 'undefined') {
    alert("Excel library is loading, please try again in a moment.");
    return;
  }

  try {
    const wb = XLSX.utils.table_to_book(tableEl, { sheet: "Maximo Report" });
    XLSX.writeFile(wb, filename);
  } catch (err) {
    console.error('Excel export error:', err);
    // Fallback to CSV if SheetJS fails
    exportTableToCSV(tableEl, filename.replace(/\.xlsx$/i, '.csv'));
  }
};

// 3. Export Table to Formatted PDF using jsPDF & AutoTable
window.exportTableToPDF = function(tableEl, reportTitle = 'IBM Maximo EAM Report', filename = 'report.pdf') {
  if (!tableEl) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF library is loading, please try again in a moment.");
    return;
  }

  try {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4'
    });

    const activeSite = document.getElementById('site-select')?.value || 'TEST';

    // Header Branding
    doc.setFillColor(3, 7, 18); // Dark Navy background header
    doc.rect(0, 0, doc.internal.pageSize.width, 50, 'F');
    
    doc.setFontSize(16);
    doc.setTextColor(56, 189, 248); // Sky blue text
    doc.text('IBM Maximo Asset Management — AI Assistant', 30, 30);

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184); // Slate grey
    doc.text(`Report: ${reportTitle}  |  Site: ${activeSite}  |  Generated: ${new Date().toLocaleString()}`, 30, 68);

    // AutoTable render
    doc.autoTable({
      html: tableEl,
      startY: 85,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [56, 189, 248],
        fontStyle: 'bold',
        fontSize: 10
      },
      styles: {
        fontSize: 9,
        cellPadding: 6,
        overflow: 'linebreak'
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      margin: { left: 30, right: 30 }
    });

    // Save PDF
    doc.save(filename);
  } catch (err) {
    console.error('PDF export error:', err);
    alert('Failed to generate PDF. Falling back to Excel.');
    exportTableToExcel(tableEl, filename.replace(/\.pdf$/i, '.xlsx'));
  }
};

// Initial load
(async () => {
  const isAuthed = await checkAuth();
  if (isAuthed) {
    loadContext();
  }
})();



