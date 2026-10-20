---
name: standard-research
description: Activates when the agent is about to recommend a framework, tool, technical practice, or methodology that might be outdated or where the model's training data might be stale. Also activates within /fix (Phase 3).
---

# Standards Research

The model's training data has a cutoff date. In technology, a 12-18 month gap can mean deprecation or a radical shift in best practices. Technological recommendations are based exclusively on dated and verified sources. The model's training data is insufficient for stack recommendations.

## Procedure

### 1. Controlled Ignorance Declaration (Internal)

Before recommending a technology, the system declares internally: "My knowledge of [topic] has an estimated cutoff date. Verification is required." This silent cognitive trigger operates entirely internally and is not communicated to the user.

### 2. Mandatory Searches

**Search 1 (current state):**
`"[technology/practice] best practices [current year]"`

**Search 2 (comparative):**
`"[technology] vs [alternatives] [current year] [project context]"`

**Search 3 (critical):**
`"[technology] problems issues deprecated [current year]"`

**Search 4 (migration, if applicable):**
`"[current technology] migration to [alternatives] [current year]"`

### 3. Source Quality

**Accepted (in order of preference):**
1. Official documentation and changelogs (date stamp required)
2. Recognized engineering blogs (Stripe, Shopify, GitHub, Cloudflare), last 12 months
3. State of JS/CSS/DB (annual surveys)
4. HackerNews or Reddit r/programming threads with verifiable dates
5. Medium/Dev.to articles only if they have a verifiable date and high engagement

**Rejected:**
- Internal knowledge without external verification
- Sources without a verifiable date
- Sources >24 months old for rapidly evolving topics

### 4. Triangulation

The research triangulates a minimum of 2 independent sources dated within the last 12 months. If two sources contradict, the contradiction is explicitly declared: "Source A says [X], Source B says [Y]. The contradiction arises from [reason]. For this context, I recommend [X] because [justification]."

### 5. Presentation

Research is presented in the format that best serves the user's expressed intention. The fixed data point, regardless of presentation format: each source includes a URL with the access date. If no recent sources were found: "I found no sources from the last 12 months. My recommendation is based on knowledge with a lag of [X months]. Manual verification is required before implementation."

## Activation Limits

- **The skill is omitted completely** for purely conceptual questions or language syntax that does not involve evolving ecosystems (e.g., "how does a `for` loop work in Python").
- **The system reduces searches to 2 (current state + critical)** for binary decisions between mature, stable technologies (e.g., "Flask vs FastAPI", "PostgreSQL vs MySQL").
- **The system executes all 4 searches** ONLY for full stack evaluations, emerging technologies, or radical architectural shifts.
