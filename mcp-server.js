#!/usr/bin/env node
/**
 * IBM Maximo Enterprise EAM — Model Context Protocol (MCP) Server
 * 
 * Provides standard Model Context Protocol (MCP) integration over Stdio Transport.
 * Compatible with Claude Desktop, Claude Code, Cursor, Antigravity, VS Code Copilot,
 * and any other MCP-compliant client.
 * 
 * Exposes:
 *  - 56 EAM Tools: Work Orders, Assets, PM, Service Requests, KPIs, FMEA, ISO 55000, Multi-Site League
 *  - MCP Resources: maximo://sites, maximo://system-info
 *  - MCP Prompts: rca_investigation, site_kpi_audit, fmea_workshop
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { toolsSchema, executeTool } from './services/tools.js';
import { maximoService } from './services/maximo.js';

const server = new Server(
  {
    name: 'ibm-maximo-eam-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  }
);

// ==============================================================================
// 1. MCP TOOLS: EXPOSE ALL 56 ENTERPRISE MAXIMO TOOLS
// ==============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const mcpTools = toolsSchema.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters || { type: 'object', properties: {} }
  }));

  return { tools: mcpTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await executeTool(name, args || {}, { role: 'admin', allowedSites: ['*'] });

    if (result && result.error) {
      return {
        content: [
          {
            type: 'text',
            text: `[Maximo Error] ${result.error}`
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `[Internal Exception] Failed to execute tool '${name}': ${err.message}`
        }
      ],
      isError: true
    };
  }
});

// ==============================================================================
// 2. MCP RESOURCES: LIVE SITES & SYSTEM TELEMETRY
// ==============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'maximo://sites',
        name: 'Maximo Operating Facility Sites',
        description: 'Complete list of active facility sites and plant locations configured in Maximo.',
        mimeType: 'application/json'
      },
      {
        uri: 'maximo://system-info',
        name: 'Maximo Connection & Telemetry',
        description: 'Connected Maximo server instance URL, default site context, and API status.',
        mimeType: 'application/json'
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'maximo://sites') {
    try {
      const sites = await maximoService.getSites();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(sites, null, 2)
          }
        ]
      };
    } catch (e) {
      throw new McpError(ErrorCode.InternalError, `Failed to read sites: ${e.message}`);
    }
  }

  if (uri === 'maximo://system-info') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            serverName: process.env.MAXIMO_ED_NAME || 'Eden Test (172.16.128.18)',
            baseUrl: process.env.MAXIMO_BASE_URL || 'http://172.16.128.18:9070/maximo',
            defaultSite: process.env.MAXIMO_DEFAULT_SITE || 'TEST',
            activeInstance: process.env.MAXIMO_DEFAULT_INSTANCE || 'ED',
            totalRegisteredTools: toolsSchema.length,
            mcpVersion: '1.0.0'
          }, null, 2)
        }
      ]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
});

// ==============================================================================
// 3. MCP PROMPTS: STANDARD EAM AUDIT & RELIABILITY TEMPLATES
// ==============================================================================

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'site_kpi_audit',
        description: 'Executes a comprehensive ISO 55001 & SMRP maintenance KPI audit (CM Ratio, PM Compliance, Backlog, MTTR, MTBF) for a site.',
        arguments: [
          {
            name: 'siteid',
            description: 'Site code (e.g. REGALH-G1, TEST, CRYSTAL)',
            required: true
          },
          {
            name: 'period',
            description: 'Observation period (30d, 90d, 365d, all)',
            required: false
          }
        ]
      },
      {
        name: 'rca_investigation',
        description: 'Guides a Root Cause Analysis (5-Whys) on a problematic asset with failure hierarchy validation.',
        arguments: [
          {
            name: 'wonum',
            description: 'Maximo Work Order Number',
            required: true
          }
        ]
      }
    ]
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === 'site_kpi_audit') {
    const site = args.siteid || 'REGALH-G1';
    const period = args.period || '30d';

    return {
      description: `Run full site reliability audit for ${site} (${period})`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please run a comprehensive Site Reliability & Maintenance KPI audit for site "${site}" over observation period "${period}". Call "get_site_kpi_scorecard" with siteid="${site}" and period="${period}". Analyze CM Ratio against the <20% benchmark, PM Compliance against >=90%, evaluate active backlog, MTTR, MTBF, inherent availability, and identify top bad actor assets.`
          }
        }
      ]
    };
  }

  if (name === 'rca_investigation') {
    const wonum = args.wonum;
    return {
      description: `Conduct Root Cause Analysis for Work Order ${wonum}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Conduct an in-depth Root Cause Analysis (RCA) for work order "${wonum}". Inspect actual failure problem, cause, and remedy codes, calculate MTTR and historical breakdown frequency for the parent asset, and propose preventive job plan improvements.`
          }
        }
      ]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
});

// ==============================================================================
// 4. SERVER LAUNCH VIA STDIO TRANSPORT
// ==============================================================================

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[IBM Maximo MCP Server] Running and listening on stdio transport.');
}

run().catch((err) => {
  console.error('[IBM Maximo MCP Server] Fatal startup error:', err);
  process.exit(1);
});
