import { maximoService } from '../services/maximo.js';
import { executeTool, MUTATING_TOOLS } from '../services/tools.js';
import { memoryService } from '../services/memory.js';
import { redisStore } from '../services/redisStore.js';

export const maximoController = {
  // Get Sites, Assets, and Locations context
  async getContext(req, res) {
    try {
      const site = req.query.siteid || process.env.MAXIMO_DEFAULT_SITE || 'TEST';
      
      // Update memory with newly switched active site
      const sessionId = req.query.sessionId || 'default-session';
      memoryService.updateWorkingContext(sessionId, { activeSite: site });

      const [sites, assets, locations] = await Promise.all([
        maximoService.getSites(),
        maximoService.getAssets({ siteid: site, limit: 50 }),
        maximoService.getLocations({ siteid: site, limit: 50 })
      ]);
      return res.json({
        activeSite: site,
        sites: Array.isArray(sites) ? sites : [site],
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
