import { deepCleanMaximoData } from './arabicCleaner.js';
import { enterpriseDepartmentsService } from './enterpriseDepartmentsService.js';
import { maximoService } from './maximo.js';
import { executiveRoiService } from './executiveRoiService.js';
import { mcpClientManager } from './mcpClientService.js';
import { searchTavily } from './tavily.js';
import { ragService } from './ragService.js';
import {
  calculate_reliability_kpis,
  evaluate_asset_criticality,
  validate_failure_hierarchy,
  build_maximo_oslc_query,
  propose_pm_frequency_update,
} from './eamSkills.js';
import {
  calculate_fmea_rpn,
  build_iso14224_failure_hierarchy,
  generate_rcm_decision_logic,
  propose_fmea_jobplan_update,
} from './fmeaRcmService.js';
import {
  calculate_reliability_availability_kpis,
  calculate_work_management_kpis,
  calculate_lifecycle_financial_kpis,
  calculate_inventory_mro_kpis,
  calculate_data_risk_governance_kpis,
  generate_maximo_kpi_manager_sql,
  propose_iso55001_capa_action,
} from './iso55000KpiService.js';

// The Tool Registry ties the AI schema directly to the JS execution function
const toolRegistry = [
  {
    schema: {
      type: 'function',
      function: {
        name: 'simulate_enterprise_chiller_incident',
        description: 'Simulates complete multi-departmental autonomous incident orchestration when a chiller fails across Technical Office, HR, Supply Chain, QHSE, Finance, and IT.',
        parameters: {
          type: 'object',
          properties: {
            assetnum: { type: 'string', description: 'Chiller or asset identifier (e.g. CHILLER-01).' },
            siteid: { type: 'string', description: 'Facility site code (optional).' }
          }
        }
      }
    },
    execute: async (args) => enterpriseDepartmentsService.simulateChillerFailureWorkflow(args || {})
  },

  {
    schema: {
      type: 'function',
      function: {
        name: 'get_enterprise_departments_roadmap',
        description: 'Enterprise multi-department integration roadmap and architecture covering Technical Office, QHSE, Supply Chain, HR, Finance, and IT for Eden Facility Management.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async () => enterpriseDepartmentsService.getEnterpriseRoadmap()
  },
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
            all_sites: { type: 'boolean', description: 'Set to true to query work orders across all sites.' },
            limit: { type: 'number', description: 'Maximum records to return (default 10).' }
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
        name: 'get_work_order_site_summary',
        description: 'Get a clean consolidated summary table of work order counts grouped by Site (supports status filter e.g. WAPPR, APPR, INPRG across all sites).',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Work order status to filter (e.g. WAPPR, APPR, INPRG).' },
            siteid: { type: 'string', description: 'Specific site ID or leave blank/ALL for all sites.' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getWorkOrderSummaryBySite(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_unplanned_work_orders',
        description: 'Query and display detailed list of unplanned work orders (Corrective Maintenance CM or Emergency Maintenance EM) by site or across all sites (use all_sites: true for all sites). Use this whenever user asks to show, list, or check unplanned/CM/EM work orders.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Work order status (e.g. WAPPR, APPR, INPRG, COMP).' },
            siteid: { type: 'string', description: 'Specific Maximo site ID or leave blank for active site.' },
            all_sites: { type: 'boolean', description: 'Set to true to query across all sites.' },
            limit: { type: 'number', description: 'Maximum records to return (default 15).' },
            period: {
              type: 'string',
              enum: ['30d', '90d', '365d', 'all'],
              description: 'Time window filter: 30d (Last 30 Days/Month), 90d (Quarter), 365d (Year), or all.'
            }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getUnplannedWorkOrders(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_unplanned_work_orders_summary',
        description: 'Get a consolidated summary table of unplanned work orders (CM & EM) with counts and statistics grouped by Site across all sites. Use this when the user asks for a summary, count, or breakdown of unplanned work orders by site.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Work order status (e.g. WAPPR, APPR, INPRG).' },
            siteid: { type: 'string', description: 'Specific site ID or leave blank/ALL for all sites.' },
            period: {
              type: 'string',
              enum: ['30d', '90d', '365d', 'all'],
              description: 'Time window filter: 30d (Last 30 Days/Month), 90d (Quarter), 365d (Year), or all.'
            }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getUnplannedWorkOrdersSummary(args)
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
        name: 'get_service_requests',
        description: 'Query list of tenant and client Service Requests (SR tickets) with current status, reported issue, and date, filtered by site and time period.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (e.g. REGALH-G1, TEST, CRYSTAL). Defaults to active site context.' },
            status: { type: 'string', description: 'Filter by ticket status (e.g. NEW, QUEUED, INPRG, RESOLVED, CLOSED, or ALL).' },
            period: {
              type: 'string',
              enum: ['7d', '30d', '90d', '180d', '365d', 'all'],
              description: 'Time period horizon: 7d (Week), 30d (Month), 90d (Quarter), 180d (6 Months), 365d (Year), or all (All-time history, default).'
            },
            limit: { type: 'number', description: 'Maximum tickets to return (default 15).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getServiceRequests(args || {})
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
        name: 'get_machine_card',
        description: 'Generate a comprehensive Machine Card (Asset Passport) including technical specifications, health rating, financial lifecycle spend, MTTR, failure history, and work orders history log.',
        parameters: {
          type: 'object',
          properties: {
            assetnum: { type: 'string', description: 'Target Asset Number (e.g. ASSET124, PUMP-101).' },
            siteid: { type: 'string', description: 'Maximo Site ID (defaults to active site).' }
          },
          required: ['assetnum']
        }
      }
    },
    execute: async (args, context = {}) => await maximoService.getMachineCard({ ...args, allowedSites: context.allowedSites })
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_asset_count',
        description: 'Get the exact total count/number of assets registered in IBM Maximo for a site or status (e.g., "how many assets in site TEST"). If the user asks for all servers/instances, call get_federated_asset_count instead.',
        parameters: {
          type: 'object',
          properties: {
            all_sites: { type: 'boolean', description: 'Set to true to calculate assets across all 47 facility sites in the portfolio.' },
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
        name: 'get_federated_asset_count',
        description: 'Get consolidated asset count across active Eden Maximo server instances (ED and GEM) combined. Call when user asks for total assets across all servers or all instances.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Optional status filter, e.g. OPERATING, DECOMMISSIONED, NOT READY.' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getFederatedAssetCount(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_federated_portfolio_summary',
        description: 'Get consolidated executive overview across active Eden Maximo server instances (ED, GEM), merging total assets, active backlog, and total work orders.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async (args) => await maximoService.getFederatedPortfolioSummary(args)
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
            itemnum: { type: 'string', description: 'Item / Part number (must be explicitly provided by user).' },
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
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' },
            period: {
              type: 'string',
              enum: ['30d', '90d', '365d', 'all'],
              description: 'Evaluation time window: 30d (Last 30 Days/Month, default), 90d (Quarter), 365d (Year), or all (All-time history).'
            }
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
        name: 'get_site_kpi_scorecard',
        description: 'Calculates core maintenance and reliability KPIs (CM Ratio, PM Compliance %, Active Backlog, MTTR, MTBF, Inherent Availability, and Top Bad Actors) for a specific site over a specified period (7d, 30d, 90d, 180d, 365d, all).',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (e.g. REGALH-G1, TEST, CRYSTAL, etc.).' },
            period: {
              type: 'string',
              enum: ['7d', '30d', '90d', '180d', '365d', 'all'],
              description: 'Observation period: 7d (Week), 30d (Month, default), 90d (Quarter), 180d (6 Months), 365d (1 Year), or all (Historical).'
            }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getSiteKpiScorecard(args || {})
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
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_asset_criticality_risk_matrix',
        description: 'Plant equipment risk matrix calculating Risk Priority Number (RPN) from consequence of failure, historical repair costs, and open work order backlog.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getAssetCriticalityRiskMatrix(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'generate_executive_audit_brief',
        description: 'Consolidated C-Suite and Boardroom executive memo synthesizing budget health, reliability KPIs, contractor SLA performance, vulnerable assets, and immediate action items.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.generateExecutiveAuditBrief(args || {})
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_executive_roi_cost_avoidance',
        description: 'Calculate comprehensive Executive ROI & Maintenance Cost Avoidance scorecard showing financial value delivered (catastrophic failure prevention, 90% in-house labor savings, energy efficiency, and SLA clawbacks).',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo Site ID (optional, defaults to active site).' }
          }
        }
      }
    },
    execute: async (args) => await executiveRoiService.getExecutiveRoiCostAvoidance(args || {})
  },

  // --- TECHNICAL KNOWLEDGE BASE / RAG ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'search_knowledge_base',
        description: 'Search internal technical manuals, OEM equipment guides, SOPs, safety procedures, or executive policy PDFs indexed in the system.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The maintenance question, troubleshooting topic, fault code, or policy search term.' },
            conversationId: { type: 'string', description: 'Optional conversation ID to restrict search to documents uploaded in the active chat.' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args, context = {}) => await ragService.search(args.query, 4, args.conversationId || context.conversationId, context.username)
  },

  // --- PREVENTIVE MAINTENANCE FORECAST (PPM) ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_ppm_forecast',
        description: 'Extract Preventive Maintenance (PPM) schedule based on estimated next forecast date (FORECASTDATE / NEXTDATE) for a specific site or asset in the PM application.',
        parameters: {
          type: 'object',
          properties: {
            siteid: { type: 'string', description: 'Maximo site ID (e.g. TEST, TEST, EAGLE).' },
            status: { type: 'string', description: 'PM status: ACTIVE, DRAFT, INACT (default ACTIVE).' },
            assetnum: { type: 'string', description: 'Optional specific asset number (e.g. ASSET124).' },
            limit: { type: 'number', description: 'Maximum PPM records to extract (default 20).' }
          }
        }
      }
    },
    execute: async (args) => await maximoService.getPpmForecast(args)
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
  },

  // --- ISO 55001 EAM & RELIABILITY ENGINEERING GOVERNANCE ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_reliability_kpis',
        description: 'Calculate MTBF, MTTR, Inherent Availability (%), and Failure Rate (λ) from operational run hours and downtime counts.',
        parameters: {
          type: 'object',
          properties: {
            total_operating_hours: { type: 'number', description: 'Total operating hours run by the equipment (excluding downtime).' },
            total_downtime_hours: { type: 'number', description: 'Total unplanned downtime hours spent on corrective repairs.' },
            number_of_failures: { type: 'integer', description: 'Total count of distinct functional failure events.' }
          },
          required: ['total_operating_hours', 'total_downtime_hours', 'number_of_failures']
        }
      }
    },
    execute: async (args) => calculate_reliability_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'evaluate_asset_criticality',
        description: 'Evaluate ISO 55001 / RCM Asset Criticality Score (RPN) based on safety, environmental, operational, and repair severity.',
        parameters: {
          type: 'object',
          properties: {
            asset_num: { type: 'string', description: 'Asset identifier tag (e.g. CHILLER-01).' },
            safety_impact: { type: 'integer', description: 'Safety hazard score: 1 (None) to 5 (Catastrophic/LOTO).' },
            environmental_impact: { type: 'integer', description: 'Environmental consequence score: 1 (None) to 5 (Major regulatory breach).' },
            production_impact: { type: 'integer', description: 'Operational impact: 1 (Redundant) to 5 (Single point of failure).' },
            mttr_severity: { type: 'integer', description: 'Repair duration severity: 1 (<2h) to 5 (>72h).' },
            failure_frequency: { type: 'integer', description: 'Failure frequency rating: 1 (Rare, <1/yr) to 5 (Frequent, >1/month).' }
          },
          required: ['asset_num']
        }
      }
    },
    execute: async (args) => evaluate_asset_criticality(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'validate_failure_hierarchy',
        description: 'Verify ISO 14224 3-tier failure coding (Problem -> Cause -> Remedy) before work order closure.',
        parameters: {
          type: 'object',
          properties: {
            wonum: { type: 'string', description: 'Work Order number (e.g. WO10492).' },
            failure_class: { type: 'string', description: 'Equipment failure class (e.g. PUMPS, HVAC).' },
            problem_code: { type: 'string', description: 'Observed problem code (e.g. LEAK, VIBR).' },
            cause_code: { type: 'string', description: 'Root cause code (e.g. SEALWORN, BEARINGFAIL).' },
            remedy_code: { type: 'string', description: 'Remedy code applied (e.g. REPLSEAL, ALIGN).' }
          },
          required: ['wonum', 'failure_class', 'problem_code', 'cause_code', 'remedy_code']
        }
      }
    },
    execute: async (args) => validate_failure_hierarchy(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'build_maximo_oslc_query',
        description: 'Construct standardized IBM Maximo REST OSLC query URLs and headers with lean=1, oslc.select, and oslc.where.',
        parameters: {
          type: 'object',
          properties: {
            object_structure: { type: 'string', description: 'Maximo Object Structure (e.g. mxapiwodetail, mxapiasset, mxapiinventory).' },
            where_clause: { type: 'string', description: 'OSLC where clause filter (e.g. status="WAPPR" and siteid="TEST").' },
            select_fields: { type: 'string', description: 'Comma-separated fields for oslc.select.' },
            page_size: { type: 'integer', description: 'Page size limit (default 20).' }
          },
          required: ['object_structure', 'where_clause']
        }
      }
    },
    execute: async (args) => build_maximo_oslc_query(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'propose_pm_frequency_update',
        description: 'Tier-2 Gated proposal to update a Preventive Maintenance (PM) frequency based on RCM / MTBF justification.',
        parameters: {
          type: 'object',
          properties: {
            pmnum: { type: 'string', description: 'PM number (e.g. PM-CHILL-01).' },
            siteid: { type: 'string', description: 'Maximo Site ID (e.g. TEST).' },
            current_frequency: { type: 'integer', description: 'Current interval value.' },
            proposed_frequency: { type: 'integer', description: 'Proposed interval value.' },
            frequnit: { type: 'string', description: 'Unit (DAYS, WEEKS, MONTHS, YEARS, HOURS).' },
            engineering_justification: { type: 'string', description: 'Reliability/RCM engineering justification.' }
          },
          required: ['pmnum', 'current_frequency', 'proposed_frequency', 'engineering_justification']
        }
      }
    },
    execute: async (args) => propose_pm_frequency_update(args)
  },
  // --- RCM & FMEA FAILURE MODE MODELING ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_fmea_rpn',
        description: 'Calculate FMEA Risk Priority Number (RPN = S * O * D) and risk classification.',
        parameters: {
          type: 'object',
          properties: {
            failure_mode_name: { type: 'string', description: 'Name of the failure mode (e.g. Bearing Seizure).' },
            severity_s: { type: 'integer', description: 'Severity rating from 1 (minor) to 10 (catastrophic).' },
            occurrence_o: { type: 'integer', description: 'Occurrence rating from 1 (remote) to 10 (frequent).' },
            detectability_d: { type: 'integer', description: 'Detectability rating from 1 (certain) to 10 (undetectable).' },
            safety_or_environmental_flag: { type: 'boolean', description: 'True if failure creates a safety/environmental hazard.' }
          },
          required: ['failure_mode_name', 'severity_s', 'occurrence_o', 'detectability_d']
        }
      }
    },
    execute: async (args) => calculate_fmea_rpn(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'build_iso14224_failure_hierarchy',
        description: 'Generate standardized ISO 14224 failure hierarchy codes (Class, Component, Problem, Cause, Remedy) for Maximo.',
        parameters: {
          type: 'object',
          properties: {
            equipment_class: { type: 'string', description: 'Equipment class code (e.g. PUMP, COMP).' },
            component_name: { type: 'string', description: 'Component/Assembly (e.g. IMPELLER, SEAL).' },
            problem_symptom: { type: 'string', description: 'Observed problem/symptom code (e.g. VIBR, LEAK).' },
            failure_cause: { type: 'string', description: 'Failure cause/mechanism code (e.g. CAVITATION, WEAR).' },
            corrective_remedy: { type: 'string', description: 'Corrective remedy code (e.g. REPLIMPELLER, ALIGN).' }
          },
          required: ['equipment_class', 'component_name', 'problem_symptom', 'failure_cause', 'corrective_remedy']
        }
      }
    },
    execute: async (args) => build_iso14224_failure_hierarchy(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'generate_rcm_decision_logic',
        description: 'Run SAE JA1011 RCM decision tree to evaluate CBM vs Time-based PM vs Redesign vs Run-to-Failure.',
        parameters: {
          type: 'object',
          properties: {
            failure_mode_description: { type: 'string', description: 'Detailed failure mode description.' },
            hidden_failure_hazard: { type: 'boolean', description: 'Is the functional failure hidden from operators?' },
            safety_environmental_consequence: { type: 'boolean', description: 'Does failure cause safety/environmental consequence?' },
            operational_economic_consequence: { type: 'boolean', description: 'Does failure cause operational downtime/economic loss?' },
            technically_feasible_cbm: { type: 'boolean', description: 'Is condition-based monitoring technically feasible with P-F interval?' },
            technically_feasible_time_based_pm: { type: 'boolean', description: 'Is scheduled discard or overhaul technically feasible?' }
          },
          required: ['failure_mode_description']
        }
      }
    },
    execute: async (args) => generate_rcm_decision_logic(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'propose_fmea_jobplan_update',
        description: 'Tier-2 Gated proposal to update a Maximo Job Plan or PM based on FMEA review.',
        parameters: {
          type: 'object',
          properties: {
            jobplan_num: { type: 'string', description: 'Job Plan identifier (e.g. JP-PUMP-01).' },
            siteid: { type: 'string', description: 'Maximo Site ID (e.g. TEST).' },
            failure_mode_addressed: { type: 'string', description: 'Failure mode addressed.' },
            proposed_task_change: { type: 'string', description: 'Proposed maintenance task modification.' },
            rpn_reduction_expected: { type: 'number', description: 'Expected RPN score reduction.' },
            rcm_justification: { type: 'string', description: 'RCM justification for the change.' }
          },
          required: ['jobplan_num', 'failure_mode_addressed', 'proposed_task_change', 'rcm_justification']
        }
      }
    },
    execute: async (args) => propose_fmea_jobplan_update(args)
  },

  // --- ISO 55000 / ISO 55001 KPI GOVERNANCE & MAXIMO SQL ---
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_reliability_availability_kpis',
        description: 'Calculate ISO 55001 Pillar 1 Reliability & Availability KPIs (Inherent Availability, Operational Availability, MTBF, MTTR, OEE).',
        parameters: {
          type: 'object',
          properties: {
            total_period_hours: { type: 'number', description: 'Total observation period hours (e.g. 720).' },
            planned_downtime_hours: { type: 'number', description: 'Planned maintenance downtime hours.' },
            unplanned_downtime_hours: { type: 'number', description: 'Unplanned corrective downtime hours.' },
            number_of_failures: { type: 'integer', description: 'Count of functional failure events.' },
            quality_rate_percent: { type: 'number', description: 'Quality rate % (default 100).' },
            performance_rate_percent: { type: 'number', description: 'Performance rate % (default 100).' }
          },
          required: ['total_period_hours', 'unplanned_downtime_hours', 'number_of_failures']
        }
      }
    },
    execute: async (args) => calculate_reliability_availability_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_work_management_kpis',
        description: 'Calculate ISO 55001 Pillar 2 Work Management KPIs (PM Compliance %, Proactive/Reactive split %, Schedule Compliance %, Backlog Weeks).',
        parameters: {
          type: 'object',
          properties: {
            pm_completed_on_time: { type: 'integer', description: 'Count of PM work orders completed on time.' },
            pm_total_scheduled: { type: 'integer', description: 'Total scheduled PM work orders.' },
            proactive_wo_hours: { type: 'number', description: 'Total labor hours on proactive PM/PdM/RT work.' },
            reactive_emergency_wo_hours: { type: 'number', description: 'Total labor hours on reactive CM/EM work.' },
            scheduled_wo_completed: { type: 'integer', description: 'Count of scheduled work orders completed.' },
            total_wo_scheduled_weekly: { type: 'integer', description: 'Total work orders scheduled on weekly plan.' },
            total_backlog_labor_hours: { type: 'number', description: 'Total labor hours in open backlog.' },
            available_weekly_craft_hours: { type: 'number', description: 'Total available weekly craft labor hours.' }
          },
          required: ['pm_completed_on_time', 'pm_total_scheduled', 'proactive_wo_hours', 'reactive_emergency_wo_hours']
        }
      }
    },
    execute: async (args) => calculate_work_management_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_lifecycle_financial_kpis',
        description: 'Calculate ISO 55001 Pillar 3 Financial & Lifecycle KPIs (Maintenance Cost as % of RAV, SMRP benchmark, Projected Opex).',
        parameters: {
          type: 'object',
          properties: {
            annual_maintenance_cost_usd: { type: 'number', description: 'Total annual maintenance expenditure in USD.' },
            replacement_asset_value_rav_usd: { type: 'number', description: 'Total asset replacement value (RAV) in USD.' },
            annual_energy_operating_cost_usd: { type: 'number', description: 'Annual energy/operating cost in USD.' },
            asset_remaining_useful_life_years: { type: 'number', description: 'Remaining useful life in years.' }
          },
          required: ['annual_maintenance_cost_usd', 'replacement_asset_value_rav_usd']
        }
      }
    },
    execute: async (args) => calculate_lifecycle_financial_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_inventory_mro_kpis',
        description: 'Calculate ISO 55001 Pillar 4 MRO Inventory KPIs (Storeroom Service Level %, Stockout Rate %, Inventory Turns, Obsolete Stock %).',
        parameters: {
          type: 'object',
          properties: {
            total_stock_requests: { type: 'integer', description: 'Total storeroom item reservation requests.' },
            stockout_incidents: { type: 'integer', description: 'Number of stockout incidents.' },
            annual_mro_issued_value_usd: { type: 'number', description: 'Total value of items issued annually in USD.' },
            average_inventory_valuation_usd: { type: 'number', description: 'Average total inventory valuation in USD.' },
            inactive_obsolete_stock_value_usd: { type: 'number', description: 'Value of non-moving/obsolete items in USD.' }
          },
          required: ['total_stock_requests', 'stockout_incidents', 'annual_mro_issued_value_usd', 'average_inventory_valuation_usd']
        }
      }
    },
    execute: async (args) => calculate_inventory_mro_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'calculate_data_risk_governance_kpis',
        description: 'Calculate ISO 55001 Pillar 5 & 6 Risk, QHSE & Asset Data Completeness KPIs.',
        parameters: {
          type: 'object',
          properties: {
            safety_critical_pm_completed: { type: 'integer', description: 'Safety-critical PM work orders completed on time.' },
            safety_critical_pm_due: { type: 'integer', description: 'Total safety-critical PM work orders due.' },
            wo_closed_with_full_iso14224_codes: { type: 'integer', description: 'Closed work orders with full Problem-Cause-Remedy.' },
            total_corrective_wo_closed: { type: 'integer', description: 'Total corrective work orders closed.' },
            verified_assets_in_maximo: { type: 'integer', description: 'Physical assets verified accurate in Maximo.' },
            total_physical_assets_audited: { type: 'integer', description: 'Total physical assets audited in field.' }
          },
          required: ['safety_critical_pm_completed', 'safety_critical_pm_due', 'wo_closed_with_full_iso14224_codes', 'total_corrective_wo_closed']
        }
      }
    },
    execute: async (args) => calculate_data_risk_governance_kpis(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'generate_maximo_kpi_manager_sql',
        description: 'Generate ready-to-paste IBM Maximo Db2 SQL and KPI Manager definitions (MTTR, MTBF, PM_COMPLIANCE, PROACTIVE_RATIO, MAINT_COST_RAV, STOCKOUT_RATE, HSE_STATUTORY_PM, ISO14224_FAILURE_CODING).',
        parameters: {
          type: 'object',
          properties: {
            kpi_code: { type: 'string', description: 'KPI code: MTTR, MTBF, PM_COMPLIANCE, PROACTIVE_RATIO, MAINT_COST_RAV, STOCKOUT_RATE, HSE_STATUTORY_PM, ISO14224_FAILURE_CODING.' },
            siteid: { type: 'string', description: 'Maximo Site ID (default TEST).' },
            rolling_days: { type: 'integer', description: 'Rolling window in days (default 30).' }
          },
          required: ['kpi_code']
        }
      }
    },
    execute: async (args) => generate_maximo_kpi_manager_sql(args)
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'propose_iso55001_capa_action',
        description: 'Tier-2 Gated proposal to log a formal Maximo CAPA Work Order for an ISO 55001 KPI threshold breach.',
        parameters: {
          type: 'object',
          properties: {
            kpi_name: { type: 'string', description: 'Name of the KPI in breach (e.g. PM_COMPLIANCE).' },
            current_value: { type: 'string', description: 'Current measured KPI value (e.g. 88.5%).' },
            target_threshold: { type: 'string', description: 'Target threshold required (e.g. 95.0%).' },
            iso_clause_reference: { type: 'string', description: 'ISO 55001 clause (e.g. 8.1, 9.1, 6.1).' },
            siteid: { type: 'string', description: 'Maximo Site ID.' },
            root_cause_summary: { type: 'string', description: 'Root cause summary of the breach.' },
            corrective_action_plan: { type: 'string', description: 'Detailed corrective action plan.' }
          },
          required: ['kpi_name', 'current_value', 'target_threshold', 'root_cause_summary', 'corrective_action_plan']
        }
      }
    },
    execute: async (args) => propose_iso55001_capa_action(args)
  }

];


// Tools restricted strictly to executive management and administrators
export const EXECUTIVE_RESTRICTED_TOOLS = new Set([
  'get_executive_cost_summary',
  'get_budget_variance_analysis',
  'get_vendor_sla_performance',
  'generate_executive_audit_brief',
  'get_multi_site_benchmark',
  'get_multi_site_reliability_league',
  'get_federated_portfolio_summary',
  'get_asset_lifecycle_forecast'
]);

// Tools restricted from field technicians (e.g. workflow routing, asset risk matrices, contract performance)
export const TECHNICIAN_DISALLOWED_TOOLS = new Set([
  ...EXECUTIVE_RESTRICTED_TOOLS,
  'route_maximo_workflow',
  'get_asset_criticality_risk_matrix'
]);

// Tools that mutate data and require explicit human-in-the-loop approval
export const MUTATING_TOOLS = new Set([
  'create_maximo_work_order',
  'update_maximo_work_order_status',
  'create_service_request',
  'route_maximo_workflow',
  'propose_pm_frequency_update',
  'propose_fmea_jobplan_update',
  'propose_iso55001_capa_action'
]);

// Extract just the schemas for Ollama
export const toolsSchema = toolRegistry.map(t => t.schema);

// Dynamic tools schema combining internal EAM tools + active external MCP tools
export function getActiveToolsSchema() {
  const external = mcpClientManager.getExternalToolsSchema();
  return [...toolsSchema, ...external];
}

// Dynamic dispatcher with Role-Based Access Control, Site Privacy, and External MCP Forwarding
export async function executeTool(toolName, args = {}, context = {}) {
  // Check if tool is provided by an external MCP server
  if (mcpClientManager.hasTool(toolName)) {
    return await mcpClientManager.executeExternalTool(toolName, args);
  }

  const tool = toolRegistry.find(t => t.schema.function.name === toolName);
  if (!tool) {
    return { error: `Tool ${toolName} is not registered in the system.` };
  }

  const role = (context.role || 'user').toLowerCase();
  const allowedSites = context.allowedSites || ['*'];
  const isUniversal = allowedSites.includes('*') || allowedSites.includes('ALL');

  // 1. Role-Based Permissions
  if (role === 'technician') {
    if (TECHNICIAN_DISALLOWED_TOOLS.has(toolName)) {
      return {
        error: `⛔ Access Denied: The tool '${toolName}' provides high-level executive/engineering analytics and is not permitted for the 'technician' role.`
      };
    }
  } else if (role === 'engineer') {
    if (EXECUTIVE_RESTRICTED_TOOLS.has(toolName)) {
      return {
        error: `⛔ Access Denied: Executive financial memo and cross-portfolio analytics tool '${toolName}' requires 'executive' or 'admin' privileges.`
      };
    }
  }

  // 2. Site Scope Privacy Enforcement
  if (!isUniversal) {
    const allowedUpper = allowedSites.map(s => s.toUpperCase());
    
    // Check if tool target explicitly requested another site
    if (args.siteid && args.siteid !== 'ALL' && !allowedUpper.includes(args.siteid.toUpperCase())) {
      return {
        error: `⛔ Site Privacy Violation: You are not authorized to access site '${args.siteid}'. Authorized site(s): [${allowedSites.join(', ')}].`
      };
    }

    // Force all single-site operations to the user's authorized site if not provided or unpermitted
    if (args.siteid && !allowedUpper.includes(args.siteid.toUpperCase())) {
      args.siteid = allowedUpper[0];
    } else if (!args.siteid && allowedUpper.length > 0) {
      args.siteid = allowedUpper[0];
    }

    // Block cross-site unrestricted dumps if user is restricted
    if (args.all_sites) {
      args.all_sites = false;
    }
  }

  const rawResult = await tool.execute(args, context);
  return deepCleanMaximoData(rawResult);
}