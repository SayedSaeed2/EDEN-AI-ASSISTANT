// Client-side Application Logic for Maximo AI Agent
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const siteSelect = document.getElementById('site-select');
const itemsList = document.getElementById('items-list');
const sidebarSearch = document.getElementById('sidebar-search');

let history = [];
let currentContext = { sites: [], assets: [], locations: [] };
let activeTab = 'chats';
let currentConversationId = null;
let userConversations = [];

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

        // Security UX: If user is restricted to a single site, lock the dropdown
        if (currentContext.sites && currentContext.sites.length === 1 && currentContext.allowedSites && !currentContext.allowedSites.includes('*')) {
          selectEl.disabled = true;
          selectEl.title = `Access locked to authorized site: ${currentVal}`;
          selectEl.style.opacity = '0.85';
          selectEl.style.cursor = 'not-allowed';
        } else {
          selectEl.disabled = false;
          selectEl.title = 'Switch active site';
          selectEl.style.opacity = '1';
          selectEl.style.cursor = 'pointer';
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

// Documents cache for RAG
let indexedDocs = [];

// Switch between Chats, Assets, Locations and Documents tabs
window.switchTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'chats') {
    renderConversationsList();
  } else if (tab === 'documents') {
    loadDocuments();
  } else {
    renderSidebarItems();
  }
};

// Load user conversations list from server and restore active chat
window.loadUserConversations = async function() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    userConversations = data.conversations || [];
    currentConversationId = data.activeConversationId;

    if (currentConversationId) {
      await loadConversationThread(currentConversationId);
    } else if (userConversations.length > 0) {
      await loadConversationThread(userConversations[0].id);
    }

    if (activeTab === 'chats') {
      renderConversationsList();
    }
  } catch (err) {
    console.error('Failed to load user conversations:', err);
  }
};

// Render Conversations in Sidebar
function renderConversationsList() {
  const query = (sidebarSearch.value || '').toLowerCase();
  itemsList.innerHTML = '';

  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = 'padding: 8px 12px; background: rgba(30, 41, 59, 0.6); border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;';
  headerDiv.innerHTML = `
    <span style="font-size: 11px; font-weight: 700; color: #38bdf8;">💬 Past Conversations (${userConversations.length})</span>
    <button onclick="handleNewChat()" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">➕ New Chat</button>
  `;
  itemsList.appendChild(headerDiv);

  const filtered = userConversations.filter(c => (c.title || '').toLowerCase().includes(query));

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'text-align: center; color: #64748b; font-size: 12px; padding: 20px;';
    emptyDiv.innerHTML = `
      <p style="margin-bottom: 8px;">No conversation history yet.</p>
      <button onclick="handleNewChat()" style="background: #3b82f6; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;">➕ Start New Chat</button>
    `;
    itemsList.appendChild(emptyDiv);
    return;
  }

  filtered.forEach(c => {
    const isActive = c.id === currentConversationId;
    const div = document.createElement('div');
    div.className = `item-card ${isActive ? 'active-chat-card' : ''}`;
    div.style.cssText = isActive ? 'border-color: #38bdf8; background: rgba(56, 189, 248, 0.08);' : '';

    const formattedDate = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
        <div class="item-code" style="color: ${isActive ? '#38bdf8' : '#e2e8f0'}; font-size: 12px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${isActive ? '🟢 ' : '💬 '}${escapeHtml(c.title || 'Untitled Chat')}
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
          <button onclick="event.stopPropagation(); renameConversationThread('${escapeHtml(c.id)}', '${escapeHtml(c.title || '').replace(/'/g, "\\'")}')" title="Rename chat" style="background: transparent; border: none; color: #94a3b8; font-size: 11px; cursor: pointer; padding: 0 3px;">✏️</button>
          <button onclick="event.stopPropagation(); deleteConversationThread('${escapeHtml(c.id)}')" title="Delete chat" style="background: transparent; border: none; color: #94a3b8; font-size: 11px; cursor: pointer; padding: 0 3px;">✕</button>
        </div>
      </div>
      <div class="item-meta" style="margin-top: 6px; font-size: 10.5px; color: #94a3b8;">
        <span>Site: ${escapeHtml(c.site || 'TEST')}</span>
        <span>${escapeHtml(formattedDate)}</span>
      </div>
    `;

    div.onclick = () => {
      loadConversationThread(c.id);
      if (window.innerWidth <= 768) toggleSidebar();
    };

    itemsList.appendChild(div);
  });
}

// Load a specific conversation thread and render all past messages
window.loadConversationThread = async function(convId) {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`);
    const data = await res.json();
    if (!data.conversation) return;

    currentConversationId = convId;
    const conv = data.conversation;

    // Sync active site if conversation had a site
    if (conv.site && siteSelect && siteSelect.value !== conv.site) {
      siteSelect.value = conv.site;
    }

    // Clear current chat box and rebuild from saved messages
    chatBox.innerHTML = '';
    history = [];

    // Always show the quick operational and executive prompt buttons at top
    appendDefaultWelcomeMessage();

    const msgs = conv.messages || [];
    msgs.forEach(m => {
      history.push(m);
      appendMessage(m.content, m.role, m.executedTools);
    });

    // Set active in backend
    fetch(`/api/conversations/${encodeURIComponent(convId)}/active`, { method: 'PUT' });

    if (activeTab === 'chats') {
      renderConversationsList();
    }
  } catch (err) {
    console.error('Failed to load conversation thread:', err);
  }
};

// Create a new fresh chat thread
window.handleNewChat = async function() {
  try {
    const activeSite = siteSelect ? siteSelect.value : 'TEST';
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation', site: activeSite })
    });
    const data = await res.json();
    if (data.conversation) {
      currentConversationId = data.conversation.id;
      userConversations.unshift({
        id: data.conversation.id,
        title: data.conversation.title,
        site: data.conversation.site,
        createdAt: data.conversation.createdAt,
        updatedAt: data.conversation.updatedAt,
        messageCount: 0
      });
      chatBox.innerHTML = '';
      history = [];
      appendDefaultWelcomeMessage();
      if (activeTab === 'chats') renderConversationsList();
    }
  } catch (err) {
    console.error('Failed to create new chat:', err);
  }
};

// Delete a conversation thread
window.deleteConversationThread = async function(convId) {
  if (!confirm("Are you sure you want to delete this conversation?")) return;
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, { method: 'DELETE' });
    const data = await res.json();
    userConversations = userConversations.filter(c => c.id !== convId);
    if (currentConversationId === convId) {
      if (data.activeConversationId) {
        await loadConversationThread(data.activeConversationId);
      } else {
        await handleNewChat();
      }
    } else {
      renderConversationsList();
    }
  } catch (err) {
    alert(`Failed to delete conversation: ${err.message}`);
  }
};

// Rename a conversation thread
window.renameConversationThread = async function(convId, oldTitle) {
  const newTitle = prompt("Enter a new title for this conversation:", oldTitle);
  if (!newTitle || !newTitle.trim() || newTitle.trim() === oldTitle) return;

  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    const data = await res.json();
    if (data.success) {
      const target = userConversations.find(c => c.id === convId);
      if (target) target.title = newTitle.trim();
      renderConversationsList();
    } else {
      alert(`Failed to rename: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Failed to rename conversation: ${err.message}`);
  }
};

// Append standard welcome card if new chat
function appendDefaultWelcomeMessage() {
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="bubble bubble-agent">
      <p>Connected to <strong>IBM Maximo EAM</strong>. Select an operational task or executive analytics report below:</p>
      
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #38bdf8; font-weight: 700; margin-top: 14px;">👔 Top Management & Executive Analytics</div>
      <div class="btn-group" style="margin-top: 8px;">
        <button class="btn-quick btn-exec" onclick="sendPrompt('Generate a consolidated executive audit brief and C-Suite memo')">📑 C-Suite: Executive Audit Brief Memo</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Show asset criticality and operational risk matrix')">🎯 Risk: Asset Criticality & Vulnerability Matrix</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Compare all sites: CM ratio, PM compliance, active backlog, MTTR, and RT comparison')">🏆 Reliability League: All Sites</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Provide budget variance analysis and OPEX financial health')">📊 Budget: Variance & OPEX Health</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Provide contractor and vendor SLA compliance scorecard')">🤝 Vendors: SLA Compliance League</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Provide asset lifecycle and CAPEX replacement renewal forecast')">🏗️ Assets: CAPEX Replacement Forecast</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Provide executive maintenance cost and spend breakdown (Labor, Material, Contractors, Tools)')">💰 Spend: Cost Breakdown</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Provide reliability analysis: MTTR, Proactive vs Reactive maintenance ratio, and Top Bad Actor assets')">📈 Reliability: MTTR & Bad Actors</button>
        <button class="btn-quick btn-exec" onclick="sendPrompt('Analyze backlog aging distribution (<7d, 7-30d, 30-90d, >90d) and stagnant risk')">⏳ Backlog: Aging Bands</button>
      </div>

      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 700; margin-top: 14px;">📋 Plant Operations & Maintenance</div>
      <div class="btn-group" style="margin-top: 8px;">
        <button class="btn-quick" onclick="sendPrompt('Provide full executive maintenance KPI dashboard summary')">📊 KPI: Maintenance Dashboard</button>
        <button class="btn-quick" onclick="sendPrompt('Show overdue work orders that missed their target date')">⏰ Alerts: Overdue Work Orders</button>
        <button class="btn-quick" onclick="sendPrompt('Check storeroom inventory for low stock alerts below safety stock')">📦 Stock: Low Inventory Alerts</button>
        <button class="btn-quick" onclick="sendPrompt('Show work orders with status WAPPR')">📋 Read: Open Work Orders</button>
        <button class="btn-quick" onclick="sendPrompt('Show unplanned work orders for all sites')">🚨 Unplanned: CM & EM Work Orders</button>
        <button class="btn-quick" onclick="sendPrompt('Show PPM schedule forecast based on forecast date')">🗓️ PPM: Preventive Maintenance Forecast</button>
        <button class="btn-quick" onclick="sendPrompt('Show machine card for asset ASSET124')">🏷️ Machine Card: Asset Passport & History</button>
        <button class="btn-quick" onclick="sendPrompt('Create a work order for HVAC compressor vibration')">➕ Write: New Work Order (Prompt for Dept/Type)</button>
        <button class="btn-quick" onclick="sendPrompt('How many assets are registered in the active site?')">🏷️ Assets: Total Asset Count</button>
      </div>
    </div>
  `;
  chatBox.appendChild(row);
}

// Fetch indexed documents from server
async function loadDocuments() {
  itemsList.innerHTML = `<div style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">Loading technical documents...</div>`;
  try {
    const res = await fetch('/api/docs');
    const data = await res.json();
    indexedDocs = data.documents || [];
    renderDocumentsList();
  } catch (err) {
    console.error('Failed to load docs:', err);
    itemsList.innerHTML = `<div style="text-align: center; color: #f87171; font-size: 12px; padding: 20px;">Failed to load documents: ${escapeHtml(err.message)}</div>`;
  }
}

// Render Document list in Explorer
function renderDocumentsList() {
  const query = (sidebarSearch.value || '').toLowerCase();
  itemsList.innerHTML = '';

  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = 'padding: 8px 12px; background: rgba(30, 41, 59, 0.6); border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;';
  headerDiv.innerHTML = `
    <span style="font-size: 11px; font-weight: 700; color: #38bdf8;">📂 Knowledge Docs (${indexedDocs.length})</span>
    <button onclick="syncFolderDocs()" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">🔄 Sync Folder</button>
  `;
  itemsList.appendChild(headerDiv);

  const filtered = indexedDocs.filter(d => d.name.toLowerCase().includes(query));

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'text-align: center; color: #64748b; font-size: 12px; padding: 20px;';
    emptyDiv.innerHTML = `
      <p style="margin-bottom: 8px;">No documents indexed yet.</p>
      <button onclick="document.getElementById('doc-file-input').click()" style="background: #3b82f6; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;">📎 Upload PDF</button>
      <p style="font-size: 11px; color: #475569; margin-top: 8px;">or drop files into <code>knowledge_docs/</code></p>
    `;
    itemsList.appendChild(emptyDiv);
    return;
  }

  filtered.forEach(doc => {
    const div = document.createElement('div');
    div.className = 'item-card';
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div class="item-code" style="color: #38bdf8; font-size: 13px;">📄 ${escapeHtml(doc.name)}</div>
        <button onclick="event.stopPropagation(); deleteDocument('${escapeHtml(doc.name)}')" title="Delete document" style="background: transparent; border: none; color: #94a3b8; font-size: 12px; cursor: pointer;">✕</button>
      </div>
      <div class="item-meta" style="margin-top: 6px;">
        <span>${doc.chunkCount} passages</span>
        <span>${(doc.sizeBytes / 1024).toFixed(1)} KB</span>
      </div>
    `;

    // Click on document to prompt agent
    div.onclick = () => {
      userInput.value = `Search ${doc.name} for standard operating procedures and maintenance steps`;
      userInput.focus();
      if (window.innerWidth <= 768) toggleSidebar();
    };

    itemsList.appendChild(div);
  });
}

// Upload file handler
window.handleFileUpload = async function(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const uploadBtn = document.getElementById('btn-upload-doc');
  if (uploadBtn) uploadBtn.textContent = '⏳';

  appendMessage(`📎 Uploading & indexing document <strong>${escapeHtml(file.name)}</strong>...`, 'user');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/docs/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      appendMessage(`✅ <strong>${escapeHtml(file.name)}</strong> indexed successfully! (${data.chunkCount} passages extracted). You can now ask any technical or operational questions about this document.`, 'agent');
      if (activeTab === 'documents') loadDocuments();
    } else {
      appendMessage(`⚠️ Failed to index document: ${escapeHtml(data.error || 'Unknown error')}`, 'agent');
    }
  } catch (err) {
    appendMessage(`⚠️ Network error uploading document: ${escapeHtml(err.message)}`, 'agent');
  } finally {
    if (uploadBtn) uploadBtn.textContent = '📎';
    event.target.value = ''; // Reset input
  }
};

// Sync knowledge_docs/ folder
window.syncFolderDocs = async function() {
  itemsList.innerHTML = `<div style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">Scanning knowledge_docs/ folder...</div>`;
  try {
    const res = await fetch('/api/docs/sync', { method: 'POST' });
    const data = await res.json();
    loadDocuments();
    appendMessage(`🔄 Synchronized local knowledge folder: ${data.synced?.length || 0} document(s) scanned and indexed.`, 'agent');
  } catch (err) {
    alert(`Failed to sync folder: ${err.message}`);
    loadDocuments();
  }
};

// Delete a document
window.deleteDocument = async function(docName) {
  if (!confirm(`Delete ${docName} from the knowledge base?`)) return;
  try {
    await fetch(`/api/docs/${encodeURIComponent(docName)}`, { method: 'DELETE' });
    loadDocuments();
  } catch (err) {
    alert(`Failed to delete document: ${err.message}`);
  }
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
        siteid: activeSite,
        conversationId: currentConversationId
      })
    });

    loadingDiv.remove();
    const data = await res.json();
    if (data.memory) renderMemoryChips(data.memory);

    if (data.conversationId) {
      currentConversationId = data.conversationId;
    }

    if (data.error) {
      appendMessage("Error: " + data.error, 'agent');
    } else if (data.requiresApproval) {
      appendApprovalCard(data);
    } else {
      history.push({ role: 'assistant', content: data.reply, executedTools: data.executedTools });
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
  // Normalize role so 'assistant' (from loaded database history) and 'agent' behave identically
  const isAgent = role === 'agent' || role === 'assistant';
  const roleClass = isAgent ? 'agent' : 'user';

  const row = document.createElement('div');
  row.className = `msg-row ${!isAgent ? 'msg-user' : ''}`;
  
  let toolHtml = '';
  let dashboardWidgetsHtml = '';

  if (tools && tools.length > 0) {
    toolHtml = tools.map(t => `<div class="tool-badge">⚡ Executed: ${t.tool}</div>`).join('');
    dashboardWidgetsHtml = renderDashboardWidgets(tools);
  }

  let reasoningHtml = '';
  if (isAgent && reasoning) {
    reasoningHtml = `
      <div class="reasoning-box">
        <div class="reasoning-toggle" onclick="toggleReasoning(this)">
          <span>⛓️ Reasoning Chain (Thought Process)</span> <span style="font-size: 10px;">▼</span>
        </div>
        <div class="reasoning-content">${escapeHtml(reasoning)}</div>
      </div>
    `;
  }

  // Format and repair compressed single-line markdown tables (e.g. rows glued together with || or |:---|:---|)
  let processedText = text || '';
  if (isAgent && processedText) {
    // If table rows were concatenated with double pipes "||", split into newlines
    processedText = processedText.replace(/\s*\|\|\s*/g, ' |\n| ');
    // Ensure table separator line sits on its own line
    processedText = processedText.replace(/\|\s*(\|[-:]+[-| :]*\|)\s*\|/g, '|\n$1\n|');
  }

  const content = isAgent && window.marked ? marked.parse(processedText) : escapeHtml(processedText);
  row.innerHTML = `<div class="bubble bubble-${roleClass}">${toolHtml}${reasoningHtml}${dashboardWidgetsHtml}${content}</div>`;
  chatBox.appendChild(row);

  // Automatically attach export action bars and responsive wrappers to all rendered data tables in agent bubble
  if (isAgent) {
    const bubble = row.querySelector('.bubble-agent');
    if (bubble) {
      // Check if this bubble contains a Machine Passport Card
      const machineCardEl = bubble.querySelector('.machine-passport-card');
      if (machineCardEl && !machineCardEl.querySelector('.machine-card-export-toolbar')) {
        const assetNum = machineCardEl.getAttribute('data-asset') || 'ASSET';
        const cardExportBar = createMachineCardExportBar(machineCardEl, assetNum);
        machineCardEl.insertBefore(cardExportBar, machineCardEl.firstChild);
      }

      const tables = Array.from(bubble.querySelectorAll('table'));
      tables.forEach((tbl, idx) => {
        // Step 1: Wrap table in responsive scroll container if not already wrapped
        let wrapper = tbl.closest('.responsive-table-wrapper');
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.className = 'responsive-table-wrapper';
          tbl.parentNode.insertBefore(wrapper, tbl);
          wrapper.appendChild(tbl);
        }

        // Step 2: Insert export toolbar directly before the responsive wrapper as a block
        if (!wrapper.previousElementSibling || !wrapper.previousElementSibling.classList.contains('table-export-bar')) {
          const exportBar = createTableExportBar(tbl, `maximo_report_${Date.now()}_${idx + 1}`);
          wrapper.parentNode.insertBefore(exportBar, wrapper);
        }
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

          <div class="responsive-table-wrapper" style="margin-top: 10px; max-height: 480px; overflow-y: auto;">
            <table class="bad-actors-table" style="margin-top: 0; min-width: 680px; white-space: nowrap;">
              <thead>
                <tr>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">Rank</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">Site ID</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">CM Ratio (%)</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">PM Compliance (%)</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">Active Backlog</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">MTTR (hrs)</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">RT Ratio (%)</th>
                  <th style="position: sticky; top: 0; z-index: 2; background: #090d16;">Health Rating</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="8" style="text-align: center; color: #64748b;">No sites evaluated.</td></tr>'}
              </tbody>
            </table>
          </div>
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

// Toggle Explorer Sidebar (Collapsible Burger Button for Desktop & Mobile)
window.toggleSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  const desktopBtn = document.getElementById('btn-toggle-explorer');

  if (window.innerWidth <= 768) {
    // Mobile bottom drawer
    if (sidebar) sidebar.classList.toggle('open');
  } else {
    // Desktop width collapse / expand
    if (sidebar) {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      if (desktopBtn) desktopBtn.classList.toggle('active', !isCollapsed);
    }
  }
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
let finalAccumulatedText = '';
let silenceTimeout = null;
let currentVoiceLang = 'ar-EG'; // Defaults to Arabic

window.toggleVoiceLanguage = function() {
  const btn = document.getElementById('btn-voice-lang');
  if (currentVoiceLang === 'ar-EG') {
    currentVoiceLang = 'en-US';
    if (btn) btn.textContent = 'EN';
  } else {
    currentVoiceLang = 'ar-EG';
    if (btn) btn.textContent = 'AR';
  }
};

window.toggleVoiceInput = function() {
  const voiceBtn = document.getElementById('voice-btn');
  const input = document.getElementById('user-input');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
    return;
  }

  if (isListening) {
    stopListeningUser();
    return;
  }

  // Preserve any text already typed in input
  const basePrefix = input && input.value.trim() ? input.value.trim() + ' ' : '';
  finalAccumulatedText = '';

  try {
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;      // CRITICAL: Prevent premature exit on short pauses
    speechRecognition.interimResults = true;   // Live real-time feedback
    speechRecognition.maxAlternatives = 1;
    speechRecognition.lang = currentVoiceLang;

    speechRecognition.onstart = () => {
      isListening = true;
      if (voiceBtn) {
        voiceBtn.classList.add('listening');
        voiceBtn.textContent = '⏹️'; // Clear visual toggle
      }
      if (input) input.placeholder = selectedLang.startsWith('ar') 
        ? "جاري الاستماع... تحدث بطلاقة (اضغط ⏹️ للإيقاف)..." 
        : "Listening continuously... Speak now (tap ⏹️ to stop)...";
    };

    speechRecognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = 0; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (input) {
        const fullLiveText = (finalTranscript + ' ' + interimTranscript).trim();
        input.value = (basePrefix + fullLiveText).trim();
      }

      // Reset comfortable 5-second silence grace period after user stops speaking
      clearTimeout(silenceTimeout);
      silenceTimeout = setTimeout(() => {
        if (isListening && (finalAccumulatedText || interimTranscript)) {
          console.log('[Voice] Auto-finishing after natural speech pause.');
          stopListeningUser();
        }
      }, 5000);
    };

    speechRecognition.onerror = (event) => {
      console.warn('Speech recognition warning/error:', event.error);
      if (event.error === 'not-allowed') {
        alert("Microphone permission was denied. Please allow microphone access in your browser settings.");
        stopListeningUser();
      } else if (event.error === 'no-speech') {
        // Just keep listening unless user manually stops
      } else {
        stopListeningUser();
      }
    };

    speechRecognition.onend = () => {
      // If user did not manually stop and it timed out naturally, cleanly finalize
      if (isListening) {
        stopListeningUser();
      }
    };

    speechRecognition.start();
  } catch (err) {
    console.error('Failed to start speech recognition:', err);
    stopListeningUser();
  }

  function stopListeningUser() {
    isListening = false;
    clearTimeout(silenceTimeout);
    if (speechRecognition) {
      try { speechRecognition.stop(); } catch (e) {}
    }
    if (voiceBtn) {
      voiceBtn.classList.remove('listening');
      voiceBtn.textContent = '🎤';
    }
    if (input) {
      input.placeholder = "Type or speak a message for IBM Maximo (English or بالعربي)...";
      if (input.value.trim().length > 0) {
        input.focus();
      }
    }
  }
};

// ==========================================
// EXPORT & REPORTING UTILITIES (CSV, EXCEL, PDF)
// ==========================================

// Create export toolbar DOM element for the whole Machine Passport Card
function createMachineCardExportBar(cardEl, assetNum = 'ASSET') {
  const bar = document.createElement('div');
  bar.className = 'machine-card-export-toolbar';
  bar.innerHTML = `
    <div class="card-export-title">
      <span>📑 Export Complete Machine Card:</span>
      <span class="card-export-badge">${escapeHtml(assetNum)}</span>
    </div>
    <div class="card-export-actions">
      <button type="button" class="btn-card-export btn-export-all-pdf" title="Export complete passport card and work order history as branded PDF">
        📑 Export Full PDF
      </button>
      <button type="button" class="btn-card-export btn-export-all-excel" title="Export specs, metrics, and work order history to multi-sheet / structured Excel workbook">
        📊 Export Full Excel
      </button>
      <button type="button" class="btn-card-export btn-export-print" title="Print or save as high-res document">
        🖨️ Print Card
      </button>
    </div>
  `;

  bar.querySelector('.btn-export-all-pdf').onclick = () => exportWholeMachineCardPDF(cardEl, assetNum);
  bar.querySelector('.btn-export-all-excel').onclick = () => exportWholeMachineCardExcel(cardEl, assetNum);
  bar.querySelector('.btn-export-print').onclick = () => printMachineCard(cardEl, assetNum);

  return bar;
}

// 1. Export Whole Machine Card as a structured, branded multi-section PDF document
window.exportWholeMachineCardPDF = function(cardEl, assetNum = 'ASSET') {
  if (!cardEl) return;
  const jsPDFClass = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
  if (!jsPDFClass) {
    console.warn('jsPDF not loaded, falling back to print.');
    return printMachineCard(cardEl, assetNum);
  }

  try {
    const doc = new jsPDFClass({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 28;
    const contentWidth = pageWidth - (margin * 2);
    const activeSite = document.getElementById('site-select')?.value || 'TEST';

    // Header Branding Banner
    doc.setFillColor(15, 23, 42); // Navy 900
    doc.rect(0, 0, pageWidth, 54, 'F');

    doc.setFontSize(13);
    doc.setTextColor(56, 189, 248); // Sky blue
    doc.setFont('helvetica', 'bold');
    doc.text(`IBM MAXIMO — MACHINE PASSPORT & LIFECYCLE CARD`, margin, 26);

    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.setFont('helvetica', 'normal');
    doc.text(`Asset Tag: ${assetNum}   |   Site: ${activeSite}   |   Generated: ${new Date().toLocaleString()}`, margin, 42);

    let currentY = 70;

    // Extract title & overview quote from card
    const titleEl = cardEl.querySelector('h2');
    const quoteEl = cardEl.querySelector('blockquote');

    if (titleEl) {
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(titleEl.innerText.replace(/^[^\w\d]+/, '').trim(), contentWidth);
      doc.text(titleLines, margin, currentY);
      currentY += (titleLines.length * 16) + 4;
    }

    if (quoteEl) {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(56, 189, 248);
      doc.setLineWidth(2);
      
      const quoteText = quoteEl.innerText.replace(/\n+/g, ' ').trim();
      const quoteLines = doc.splitTextToSize(quoteText, contentWidth - 16);
      const quoteHeight = (quoteLines.length * 13) + 12;

      doc.rect(margin, currentY, contentWidth, quoteHeight, 'F');
      doc.line(margin, currentY, margin, currentY + quoteHeight); // Left border accent

      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'normal');
      doc.text(quoteLines, margin + 8, currentY + 12);

      currentY += quoteHeight + 14;
    }

    // Process all sections and tables
    const sections = [
      { heading: '⚙️ Technical Specifications & Asset Info', tableIdx: 0 },
      { heading: '📊 Reliability & Maintenance Performance (Historical)', tableIdx: 1 },
      { heading: '📜 Historical Work Orders Log', tableIdx: 2 }
    ];

    const tables = Array.from(cardEl.querySelectorAll('table'));

    sections.forEach(sec => {
      const tbl = tables[sec.tableIdx];
      if (!tbl) return;

      // Section Header
      if (currentY > 730) {
        doc.addPage();
        currentY = 40;
      }

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(sec.heading.replace(/[^\x20-\x7E]/g, '').trim() || sec.heading, margin, currentY);
      currentY += 8;

      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          html: tbl,
          startY: currentY,
          theme: 'grid',
          margin: { left: margin, right: margin },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [56, 189, 248],
            fontStyle: 'bold',
            fontSize: 8.5
          },
          styles: {
            fontSize: 7.5,
            cellPadding: 4.5,
            overflow: 'linebreak'
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252]
          }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }
    });

    // Add page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pageCount} — IBM Maximo Asset Management System`, margin, doc.internal.pageSize.getHeight() - 15);
    }

    doc.save(`Machine_Passport_${assetNum}_${Date.now()}.pdf`);
  } catch (err) {
    console.error('Full Machine Card PDF export error:', err);
    printMachineCard(cardEl, assetNum);
  }
};

// 2. Export Whole Machine Card to structured Excel Workbook (SheetJS)
window.exportWholeMachineCardExcel = function(cardEl, assetNum = 'ASSET') {
  if (!cardEl) return;
  const xlsxLib = window.XLSX;
  if (!xlsxLib) {
    console.warn('SheetJS not loaded, falling back to PDF.');
    return exportWholeMachineCardPDF(cardEl, assetNum);
  }

  try {
    const wb = xlsxLib.utils.book_new();
    const tables = Array.from(cardEl.querySelectorAll('table'));
    const sheetNames = ['Technical Specs', 'Reliability KPIs', 'Work Order History'];

    tables.forEach((tbl, idx) => {
      const sName = sheetNames[idx] || `Section ${idx + 1}`;
      const ws = xlsxLib.utils.table_to_sheet(tbl, { raw: true });
      xlsxLib.utils.book_append_sheet(wb, ws, sName);
    });

    xlsxLib.writeFile(wb, `Machine_Passport_${assetNum}_${Date.now()}.xlsx`);
  } catch (err) {
    console.error('Full Machine Card Excel export error:', err);
    exportWholeMachineCardPDF(cardEl, assetNum);
  }
};

// 3. Print / High-Res Browser Print for Machine Card
window.printMachineCard = function(cardEl, assetNum = 'ASSET') {
  if (!cardEl) return;
  const printWindow = window.open('', '_blank', 'width=950,height=800');
  if (!printWindow) {
    window.print();
    return;
  }

  const activeSite = document.getElementById('site-select')?.value || 'TEST';
  const cardHtml = cardEl.innerHTML;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Machine Passport Card - ${assetNum}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 30px; color: #0f172a; }
          .machine-card-export-toolbar, .table-export-bar { display: none !important; }
          .header-banner { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; }
          .header-banner h1 { margin: 0 0 6px 0; font-size: 20px; color: #0369a1; }
          .header-banner p { margin: 0; font-size: 11px; color: #64748b; }
          blockquote { background: #f8fafc; border-left: 4px solid #0284c7; margin: 12px 0 20px 0; padding: 10px 14px; font-size: 13px; color: #1e293b; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
          th { background: #f1f5f9; font-weight: bold; color: #0f172a; }
          h2, h3 { color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
        </style>
      </head>
      <body>
        <div class="header-banner">
          <h1>IBM Maximo — Machine Passport & History Card</h1>
          <p>Asset: <strong>${assetNum}</strong> | Site: <strong>${activeSite}</strong> | Generated: ${new Date().toLocaleString()}</p>
        </div>
        ${cardHtml}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 400);
};

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
  if (rows.length === 0) return alert('No table data to export.');
  const csvLines = [];

  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    const line = cells.map(c => {
      let text = c.innerText.trim().replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
      return `"${text}"`;
    }).join(',');
    csvLines.push(line);
  });

  const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// 2. Export Table to Excel (.xlsx) using SheetJS
window.exportTableToExcel = function(tableEl, filename = 'report.xlsx') {
  if (!tableEl) return;
  const xlsxLib = window.XLSX;
  if (!xlsxLib) {
    console.warn('SheetJS not loaded, falling back to CSV export.');
    return exportTableToCSV(tableEl, filename.replace(/\.xlsx$/i, '.csv'));
  }

  try {
    const wb = xlsxLib.utils.table_to_book(tableEl, { sheet: "Maximo Report", raw: true });
    xlsxLib.writeFile(wb, filename);
  } catch (err) {
    console.error('Excel export error:', err);
    exportTableToCSV(tableEl, filename.replace(/\.xlsx$/i, '.csv'));
  }
};

// 3. Export Table to Formatted PDF using jsPDF & AutoTable
window.exportTableToPDF = function(tableEl, reportTitle = 'IBM Maximo EAM Report', filename = 'report.pdf') {
  if (!tableEl) return;
  const jsPDFClass = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
  if (!jsPDFClass) {
    console.warn('jsPDF not loaded, falling back to Excel/CSV.');
    return exportTableToExcel(tableEl, filename.replace(/\.pdf$/i, '.xlsx'));
  }

  try {
    const doc = new jsPDFClass({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4'
    });

    const activeSite = document.getElementById('site-select')?.value || 'TEST';

    // Header Branding
    doc.setFillColor(15, 23, 42); // Navy Dark
    doc.rect(0, 0, doc.internal.pageSize.width, 45, 'F');
    
    doc.setFontSize(14);
    doc.setTextColor(56, 189, 248);
    doc.text('IBM Maximo Asset Management — AI Assistant', 24, 28);

    doc.setFontSize(9.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Report: ${reportTitle}  |  Site: ${activeSite}  |  Generated: ${new Date().toLocaleString()}`, 24, 62);

    // AutoTable render with fallback
    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        html: tableEl,
        startY: 75,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [56, 189, 248],
          fontStyle: 'bold',
          fontSize: 9
        },
        styles: {
          fontSize: 8.5,
          cellPadding: 5,
          overflow: 'linebreak'
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: 24, right: 24 }
      });
      doc.save(filename);
    } else {
      exportTableToExcel(tableEl, filename.replace(/\.pdf$/i, '.xlsx'));
    }
  } catch (err) {
    console.error('PDF export error:', err);
    exportTableToExcel(tableEl, filename.replace(/\.pdf$/i, '.xlsx'));
  }
};

// Toggle Universal Application Dropdown Menu (Burger Menu)
window.toggleAppMenu = function() {
  const menu = document.getElementById('app-dropdown-menu');
  const burger = document.getElementById('btn-burger');
  if (!menu) return;
  menu.classList.toggle('open');
  if (burger) burger.classList.toggle('active');
};

// Close dropdown menu when clicking anywhere outside
document.addEventListener('click', function(e) {
  const menu = document.getElementById('app-dropdown-menu');
  const burger = document.getElementById('btn-burger');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && !burger.contains(e.target)) {
      menu.classList.remove('open');
      if (burger) burger.classList.remove('active');
    }
  }
});

// ==========================================
// THEME SWITCHER (LIGHT & DARK MODE)
// ==========================================
window.initTheme = function() {
  const savedTheme = localStorage.getItem('maximo_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeUI(savedTheme);
};

window.toggleTheme = function() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('maximo_theme', newTheme);
  updateThemeUI(newTheme);
};

function updateThemeUI(theme) {
  const icon = document.getElementById('theme-toggle-icon');
  const label = document.getElementById('dropdown-theme-label');
  const isDark = theme === 'dark';

  if (icon) {
    icon.textContent = isDark ? '🌙' : '☀️';
  }
  if (label) {
    label.textContent = isDark ? '☀️ Switch to Light Mode' : '🌙 Switch to Dark Mode';
  }
}

// Initial load
(async () => {
  initTheme();
  initMatrixDigitalRain();
  const isAuthed = await checkAuth();
  if (isAuthed) {
    await loadContext();
    await loadUserConversations();
  }
})();

// --- Streams of Glowing Green Characters Background Animation (Matrix Rain) ---
function initMatrixDigitalRain() {
  const canvas = document.getElementById('matrix-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  // High-tech characters: Katakana, Cyrillic, Greek, Numbers & Hex glyphs
  const chars = '0123456789ABCDEFΞΨΩΣΠΔλθφψαβγδε010101アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  const fontSize = 14;
  let columns = Math.floor(width / fontSize);
  let drops = [];

  function resetDrops() {
    columns = Math.floor(width / fontSize);
    drops = [];
    for (let i = 0; i < columns; i++) {
      // Stagger initial drop positions randomly above the screen
      drops[i] = Math.floor(Math.random() * -100);
    }
  }
  resetDrops();

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    resetDrops();
  });

  let lastFrameTime = 0;
  const fpsInterval = 1000 / 30; // 30 FPS for optimal performance & classic Matrix pace

  function renderMatrix(currentTime) {
    requestAnimationFrame(renderMatrix);

    const elapsed = currentTime - lastFrameTime;
    if (elapsed < fpsInterval) return;
    lastFrameTime = currentTime - (elapsed % fpsInterval);

    // Semi-transparent fade layer to create character motion trails
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? 'rgba(248, 250, 252, 0.08)' : 'rgba(11, 17, 32, 0.08)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < drops.length; i++) {
      const text = chars.charAt(Math.floor(Math.random() * chars.length));
      const x = i * fontSize;
      const y = drops[i] * fontSize;

      if (y > 0 && y < height + fontSize) {
        // Glowing leading character (bright lime/white highlight)
        ctx.save();
        ctx.fillStyle = '#bbf7d0'; // luminous bright green head
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 8;
        ctx.fillText(text, x, y);
        ctx.restore();

        // Trail character
        ctx.fillStyle = isLight ? '#15803d' : '#22c55e';
        ctx.fillText(text, x, y - fontSize);
      }

      // Reset drop to top once it falls past bottom with random delay
      if (y > height && Math.random() > 0.975) {
        drops[i] = 0;
      }

      drops[i]++;
    }
  }

  requestAnimationFrame(renderMatrix);
}




