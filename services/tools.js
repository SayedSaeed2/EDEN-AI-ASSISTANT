import { maximoService } from './maximo.js';
import { searchTavily } from './tavily.js';

// The Tool Registry ties the AI schema directly to the JS execution function
const toolRegistry = [
  // --- WORK ORDERS ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_maximo_work_orders',
        description: 'Query list of work orders from IBM Maximo based on status, location, and site.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Work Order status: WAPPR, APPR, INPRG, COMP, CLOSE.' },
            location: { type: 'string', description: 'Maximo location tag/code (e.g. TEST, BLDG-A, SUB-01).' },
            siteid: { type: 'string', description: 'Maximo Site ID (defaults to system site).' },
            limit: { type: 'number', description: 'Maximum records to return (default 5).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getWorkOrders(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_work_order_count',
        description: 'Get the exact total count/number of work orders matching an optional status or site.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Target status filter (e.g. WAPPR) or blank for all.' },
            siteid: { type: 'string', description: 'Site ID.' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getWorkOrderCount(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'create_maximo_work_order',
        description: 'Create a new Work Order in IBM Maximo. Work type (defaults to CM) and department (e.g. MECH, ELEC, CIVIL) can be inferred automatically.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Summary/description of the maintenance work (maps to DESCRIPTION field).' },
            worktype: { 
              type: 'string', 
              enum: ['RT', 'CM', 'EM', 'PRJ'], 
              description: 'Work order type: RT (Routine), CM (Corrective), EM (Emergency), or PRJ (Project). Defaults to CM.' 
            },
            department: { 
              type: 'string', 
              enum: ['CIVIL', 'ELEC', 'ELEC-LC', 'HK', 'LS', 'MECH'],
              description: 'Executing department (maps to EXEDEPT field). Inferred or defaults to MECH.' 
            },
            assetnum: { type: 'string', description: 'Asset tag number (optional).' },
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            jpnum: { type: 'string', description: 'Job Plan number (optional).' },
            failurecode: { type: 'string', description: 'Failure code (optional).' }
          },
          required: ['description']
        }
      }
    },
    execute: async (args) => await maximoService.createWorkOrder(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'update_maximo_work_order_status',
        description: 'Update the status of an existing work order.',
        parameters: {
          type: 'object',
          properties: {
            wonum: { type: 'string', description: 'The Work Order number.' },
            newStatus: { type: 'string', description: 'Target status: APPR, INPRG, COMP, or CAN.' }
          },
          required: ['wonum', 'newStatus']
        }
      }
    },
    execute: async (args) => await maximoService.updateWorkOrderStatus(args)
  },

  // --- SERVICE REQUESTS ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_service_request_count',
        description: 'Get total count of Service Requests (SRs), optionally filtered by status.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Status filter (e.g. NEW, QUEUED) or blank for total.' },
            siteid: { type: 'string', description: 'Site ID.' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getServiceRequestCount(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'create_service_request',
        description: 'Submit/log a new Service Request (SR ticket). Work type (defaults to CM) and department (defaults to MECH/ELEC/CIVIL) are inferred automatically.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Short summary/issue description (maps to DESCRIPTION field).' },
            details: { type: 'string', description: 'Extended details or description (maps to DESCRIPTION_LONGDESCRIPTION).' },
            worktype: { 
              type: 'string', 
              enum: ['RT', 'CM', 'EM', 'PRJ'], 
              description: 'Service Request work type: RT (Routine), CM (Corrective), EM (Emergency), or PRJ (Project). Defaults to CM.' 
            },
            department: { 
              type: 'string', 
              enum: ['CIVIL', 'ELEC', 'ELEC-LC', 'HK', 'LS', 'MECH'],
              description: 'Executing department (maps to EXEDEPT field). Defaults to MECH if unassigned.' 
            },
            assetnum: { type: 'string', description: 'Related asset number (optional).' }
          },
          required: ['summary']
        }
      }
    },
    execute: async (args) => await maximoService.createServiceRequest(args)
  },

  // --- ASSETS & INVENTORY ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_asset_details',
        description: 'Get operational details and vendor info for a single specific asset.',
        parameters: {
          type: 'object',
          properties: {
            assetnum: { type: 'string', description: 'Asset number (e.g., PUMP-101).' },
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          },
          required: ['assetnum']
        }
      }
    },
    execute: async (args) => await maximoService.getAsset(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_asset_count',
        description: 'Get the exact total count/number of assets registered in IBM Maximo for a site or status (e.g., "how many assets in site TEST").',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (defaults to system site).' },
            status: { type: 'string', description: 'Optional status filter, e.g. OPERATING, DECOMMISSIONED, NOT READY.' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getAssetCount(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_assets',
        description: 'Query list of assets in IBM Maximo for a site or status.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            status: { type: 'string', description: 'Asset status (optional).' },
            limit: { type: 'number', description: 'Maximum assets to return (default 10).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getAssets(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_sites',
        description: 'Get all active IBM Maximo site IDs and descriptions to see available operational sites.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async () => await maximoService.getSites()
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_locations',
        description: 'Get list of operating locations in a site for asset and work order placement.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            limit: { type: 'number', description: 'Maximum locations to return (default 20).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getLocations(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'check_inventory',
        description: 'Check available current balance of a spare part across storerooms.',
        parameters: {
          type: 'object',
          properties: {
            itemnum: { type: 'string', description: 'Item / Part number (e.g. BEARING-01).' },
            location: { type: 'string', description: 'Specific Storeroom location (optional).' }
          },
          required: ['itemnum']
        }
      }
    },
    execute: async (args) => await maximoService.checkInventory(args)
  },

  // --- FAILURE CODES & JOB PLANS ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_failure_codes',
        description: 'Lookup Maximo failure codes and hierarchies to standardize problem reporting.',
        parameters: {
          type: 'object',
          properties: {
            failurelist: { type: 'string', description: 'Specific failure code to inspect (optional).' },
            limit: { type: 'number', description: 'Maximum records to return (default 10).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getFailureCodes(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_job_plans',
        description: 'Query standardized Job Plans (JPs) including expected duration and tasks.',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Keyword to search in job plan number or description.' },
            status: { type: 'string', description: 'Status (defaults to ACTIVE).' },
            limit: { type: 'number', description: 'Maximum records to return (default 5).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getJobPlans(args)
  },

  // --- ADVANCED OSLC QUERY ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'advanced_maximo_query',
        description: 'Perform an advanced OSLC query using custom where-clauses and selected attributes across MXWO, MXSR, MXASSET, MXINVENTORY, MXJOBPLAN.',
        parameters: {
          type: 'object',
          properties: {
            objectStructure: { type: 'string', description: 'Maximo Object Structure: MXWO, MXSR, MXASSET, MXINVENTORY, or MXJOBPLAN.' },
            whereClause: { type: 'string', description: 'OSLC where clause, e.g. siteid="TEST" and status="APPR"' },
            selectFields: { type: 'string', description: 'Comma separated fields to select, e.g. wonum,description,status' },
            limit: { type: 'number', description: 'Limit number of results (default 5, max 20).' }
          },
          required: ['objectStructure']
        }
      }
    },
    execute: async (args) => await maximoService.queryMaximo(args)
  },

  // --- WORKFLOW ROUTING ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'route_maximo_workflow',
        description: 'Route a work order through Maximo workflow or submit workflow actions.',
        parameters: {
          type: 'object',
          properties: {
            wonum: { type: 'string', description: 'Work Order number to route.' },
            action: { type: 'string', description: 'Workflow action name, e.g. ROUTE, APPROVE, REJECT.' },
            memo: { type: 'string', description: 'Approval or routing memo/comment.' }
          },
          required: ['wonum']
        }
      }
    },
    execute: async (args) => await maximoService.routeWorkflow(args)
  },
  
  // --- EXECUTIVE DASHBOARD & KPIS ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_maintenance_kpis',
        description: 'Get executive maintenance KPI dashboard metrics including total work orders, active backlog, completion rate, status distribution, and service request counts.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (defaults to system site).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getMaintenanceKPIs(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_overdue_work_orders',
        description: 'Retrieve critical work orders that missed their target completion date (overdue backlog).',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            limit: { type: 'number', description: 'Maximum records to return (default 5).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getOverdueWorkOrders(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_inventory_alerts',
        description: 'Check storeroom inventory for spare parts at or below critical reorder/safety stock thresholds.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            threshold: { type: 'number', description: 'Current balance threshold below which an alert is raised (default 5).' },
            limit: { type: 'number', description: 'Maximum alerts to return (default 5).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getInventoryAlerts(args)
  },

  // --- EXECUTIVE MANAGEMENT ANALYTICS ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_executive_cost_summary',
        description: 'Executive financial report of maintenance expenditure: labor, materials, services/contractors, and tools spend grouped by department and work type.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional, defaults to active site).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getExecutiveCostSummary(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_reliability_metrics',
        description: 'Reliability engineering analysis: Mean Time To Repair (MTTR), Proactive (RT/PM) vs. Reactive (CM/EM) ratio, and Top 5 Bad Actor assets.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getReliabilityMetrics(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_backlog_aging',
        description: 'Work order backlog aging distribution bands (<7d, 7-30d, 30-90d, >90d) to assess stagnant maintenance risk.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getBacklogAging(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_multi_site_benchmark',
        description: 'Cross-site benchmark comparing all Maximo sites side-by-side with work order volume, approval backlogs, and risk health ratings.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async () => await maximoService.getMultiSiteBenchmark()
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_budget_variance_analysis',
        description: 'Executive financial report comparing actual maintenance expenditure against estimated budgets, with dollar variances and department breakdown.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getBudgetVarianceAnalysis(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_vendor_sla_performance',
        description: 'Executive contractor report measuring third-party maintenance vendor SLA compliance rates, on-time deliveries, and breach counts.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getVendorSlaPerformance(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_asset_lifecycle_forecast',
        description: 'Asset health and replacement forecast for CAPEX planning, identifying high-risk equipment where cumulative repair costs exceed replacement value.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getAssetLifecycleForecast(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_multi_site_reliability_league',
        description: 'Comprehensive cross-site reliability league comparing CM Ratio, PM Compliance %, Active Backlog, MTTR (Mean Time to Repair), and RT Comparison ratio across all operating Maximo sites.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Specific Maximo Site ID (optional). If omitted, compares all operating sites.' },
            period: { 
              type: 'string', 
              enum: ['30d', '90d', '365d', 'all'],
              description: 'Evaluation time window: 30d (Last 30 Days/Month, default), 90d (Last Quarter), 365d (Past Year), or all (All-time history).' 
            }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getMultiSiteReliabilityLeague(args || {})
  },

  // --- EXTERNAL KNOWLEDGE ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the live web using Tavily for vendor manuals, OEM specs, or troubleshooting.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The web search query.' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args) => await searchTavily(args.query) // Tavily only expects a string
  }
];

// Tools that mutate data and require explicit human-in-the-loop approval
export const MUTATING_TOOLS = new Set([
  'create_maximo_work_order',
  'update_maximo_work_order_status',
  'create_service_request',
  'route_maximo_workflow'
]);

// Extract just the schemas for Ollama
export const toolsSchema = toolRegistry.map(t => t.schema);

// Dynamic dispatcher: finds the function by name and runs it
export async function executeTool(toolName, args) {
  const tool = toolRegistry.find(t => t.schema.function.name === toolName);
  if (tool) {
    return await tool.execute(args);
  }
  return { error: `Tool ${toolName} is not registered in the system.` };
}