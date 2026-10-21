import { maximoService, setActiveInstance } from '../services/maximo.js';
import { executeTool, MUTATING_TOOLS } from '../services/tools.js';
import { memoryService } from '../services/memory.js';
import { redisStore } from '../services/redisStore.js';

export const maximoController = {
  // Get Sites, Assets, and Locations context
  async getContext(req, res) {
    try {
      const allowedSites = req.user?.allowedSites || ['*'];
      const isUniversal = allowedSites.includes('*') || allowedSites.includes('ALL');

      // Determine requested active server instance
      const activeInstance = (req.query.instance || process.env.MAXIMO_DEFAULT_INSTANCE || 'ED').toUpperCase();
      setActiveInstance(activeInstance);

      let rawSites = await maximoService.getSites(activeInstance);
      let allSites = Array.isArray(rawSites) ? rawSites : [{ siteid: 'CAC', description: 'CAC' }];

      // Filter sites to only authorized sites for this user
      let accessibleSites = isUniversal
        ? allSites
        : allSites.filter(s => {
            const sid = (typeof s === 'string' ? s : s.siteid || '').toUpperCase();
            return allowedSites.map(a => a.toUpperCase()).includes(sid);
          });

      // If user has restricted sites but none matched, default to their first allowed site
      if (accessibleSites.length === 0 && !isUniversal) {
        accessibleSites = allowedSites.map(s => ({ siteid: s.toUpperCase(), description: `Site ${s.toUpperCase()}` }));
      }

      // Determine requested site and verify authorization
      let requestedSite = (req.query.siteid || '').toUpperCase();
      let activeSite;

      if (isUniversal) {
        activeSite = requestedSite || accessibleSites[0]?.siteid || 'CAC';
      } else {
        // Enforce that user cannot request a site outside their authorized list
        const isAllowed = accessibleSites.some(s => (s.siteid || s).toUpperCase() === requestedSite);
        activeSite = isAllowed ? requestedSite : accessibleSites[0]?.siteid || 'CAC';
      }

      // Update memory with active site
      const sessionId = req.query.sessionId || 'default-session';
      memoryService.updateWorkingContext(sessionId, { activeSite, allowedSites });

      const fetchLimit = parseInt(req.query.limit, 10) || 500;
      const [assets, locations, assetStatusBreakdown, locationStatusBreakdown] = await Promise.all([
        maximoService.getAssets({ siteid: activeSite, limit: fetchLimit }).catch(() => ({ assets: [] })),
        maximoService.getLocations({ siteid: activeSite, limit: fetchLimit }).catch(() => []),
        maximoService.getAssetStatusBreakdown({ siteid: activeSite }).catch(() => ({ total: 0 })),
        maximoService.getLocationStatusBreakdown({ siteid: activeSite }).catch(() => ({ total: 0 }))
      ]);

      // Determine instances list (ED and GEM active; MD reserved for later)
      const instances = [
        { id: 'ED', name: 'Eden ED (Operations)' },
        { id: 'GEM', name: 'Eden GEM' }
        // , { id: 'MD', name: 'Eden MD' }
      ];

      return res.json({
        activeSite,
        activeInstance,
        instances,
        sites: accessibleSites,
        allowedSites,
        assets: assets.assets || [],
        locations: Array.isArray(locations) ? locations : [],
        assetStatusBreakdown,
        locationStatusBreakdown
      });
    } catch (err) {
      console.error('[getContext] Error:', err);
      return res.status(200).json({
        activeSite: 'CAC',
        activeInstance: 'ED',
        instances: [{ id: 'ED', name: 'Eden ED (Operations)' }, { id: 'GEM', name: 'Eden GEM' }],
        sites: [{ siteid: 'CAC', description: 'City of Arts and Culture (CAC)', active: true }],
        allowedSites: ['*'],
        assets: [],
        locations: []
      });
    }
  },

  // Approve or Reject an intercepted HITL tool action
  async approveAction(req, res, ollama, model, toolsSchema) {
    const { actionId, approved, updatedArgs, conversation = [] } = req.body;
    const pending = await redisStore.getApproval(actionId);

    if (!pending) {
      return res.status(404).json({ error: 'Action approval request expired or not found.' });
    }

    await redisStore.deleteApproval(actionId);

    if (!approved) {
      return res.json({
        status: 'rejected',
        reply: `Action **${pending.toolName}** was **cancelled** by the user.`
      });
    }

    // Merge any user modifications made in the approval card (e.g. customized description)
    const effectiveArgs = (updatedArgs && typeof updatedArgs === 'object')
      ? { ...pending.toolArgs, ...updatedArgs }
      : pending.toolArgs;

    try {
      const toolResult = await executeTool(pending.toolName, effectiveArgs, {
        role: req.user?.role || 'user',
        allowedSites: req.user?.allowedSites || ['*'],
        username: req.user?.username || 'admin'
      });
      
      const updatedConversation = [
        ...conversation,
        {
          role: 'assistant',
          tool_calls: [{
            function: { name: pending.toolName, arguments: effectiveArgs }
          }]
        },
        {
          role: 'tool',
          content: JSON.stringify(toolResult)
        }
      ];

      let replyText = '';
      if (pending.toolName === 'create_maximo_work_order' && toolResult?.success) {
        replyText = `### ✅ Work Order Successfully Created in IBM Maximo\n\n` +
          `- **Work Order Number:** **\`${toolResult.wonum}\`**\n` +
          `- **Description:** ${toolResult.description}\n` +
          `- **Status:** \`${toolResult.status || 'WAPPR'}\`\n` +
          `- **Site:** \`${toolResult.siteid}\`\n` +
          `- **Asset:** \`${effectiveArgs.assetnum || 'N/A'}\`\n` +
          `- **Department:** \`${effectiveArgs.department || 'MECH'}\`\n` +
          `- **Work Type:** \`${effectiveArgs.worktype || 'CM'}\`\n`;
      } else if (pending.toolName === 'create_maximo_sr' && toolResult?.success) {
        replyText = `### ✅ Service Request Ticket Successfully Logged\n\n` +
          `- **Ticket ID:** **\`${toolResult.ticketid}\`**\n` +
          `- **Description:** ${toolResult.description}\n` +
          `- **Status:** \`${toolResult.status || 'NEW'}\`\n` +
          `- **Site:** \`${toolResult.siteid}\`\n`;
      } else if (toolResult?.error) {
        replyText = `❌ **Maximo Execution Failed:** ${toolResult.error}`;
      } else {
        const modelResponse = await ollama.chat({
          model,
          messages: updatedConversation,
          tools: toolsSchema
        });
        replyText = modelResponse.message?.content || 'Action executed successfully in Maximo.';
      }

      return res.json({
        status: toolResult?.error ? 'error' : 'completed',
        toolResult,
        reply: replyText
      });
    } catch (err) {
      console.error('Approved action execution error:', err);
      return res.status(500).json({ error: 'Failed to execute approved action', details: err.message });
    }
  }
};
