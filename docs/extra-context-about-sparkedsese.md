# Sparked Sense

## What This Is

Sparked Sense is an open-source DePIN infrastructure that connects generic IoT hardware (Arduino, ESP boards) to blockchain. The value proposition: you don't need proprietary hardware to participate in a DePIN network — a R$15 ESP8266 is enough.

Live MVP: https://sparkedsensemvp.vercel.app

## Relationship with Academic Research

Sparked Sense is the base artifact for two academic projects at Poli-USP (Engenharia de Produção), but they are separate things with potentially divergent futures.

**Sparked Sense** is a standalone open-source project. Its scope is generic: any IoT-to-blockchain integration via DePIN. It is not limited to any specific use case or industry.

**IC and TF** are academic research that currently use Sparked Sense as their foundation. They apply it to a specific use case (behavior analytics in commercial spaces with edge AI). In the future, the research may evolve independently from Sparked Sense, and Sparked Sense may serve use cases beyond the academic scope.

When working on this codebase, always consider: does this change serve Sparked Sense as infrastructure, or does it serve the IC/TF use case? Keep both concerns visible but separable.

## Academic Context (IC/TF)

- **Iniciação Científica (IC)** — Code 2025-4415, advisor Prof. Eduardo de Senzi Zancul (Poli-USP). Deliverables: (1) conceptual architecture of processes and protocols for DePIN networks in urban environments with edge inference; (2) functional prototype using ESP32-S3 + I2S mic + TinyML for audio inference in commercial spaces. Requires a SIICUSP article.
- **Trabalho de Formatura (TF)** — Same advisor. Title: "Rede descentralizada para geração de inferências autênticas sobre comportamento de consumo com IA na borda" (never use "plataforma" in this title). TF1 (theoretical foundation, architecture, use case design) due end of May 2026. TF2 (implementation and validation) second semester 2026.
- **Applied cryptography advisor:** Otávio Vacari (Poli-USP, M.Sc.)

### IC/TF Use Case

A decentralized network of low-cost devices deployed across commercial spaces (shopping mall common areas, retail stores, supermarket shelves). Each device processes audio/image locally with TinyML, exports only anonymized inferences signed with secp256k1, and anchors hashes on-chain. No raw data leaves the device.

**Why DePIN is justified here:** Multiple parties with conflicting interests operate in the same ecosystem. The shopping mall has incentive to inflate foot traffic numbers. The store tenant has incentive to underreport performance. Suppliers need reliable data to allocate trade marketing budgets. No party trusts the others. Blockchain provides verifiable provenance for inferences that no single actor controls.

**Data buyers:** brands/suppliers (trade marketing intelligence), real estate investment funds (FIIs) evaluating assets, insurers, trade marketing consultancies, franchisors monitoring franchisees.
