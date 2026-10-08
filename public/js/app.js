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
    if (el) {
      const currentVal = siteId || currentContext.activeSite || (currentContext.sites?.[0]?.siteid) || 'TEST';
      el.innerHTML = '';

      if (Array.isArray(currentContext.sites) && currentContext.sites.length > 0) {
        currentContext.sites.forEach(s => {
          const opt = document.createElement('option');
          const id = typeof s === 'string' ? s : (s.siteid || s.id || '');
          const desc = typeof s === 'string' ? s : (s.description ? `${id} — ${s.description}` : id);
          opt.value = id;
          opt.textContent = desc;
          if (id === currentVal) opt.selected = true;
          el.appendChild(opt);
        });
        el.value = currentVal;
      } else {
        const opt = document.createElement('option');
        opt.value = currentVal;
        opt.textContent = currentVal;
        el.appendChild(opt);
      }
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

    // Click to insert into prompt
    div.onclick = () => {
      userInput.value = activeTab === 'assets'
        ? `Create a work order for asset ${code} in department MECH with work type CM`
        : `Check work orders in location ${code}`;
      userInput.focus();
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
      if (nameEl) {
        nameEl.textContent = `${data.user.displayName || data.user.username} (${data.user.role || 'user'})`;
      }
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

// Register PWA Service Worker for mobile performance & offline capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service Worker registered with scope:', reg.scope))
      .catch(err => console.log('[PWA] Service Worker registration failed:', err));
  });
}

// Initial load
(async () => {
  const isAuthed = await checkAuth();
  if (isAuthed) {
    loadContext();
  }
})();



