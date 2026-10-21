---
name: executive-federation
displayName: Multi-Server Enterprise Federation (ED + GEM)
role: executive
description: Consolidates asset registries, site health, and operational capacity across multiple IBM Maximo production server instances.
commands:
  - command: "/portfolio-summary"
    description: "Generate a consolidated multi-server portfolio summary across ED, GEM, and all connected Maximo instances"
    example: "/portfolio-summary"
  - command: "/federated-assets"
    description: "Audit enterprise-wide asset counts and active operational percentages across all federated servers"
    example: "/federated-assets"
tools:
  - get_federated_portfolio_summary
  - get_federated_asset_count
  - get_multi_site_benchmark
---

# Multi-Server Enterprise Federation Skill

## Goal
Enable C-Suite Executives, Regional Operations Directors, and IT Enterprise Architects to monitor federated multi-instance Maximo environments (e.g. ED, GEM, international subsidiaries) from a single unified cockpit.

## Operational Workflow
1. **Consolidated Portfolio Summary (`/portfolio-summary`)**:
   - Query `get_federated_portfolio_summary` across all configured server instances.
   - Aggregate total registered assets, operating site counts, active servers, and primary database endpoints.
   - Output an enterprise executive summary card suitable for C-Level briefing.

2. **Enterprise Asset Audit (`/federated-assets`)**:
   - Execute `get_federated_asset_count`.
   - Break down asset inventory by server instance (ED vs GEM vs Regional).
   - Display total operational assets vs decommissioned or in-repair machinery.
