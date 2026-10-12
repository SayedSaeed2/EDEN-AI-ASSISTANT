import { maximoService } from '../services/maximo.js';
import { executeTool, MUTATING_TOOLS } from '../services/tools.js';
import { memoryService } from '../services/memory.js';
import { redisStore } from '../services/redisStore.js';

export const maximoController = {
  // Get Sites, Assets, and Locations context
  async getContext(req, res) {
    try {
      const allowedSites = req.user?.allowedSites || ['*'];
      const isUniversal = allowedSites.includes('*') || allowedSites.includes('ALL');

      let rawSites = await maximoService.getSites();
      let allSites = Array.isArray(rawSites) ? rawSites : [{ siteid: 'TEST', description: 'TEST' }];

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
        activeSite = requestedSite || process.env.MAXIMO_DEFAULT_SITE || accessibleSites[0]?.siteid || 'TEST';
      } else {
        // Enforce that user cannot request a site outside their authorized list
        const isAllowed = accessibleSites.some(s => (s.siteid || s).toUpperCase() === requestedSite);
        activeSite = isAllowed ? requestedSite : accessibleSites[0]?.siteid || 'TEST';
      }

      // Update memory with active site
      const sessionId = req.query.sessionId || 'default-session';
      memoryService.updateWorkingContext(sessionId, { activeSite, allowedSites });

      const [assets, locations] = await Promise.all([
        maximoService.getAssets({ siteid: activeSite, limit: 50 }),
        maximoService.getLocations({ siteid: activeSite, limit: 50 })
      ]);

      return res.json({
        activeSite,
        sites: accessibleSites,
        allowedSites,
        assets: assets.assets || [],
        locations: Array.isArray(locations) ? locations : []
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch Maximo context', details: err.message });
    }
  },

  // Approve or Reject an intercepted HITL tool action
  async approveAction(req, res, ollama, model, toolsSchema) {
    const { actionId, approved, conversation = [] } = req.body;
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

    try {
      const toolResult = await executeTool(pending.toolName, pending.toolArgs);
      
      const updatedConversation = [
        ...conversation,
        {
          role: 'assistant',
          tool_calls: [{
            function: { name: pending.toolName, arguments: pending.toolArgs }
          }]
        },
        {
          role: 'tool',
          content: JSON.stringify(toolResult)
        }
      ];

      const modelResponse = await ollama.chat({
        model,
        messages: updatedConversation,
        tools: toolsSchema
      });

      return res.json({
        status: 'completed',
        toolResult,
        reply: modelResponse.message.content || 'Action executed successfully in Maximo.'
      });
    } catch (err) {
      console.error('Approved action execution error:', err);
      return res.status(500).json({ error: 'Failed to execute approved action', details: err.message });
    }
  }
};
