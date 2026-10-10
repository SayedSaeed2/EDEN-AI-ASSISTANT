import { toolsSchema, executeTool, MUTATING_TOOLS } from '../services/tools.js';
import { memoryService } from '../services/memory.js';
import { redisStore } from '../services/redisStore.js';
import { conversationService } from '../services/conversationService.js';

const BASE_SYSTEM_PROMPT = `You are an expert IBM Maximo 7.6 Assistant.
You have tools to query and create records in Maximo OSLC APIs.

RULES:
1. Always invoke the relevant tool from your tools list:
   - For creating Work Orders: call "create_maximo_work_order"
   - For listing Work Orders: call "get_maximo_work_orders" (supports status e.g. INPRG, WAPPR, APPR, location, siteid)
   - For counting Work Orders: call "get_work_order_count"
   - For counting Assets (e.g. "how many assets"): call "get_asset_count"
   - For listing Assets: call "get_assets"
   - For Asset details: call "get_asset_details"
   - For counting SRs: call "get_service_request_count"
   - For executive metrics: call the executive tool (get_executive_cost_summary, get_reliability_metrics, etc.)
   - For technical manuals, equipment guides, SOPs, HSE safety, or document questions: call "search_knowledge_base"
2. When displaying lists of records or cross-site tables:
   - Keep introductory text concise.
   - Format tables cleanly.
   - Provide a brief, complete 1-2 sentence executive conclusion. Never cut off mid-sentence.
3. NEVER output code strings, Python syntax, pseudo-code, or JSON in plain text. Always execute tools directly.
4. Language support:
   - If the user writes in Arabic, answer in Arabic.
   - If the user writes in English, answer in English.`;

// Helper: parse <thought> tags from response
function extractReasoning(text = '') {
  const match = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (match) {
    const reasoning = match[1].trim();
    const cleanContent = text.replace(/<thought>[\s\S]*?<\/thought>/i, '').trim();
    return { reasoning, content: cleanContent };
  }
  return { reasoning: null, content: text.trim() };
}

// Helper: extract entities from user query or tool results into memory
function updateMemoryFromText(sessionId, text = '', toolResults = []) {
  const upper = text.toUpperCase();

  const updates = {};

  // Detect Department
  const depts = ['CIVIL', 'ELEC-LC', 'ELEC', 'HK', 'LS', 'MECH'];
  for (const d of depts) {
    if (new RegExp(`\\b${d}\\b`, 'i').test(upper)) {
      updates.lastMentionedDepartment = d;
      break;
    }
  }

  // Detect Work Type
  const workTypes = ['RT', 'CM', 'EM', 'PRJ'];
  for (const wt of workTypes) {
    if (new RegExp(`\\b${wt}\\b`, 'i').test(upper)) {
      updates.lastMentionedWorkType = wt;
      break;
    }
  }

  // Detect Work Order Number (e.g., WO-1001, WO1001, 1001)
  const woMatch = text.match(/WO-?\d{3,8}/i);
  if (woMatch) {
    updates.lastMentionedWonum = woMatch[0].toUpperCase();
  }

  // Detect Asset (e.g., PUMP-101, COMP-01, TEST_STATUS)
  const assetMatch = text.match(/\b(asset\s+([A-Z0-9_\-]+)|\b(PUMP|COMP|HVAC|MOTOR|GEN)-[A-Z0-9_\-]+)\b/i);
  if (assetMatch) {
    updates.lastMentionedAsset = (assetMatch[2] || assetMatch[0]).toUpperCase();
  }

  // Detect Location (e.g., in location TEST, at location BLDG-1)
  const locMatch = text.match(/\b(?:in|at|for)?\s*location\s+([A-Z0-9_\-]+)\b/i);
  if (locMatch) {
    updates.lastMentionedLocation = locMatch[1].toUpperCase();
  }

  // Also check tool execution results for created or queried wonum / assetnum / location
  for (const item of toolResults) {
    if (item.result) {
      if (item.result.wonum) updates.lastMentionedWonum = item.result.wonum;
      if (item.result.ticketid) updates.lastMentionedWonum = item.result.ticketid;
      if (item.result.assetnum && item.result.assetnum !== 'N/A') updates.lastMentionedAsset = item.result.assetnum;
      if (item.result.location && item.result.location !== 'N/A') updates.lastMentionedLocation = item.result.location;
      if (item.result.site) updates.activeSite = item.result.site;

      // If tool returned an array of records (e.g. get_maximo_work_orders), grab the first record's wonum / asset for context
      if (Array.isArray(item.result) && item.result.length > 0) {
        const first = item.result[0];
        if (first.wonum) updates.lastMentionedWonum = first.wonum;
        if (first.assetnum && first.assetnum !== 'N/A') updates.lastMentionedAsset = first.assetnum;
        if (first.location && first.location !== 'N/A') updates.lastMentionedLocation = first.location;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    memoryService.updateWorkingContext(sessionId, updates);
  }
}

export const chatController = {
  async handleChat(req, res, ollama, model) {
    const { messages, sessionId = 'default-session', siteid, conversationId } = req.body;
    const username = req.user?.username || 'admin';
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Valid messages array is required.' });
    }

    // Set site in memory if provided
    if (siteid) {
      memoryService.updateWorkingContext(sessionId, { activeSite: siteid });
    }

    const lastUserMessage = messages[messages.length - 1]?.content || '';
    updateMemoryFromText(sessionId, lastUserMessage);

    // Formulate dynamic system prompt with session memory
    const memoryContextBlock = memoryService.formatMemoryPrompt(sessionId);
    const systemPromptWithMemory = `${BASE_SYSTEM_PROMPT}\n\nCURRENT WORKING MEMORY (Active Context):\n${memoryContextBlock}`;

    // Sliding window: keep the last 10 messages for rich conversational continuity without token bloat
    const recentMessages = messages.length > 10 ? messages.slice(-10) : messages;

    const conversation = [
      { role: 'system', content: systemPromptWithMemory },
      ...recentMessages
    ];

    const executedToolsLog = [];
    let accumulatedReasoning = [];

    // High performance Ollama parameters
    const ollamaOptions = {
      num_ctx: 4096,       // Generous context buffer for multi-site tables
      num_predict: 1280,   // Ample output tokens so large 15-site tables + conclusions never cut off mid-sentence
      temperature: 0.1,    // Focused, fast deterministic responses
      top_p: 0.9,
      repeat_penalty: 1.1,
      num_thread: 8        // Utilize full CPU multi-core threads
    };

    // Fast Intent Recognition: If user request directly matches unambiguous intents, route immediately
    const userQuery = lastUserMessage.trim().toLowerCase();
    let directToolCall = null;
    const activeCtx = memoryService.getSession(sessionId)?.workingContext || {};
    const defaultSite = activeCtx.activeSite || siteid || 'TEST';

    // 1. Asset Count
    if (/\b(how many|count of|total count|number of)\s+assets\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_asset_count',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 2. Work Order Count
    else if (/\b(how many|count of|total count|number of)\s*(work\s*orders?|wo\b)/i.test(userQuery)) {
      let statusValue = null;
      if (/in[-_\s]?prog(ress)?/i.test(userQuery) || /\bINPRG\b/i.test(lastUserMessage)) statusValue = 'INPRG';
      else if (/\b(wappr|waiting|open)\b/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/\bappr(oved)?\b/i.test(userQuery)) statusValue = 'APPR';
      else if (/\bcomp(leted)?\b/i.test(userQuery)) statusValue = 'COMP';
      else if (/\bclose(d)?\b/i.test(userQuery)) statusValue = 'CLOSE';

      directToolCall = {
        function: {
          name: 'get_work_order_count',
          arguments: {
            siteid: defaultSite,
            ...(statusValue && { status: statusValue })
          }
        }
      };
    }
    // 3. Overdue Work Orders
    else if (/\b(overdue|late|delayed|missed\s+target)\s*(work\s*orders?|wo\b)?/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_overdue_work_orders',
          arguments: { siteid: defaultSite, limit: 10 }
        }
      };
    }
    // 4. Query / List Work Orders
    else if (/\b(check|show|list|get|find|view|give)\s*(me\s+)?(all\s+)?([a-z\s-]*work\s*orders?|wo\b)/i.test(userQuery)) {
      const locMatch = lastUserMessage.match(/\b(?:in|at|for)\s+location\s+([A-Z0-9_\-]+)\b/i);
      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);
      
      let statusValue = null;
      if (/in[-_\s]?prog(ress)?/i.test(userQuery) || /\bINPRG\b/i.test(lastUserMessage)) statusValue = 'INPRG';
      else if (/\b(wappr|waiting|open)\b/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/\bappr(oved)?\b/i.test(userQuery)) statusValue = 'APPR';
      else if (/\bcomp(leted)?\b/i.test(userQuery)) statusValue = 'COMP';
      else if (/\bclose(d)?\b/i.test(userQuery)) statusValue = 'CLOSE';

      directToolCall = {
        function: {
          name: 'get_maximo_work_orders',
          arguments: {
            siteid: siteMatch ? siteMatch[1].toUpperCase() : defaultSite,
            ...(locMatch && { location: locMatch[1].toUpperCase() }),
            ...(statusValue && { status: statusValue }),
            limit: 10
          }
        }
      };
    }
    // 5. Create Work Order
    else if (/\b(create|open|log|new)\s+(a\s+)?(work order|wo)\b/i.test(userQuery)) {
      const deptMatch = lastUserMessage.match(/\b(CIVIL|ELEC|ELEC-LC|HK|LS|MECH)\b/i);
      const wtMatch = lastUserMessage.match(/\b(CM|RT|EM|PRJ)\b/i);
      const assetMatch = lastUserMessage.match(/\b(asset\s+([A-Z0-9_\-]+)|\b(ASSET[A-Z0-9_\-]*|TEST_STATUS|PUMP-[A-Z0-9_\-]+))\b/i);

      directToolCall = {
        function: {
          name: 'create_maximo_work_order',
          arguments: {
            description: `Work order for ${assetMatch ? (assetMatch[2] || assetMatch[0]) : 'maintenance'}`,
            department: (deptMatch ? deptMatch[0].toUpperCase() : activeCtx.lastMentionedDepartment) || 'MECH',
            worktype: (wtMatch ? wtMatch[0].toUpperCase() : activeCtx.lastMentionedWorkType) || 'CM',
            assetnum: assetMatch ? (assetMatch[2] || assetMatch[0]) : activeCtx.lastMentionedAsset,
            siteid: defaultSite
          }
        }
      };
    }
    // 6. Update Work Order Status
    else if (/\b(update|change|set)\s+(status\s+of\s+)?(wo|work order)?\s*(WO-?\d{3,8}|[A-Z0-9_\-]+)\s*(?:to|status)?\s*(APPR|INPRG|COMP|CAN|CLOSE)\b/i.test(userQuery)) {
      const match = userQuery.match(/\b(?:update|change|set)\s+(?:status\s+of\s+)?(?:wo|work order)?\s*([A-Z0-9_\-]+)\s*(?:to|status)?\s*(APPR|INPRG|COMP|CAN|CLOSE)\b/i);
      if (match) {
        directToolCall = {
          function: {
            name: 'update_maximo_work_order_status',
            arguments: {
              wonum: match[1].toUpperCase(),
              newStatus: match[2].toUpperCase()
            }
          }
        };
      }
    }
    // 7. Inventory Low Stock Alerts
    else if (/\b(inventory alerts?|low stock|reorder alerts?|safety stock alerts?|critical parts?)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_inventory_alerts',
          arguments: { siteid: defaultSite, threshold: 5, limit: 10 }
        }
      };
    }
    // 8. Check Inventory Item Balance
    else if (/\b(check\s+inventory|stock\s+of|inventory\s+(?:balance|for)|item\s+balance)\b/i.test(userQuery)) {
      const itemMatch = lastUserMessage.match(/\b(?:for|of|item)\s+([A-Z0-9_\-]+)\b/i);
      if (itemMatch) {
        directToolCall = {
          function: {
            name: 'check_inventory',
            arguments: { itemnum: itemMatch[1].toUpperCase() }
          }
        };
      }
    }
    // 9. Failure Codes Lookup
    else if (/\b(failure\s*code|failure\s*hierarchy|problem\s*code)\b/i.test(userQuery)) {
      const codeMatch = lastUserMessage.match(/\b(?:for|code)\s+([A-Z0-9_\-]+)\b/i);
      directToolCall = {
        function: {
          name: 'get_failure_codes',
          arguments: {
            ...(codeMatch && { failurelist: codeMatch[1].toUpperCase() }),
            limit: 10
          }
        }
      };
    }
    // 10. Job Plans Query
    else if (/\b(job\s*plans?|jobplan|standard\s+tasks?)\b/i.test(userQuery)) {
      const searchMatch = lastUserMessage.match(/\b(?:for|search|keyword)\s+([A-Z0-9_\-]+)\b/i);
      directToolCall = {
        function: {
          name: 'get_job_plans',
          arguments: {
            ...(searchMatch && { search: searchMatch[1] }),
            limit: 10
          }
        }
      };
    }
    // 11. Service Request Count
    else if (/\b(how many|count of|number of)\s*(service\s*requests?|srs?\b)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_service_request_count',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 12. Create Service Request
    else if (/\b(create|open|log|new|submit)\s+(a\s+)?(service\s*request|sr\b|ticket)\b/i.test(userQuery)) {
      const deptMatch = lastUserMessage.match(/\b(CIVIL|ELEC|ELEC-LC|HK|LS|MECH)\b/i);
      const assetMatch = lastUserMessage.match(/\b(asset\s+([A-Z0-9_\-]+)|\b(ASSET[A-Z0-9_\-]*|PUMP-[A-Z0-9_\-]+))\b/i);

      directToolCall = {
        function: {
          name: 'create_service_request',
          arguments: {
            summary: `Service request submitted for ${assetMatch ? (assetMatch[2] || assetMatch[0]) : 'maintenance'}`,
            department: (deptMatch ? deptMatch[0].toUpperCase() : activeCtx.lastMentionedDepartment) || 'MECH',
            worktype: 'CM',
            ...(assetMatch && { assetnum: assetMatch[2] || assetMatch[0] })
          }
        }
      };
    }
    // 13. Executive Cost Summary
    else if (/\b(cost summary|maintenance cost|spend breakdown|maintenance spend|expenditure|financial report|labor cost|contractors?|tools spend)\b/i.test(userQuery) || userQuery.includes('spend breakdown') || userQuery.includes('cost and spend')) {
      directToolCall = {
        function: {
          name: 'get_executive_cost_summary',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 14. Comprehensive Reliability League (CM Ratio, PM Compliance, Backlog, MTTR, RT Comparison)
    else if (/\b(cm ratio|pm compliance|backlog and mttr|compare all sites|reliability league|sites comparison|all sites benchmark|cross-site league|مقارنة المواقع)\b/i.test(userQuery) || (userQuery.includes('cm') && userQuery.includes('pm')) || (userQuery.includes('compare') && userQuery.includes('site'))) {
      const siteMatch = lastUserMessage.match(/\b(?:for|in|site)\s+([A-Z0-9_\-]+)\b/i);
      const isAllSites = /\b(all sites|across all|cross-site|كل المواقع)\b/i.test(userQuery);
      const targetSite = (!isAllSites && siteMatch) ? siteMatch[1].toUpperCase() : null;

      // Detect period from prompt
      let period = '30d';
      if (/\b(90\s*days?|quarter|last\s*3\s*months?|الربع\s*الاخير|٣\s*شهور)\b/i.test(userQuery)) {
        period = '90d';
      } else if (/\b(year|365\s*days?|ytd|past\s*year|last\s*12\s*months?|السنة|العام)\b/i.test(userQuery)) {
        period = '365d';
      } else if (/\b(all\s*time|historical|ever|كل\s*الوقت|تاريخيا)\b/i.test(userQuery)) {
        period = 'all';
      }

      directToolCall = {
        function: {
          name: 'get_multi_site_reliability_league',
          arguments: {
            ...(targetSite && { siteid: targetSite }),
            period
          }
        }
      };
    }
    // 15. Reliability Single-Site Bad Actors & MTTR
    else if (/\b(reliability|mttr|mean time to repair|bad actor|bad actors|proactivity index)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_reliability_metrics',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 16. Backlog Aging
    else if (/\b(backlog aging|aging distribution|stagnant|aging report)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_backlog_aging',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 17. Multi-Site Benchmark
    else if (/\b(benchmark|multi-site|cross-site|site comparison|compare sites)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_multi_site_benchmark',
          arguments: {}
        }
      };
    }
    // 18. Maintenance KPIs Dashboard
    else if (/\b(kpis?|kpi dashboard|maintenance metrics|operational health)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_maintenance_kpis',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 19. Locations list
    else if (/\b(list|show|get|all)\s+locations\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_locations',
          arguments: { siteid: defaultSite, limit: 20 }
        }
      };
    }
    // 20. Sites list
    else if (/\b(list|show|get|all)\s+sites\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_sites',
          arguments: {}
        }
      };
    }
    // 21. Executive Budget Variance
    else if (/\b(budget|variance|budget health|over budget|under budget|capex vs opex|opex spend)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_budget_variance_analysis',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 22. Vendor & Contractor SLA Performance
    else if (/\b(vendor|contractor|sla|sla compliance|vendor performance|contractors? performance)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_vendor_sla_performance',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 23. Asset Lifecycle & CAPEX Replacement Forecast
    else if (/\b(asset lifecycle|replacement forecast|capex forecast|replace critical assets|money pit|asset replacement)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_asset_lifecycle_forecast',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 24. Asset Criticality Risk Matrix
    else if (/\b(criticality|risk matrix|operational risk|vulnerable assets|rpn|single point of failure|مصفوفة المخاطر)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_asset_criticality_risk_matrix',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 25. Comprehensive Executive Audit Brief
    else if (/\b(executive brief|audit brief|boardroom report|c-suite memo|audit report|executive summary report|تقرير الإدارة العليا)\b/i.test(userQuery) || (userQuery.includes('executive') && userQuery.includes('brief'))) {
      directToolCall = {
        function: {
          name: 'generate_executive_audit_brief',
          arguments: { siteid: defaultSite }
        }
      };
    }
    // 23. Arabic Native Intent Routing (أوامر الشغل، الأصول، قطع الغيار، البلاغات)
    else if (/(اوامر\s*الشغل|أوامر\s*الشغل|اوامر\s*العمل|أوامر\s*العمل|وردرات)/i.test(userQuery)) {
      let statusValue = null;
      if (/(تحت\s*التنفيذ|شغالة|قيد\s*العمل)/i.test(userQuery)) statusValue = 'INPRG';
      else if (/(معلقة|مفتوحة|في\s*الانتظار|تحت\s*الاعتماد)/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/(معتمدة|موافقة)/i.test(userQuery)) statusValue = 'APPR';
      else if (/(منتهية|مغلقة|مكتملة)/i.test(userQuery)) statusValue = 'COMP';

      directToolCall = {
        function: {
          name: 'get_maximo_work_orders',
          arguments: {
            siteid: defaultSite,
            ...(statusValue && { status: statusValue }),
            limit: 10
          }
        }
      };
    }
    else if (/(كم\s*عدد\s*الاصول|عدد\s*الأصول|كم\s*أصل|كام\s*اصل)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_asset_count',
          arguments: { siteid: defaultSite }
        }
      };
    }
    else if (/(نواقص|نقص|تنبيهات\s*المخزن|المخزون\s*الحرج|قطع\s*الغيار\s*الناقصة)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_inventory_alerts',
          arguments: { siteid: defaultSite, threshold: 5, limit: 10 }
        }
      };
    }
    else if (/(مؤشرات\s*الاداء|مؤشرات\s*الأداء|تقرير\s*الصيانة|لوحة\s*التحكم|kpi)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_maintenance_kpis',
          arguments: { siteid: defaultSite }
        }
      };
    }
    else if (/(اوامر\s*شغل\s*متاخرة|أوامر\s*متأخرة|متأخرة|فائتة)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_overdue_work_orders',
          arguments: { siteid: defaultSite, limit: 10 }
        }
      };
    }

    try {
      let response;
      if (directToolCall) {
        response = {
          message: {
            role: 'assistant',
            tool_calls: [directToolCall],
            content: null
          }
        };
      } else {
        // 1. Initial agent deliberation & tool call detection
        response = await ollama.chat({
          model,
          messages: conversation,
          tools: toolsSchema,
          keep_alive: -1, // Keep model hot in RAM/VRAM permanently (no cold-boot delay)
          options: ollamaOptions
        });
      }

      // Log for instant debugging
      console.log('[Agent Turn] Model response content:', response.message?.content);
      console.log('[Agent Turn] Model tool_calls:', response.message?.tool_calls);

      // Helper to detect and normalize tool calls from raw JSON or pseudo-code strings
      function normalizeToolCalls(msg) {
        if (msg.tool_calls && msg.tool_calls.length > 0) return;
        if (!msg.content) return;
        const textContent = msg.content.trim();

        // 1. JSON format: {"tool": "create_maximo_work_order", ...}
        const jsonMatch = textContent.match(/\{[\s\S]*?"(?:tool|action|name|function)"\s*:\s*"([a-zA-Z0-9_]+)"[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const parsedJson = JSON.parse(jsonMatch[0]);
            const inferredTool = parsedJson.tool || parsedJson.action || parsedJson.name || parsedJson.function;
            const inferredArgs = { ...parsedJson };
            delete inferredArgs.tool;
            delete inferredArgs.action;
            delete inferredArgs.name;
            delete inferredArgs.function;

            msg.tool_calls = [{
              function: {
                name: inferredTool,
                arguments: inferredArgs
              }
            }];
            return;
          } catch (e) {}
        }

        // 1b. Python import format hallucination: from maximo.oslc import tool_name OR tool_name = ...
        const pyImportMatch = textContent.match(/(?:from\s+[a-zA-Z0-9_.]+\s+import\s+|import\s+)([a-zA-Z0-9_]+)/);
        if (pyImportMatch) {
          const importedName = pyImportMatch[1];
          const isRegistered = toolsSchema.some(t => t.function.name === importedName);
          if (isRegistered) {
            msg.tool_calls = [{
              function: {
                name: importedName,
                arguments: { siteid: memoryService.getSession(sessionId)?.workingContext?.activeSite || siteid || 'TEST' }
              }
            }];
            return;
          }
        }

        // 2. Function call format: create_maximo_work_order(...) or get_work_orders(...)
        const fnMatch = textContent.match(/([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)/m);
        if (fnMatch) {
          let toolName = fnMatch[1];
          const rawArgs = fnMatch[2].trim();
          const inferredArgs = {};

          const argRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,)]*))/g;
          let m;
          let hasNamedArgs = false;
          while ((m = argRegex.exec(rawArgs)) !== null) {
            hasNamedArgs = true;
            let k = m[1].toLowerCase().replace(/^[-_]+|[-_]+$/g, '');
            const v = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] || '').trim());

            // Normalize parameter names generated by small models
            if (k === 'active_site' || k === 'site' || k === 'activesite') k = 'siteid';
            else if (k === 'in_focus_asset' || k === 'asset' || k === 'infocusasset') k = 'assetnum';
            else if (k === 'selected_department' || k === 'dept' || k === 'selecteddepartment') k = 'department';
            else if (k === 'selected_work_type' || k === 'work_type' || k === 'selectedworktype') k = 'worktype';
            else if (k === 'desc' || k === 'summary') k = 'description';

            inferredArgs[k] = v;
          }

          if (toolName === 'create_maximo_work_order') {
            if (!inferredArgs.description) {
              inferredArgs.description = inferredArgs.assetnum 
                ? `Work order for asset ${inferredArgs.assetnum}`
                : 'Corrective maintenance work order';
            }
            if (!inferredArgs.siteid) {
              inferredArgs.siteid = memoryService.getSession(sessionId)?.workingContext?.activeSite || 'TEST';
            }
          }

          if (!hasNamedArgs && rawArgs) {
            // Positional arguments like: ("MECH", "CM", "TEST_STATUS") or ("Water pump leak", "MECH", "CM")
            const parts = rawArgs.split(',').map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);
            if (toolName === 'create_maximo_work_order') {
              for (const part of parts) {
                const upper = part.toUpperCase();
                if (['MECH', 'ELEC', 'CIVIL', 'HK', 'LS', 'ELEC-LC'].includes(upper)) {
                  inferredArgs.department = upper;
                } else if (['CM', 'RT', 'EM', 'PRJ'].includes(upper)) {
                  inferredArgs.worktype = upper;
                } else if (upper === 'TEST' || upper === 'BEDFORD') {
                  inferredArgs.siteid = upper;
                } else if (upper.startsWith('ASSET') || upper.includes('STATUS') || upper.includes('PUMP') || upper.includes('COMP') || upper.startsWith('TEST_') || /^[A-Z0-9_\-]+$/.test(part)) {
                  if (!inferredArgs.assetnum) {
                    inferredArgs.assetnum = part;
                    if (!inferredArgs.description) inferredArgs.description = `Work order for asset ${part}`;
                  } else if (!inferredArgs.description) {
                    inferredArgs.description = part;
                  }
                } else if (!inferredArgs.description) {
                  inferredArgs.description = part;
                }
              }
              if (!inferredArgs.description) {
                inferredArgs.description = `Work order for ${inferredArgs.assetnum || 'asset maintenance'}`;
              }
              if (!inferredArgs.siteid) {
                inferredArgs.siteid = memoryService.getSession(sessionId)?.workingContext?.activeSite || 'TEST';
              }
            } else {
              const cleanedArg = parts[0] || '';
              if (toolName.includes('location')) inferredArgs.location = cleanedArg;
              else if (toolName.includes('site')) inferredArgs.siteid = cleanedArg;
              else if (toolName.includes('status')) inferredArgs.status = cleanedArg;
            }
          }

          if (toolName === 'get_work_orders_in_location' || toolName === 'get_work_orders_by_location' || toolName === 'get_work_orders') {
            toolName = 'get_maximo_work_orders';
          }

          if (toolName === 'get_maximo_work_orders') {
            if (!inferredArgs.siteid) {
              inferredArgs.siteid = memoryService.getSession(sessionId)?.workingContext?.activeSite || 'TEST';
            }
            if (!inferredArgs.limit) {
              inferredArgs.limit = 10;
            }
          }

          const isRegistered = toolsSchema.some(t => t.function.name === toolName);
          if (isRegistered || toolName.includes('work_order') || toolName.includes('service_request') || toolName.includes('asset')) {
            msg.tool_calls = [{
              function: {
                name: toolName,
                arguments: inferredArgs
              }
            }];
          }
        }
      }

      normalizeToolCalls(response.message);
      console.log('[Agent Turn] Normalized tool_calls:', response.message.tool_calls);

      if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        // Extract diagnostic thoughts if present
        if (response.message.content) {
          const parsed = extractReasoning(response.message.content);
          if (parsed.reasoning) accumulatedReasoning.push(parsed.reasoning);
        }

        // Check for Human-In-The-Loop mutating tools
        for (const call of response.message.tool_calls) {
          const toolName = call.function.name;
          const toolArgs = call.function.arguments;

          if (MUTATING_TOOLS.has(toolName)) {
            const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            await redisStore.setApproval(actionId, { toolName, toolArgs, sessionId, timestamp: Date.now() });

            return res.json({
              requiresApproval: true,
              actionId,
              toolName,
              toolArgs,
              executedTools: executedToolsLog,
              reasoning: accumulatedReasoning.join('\n\n') || `Analyzing request and verifying parameters before submitting change to Maximo for ${toolName}.`,
              memory: memoryService.getSession(sessionId).workingContext,
              reply: `Action requires human confirmation before updating IBM Maximo: **${toolName}**`
            });
          }
        }

        conversation.push(response.message);

        // Execute read tools in parallel if multiple, or sequentially
        for (const call of response.message.tool_calls) {
          const toolName = call.function.name;
          const toolArgs = call.function.arguments;

          const toolResult = await executeTool(toolName, toolArgs);
          executedToolsLog.push({ tool: toolName, arguments: toolArgs, result: toolResult });
          conversation.push({ role: 'tool', content: JSON.stringify(toolResult) });
        }
      }

      // Send final prompt with tool results back to Ollama for the final natural language answer
      const finalResponse = await ollama.chat({
        model,
        messages: conversation,
        keep_alive: -1,
        options: ollamaOptions
      });

      const reply = finalResponse.message?.content || 'Done.';
      updateMemoryFromText(sessionId, reply, executedToolsLog);

      // Persist conversation to disk for the logged-in user
      const fullMessages = [...messages, { role: 'assistant', content: reply, executedTools: executedToolsLog }];
      const savedConv = conversationService.saveMessages(username, conversationId, fullMessages, executedToolsLog, siteid);

      return res.json({
        reply,
        executedTools: executedToolsLog,
        conversationId: savedConv.id,
        memory: memoryService.getSession(sessionId).workingContext
      });

    } catch (error) {
      console.error('Agent processing error:', error);
      return res.status(500).json({ error: 'Internal Error', details: error.message });
    }
  },

  // Reset session memory endpoint
  async resetMemory(req, res) {
    const { sessionId = 'default-session' } = req.body;
    const session = memoryService.clearSession(sessionId);
    return res.json({ success: true, message: 'Session memory cleared', memory: session.workingContext });
  },

  // Get active session memory
  async getMemory(req, res) {
    const { sessionId = 'default-session' } = req.query;
    const session = memoryService.getSession(sessionId);
    return res.json({ session: session.workingContext });
  }
};
