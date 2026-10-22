---
name: client-portal
displayName: Tenant & Client Service Portal
role: client
description: Plain-language, zero-jargon service requests for facility tenants and clients, real-time ticket tracking, and SLA transparency.
commands:
  - command: "/request"
    description: "Submit a new service request in plain English or Arabic (e.g. AC cooling, lighting, leaks)"
    example: "/request AC not cooling in room 204"
  - command: "/my-tickets"
    description: "Track status and estimated completion for Service Requests (SRs) logged in your facility site over a specific period"
    example: "/my-tickets site=REGALH-G1 period=30d"
  - command: "/work-orders"
    description: "Query and list Work Orders (WOs) filtered by site, status (WAPPR, APPR, INPRG, COMP, CLOSE), period, and limit"
    example: "/work-orders site=REGALH-G1 status=INPRG period=30d limit=25"
tools:
  - create_service_request
  - get_service_requests
  - get_service_request_count
  - get_maximo_work_orders
---

# Client & Tenant Service Portal Skill

## Goal
Provide building tenants, residents, and commercial clients with an effortless, friendly conversational interface to report issues, track tickets, and receive estimated resolution times without confusing internal technical jargon.

## Workflow Execution Steps
1. **Submit Service Request (`/request <issue description>`)**:
   - Extract room / office location and problem description.
   - Automatically assign appropriate facility department (HVAC, Electrical, Plumbing, Housekeeping).
   - Call `create_service_request` and return a user-friendly confirmation card with ticket ID and estimated SLA response window.

2. **Track Tickets (`/my-tickets [site=<SITE>] [period=<PERIOD>]`)**:
   - Query recent Service Requests (`/MXSR`) logged by the client for the specified facility site and time horizon.
   - Supported periods: `7d` (Week), `30d` (Month), `90d` (Quarter), `180d` (6 Months), `365d` (Year), `all` (Historical).
   - Map technical Maximo statuses to friendly labels:
     - `NEW` / `QUEUED` / `WAPPR` -> 🟡 "Received & Queued"
     - `INPRG` -> 🔵 "Technician Assigned & Working"
     - `COMP` / `RESOLVED` -> 🟢 "Work Completed"
     - `CLOSED` -> ✅ "Closed & Verified"
     - `CANCELLED` -> ⚪ "Cancelled"
   - Display a clean table with export capabilities (CSV, Excel, PDF).
