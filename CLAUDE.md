# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository hosts **Edge Tracker**, an initiative under the **Insedge** open-source umbrella (Insedge = research umbrella for the layer where AI meets the physical world: sensors, microcontrollers, and edge ML on commodity hardware).

Edge Tracker is an **open-source DePIN infrastructure platform**. It provides a generic, hardware-agnostic layer that connects commodity IoT devices (ESP8266/ESP32, Arduino-compatible boards) to off-chain storage and on-chain verification.

The core value proposition: **anyone can participate in a decentralized physical infrastructure network using off-the-shelf hardware** — no proprietary devices required. The platform handles device identity (secp256k1 key pairs), data ingestion, cryptographic verification, dataset aggregation, Merkle proofs, and blockchain anchoring.

Edge Tracker is **not** a sensor product, a dashboard, or a data analytics tool. It is infrastructure that different applications consume. Projects are already being developed on top of it, such as a **business/customer analytics** system that uses edge devices in commercial spaces (malls, retail stores) for foot traffic and consumer behavior inference via TinyML. Future applications may target smart cities, agriculture, environmental monitoring, or any domain where trustworthy physical-world data matters. The architecture must remain agnostic to:
- **Sensor type** — temperature, humidity, audio, image, air quality, foot traffic, or any future data source
- **Vertical** — smart cities, retail analytics, agriculture, environmental monitoring, logistics, or any domain that needs trustworthy physical-world data
- **Storage backend** — currently Supabase/PostgreSQL, but the platform should not assume a specific database
- **Blockchain** — currently Solana Devnet, but on-chain interactions are isolated behind clear interfaces

## Design Intent

When making architectural or code decisions, preserve these properties:

1. **Sensor-agnostic data path.** The ingestion pipeline accepts arbitrary signed JSON payloads. Never hardcode assumptions about what fields a reading contains beyond the cryptographic envelope (device ID, signature, timestamp, payload).

2. **Separable layers.** Device identity, data transport, storage, aggregation, and blockchain anchoring are distinct concerns. Changes to one layer should not require changes to others.

3. **Commodity hardware first.** If a design choice forces specific hardware beyond a generic microcontroller with WiFi and a crypto library, it needs strong justification. The ~R$15 ESP8266 is the baseline.

4. **Trust model = DePIN.** The system exists because multiple parties need to trust data without trusting whoever collected it. Every architectural decision should be traceable to this premise. If a feature doesn't serve trustless verification, question whether it belongs in the platform layer.

5. **Platform vs. application.** Code that serves any DePIN use case belongs in the platform. Code specific to the current MVP (DHT11 readings, environmental dashboard) should be clearly separated and replaceable.

## Current MVP Instance

The live deployment (linked from `insedge.org/edgetracker`) is a **specific instantiation** of the platform for environmental sensing. It demonstrates the end-to-end flow but is not the product itself.

> **Note on legacy identifiers.** Despite the rebrand to Insedge / Edge Tracker, the protocol-level identifiers `io.sparkedsense.*` (CloudEvents event types), the `sparked-sense://` URI scheme used in Solana memos, and the `sparked-sense.dataset.v1` spec ID are **stable contracts** with deployed firmware and on-chain anchors. Do not rename them in passing — any migration requires a dedicated ADR (referencing ADRs 010 and 015) with versioned dual-support during the transition.

Stack details, source file map, database schema, and environment variables are documented in `docs/`. Infer current technical choices from the codebase directly.

## Commands

- `pnpm dev` — Start Vite dev server on port 3000
- `pnpm build` — Build to `./build` directory
- Supabase Edge Functions are deployed separately via Supabase CLI
- WiFi geolocation worker (`wifi-geolocate-worker/`) uses Wrangler (Cloudflare Workers)

## Data Flow

1. Device sends signed JSON payload → Edge Function validates signature & stores
2. Real-time change event → Frontend dashboard updates
3. Readings aggregated into datasets → Merkle tree built → root anchored on-chain
4. Public audit pages verify dataset integrity via Merkle inclusion proofs

## Timeline

The file `docs/timeline.md` tracks project milestones and progress using **changelog format**. Consult it before starting work to understand what has been completed, what is in progress, and what is next. Update it when completing a milestone or delivering a significant change.

## Workflow Practices

- **No AI authorship in commits.** Never include "Co-Authored-By: Claude" or similar attribution in commit messages. AI usage is disclosed in the README and in academic methodology, not in git history.
- **Check other worktrees before starting.** Other git worktrees may be open with in-progress work. Before making changes, review existing worktrees (`git worktree list`) to avoid conflicts, duplicated effort, or overwriting parallel work.
- **Worktree naming.** Never use auto-generated random names (e.g. `funny-leavitt-f4d868`, `great-leakey`) for worktrees. Create worktrees with descriptive names that follow the same prefix convention as branches: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`. Path format: `.claude/worktrees/<prefix>-<short-name>` (e.g. `.claude/worktrees/feat-merkle-anchor`, `.claude/worktrees/fix-sparkline`). When Claude Code offers to create a worktree with an auto-generated name, decline and create it manually: `git worktree add .claude/worktrees/<prefix>-<short-name> -b <prefix>/<short-name>`. Clean up worktrees after the related PR is merged.
- **After every merge or PR:** update the timeline (`docs/timeline.md`) with what was delivered, and update or create any ADRs affected by the changes. If a merge supersedes a previous decision, write a new ADR referencing the old one rather than editing it.

## Architecture Decision Records

ADRs in `docs/adr/` follow the **Michael Nygard standard** (Title, Status, Context, Decision, Consequences). One file per decision. Superseded decisions get a new ADR referencing the old one rather than in-place edits. **Always check existing ADRs before proposing changes to settled decisions.**