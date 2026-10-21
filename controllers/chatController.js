import { toolsSchema, getActiveToolsSchema, executeTool, MUTATING_TOOLS } from '../services/tools.js';
import { memoryService } from '../services/memory.js';
import { redisStore } from '../services/redisStore.js';
import { conversationService } from '../services/conversationService.js';
import { getDefaultSite } from '../services/maximo.js';
import { skillService } from '../services/skillService.js';

const BASE_SYSTEM_PROMPT = `You are the Eden FM Intelligent Operations & Asset Assistant, representing Eden Facility Management (a subsidiary of Hassan Allam Holding) operating since 2011 across Egypt and the MEA region.
You interface directly with Eden's IBM Maximo EAM system to empower Facility Managers, Engineers, and C-Suite leadership.

CORE IDENTITY & EDEN VALUES:
- Organization: Eden Facility Management (Subsidiary of Hassan Allam Holding).
- Operating Model: 90% Self-Executed Operations (in-house technical manpower across MEP, HVAC, Civil, HSE, and Energy Management).
- Core Values: Integrity, Respect, Reliability, Quality, and Discipline.
- Mission: Managing, protecting, and maximizing property and infrastructure asset value and energy efficiency.

RULES:
1. Always invoke the relevant tool from your tools list:
   - For PPM Schedules & Forecasts: call "get_ppm_forecast"
   - For creating Work Orders: call "create_maximo_work_order"
   - For listing Work Orders: call "get_maximo_work_orders" (supports status e.g. INPRG, WAPPR, APPR, location, siteid)
   - For showing or listing unplanned / corrective / emergency work orders: call "get_unplanned_work_orders" (use all_sites: true if user asks across all sites). Only call "get_unplanned_work_orders_summary" when the user explicitly requests a summary breakdown or count by site.
   - For counting Work Orders: call "get_work_order_count"
   - For counting Assets (e.g. "how many assets"): call "get_asset_count"
   - For listing Assets: call "get_assets"
   - For Asset details: call "get_asset_details"
   - For counting SRs: call "get_service_request_count"
   - For comparing all sites reliability, CM ratio, PM compliance, active backlog, MTTR, and RT comparison: call "get_multi_site_reliability_league" (leave siteid empty or ALL). For a single site reliability breakdown (MTTR, Proactive ratio, Top Bad Actors): call "get_reliability_metrics".
   - For executive metrics: call the executive tool (get_executive_cost_summary, get_reliability_metrics, get_multi_site_reliability_league, etc.)
   - For technical manuals, equipment guides, SOPs, HSE safety, or document questions: call "search_knowledge_base"
2. When displaying lists of records or cross-site tables:
   - When presenting lists of Work Orders or multi-site data, format them as a standard GitHub Flavored Markdown table.
   - You MUST put each table row on its own line separated by a real newline character (\n). Never concatenate rows on a single line with ||.
   - Example table format:
| WONUM | Description | Type | Status | Asset | Location | Site | Report Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WO-101 | Chiller Annual Overhaul | CM | WAPPR | CHILLER-01 | ROOF-A | CAC | 2026-10-01 |
   - When asked for Work Orders across all sites or a summary, call "get_work_order_site_summary" (or "get_unplanned_work_orders_summary" for unplanned) to display the site count summary table.
   - Keep introductory text concise and aligned with Eden professional standards.
   - Provide a brief, complete 1-2 sentence executive conclusion. Never cut off mid-sentence.
3. GROUNDED REAL-TIME TELEMETRY & ZERO FABRICATION:
   - Base all analysis, commentary, and metrics strictly and exclusively on the actual data returned by the executed tools.
   - NEVER fabricate or invent site names, asset names, or maintenance statistics not present in the tool results.
   - Always state the evaluated time period explicitly (e.g. "Last 30 Days", "Quarter", or "All Time"). If 0 work orders are recorded for the requested period, state clearly that no work orders were logged during that period.
4. NEVER output code strings, Python syntax, pseudo-code, or JSON in plain text. Always execute tools directly.
5. Language support:
   - If the user writes in Arabic, answer in professional Arabic (مساعد إيدن الذكي لإدارة المرافق والصيانة).
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

  // Detect Asset (e.g., PUMP-101, COMP-01, CHILLER-01)
  const assetMatch = text.match(/\b(asset\s+([A-Z0-9_\-]+)|\b(PUMP|COMP|HVAC|MOTOR|GEN|CHILLER|BOILER)-[A-Z0-9_\-]+)\b/i);
  if (assetMatch) {
    const candidate = (assetMatch[2] || assetMatch[0]).toUpperCase();
    const stopWords = ['MANAGEMENT', 'COUNT', 'CARD', 'DETAILS', 'LIST', 'STATUS', 'LIFECYCLE', 'REPLACEMENT', 'CRITICALITY', 'PASSPORT', 'HISTORY', 'REPORT', 'RECORDS', 'NUMBER', 'NAME', 'TAG', 'SUMMARY', 'TABLE'];
    if (!stopWords.includes(candidate)) {
      updates.lastMentionedAsset = candidate;
    }
  }

  // Detect Location (e.g., in location ROOF-A, at location BLDG-1)
  const locMatch = text.match(/\b(?:in|at|for)?\s*location\s+([A-Z0-9_\-]+)\b/i);
  if (locMatch) {
    const candidateLoc = locMatch[1].toUpperCase();
    const locStopWords = ['STATUS', 'LIST', 'SUMMARY', 'COUNT', 'DETAILS', 'NAME', 'CODE', 'TABLE'];
    if (!locStopWords.includes(candidateLoc)) {
      updates.lastMentionedLocation = candidateLoc;
    }
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


// Universal helper to detect any valid site ID mentioned in user message
const KNOWN_MAXIMO_SITES = [
  'REGALH-G1', 'REGALH-G2', 'CRYSTAL', 'VIPCH', 'O-MALL', 'G-AREAS',
  'CED-OFFICES', 'M5', 'M4', 'UPPINGHAM', 'EDEN-EQ', 'ETISALAT',
  'NORTH-SQUARE', 'SHYAA-EGY', 'ECLP', 'EDEN-HQ', 'TEST', 'HURGHADA',
  'NORTHCOAST', 'SHARM'
];

function extractSiteFromText(text = '') {
  if (!text) return null;
  // 1. Look for explicit site keyword: "site REGALH-G1", "in site REGALH-G1"
  const kwMatch = text.match(/\b(?:in|at|for|site)?\s*(?:site\s+)?([A-Z0-9_\-]+)\b/i);
  for (const s of KNOWN_MAXIMO_SITES) {
    const reg = new RegExp('(^|[^a-zA-Z0-9_-])' + s + '($|[^a-zA-Z0-9_-])', 'i');
    if (reg.test(text)) return s;
  }
  return null;
}

export const chatController = {
  async handleChat(req, res, ollama, model) {
    const { messages, sessionId = 'default-session', siteid, conversationId } = req.body || {};
    const username = req.user?.username || 'admin';
    const allowedSites = req.user?.allowedSites || ['*'];
    const isUniversal = allowedSites.includes('*') || allowedSites.includes('ALL');

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Valid messages array is required.' });
    }

    // Determine target site and enforce user site authorization
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    const mentionedSite = extractSiteFromText(lastUserMessage);

    let targetSite = (mentionedSite || siteid || '').toUpperCase();
    if (!isUniversal) {
      const allowedUpper = allowedSites.map(s => s.toUpperCase());
      if (targetSite && !allowedUpper.includes(targetSite)) {
        return res.json({
          reply: `⛔ **Access Denied**: You do not have permission to view or manage site **${targetSite}**. Your authorized site(s): \`${allowedSites.join(', ')}\`.`,
          executedTools: [],
          memory: memoryService.getSession(sessionId).workingContext
        });
      }
      if (!targetSite) {
        targetSite = allowedUpper[0];
      }
    } else {
      if (!targetSite || targetSite === 'TEST') {
        const sessionSite = memoryService.getSession(sessionId)?.workingContext?.activeSite;
        targetSite = (sessionSite && sessionSite !== 'TEST') ? sessionSite : getDefaultSite();
      }
    }

    // Set authorized site in memory
    memoryService.updateWorkingContext(sessionId, { activeSite: targetSite, allowedSites });

    updateMemoryFromText(sessionId, lastUserMessage);

    // Formulate dynamic system prompt with session memory
    const userRole = req.user?.role || 'user';
    const memoryContextBlock = memoryService.formatMemoryPrompt(sessionId);
    const systemPromptWithMemory = `${BASE_SYSTEM_PROMPT}\n\nCURRENT WORKING MEMORY (Active Context):\n${memoryContextBlock}\n\nUSER PRIVACY & AUTHORIZATION RESTRICTIONS:
User '${username}' has role '${userRole}' and is strictly authorized for sites: [${allowedSites.join(', ')}].
${userRole === 'technician' ? "- PRIVACY RESTRICTION: You are assisting a plant Technician. Disclose only work orders, assets, and inventory for their authorized site. Never reveal executive financial figures, corporate board audits, or cross-site leagues." : ""}
${userRole === 'engineer' ? "- PRIVACY RESTRICTION: You are assisting a Site Engineer. Limit data to their assigned facility and operational metrics." : ""}
- Never query, invent, or disclose Maximo data belonging to any site outside [${allowedSites.join(', ')}].`;

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
    const defaultSite = targetSite;

    // Check for explicit Skill Slash Commands (e.g. /rca, /capex, /audit, /league, /safety, /my-tickets)
    const skillMatch = skillService.findMatchingSkill(userQuery);
    if (skillMatch) {
      const { command, matchedQuery } = skillMatch;
      const cmd = command.command;

      // Extract asset or context from matched query
      const assetTokenMatch = matchedQuery.match(/\b([A-Z0-9_\-]+)\b/i);
      const targetAsset = assetTokenMatch ? assetTokenMatch[1].toUpperCase() : (activeCtx.lastMentionedAsset || null);

      if (cmd === '/rca') {
        directToolCall = {
          function: {
            name: 'get_machine_card',
            arguments: { assetnum: targetAsset || 'ASSET124', siteid: defaultSite }
          }
        };
      } else if (cmd === '/capex') {
        directToolCall = {
          function: {
            name: 'get_machine_card',
            arguments: { assetnum: targetAsset || 'ASSET124', siteid: defaultSite }
          }
        };
      } else if (cmd === '/site-kpis' || cmd === '/cm-ratio' || cmd === '/pm-compliance' || cmd === '/site-mtbf' || cmd === '/site-backlog') {
        const pMatch = matchedQuery.match(/period\s*=\s*([A-Z0-9_\-]+)/i) || 
                       matchedQuery.match(/\b(7d|30d|90d|180d|365d|all)\b/i) ||
                       (matchedQuery.includes('quarter') ? [null, '90d'] : null) ||
                       (matchedQuery.includes('year') ? [null, '365d'] : null) ||
                       (matchedQuery.includes('week') ? [null, '7d'] : null);
        const resolvedPeriod = pMatch ? pMatch[1].toLowerCase() : '30d';
        const sMatch = matchedQuery.match(/site(?:id)?\s*=\s*([A-Z0-9_\-]+)/i);
        const resolvedSite = sMatch ? sMatch[1].toUpperCase() : (mentionedSite || defaultSite);

        directToolCall = {
          function: {
            name: 'get_site_kpi_scorecard',
            arguments: {
              siteid: resolvedSite,
              period: resolvedPeriod
            }
          }
        };
      } else if (cmd === '/league') {
        directToolCall = {
          function: {
            name: 'get_multi_site_reliability_league',
            arguments: { all_sites: true }
          }
        };
      } else if (cmd === '/board-memo') {
        directToolCall = {
          function: {
            name: 'generate_executive_audit_brief',
            arguments: { all_sites: true }
          }
        };
      } else if (cmd === '/audit') {
        directToolCall = {
          function: {
            name: 'get_overdue_work_orders',
            arguments: { siteid: defaultSite, limit: 15 }
          }
        };
      } else if (cmd === '/vendor-sla') {
        directToolCall = {
          function: {
            name: 'get_vendor_sla_performance',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/stock-forecast') {
        directToolCall = {
          function: {
            name: 'get_inventory_alerts',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/troubleshoot') {
        directToolCall = {
          function: {
            name: 'search_knowledge_base',
            arguments: {
              query: `troubleshoot steps maintenance symptom ${matchedQuery || targetAsset || ''}`,
              conversationId: conversationId || undefined
            }
          }
        };
      } else if (cmd === '/safety') {
        directToolCall = {
          function: {
            name: 'search_knowledge_base',
            arguments: {
              query: `safety requirements PPE personal protective equipment Lockout Tagout LOTO ${matchedQuery || targetAsset || ''}`,
              conversationId: conversationId || undefined
            }
          }
        };
      } else if (cmd === '/budget-variance') {
        directToolCall = {
          function: {
            name: 'get_budget_variance_analysis',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/cost-summary') {
        directToolCall = {
          function: {
            name: 'get_executive_cost_summary',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/risk-matrix') {
        directToolCall = {
          function: {
            name: 'get_asset_criticality_risk_matrix',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/backlog-aging') {
        directToolCall = {
          function: {
            name: 'get_backlog_aging',
            arguments: { siteid: defaultSite }
          }
        };
      } else if (cmd === '/portfolio-summary') {
        directToolCall = {
          function: {
            name: 'get_federated_portfolio_summary',
            arguments: {}
          }
        };
      } else if (cmd === '/federated-assets') {
        directToolCall = {
          function: {
            name: 'get_federated_asset_count',
            arguments: {}
          }
        };
      } else if (cmd === '/my-tickets') {
        const pMatch = matchedQuery.match(/period\s*=\s*([A-Z0-9_\-]+)/i) || 
                       matchedQuery.match(/\b(7d|30d|90d|180d|365d|all)\b/i) ||
                       (matchedQuery.includes('quarter') ? [null, '90d'] : null) ||
                       (matchedQuery.includes('year') ? [null, '365d'] : null) ||
                       (matchedQuery.includes('month') ? [null, '30d'] : null) ||
                       (matchedQuery.includes('week') ? [null, '7d'] : null);
        const resolvedPeriod = pMatch ? pMatch[1].toLowerCase() : 'all';
        const sMatch = matchedQuery.match(/site(?:id)?\s*=\s*([A-Z0-9_\-]+)/i);
        const resolvedSite = sMatch ? sMatch[1].toUpperCase() : (mentionedSite || defaultSite);
        const limitMatch = matchedQuery.match(/limit\s*=\s*(\d+)/i);

        directToolCall = {
          function: {
            name: 'get_service_requests',
            arguments: {
              siteid: resolvedSite,
              period: resolvedPeriod,
              limit: limitMatch ? parseInt(limitMatch[1]) : 15
            }
          }
        };
      } else if (cmd === '/reliability-kpis') {
        // Parse numbers from matched query: e.g. "720 operating hrs, 14 downtime hrs, 2 failures"
        const numMatches = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        const op = numMatches[0] ? parseFloat(numMatches[0]) : 720;
        const down = numMatches[1] ? parseFloat(numMatches[1]) : 12;
        const fails = numMatches[2] ? parseInt(numMatches[2]) : 2;
        directToolCall = {
          function: {
            name: 'calculate_reliability_kpis',
            arguments: {
              total_operating_hours: op,
              total_downtime_hours: down,
              number_of_failures: fails
            }
          }
        };
      } else if (cmd === '/asset-criticality') {
        const sMatch = matchedQuery.match(/safety\s*=\s*(\d+)/i);
        const eMatch = matchedQuery.match(/env(?:ironmental)?\s*=\s*(\d+)/i);
        const pMatch = matchedQuery.match(/prod(?:uction)?\s*=\s*(\d+)/i);
        const mMatch = matchedQuery.match(/mttr\s*=\s*(\d+)/i);
        const fMatch = matchedQuery.match(/freq(?:uency)?\s*=\s*(\d+)/i);
        directToolCall = {
          function: {
            name: 'evaluate_asset_criticality',
            arguments: {
              asset_num: targetAsset || 'CHILLER-01',
              safety_impact: sMatch ? parseInt(sMatch[1]) : 3,
              environmental_impact: eMatch ? parseInt(eMatch[1]) : 2,
              production_impact: pMatch ? parseInt(pMatch[1]) : 3,
              mttr_severity: mMatch ? parseInt(mMatch[1]) : 2,
              failure_frequency: fMatch ? parseInt(fMatch[1]) : 2
            }
          }
        };
      } else if (cmd === '/failure-hierarchy') {
        const classMatch = matchedQuery.match(/class\s*=\s*([A-Z0-9_\-]+)/i);
        const probMatch = matchedQuery.match(/prob(?:lem)?\s*=\s*([A-Z0-9_\-]+)/i);
        const causeMatch = matchedQuery.match(/cause\s*=\s*([A-Z0-9_\-]+)/i);
        const remMatch = matchedQuery.match(/rem(?:edy)?\s*=\s*([A-Z0-9_\-]+)/i);
        const woMatch = matchedQuery.match(/\b(WO-?\d{3,8})\b/i);
        directToolCall = {
          function: {
            name: 'validate_failure_hierarchy',
            arguments: {
              wonum: woMatch ? woMatch[1].toUpperCase() : (activeCtx.lastMentionedWonum || 'WO10492'),
              failure_class: classMatch ? classMatch[1].toUpperCase() : 'PUMP',
              problem_code: probMatch ? probMatch[1].toUpperCase() : 'LEAK',
              cause_code: causeMatch ? causeMatch[1].toUpperCase() : 'SEALWORN',
              remedy_code: remMatch ? remMatch[1].toUpperCase() : 'REPLSEAL'
            }
          }
        };
      } else if (cmd === '/build-oslc-query') {
        const parts = matchedQuery.split(/\s+/).filter(Boolean);
        const os = parts[0] || 'mxapiwodetail';
        const restWhere = parts.slice(1).join(' ') || `siteid="${defaultSite}"`;
        directToolCall = {
          function: {
            name: 'build_maximo_oslc_query',
            arguments: {
              object_structure: os,
              where_clause: restWhere
            }
          }
        };
      } else if (cmd === '/propose-pm-freq') {
        const pmMatch = matchedQuery.match(/\b(PM-?[A-Z0-9_\-]+)\b/i);
        const curMatch = matchedQuery.match(/current\s*=\s*(\d+)/i);
        const propMatch = matchedQuery.match(/proposed?\s*=\s*(\d+)/i);
        const unitMatch = matchedQuery.match(/unit\s*=\s*([A-Z]+)/i);
        directToolCall = {
          function: {
            name: 'propose_pm_frequency_update',
            arguments: {
              pmnum: pmMatch ? pmMatch[1].toUpperCase() : 'PM-CHILL-01',
              siteid: defaultSite,
              current_frequency: curMatch ? parseInt(curMatch[1]) : 30,
              proposed_frequency: propMatch ? parseInt(propMatch[1]) : 60,
              frequnit: unitMatch ? unitMatch[1].toUpperCase() : 'DAYS',
              engineering_justification: matchedQuery || 'Extended based on MTBF & ISO 55001 review'
            }
          }
        };
      // --- FMEA & RCM FAILURE MODE COMMANDS ---
      } else if (cmd === '/fmea-rpn') {
        const sMatch = matchedQuery.match(/s(?:everity)?\s*=\s*(\d+)/i);
        const oMatch = matchedQuery.match(/o(?:ccurrence)?\s*=\s*(\d+)/i);
        const dMatch = matchedQuery.match(/d(?:etectability)?\s*=\s*(\d+)/i);
        const nums = matchedQuery.match(/\b(\d+)\b/g) || [];
        const sVal = sMatch ? parseInt(sMatch[1]) : (nums[0] ? parseInt(nums[0]) : 7);
        const oVal = oMatch ? parseInt(oMatch[1]) : (nums[1] ? parseInt(nums[1]) : 4);
        const dVal = dMatch ? parseInt(dMatch[1]) : (nums[2] ? parseInt(nums[2]) : 3);
        const cleanName = matchedQuery.replace(/s\s*=\s*\d+|o\s*=\s*\d+|d\s*=\s*\d+|safety\s*=\s*\w+/gi, '').trim() || 'Bearing Seizure';
        directToolCall = {
          function: {
            name: 'calculate_fmea_rpn',
            arguments: {
              failure_mode_name: cleanName,
              severity_s: sVal,
              occurrence_o: oVal,
              detectability_d: dVal,
              safety_or_environmental_flag: /safety|hazard|env/i.test(matchedQuery)
            }
          }
        };
      } else if (cmd === '/iso14224-hierarchy') {
        const classMatch = matchedQuery.match(/class\s*=\s*([A-Z0-9_\-]+)/i);
        const compMatch = matchedQuery.match(/comp(?:onent)?\s*=\s*([A-Z0-9_\-]+)/i);
        const probMatch = matchedQuery.match(/prob(?:lem)?\s*=\s*([A-Z0-9_\-]+)/i);
        const causeMatch = matchedQuery.match(/cause\s*=\s*([A-Z0-9_\-]+)/i);
        const remMatch = matchedQuery.match(/rem(?:edy)?\s*=\s*([A-Z0-9_\-]+)/i);
        directToolCall = {
          function: {
            name: 'build_iso14224_failure_hierarchy',
            arguments: {
              equipment_class: classMatch ? classMatch[1] : 'PUMP',
              component_name: compMatch ? compMatch[1] : 'IMPELLER',
              problem_symptom: probMatch ? probMatch[1] : 'VIBR',
              failure_cause: causeMatch ? causeMatch[1] : 'CAVITATION',
              corrective_remedy: remMatch ? remMatch[1] : 'REPLIMPELLER'
            }
          }
        };
      } else if (cmd === '/rcm-decision') {
        directToolCall = {
          function: {
            name: 'generate_rcm_decision_logic',
            arguments: {
              failure_mode_description: matchedQuery || 'Critical Asset Failure Mode',
              hidden_failure_hazard: /hidden/i.test(matchedQuery),
              safety_environmental_consequence: /safety|hazard|env/i.test(matchedQuery),
              operational_economic_consequence: /economic|cost|downtime|prod/i.test(matchedQuery),
              technically_feasible_cbm: /cbm|pdm|condition|sensor|iot/i.test(matchedQuery),
              technically_feasible_time_based_pm: /time|pm|meter|scheduled/i.test(matchedQuery)
            }
          }
        };
      } else if (cmd === '/propose-fmea-jobplan') {
        const jpMatch = matchedQuery.match(/\b(JP-?[A-Z0-9_\-]+)\b/i);
        const failMatch = matchedQuery.match(/failure\s*=\s*([A-Z0-9_\-\s]+?)(?:task=|rpn=|$)/i);
        const taskMatch = matchedQuery.match(/task\s*=\s*([A-Z0-9_\-\s]+?)(?:rpn=|$)/i);
        const rpnMatch = matchedQuery.match(/rpn(?:_reduction)?\s*=\s*(\d+)/i);
        directToolCall = {
          function: {
            name: 'propose_fmea_jobplan_update',
            arguments: {
              jobplan_num: jpMatch ? jpMatch[1].toUpperCase() : 'JP-PUMP-01',
              siteid: defaultSite,
              failure_mode_addressed: failMatch ? failMatch[1].trim() : 'Cavitation / Wear',
              proposed_task_change: taskMatch ? taskMatch[1].trim() : 'Inspect suction strainer & record vibration baseline',
              rpn_reduction_expected: rpnMatch ? parseInt(rpnMatch[1]) : 80,
              rcm_justification: matchedQuery || 'Optimized per FMEA workshop review'
            }
          }
        };

      // --- ISO 55000 / ISO 55001 KPI & SQL COMMANDS ---
      } else if (cmd === '/iso-kpi-sql') {
        const parts = matchedQuery.split(/\s+/).filter(Boolean);
        const kpi = parts[0] || 'PM_COMPLIANCE';
        const daysMatch = matchedQuery.match(/days\s*=\s*(\d+)/i);
        directToolCall = {
          function: {
            name: 'generate_maximo_kpi_manager_sql',
            arguments: {
              kpi_code: kpi.toUpperCase(),
              siteid: defaultSite,
              rolling_days: daysMatch ? parseInt(daysMatch[1]) : 30
            }
          }
        };
      } else if (cmd === '/iso-reliability-kpi') {
        const nums = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        directToolCall = {
          function: {
            name: 'calculate_reliability_availability_kpis',
            arguments: {
              total_period_hours: nums[0] ? parseFloat(nums[0]) : 720,
              planned_downtime_hours: nums[1] ? parseFloat(nums[1]) : 20,
              unplanned_downtime_hours: nums[2] ? parseFloat(nums[2]) : 12,
              number_of_failures: nums[3] ? parseInt(nums[3]) : 2,
              performance_rate_percent: nums[4] ? parseFloat(nums[4]) : 100,
              quality_rate_percent: nums[5] ? parseFloat(nums[5]) : 100
            }
          }
        };
      } else if (cmd === '/iso-work-kpi') {
        const nums = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        directToolCall = {
          function: {
            name: 'calculate_work_management_kpis',
            arguments: {
              pm_completed_on_time: nums[0] ? parseInt(nums[0]) : 95,
              pm_total_scheduled: nums[1] ? parseInt(nums[1]) : 100,
              proactive_wo_hours: nums[2] ? parseFloat(nums[2]) : 320,
              reactive_emergency_wo_hours: nums[3] ? parseFloat(nums[3]) : 80,
              scheduled_wo_completed: nums[4] ? parseInt(nums[4]) : 40,
              total_wo_scheduled_weekly: nums[5] ? parseInt(nums[5]) : 45,
              total_backlog_labor_hours: nums[6] ? parseFloat(nums[6]) : 240,
              available_weekly_craft_hours: nums[7] ? parseFloat(nums[7]) : 80
            }
          }
        };
      } else if (cmd === '/iso-financial-kpi') {
        const nums = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        directToolCall = {
          function: {
            name: 'calculate_lifecycle_financial_kpis',
            arguments: {
              annual_maintenance_cost_usd: nums[0] ? parseFloat(nums[0]) : 150000,
              replacement_asset_value_rav_usd: nums[1] ? parseFloat(nums[1]) : 6000000,
              annual_energy_operating_cost_usd: nums[2] ? parseFloat(nums[2]) : 45000,
              asset_remaining_useful_life_years: nums[3] ? parseFloat(nums[3]) : 10
            }
          }
        };
      } else if (cmd === '/iso-inventory-kpi') {
        const nums = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        directToolCall = {
          function: {
            name: 'calculate_inventory_mro_kpis',
            arguments: {
              total_stock_requests: nums[0] ? parseInt(nums[0]) : 500,
              stockout_incidents: nums[1] ? parseInt(nums[1]) : 6,
              annual_mro_issued_value_usd: nums[2] ? parseFloat(nums[2]) : 350000,
              average_inventory_valuation_usd: nums[3] ? parseFloat(nums[3]) : 180000,
              inactive_obsolete_stock_value_usd: nums[4] ? parseFloat(nums[4]) : 8000
            }
          }
        };
      } else if (cmd === '/iso-governance-audit') {
        const nums = matchedQuery.match(/\d+(?:\.\d+)?/g) || [];
        directToolCall = {
          function: {
            name: 'calculate_data_risk_governance_kpis',
            arguments: {
              safety_critical_pm_completed: nums[0] ? parseInt(nums[0]) : 50,
              safety_critical_pm_due: nums[1] ? parseInt(nums[1]) : 50,
              wo_closed_with_full_iso14224_codes: nums[2] ? parseInt(nums[2]) : 190,
              total_corrective_wo_closed: nums[3] ? parseInt(nums[3]) : 200,
              verified_assets_in_maximo: nums[4] ? parseInt(nums[4]) : 980,
              total_physical_assets_audited: nums[5] ? parseInt(nums[5]) : 1000
            }
          }
        };
      } else if (cmd === '/propose-capa') {
        const kpiMatch = matchedQuery.match(/kpi\s*=\s*([A-Z0-9_\-]+)/i);
        const valMatch = matchedQuery.match(/val(?:ue)?\s*=\s*([A-Z0-9_\-.%]+)/i);
        const targetMatch = matchedQuery.match(/target\s*=\s*([A-Z0-9_\-.%]+)/i);
        const clauseMatch = matchedQuery.match(/clause\s*=\s*([0-9.]+)/i);
        directToolCall = {
          function: {
            name: 'propose_iso55001_capa_action',
            arguments: {
              kpi_name: kpiMatch ? kpiMatch[1].toUpperCase() : 'PM_COMPLIANCE',
              current_value: valMatch ? valMatch[1] : '88.5%',
              target_threshold: targetMatch ? targetMatch[1] : '95.0%',
              iso_clause_reference: clauseMatch ? clauseMatch[1] : '8.1',
              siteid: defaultSite,
              root_cause_summary: matchedQuery || 'PM compliance dropped below ISO 55001 corridor',
              corrective_action_plan: 'Review technician craft scheduling, dispatch contract support, and clear overdue backlog.'
            }
          }
        };
      }
    }

    // 0. Machine Card (Asset Passport & History)
    if (!directToolCall && (/\b(machine card|asset card|asset passport|بطاقة\s*الماكينة|بطاقة\s*المعدة|كارت\s*المعدة|كارت\s*الماكينة|تاريخ\s*المعدة|تاريخ\s*الماكينة)\b/i.test(userQuery) || (userQuery.includes('card') && (userQuery.includes('asset') || userQuery.includes('machine'))))) {
      // 1. Explicit asset mention after keyword (e.g. "asset ASSET124", "machine PUMP-101", "for ASSET124")
      const explicitMatch = lastUserMessage.match(/\b(?:asset|machine|for|المعدة|الماكينة|أصل|اصل)\s+([A-Z0-9_\-]+)\b/i);
      // 2. Fallback to asset pattern matching, strictly excluding query words like SHOW, GIVE, CARD, MACHINE
      const patternMatch = lastUserMessage.match(/\b(ASSET\d+|PUMP-?\d+|CHILLER-?\d+|COMP-?\d+|GEN-?\d+|AHU-?\d+|HVAC-?\d+|TEST_STATUS)\b/i);
      
      let targetAsset = null;
      if (explicitMatch && !['CARD', 'PASSPORT', 'HISTORY', 'DETAILS'].includes(explicitMatch[1].toUpperCase())) {
        targetAsset = explicitMatch[1].toUpperCase();
      } else if (patternMatch) {
        targetAsset = patternMatch[0].toUpperCase();
      } else {
        targetAsset = activeCtx.lastMentionedAsset || 'ASSET124';
      }

      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);

      directToolCall = {
        function: {
          name: 'get_machine_card',
          arguments: {
            assetnum: targetAsset,
            siteid: siteMatch ? siteMatch[1].toUpperCase() : defaultSite
          }
        }
      };
    }
    // 0.5. Create Work Order Intent
    else if (/\b(create|log|submit|open|new|انشئ|انشاء|عمل|سجل)\s+(a\s+)?(work\s*order|wo|امر\s*شغل|أمر\s*شغل)\b/i.test(userQuery) ||
             /\b(create_maximo_work_order)\b/i.test(userQuery)) {
      // 1. Explicit asset keyword followed by identifier (e.g. "asset ASSET124", "machine PUMP-101")
      const explicitAssetMatch = lastUserMessage.match(/\b(?:asset|machine|المعدة|الماكينة|أصل|اصل)\s+([A-Z0-9_\-]+)\b/i);
      // 2. Asset code pattern (e.g. ASSET124, PUMP-101, AHU-CHW-001)
      const patternAssetMatch = lastUserMessage.match(/\b(ASSET\d+|PUMP-?\d+|CHILLER-?\d+|COMP-?\d+|GEN-?\d+|AHU-?\d+|AHU-CHW-\d+|HVAC-?\d+|TEST_STATUS)\b/i);
      // 3. Fallback to "for/on <IDENTIFIER>" but strictly exclude words like "ASSET", "MACHINE", "WORK", "MECH"
      const forAssetMatch = lastUserMessage.match(/\b(?:for|on)\s+([A-Z0-9_\-]+)\b/i);
      
      let targetAsset = null;
      if (explicitAssetMatch && !['A', 'THE', 'ORDER', 'WORK', 'NEW'].includes(explicitAssetMatch[1].toUpperCase())) {
        targetAsset = explicitAssetMatch[1].toUpperCase();
      } else if (patternAssetMatch) {
        targetAsset = patternAssetMatch[0].toUpperCase();
      } else if (forAssetMatch && !['ASSET', 'A', 'THE', 'WORK', 'ORDER', 'NEW', 'MECH', 'ELEC'].includes(forAssetMatch[1].toUpperCase())) {
        targetAsset = forAssetMatch[1].toUpperCase();
      }

      const deptMatch = lastUserMessage.match(/\b(?:department|dept|قسم)\s+([A-Z\-]+)\b/i) ||
                        lastUserMessage.match(/\b(MECH|ELEC|ELEC-LC|CIVIL|HK|LS)\b/i);
      let targetDept = deptMatch ? (deptMatch[1] || deptMatch[0]).toUpperCase() : 'MECH';

      const wtMatch = lastUserMessage.match(/\b(?:work\s*type|type|نوع)\s+([A-Z]+)\b/i) ||
                      lastUserMessage.match(/\b(CM|EM|RT|PRJ)\b/i);
      let targetWorkType = wtMatch ? (wtMatch[1] || wtMatch[0]).toUpperCase() : 'CM';

      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);
      let targetSiteId = siteMatch ? siteMatch[1].toUpperCase() : defaultSite;

      let desc = null;
      const descMatch = lastUserMessage.match(/\b(?:description|details|summary|issue|problem|وصف|تفاصيل)\s*[:=]?\s*["']?([^"'\n,]+)["']?/i);
      if (descMatch) {
        desc = descMatch[1].trim();
      } else {
        const wtLabel = targetWorkType === 'CM' ? 'Corrective Maintenance' : targetWorkType === 'EM' ? 'Emergency Maintenance' : 'Maintenance';
        desc = targetAsset 
          ? `${wtLabel} for ${targetAsset} (${targetDept})`
          : `${wtLabel} Work Order (${targetDept})`;
      }

      directToolCall = {
        function: {
          name: 'create_maximo_work_order',
          arguments: {
            description: desc,
            worktype: targetWorkType,
            department: targetDept,
            ...(targetAsset && { assetnum: targetAsset }),
            siteid: targetSiteId
          }
        }
      };
    }
    // 1. Federated Multi-Server Queries (All 3 instances: ED, GEM, MD)
    else if (/\b(all\s+servers|all\s+instances|across\s+servers|across\s+all|every\s+server|all\s+three\s+servers|كل\s+السيرفرات|كل\s+الأنظمة|جميع\s+السيرفرات)\b/i.test(userQuery) && /\b(assets?|أصول|معدات)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_federated_asset_count',
          arguments: {}
        }
      };
    }
    else if (/\b(all\s+servers|all\s+instances|portfolio|executive\s+summary|across\s+all\s+servers|كل\s+السيرفرات|ملخص\s+تنفيذي|جميع\s+السيرفرات)\b/i.test(userQuery) && /\b(summary|overview|portfolio|status|orders|work|report|تقرير|ملخص)\b/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'get_federated_portfolio_summary',
          arguments: {}
        }
      };
    }
    // 1b. Single Instance Asset Count
    else if (/\b(how many|count of|total count|number of|total number of)\s+assets\b/i.test(userQuery) || (userQuery.includes('total') && userQuery.includes('assets'))) {
      const siteForCount = mentionedSite || defaultSite;
      directToolCall = {
        function: {
          name: 'get_asset_count',
          arguments: { siteid: siteForCount }
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
    // 3.5. Preventive Maintenance (PPM) Forecast Schedule (based on FORECASTDATE / NEXTDATE in PM application)
    else if (/\b(ppm|preventive|pm\s+application|forecast\s*date|forecastdate|next\s*date|جدول\s*الصيانة\s*الوقائية|صيانة\s*وقائية|وقائي)\b/i.test(userQuery) && !/\b(bad\s*actors|kpi|executive)\b/i.test(userQuery)) {
      const siteMatch = lastUserMessage.match(/\b(?:site|in\s+site|at\s+site|for\s+site)\s+([A-Z0-9_\-]+)\b/i);
      const assetMatch = lastUserMessage.match(/\b(?:asset|assetnum|معدة|ماكينة)\s*[:#]?\s*([A-Z0-9_\-]+)\b/i);

      let targetSite = defaultSite;
      if (siteMatch) {
        const candidate = siteMatch[1].toUpperCase();
        if (!['ACTIVE', 'PPM', 'PM', 'SITE', 'DATE', 'FORECAST', 'ALL'].includes(candidate)) {
          targetSite = candidate;
        }
      }

      directToolCall = {
        function: {
          name: 'get_ppm_forecast',
          arguments: {
            siteid: targetSite,
            status: 'ACTIVE',
            ...(assetMatch && { assetnum: assetMatch[1].toUpperCase() })
          }
        }
      };
    }
    // 3.8. Reliability League across all sites OR Single-Site Reliability Analysis
    else if (/\b(compare\s+all\s+sites|reliability\s+league|all\s+sites.*(cm|pm|mttr|backlog|rt)|cross[- ]site.*reliability|league)\b/i.test(userQuery) ||
             (/\b(compare|league)\b/i.test(userQuery) && /\b(all\s+sites|sites)\b/i.test(userQuery) && /\b(cm|pm|mttr|reliability|backlog|rt)\b/i.test(userQuery))) {
      let period = '30d';
      if (/\b(90\s*days?|quarter|last\s*3\s*months?|الربع\s*الاخير)\b/i.test(userQuery)) period = '90d';
      else if (/\b(year|365\s*days?|ytd|past\s*year|last\s*12\s*months?|السنة|العام)\b/i.test(userQuery)) period = '365d';
      else if (/\b(all\s*time|historical|ever|كل\s*الوقت|تاريخيا)\b/i.test(userQuery)) period = 'all';

      directToolCall = {
        function: {
          name: 'get_multi_site_reliability_league',
          arguments: { period }
        }
      };
    }
    else if (/\b(reliability|mttr|mean time to repair|bad actor|bad actors|proactive|reactive|proactivity)\b/i.test(userQuery) && /\b(analysis|metrics?|ratio|dashboard|report|kpi|actors?|index|مؤشرات|اعتمادية)\b/i.test(userQuery)) {
      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);
      directToolCall = {
        function: {
          name: 'get_reliability_metrics',
          arguments: { siteid: siteMatch ? siteMatch[1].toUpperCase() : defaultSite }
        }
      };
    }
    // 4. Unplanned / Corrective / Emergency Work Orders (CM & EM)
    else if (/\b(unplanned|corrective|emergency|غير\s*مخططة|طارئة|تصحيحية|اعطال|أعطال)\s*(work\s*orders?|wo\b|أوامر\s*شغل|اوامر\s*شغل)?/i.test(userQuery) ||
             /\b(no|count|number|total|how many)\s+(of\s+)?(cm|em|corrective|emergency|breakdowns?|reactive)\b/i.test(userQuery) ||
             (/\b(cm|em)\b/i.test(userQuery) && /\b(last\s*month|this\s*month|30\s*days?|month|quarter|year|yesterday|today|شهر|الشهر|الماضي)\b/i.test(userQuery)) ||
             (/\breactive\b/i.test(userQuery) && /\b(work\s*orders?|wo\b)\b/i.test(userQuery))) {
      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);
      const isAllSites = /\b(all\s+sites|across\s+sites|every\s+site|cross[- ]?site|كل\s+المواقع|جميع\s+المواقع)\b/i.test(userQuery);
      const isSummary = /\b(summary|table|count|number\s+of|numbers|no\b|how\s+many|ملخص|جدول|كام|كم\s+عدد)\b/i.test(userQuery) || /\b(no|count|number)\s+(of\s+)?(cm|em)\b/i.test(userQuery);

      // Detect period
      let period = null;
      if (/\b(last\s*month|past\s*month|30\s*days?|الشهر\s*الماضي|شهر)\b/i.test(userQuery)) {
        period = '30d';
      } else if (/\b(90\s*days?|quarter|last\s*3\s*months?|الربع\s*الاخير)\b/i.test(userQuery)) {
        period = '90d';
      } else if (/\b(year|365\s*days?|ytd|past\s*year|last\s*12\s*months?|السنة|العام)\b/i.test(userQuery)) {
        period = '365d';
      }

      let statusValue = null;
      if (/in[-_\s]?prog(ress)?/i.test(userQuery) || /\bINPRG\b/i.test(lastUserMessage)) statusValue = 'INPRG';
      else if (/\b(wappr|waiting|open)\b/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/\bappr(oved)?\b/i.test(userQuery)) statusValue = 'APPR';
      else if (/\bcomp(leted)?\b/i.test(userQuery)) statusValue = 'COMP';
      else if (/\bclose(d)?\b/i.test(userQuery)) statusValue = 'CLOSE';

      if (isAllSites || isSummary) {
        directToolCall = {
          function: {
            name: 'get_unplanned_work_orders_summary',
            arguments: {
              ...(statusValue && { status: statusValue }),
              siteid: siteMatch ? siteMatch[1].toUpperCase() : (isAllSites ? 'ALL' : defaultSite),
              ...(period && { period })
            }
          }
        };
      } else {
        directToolCall = {
          function: {
            name: 'get_unplanned_work_orders',
            arguments: {
              siteid: siteMatch ? siteMatch[1].toUpperCase() : defaultSite,
              ...(statusValue && { status: statusValue }),
              ...(period && { period }),
              all_sites: isAllSites,
              limit: 15
            }
          }
        };
      }
    }
    // 5. Query / List General Work Orders or Work Order Site Summary
    else if (/\b(check|show|list|get|find|view|give)\s*(me\s+)?(all\s+)?([a-z\s-]*work\s*orders?|wo\b)/i.test(userQuery) || /\bwork\s*orders?\s*(summary|count|table|by\s*site|across\s*all\s*sites)\b/i.test(userQuery)) {
      const locMatch = lastUserMessage.match(/\b(?:in|at|for)\s+location\s+([A-Z0-9_\-]+)\b/i);
      const siteMatch = lastUserMessage.match(/\b(?:in|at|for)\s+site\s+([A-Z0-9_\-]+)\b/i);
      const isAllSites = /\b(all\s+sites|across\s+sites|every\s+site|cross[- ]?site|كل\s+المواقع)\b/i.test(userQuery);
      const isSummary = /\b(summary|table|count|ملخص|جدول)\b/i.test(userQuery);
      
      let statusValue = null;
      if (/in[-_\s]?prog(ress)?/i.test(userQuery) || /\bINPRG\b/i.test(lastUserMessage)) statusValue = 'INPRG';
      else if (/\b(wappr|waiting|open)\b/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/\bappr(oved)?\b/i.test(userQuery)) statusValue = 'APPR';
      else if (/\bcomp(leted)?\b/i.test(userQuery)) statusValue = 'COMP';
      else if (/\bclose(d)?\b/i.test(userQuery)) statusValue = 'CLOSE';

      if (isAllSites || isSummary) {
        // Return structured summary table grouped by site (all sites if user requested summary across sites or did not specify a single site)
        const summaryTargetSite = siteMatch ? siteMatch[1].toUpperCase() : (isAllSites ? 'ALL' : (isSummary ? 'ALL' : defaultSite));

        directToolCall = {
          function: {
            name: 'get_work_order_site_summary',
            arguments: {
              ...(statusValue && { status: statusValue }),
              siteid: summaryTargetSite
            }
          }
        };
      } else {
        // Query individual work order records with markdown table representation
        directToolCall = {
          function: {
            name: 'get_maximo_work_orders',
            arguments: {
              siteid: siteMatch ? siteMatch[1].toUpperCase() : defaultSite,
              ...(locMatch && { location: locMatch[1].toUpperCase() }),
              ...(statusValue && { status: statusValue }),
              all_sites: isAllSites,
              limit: 15
            }
          }
        };
      }
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
    // 13a. Service Requests List (My Tickets, SR list, requests for site & period)
    else if (/\b(my\s*tickets?|service\s*requests?|list\s*tickets?|client\s*requests?|show\s*sr\b|البلاغات|طلبات\s*الخدمة|تذاكري)\b/i.test(userQuery) && !/\b(how many|count of|number of|كم عدد)\b/i.test(userQuery)) {
      const siteMatch = lastUserMessage.match(/\b(?:for|in|site(?:id)?)\s+([A-Z0-9_\-]+)\b/i);
      const targetSite = siteMatch ? siteMatch[1].toUpperCase() : (mentionedSite || defaultSite);

      let period = 'all';
      if (/\b(7\s*days?|week|اسبوع)\b/i.test(userQuery)) period = '7d';
      else if (/\b(30\s*days?|month|شهر)\b/i.test(userQuery)) period = '30d';
      else if (/\b(90\s*days?|quarter|last\s*3\s*months?|الربع\s*الاخير|٣\s*شهور)\b/i.test(userQuery)) period = '90d';
      else if (/\b(year|365\s*days?|السنة|العام)\b/i.test(userQuery)) period = '365d';

      directToolCall = {
        function: {
          name: 'get_service_requests',
          arguments: {
            siteid: targetSite,
            period,
            limit: 15
          }
        }
      };
    }
    // 13b. Single-Site KPI Scorecard (CM Ratio, PM Compliance, Backlog, MTTR, MTBF for a specific site and period)
    else if (/\b(cm ratio|pm compliance|site kpis?|reliability scorecard|kpis for site|mtbf and mttr|backlog for site|مؤشرات الموقع|نسبة الصيانة التصحيحية)\b/i.test(userQuery) && (mentionedSite || /\b(site|in|for)\s+([A-Z0-9_\-]+)\b/i.test(lastUserMessage)) && !/\b(compare all|all sites|across all|league)\b/i.test(userQuery)) {
      const siteMatch = lastUserMessage.match(/\b(?:for|in|site(?:id)?)\s+([A-Z0-9_\-]+)\b/i);
      const targetSite = siteMatch ? siteMatch[1].toUpperCase() : (mentionedSite || defaultSite);

      let period = '30d';
      if (/\b(7\s*days?|week|اسبوع)\b/i.test(userQuery)) {
        period = '7d';
      } else if (/\b(90\s*days?|quarter|last\s*3\s*months?|الربع\s*الاخير|٣\s*شهور)\b/i.test(userQuery)) {
        period = '90d';
      } else if (/\b(180\s*days?|6\s*months?|نصف\s*سنة|٦\s*شهور)\b/i.test(userQuery)) {
        period = '180d';
      } else if (/\b(year|365\s*days?|ytd|past\s*year|last\s*12\s*months?|السنة|العام)\b/i.test(userQuery)) {
        period = '365d';
      } else if (/\b(all\s*time|historical|ever|كل\s*الوقت|تاريخيا)\b/i.test(userQuery)) {
        period = 'all';
      }

      directToolCall = {
        function: {
          name: 'get_site_kpi_scorecard',
          arguments: {
            siteid: targetSite,
            period
          }
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
      else if (/(معلقة|مفتوحة|في\s*الانتظار|تحت\s*الاعتماد|wappr)/i.test(userQuery)) statusValue = 'WAPPR';
      else if (/(معتمدة|موافقة|appr)/i.test(userQuery)) statusValue = 'APPR';
      else if (/(منتهية|مغلقة|مكتملة|comp)/i.test(userQuery)) statusValue = 'COMP';

      const isAllSites = /(كل\s*المواقع|جميع\s*المواقع|بين\s*المواقع)/i.test(userQuery);
      const isSummary = /(ملخص|جدول|احصائية|إحصائية|كم\s*عدد|كام\s*عدد)/i.test(userQuery);

      if (isAllSites || isSummary) {
        directToolCall = {
          function: {
            name: 'get_work_order_site_summary',
            arguments: {
              ...(statusValue && { status: statusValue }),
              siteid: isAllSites ? 'ALL' : defaultSite
            }
          }
        };
      } else {
        directToolCall = {
          function: {
            name: 'get_maximo_work_orders',
            arguments: {
              siteid: defaultSite,
              ...(statusValue && { status: statusValue }),
              all_sites: isAllSites,
              limit: 15
            }
          }
        };
      }
    }
    else if (/(كم\s*عدد\s*الاصول|عدد\s*الأصول|كم\s*أصل|كام\s*اصل)/i.test(userQuery)) {
      const siteForCount = mentionedSite || defaultSite;
      directToolCall = {
        function: {
          name: 'get_asset_count',
          arguments: { siteid: siteForCount }
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
    // 24. Document / Knowledge Base / RAG Search Intent
    else if (/\b(rag|manual|manuals|sop|sops|policy|policies|pdf|document|documents|book|books|chapter|chapters|case\s*stud(y|ies)|study|studies|author|author(s)?|guide|handbook|standard|standards)\b/i.test(userQuery) ||
             /(كتاب|كتب|دراسة\s*حالة|دراسات\s*حالة|دراسات|فصل|فصول|كراسة|ملف|مستند|وثيقة|كتالوج|دليل|مرفق|مرفقات|في\s*الملف|من\s*الملف|في\s*الكتاب|من\s*الكتاب|بناء\s*على\s*ملف|بناءً\s*على\s*ملف|الملف\s*المرفق|المستند\s*المرفق|كراسة\s*الشروط|كراسه|ابحث\s*في\s*المستندات|ابحث\s*في\s*الملفات|ابحث\s*في\s*الكتاب|طبقا\s*للملف|حسب\s*الملف)/i.test(userQuery)) {
      directToolCall = {
        function: {
          name: 'search_knowledge_base',
          arguments: {
            query: lastUserMessage,
            conversationId: conversationId || undefined
          }
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
          tools: getActiveToolsSchema(),
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
                } else if (upper === 'BEDFORD') {
                  inferredArgs.siteid = upper;
                } else if (upper.startsWith('ASSET') || upper.includes('STATUS') || upper.includes('PUMP') || upper.includes('COMP') || /^[A-Z0-9_\-]+$/.test(part)) {
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
                inferredArgs.siteid = memoryService.getSession(sessionId)?.workingContext?.activeSite || getDefaultSite();
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
              inferredArgs.siteid = memoryService.getSession(sessionId)?.workingContext?.activeSite || getDefaultSite();
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

          // Inject conversationId if tool is search_knowledge_base and not already provided
          if (toolName === 'search_knowledge_base' && !toolArgs.conversationId && conversationId) {
            toolArgs.conversationId = conversationId;
          }

          const toolResult = await executeTool(toolName, toolArgs, { 
            conversationId, 
            siteid: targetSite, 
            username, 
            role: req.user?.role || 'user',
            allowedSites 
          });
          executedToolsLog.push({ tool: toolName, arguments: toolArgs, result: toolResult });
          
          let toolContent = JSON.stringify(toolResult);
          if (toolName === 'search_knowledge_base' && toolResult?.results) {
            const excerpts = toolResult.results.map((r, i) => `[Document: ${r.docName}${r.isChatSpecific ? ' (Attached in this chat)' : ''}]:\n${r.content}`).join('\n\n---\n\n');
            toolContent = `DOCUMENT CONTEXT / سياق المستندات والكتب المرفقة:\n${excerpts}\n\nINSTRUCTIONS: Answer the user's request thoroughly using the facts, case studies, sections, and details extracted from the document excerpts above. Respond in the same language as the user (English if the user asked in English, Arabic if in Arabic).`;
          } else if (toolName === 'get_maximo_work_orders' && Array.isArray(toolResult)) {
            toolContent = `TOOL_RESULT: Returned ${toolResult.length} work orders. Format ALL columns in your markdown table: WONUM, Description, Status, Asset, Location, Site, Report Date.\n` + JSON.stringify(toolResult);
          }
          conversation.push({ role: 'tool', content: toolContent });
        }
      }

      // Send final prompt with tool results back to Ollama for the final natural language answer
      let reply = '';
      
      // Check if we executed get_maximo_work_orders, get_unplanned_work_orders, get_machine_card, or summaries:
      // Generate clean, high-precision deterministic markdown table with ALL columns
      const ppmForecastLog = executedToolsLog.find(t => t.tool === 'get_ppm_forecast' && t.result?.cardType === 'PPM_FORECAST_SCHEDULE');
      const machineCardLog = executedToolsLog.find(t => t.tool === 'get_machine_card' && t.result?.cardType === 'MACHINE_PASSPORT_CARD');
      const woToolLog = executedToolsLog.find(t => (t.tool === 'get_maximo_work_orders' || t.tool === 'get_unplanned_work_orders') && Array.isArray(t.result));
      const woSummaryLog = executedToolsLog.find(t => t.tool === 'get_work_order_site_summary' && t.result?.summaryBySite);
      const unplannedSummaryLog = executedToolsLog.find(t => t.tool === 'get_unplanned_work_orders_summary' && t.result?.summaryBySite);
      const oslcQueryLog = executedToolsLog.find(t => t.tool === 'build_maximo_oslc_query' && t.result?.endpoint);
      const federatedAssetLog = executedToolsLog.find(t => t.tool === "get_federated_asset_count" && t.result?.federated);
      const assetCountLog = executedToolsLog.find(t => t.tool === 'get_asset_count' && t.result?.totalAssets !== undefined);
      const portfolioSummaryLog = executedToolsLog.find(t => t.tool === 'get_federated_portfolio_summary' && t.result?.federated);
      const reliabilityLeagueLog = executedToolsLog.find(t => t.tool === 'get_multi_site_reliability_league' && t.result?.leagueRankings);
      const siteKpiScorecardLog = executedToolsLog.find(t => t.tool === 'get_site_kpi_scorecard' && t.result?.cardType === 'SITE_KPI_SCORECARD');
      const serviceRequestListLog = executedToolsLog.find(t => t.tool === 'get_service_requests' && t.result?.cardType === 'SERVICE_REQUEST_LIST');

      if (federatedAssetLog) {
        const data = federatedAssetLog.result;
        const grandTotal = Number(data.grandTotalAssets).toLocaleString();
        let md = "### 🌐 Federated Asset Inventory Across Maximo Server Instances\n\n";
        md += "> **Scope:** `" + data.scope + "` | **Status Filter:** `" + data.statusFilter + "` | **Grand Total Assets:** **" + grandTotal + "**\n\n";
        md += "| Server Instance | Server Name | Status | Total Assets (All Sites) | Maximo Base URL |\n";
        md += "| :--- | :--- | :--- | :--- | :--- |\n";
        (data.breakdownByServer || []).forEach(inst => {
          md += "| **" + inst.instanceId + "** | " + inst.serverName + " | `" + inst.status + "` | **" + Number(inst.assetCount).toLocaleString() + "** | `" + inst.baseUrl + "` |\n";
        });
        md += "\n*The **" + grandTotal + "** assets represent the verified total across all facility sites configured on connected Maximo production servers.*\n";
        reply = md;
      } else if (oslcQueryLog) {
        const q = oslcQueryLog.result;
        let md = `### 🔗 IBM Maximo OSLC REST API Query Builder\n\n`;
        md += `> **Target Object Structure:** \`${q.objectStructure}\` | **Protocol:** \`REST / OSLC (JSON)\`\n\n`;
        md += `#### 1. Relative Endpoint & Query Parameters\n`;
        md += `\`\`\`http\nGET ${q.endpoint}\n\`\`\`\n\n`;
        md += `#### 2. Required Request Headers\n`;
        md += `\`\`\`json\n${JSON.stringify(q.headers, null, 2)}\n\`\`\`\n\n`;
        md += `#### 3. Ready-to-Execute cURL Command\n`;
        md += `\`\`\`bash\n${q.sampleCurl}\n\`\`\`\n\n`;
        md += `*This query is formatted for IBM Maximo OSLC REST APIs with lean=1 payload optimization.*\n`;
        reply = md;
      } else if (assetCountLog) {
        const data = assetCountLog.result;
        const formattedTotal = Number(data.totalAssets).toLocaleString();
        reply = `### 🏷️ Total Asset Inventory — Site \`${data.site}\`\n\n` +
          `> **Site ID:** **${data.site}** | **Status:** \`${data.status || 'ALL'}\` | **Total Registered Assets:** **${formattedTotal}**\n\n` +
          `There are currently **${formattedTotal}** registered assets in site **${data.site}** within your Maximo system.\n`;
      } else if (portfolioSummaryLog) {
        const data = portfolioSummaryLog.result;
        let md = `### 🏢 Federated Enterprise Portfolio Summary Across Maximo Instances\n\n`;
        md += `> **Evaluated Servers:** **${data.serversEvaluated}** | **Enterprise Assets:** **${data.grandTotalAssets.toLocaleString()}** | **Active Backlog:** **${data.grandTotalBacklog.toLocaleString()}** | **Total Work Orders:** **${data.grandTotalWorkOrders.toLocaleString()}**\n\n`;
        md += `| Server / Instance ID | Server Name | Status | Total Assets (All 20 Sites) | Active Backlog | Total Work Orders | Endpoint |\n`;
        md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        (data.serverInstances || []).forEach(inst => {
          md += '| **' + inst.instanceId + '** | ' + inst.serverName + ' | `' + inst.status + '` | **' + inst.totalAssets.toLocaleString() + '** | ' + inst.activeBacklog.toLocaleString() + ' | ' + inst.totalWorkOrders.toLocaleString() + ' | `' + inst.baseUrl + '` |\n';
        });
        md += `\n> ℹ️ **Asset Count Verification:** The **${data.grandTotalAssets.toLocaleString()}** assets represent the consolidated total across **all 20 operating facility sites** in your Maximo database (including Regal Heights, Mansoura, North Square, Alshaya, Hurghada, Sharm, and others), not just the active test site (${data.serverInstances?.[0]?.instanceId || 'ED'}).\n`;
        reply = md;
      } else if (serviceRequestListLog) {
        const srData = serviceRequestListLog.result;
        const reqs = srData.requests || [];
        let srMd = "### 📋 Service Requests & Tickets — Site `" + srData.site + "`\n\n";
        srMd += "> **Period:** **" + srData.periodLabel + "** | **Total Tickets Found:** **" + srData.totalFound + "**\n\n";

        if (reqs.length > 0) {
          srMd += "| Ticket ID | Description | Status | Tracking Stage | Reported By | Asset Tag | Date |\n";
          srMd += "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n";
          reqs.forEach(r => {
            srMd += "| **" + r.ticketid + "** | " + r.description + " | `" + r.status + "` | **" + r.friendlyStatus + "** | " + r.reportedby + " | " + r.assetnum + " | `" + r.reportdate + "` |\n";
          });
          srMd += "\n*Showing recent Service Requests logged in Maximo for site **" + srData.site + "**. Real-time tracking from Maximo Service Desk.*\n";
        } else {
          srMd += "*No Service Requests found for site **" + srData.site + "** within the specified period (" + srData.periodLabel + ").*\n";
        }
        reply = srMd;
      } else if (siteKpiScorecardLog) {
        const sc = siteKpiScorecardLog.result;
        const kp = sc.kpis || {};
        const wb = sc.workBreakdown || {};

        let kpiMd = `### 📊 Site Reliability & Maintenance KPI Scorecard — Site \`${sc.site}\`\n\n`;
        kpiMd += `> **Evaluation Period:** **${sc.periodLabel}** | **Total Work Orders Evaluated:** **${sc.totalOrdersEvaluated.toLocaleString()}** | **Overall Status:** \`${kp.statusRating}\`\n\n`;
        kpiMd += `#### 1. Core Reliability & Maintenance Metrics\n\n`;
        kpiMd += `| KPI Metric | Current Value | World-Class Target | Status / Assessment |\n`;
        kpiMd += `| :--- | :--- | :--- | :--- |\n`;
        kpiMd += `| **CM Ratio (Corrective Maintenance %)** | **${kp.cmRatio}** | \`${kp.cmRatioTarget}\` | ${kp.cmRatioNumeric <= 20 ? '✅ Optimal (Proactive Heavy)' : (kp.cmRatioNumeric <= 35 ? '⚠️ Moderate Reactive Risk' : '🚨 Critical Reactive Heavy')} |\n`;
        kpiMd += `| **PM Compliance (% On-Time)** | **${kp.pmCompliance}** | \`${kp.pmComplianceTarget}\` | ${kp.pmComplianceNumeric >= 90 ? '✅ Compliant (SMRP Pillar 3)' : (kp.pmComplianceNumeric >= 75 ? '⚠️ Backlog Risk' : '🚨 Overdue PPM Warning')} |\n`;
        kpiMd += `| **Active Work Order Backlog** | **${kp.activeBacklog} WOs** | \`${kp.backlogTarget}\` | ${kp.activeBacklog <= 20 ? '✅ Healthy Queue' : (kp.activeBacklog <= 50 ? '⚠️ Workload Attention' : '🚨 Severe Bottleneck')} |\n`;
        kpiMd += `| **Mean Time to Repair (MTTR)** | **${kp.mttrHours}** | \`${kp.mttrTarget}\` | ${kp.mttrNumeric <= 3.5 ? '✅ Rapid Restoration' : '⚠️ Long Repair Cycle'} |\n`;
        kpiMd += `| **Mean Time Between Failures (MTBF)** | **${kp.mtbfHours}** | \`Maximized Uptime\` | ${kp.mtbfNumeric > 500 ? '✅ High Operational Reliability' : '⚠️ Frequent Breakdowns'} |\n`;
        kpiMd += `| **Inherent Equipment Availability** | **${kp.inherentAvailability}** | \`>= 99.0%\` | ${parseFloat(kp.inherentAvailability) >= 99 ? '✅ World Class' : '⚠️ Availability Loss'} |\n\n`;

        kpiMd += "- **Preventive Maintenance (PM / RT):** `" + (wb.preventiveMaintenance_PM || 0) + "` orders\n";
        kpiMd += "- **Corrective & Breakdown (CM / EM):** `" + (wb.correctiveMaintenance_CM || 0) + "` orders\n";
        kpiMd += "- **Waiting Approval (WAPPR):** `" + (wb.waitingApproval_WAPPR || 0) + "` orders\n";
        kpiMd += "- **In Progress (INPRG):** `" + (wb.inProgress_INPRG || 0) + "` orders\n\n";

        if (sc.topBadActors && sc.topBadActors.length > 0) {
          kpiMd += `#### 3. Top Bad Actor Assets (Breakdown Frequency)\n\n`;
          kpiMd += `| Asset Number | Breakdown WOs Recorded in Period | Failure Frequency Rating |\n`;
          kpiMd += `| :--- | :--- | :--- |\n`;
          sc.topBadActors.forEach(ba => {
            kpiMd += `| **${ba.assetnum}** | ${ba.failureCount} | ${ba.failureCount > 3 ? '🚨 Critical Repeat Failure' : '⚠️ Monitored Asset'} |\n`;
          });
          kpiMd += `\n`;
        }

        kpiMd += `*Metrics computed directly against live Maximo database records for site **${sc.site}**.*\n`;
        reply = kpiMd;
      } else if (reliabilityLeagueLog) {
        const data = reliabilityLeagueLog.result;
        let leagueMd = `### 🏆 Multi-Site Reliability League (${data.periodLabel || 'Last 30 Days'})\n\n`;
        leagueMd += `> **Sites Benchmarked:** **${data.sitesEvaluated}** | **CM Ratio Target:** \`${data.industryTargets?.cmRatioTarget || '< 20%'}\` | **PM Compliance Target:** \`${data.industryTargets?.pmComplianceTarget || '>= 90%'}\` | **MTTR Target:** \`${data.industryTargets?.mttrTarget || '< 3.5 hrs'}\`\n\n`;
        leagueMd += `| Rank | Site ID | Site Name | CM Ratio (%) | PM Compliance (%) | Active Backlog | MTTR (hrs) | RT Ratio (%) | Health Rating |\n`;
        leagueMd += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        data.leagueRankings.forEach((r, idx) => {
          leagueMd += `| #${idx + 1} | **${r.siteid}** | ${r.description || r.siteid} | ${r.cmRatio} | ${r.pmCompliance} | **${r.activeBacklog}** | ${r.mttrHours} | ${r.rtRatio} | \`${r.healthRating}\` |\n`;
        });
        leagueMd += `\n*Benchmark generated across all operating Maximo facility sites for ${data.periodLabel || 'the selected period'}.*\n`;
        reply = leagueMd;
      } else if (ppmForecastLog) {
        const data = ppmForecastLog.result;
        let ppmMd = `### 🗓️ Preventive Maintenance (PPM) Forecast Schedule — Site \`${data.site}\`\n\n`;
        ppmMd += `> **Filter Status:** \`${data.statusFilter}\` | **Asset Filter:** \`${data.assetFilter}\` | **Total Scheduled PPM:** **${data.totalPpmFound}** | **Source:** \`${data.usedEndpoint || 'PM Application'}\`\n\n`;

        if (data.records && data.records.length > 0) {
          ppmMd += `| PM Number | Description | Forecast / Next Date | Asset Tag | Location | Frequency | Priority |\n`;
          ppmMd += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
          data.records.forEach(r => {
            ppmMd += `| **${r.pmnum}** | ${r.description} | **\`${r.forecastdate}\`** | ${r.assetnum} | ${r.location} | \`${r.frequency}\` | ${r.priority} |\n`;
          });
          ppmMd += `\n*PPM records are sorted chronologically by estimated forecast date (\`FORECASTDATE / NEXTDATE\`).*\n`;
        } else {
          ppmMd += `*No Preventive Maintenance (PPM) forecast records found matching the specified parameters.*\n`;
        }
        reply = ppmMd;
      } else if (machineCardLog) {
        const mc = machineCardLog.result;
        let cardMd = `<div class="machine-passport-card" data-asset="${mc.assetnum}">\n\n`;
        if (mc.crossSiteResolved && mc.originalRequestedSite) {
          cardMd += `> ℹ️ **Cross-Site Discovery Notice:** Asset **\`${mc.assetnum}\`** was not found in your currently selected site (\`${mc.originalRequestedSite}\`). Eden Copilot automatically located and loaded its complete Passport Card from site **\`${mc.siteid}\`**.\n\n`;
        }
        cardMd += `## 🏷️ Machine Passport Card: ${mc.assetnum} — ${mc.description}\n\n`;
        cardMd += `> **Operational Status:** \`${mc.status}\` | **Site:** \`${mc.siteid}\` | **Location:** \`${mc.location}\` | **Health Rating:** **${mc.reliabilityMetrics.healthStatus}**\n\n`;

        cardMd += `### ⚙️ Technical Specifications & Asset Info\n`;
        cardMd += `| Attribute | Details | Attribute | Details |\n`;
        cardMd += `| :--- | :--- | :--- | :--- |\n`;
        cardMd += `| **Manufacturer** | ${mc.manufacturer} | **Model Number** | ${mc.modelnum} |\n`;
        cardMd += `| **Serial Number** | ${mc.serialnum} | **Vendor** | ${mc.vendor} |\n`;
        cardMd += `| **Installation Date** | ${mc.installdate} | **Asset Priority** | ${mc.priority} |\n`;
        cardMd += `| **Failure Class Code** | ${mc.failurecode} | **Lifecycle State** | ${mc.financials.replacementRecommendation} |\n\n`;

        cardMd += `### 📊 Reliability & Maintenance Performance (Historical)\n`;
        cardMd += `| Metric | Value | Metric | Value |\n`;
        cardMd += `| :--- | :--- | :--- | :--- |\n`;
        cardMd += `| **Total Lifetime Work Orders** | **${mc.reliabilityMetrics.totalWorkOrders}** | **Mean Time to Repair (MTTR)** | **${mc.reliabilityMetrics.mttr}** |\n`;
        cardMd += `| **Corrective Maintenance (CM)** | ${mc.reliabilityMetrics.correctiveMaintenanceCount} | **Preventive Maintenance (PM)** | ${mc.reliabilityMetrics.preventiveMaintenanceCount} |\n`;
        cardMd += `| **Emergency Breakdowns (EM)** | ${mc.reliabilityMetrics.emergencyBreakdownCount} | **Active Backlog Orders** | ${mc.reliabilityMetrics.activeBacklogOrders} |\n`;
        cardMd += `| **Purchase Cost** | ${mc.financials.purchasePrice} | **Total Maintenance Spend** | **${mc.financials.totalMaintenanceCost}** |\n`;
        cardMd += `| **Repair-to-Replacement Ratio** | **${mc.financials.repairVsReplacementRatio || 'N/A'}** | **Total Labor Invested** | ${mc.reliabilityMetrics.totalRecordedLaborHours} |\n\n`;

        cardMd += `### 📜 Historical Work Orders Log (All-Time Lifecycle Records — ${mc.workOrderHistory?.length || 0} Orders)\n`;
        if (mc.workOrderHistory && mc.workOrderHistory.length > 0) {
          cardMd += `| WONUM | Description | Type | Status | Labor Hours | Report Date |\n`;
          cardMd += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
          mc.workOrderHistory.forEach(h => {
            cardMd += `| **${h.wonum}** | ${h.description} | \`${h.worktype}\` | \`${h.status}\` | ${h.laborHours} | ${h.reportdate} |\n`;
          });
        } else {
          cardMd += `*No previous work order history logged for this asset.*\n`;
        }
        cardMd += `\n</div>\n`;
        reply = cardMd;
      } else if (unplannedSummaryLog) {
        const data = unplannedSummaryLog.result;
        let tableMd = `### 🚨 Unplanned Corrective & Emergency Work Orders (CM & EM) by Site (${data.period || 'All Time'})\n\n`;
        tableMd += `| Site ID | Site Name | Work Type | Pending / Active | Closed / Done | Total Unplanned |\n`;
        tableMd += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        data.summaryBySite.forEach(s => {
          tableMd += `| **${s.siteid}** | ${s.siteName} | \`${s.workType}\` | **${s.pendingCount ?? 0}** | **${s.closedCount ?? 0}** | **${s.unplannedCount}** |\n`;
        });
        tableMd += `\n**Overall Totals (${data.period || 'All Time'}):** **${data.totalUnplannedWorkOrders}** Unplanned Work Orders (**${data.totalPendingWorkOrders ?? 0}** Pending / Active, **${data.totalClosedWorkOrders ?? 0}** Closed) across ${data.sitesCount} sites.\n`;
        reply = tableMd;
      } else if (woSummaryLog) {
        const data = woSummaryLog.result;
        let tableMd = `### 📋 Work Orders Summary by Site (${data.filterStatus || 'ALL'})\n\n`;
        tableMd += `| Site ID | Site Name | Status | Work Order Count |\n`;
        tableMd += `| :--- | :--- | :--- | :--- |\n`;
        data.summaryBySite.forEach(s => {
          tableMd += `| **${s.siteid}** | ${s.siteName} | \`${s.statusFilter}\` | **${s.workOrderCount}** |\n`;
        });
        tableMd += `\n**Total Work Orders (${data.filterStatus}):** ${data.totalWorkOrders} across ${data.sitesCount} sites.\n`;
        reply = tableMd;
      } else if (woToolLog && woToolLog.result.length > 0) {
        const rows = woToolLog.result;
        const isUnplanned = woToolLog.tool === 'get_unplanned_work_orders';
        const queriedStatus = woToolLog.arguments?.status;
        const statusLabel = queriedStatus ? ` (${queriedStatus})` : '';
        let tableMd = `Here is the list of ${isUnplanned ? '🚨 **Unplanned (CM/EM) Work Orders**' : '**Work Orders**'}${statusLabel}:\n\n`;
        tableMd += `| WONUM | Description | Type | Status | Asset | Location | Site | Report Date |\n`;
        tableMd += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        rows.forEach(r => {
          const dateStr = r.reportdate ? (r.reportdate.includes('T') ? r.reportdate.split('T')[0] : r.reportdate) : 'N/A';
          tableMd += `| **${r.wonum}** | ${r.description || 'N/A'} | \`${r.worktype || (isUnplanned ? 'CM' : 'WORK')}\` | \`${r.status || 'N/A'}\` | ${r.assetnum || 'N/A'} | ${r.location || 'N/A'} | ${r.siteid || 'N/A'} | ${dateStr} |\n`;
        });
        tableMd += `\n*Total Records Displayed: ${rows.length} ${isUnplanned ? 'Unplanned ' : ''}Work Orders.*\n`;
        reply = tableMd;
      } else if (executedToolsLog.length > 0) {
        // Tools were executed, synthesize their results with final LLM turn
        const finalResponse = await ollama.chat({
          model,
          messages: conversation,
          keep_alive: -1,
          options: ollamaOptions
        });
        reply = finalResponse.message?.content || 'Done.';
      } else {
        // No tools needed: use the model's direct conversational answer immediately
        reply = response.message?.content || 'Done.';
      }
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
