---
description: /narrate - Creates or synchronizes the Living Document (docs/LIVING-DOCUMENT.md). Manual fallback for the auto-detection system. Creates the document for greenfield projects, snapshots existing projects for brownfield, and regenerates chapters on demand. Always finalizes with mandatory EPUB generation.
---

# Narrate (Living Document Management)

This workflow manages the creation, synchronization, and regeneration of the Living Document. It is the manual fallback for the auto-detection system defined in `04-documentation.md`. The Living Document is an agent-authored, human-directed pedagogical narrative of the project, structured as a book.

> **MANDATORY:** Before executing ANY mode, the agent reads:
> 1. `.agents/knowledge/narrator-voice.md` (voice protocol with generation constraints)
> 2. `.agents/roles/narrator.md` (narrator voice profile, if it exists)
> 3. `docs/MASTER-SPEC.md` (project specification, if it exists)
> 4. `docs/LIVING-DOCUMENT.md` (current Living Document, if it exists)

## Mode Detection

- **`/narrate` (no Living Document exists):** Genesis mode. Creates the Living Document from scratch.
- **`/narrate` (Living Document already exists):** Synchronization mode. Detects drift between the document and the current project state, then updates affected chapters.
- **`/narrate [chapter]` or `/narrate [topic]`:** Targeted mode. Regenerates or creates a specific chapter.

---

## Genesis Mode (greenfield or first-time brownfield)

Creates `docs/LIVING-DOCUMENT.md` for the first time.

### Step 1: Project Survey

The agent inventories the project to determine what exists:

```
Does the project have implemented code/content?
  YES → Brownfield genesis. The Living Document is a snapshot that teaches
        how the existing project works.
  NO  → Greenfield genesis. The Living Document begins from the declared
        intentions (MASTER-SPEC §1, TODO.md, or user's stated goals).
```

In both cases, the agent initializes `docs/LIVING-DOCUMENT.md` from the canonical skeleton at `.agents/templates/living-document.md`. The system replaces `[Project Name]` with the project's name. The generation instructions inside HTML comments are removed during population.

### Step 2: Chapter Planning

The agent proposes a chapter structure. Chapters are organized by topic, not by chronology. Each chapter should be self-contained but build on previous chapters.

**For brownfield projects:**
Chapters map to the major functional areas of the existing project. Each chapter explains what that area does, why it exists, and how it works.

**For greenfield projects:**
If intentions have been declared (MASTER-SPEC exists, TODO has tasks), chapters map to the planned areas. If the project is empty except for Kairos governance, the first chapter is a prologue explaining what the project intends to become.

The agent presents the chapter plan:

```
Living Document: proposed structure

Chapter 1: [Title] - [One-line description of what it teaches]
Chapter 2: [Title] - [One-line description]
...

Proceed with this structure?
```

The user confirms, modifies, or rejects the plan.

### Step 3: Chapter Generation

For each chapter in the approved plan:

1. **Load voice protocol** from `.agents/knowledge/narrator-voice.md`.
2. **Load narrator role** from `.agents/roles/narrator.md` (if it exists).
3. **Gather source material:** The agent reads the relevant code, configuration, documentation, and commit history for this chapter's topic.
4. **Apply the narrator's reasoning scaffold:**
   - **Situate:** What does the reader currently understand at this point in the book?
   - **Anchor:** Find a concrete analogy or scenario that makes the topic tangible.
   - **Narrate:** Generate prose following the voice protocol constraints. WHY > WHAT > HOW.
5. **Verify output** against all anti-slop constraints (voice protocol Step 3).

### Step 4: Assembly

The generated chapters are assembled into `docs/LIVING-DOCUMENT.md` with:

1. A title derived from the project name or identity.
2. A table of contents listing all chapters.
3. Chapters in the approved order.
4. No metadata headers, no version stamps, no governance markers within the prose. The document reads as a book, not as a Kairos artifact.

### Step 5: EPUB Generation

See **Mandatory EPUB Generation** section below. The system executes it now.

After EPUB generation, the agent reports to the user:

```
Living Document created: docs/LIVING-DOCUMENT.md
EPUB exported: docs/LIVING-DOCUMENT.epub
[N] chapters, [M] words.

The auto-detection system is now active. Future intentions will
trigger chapter updates automatically.

Review the document. If any section doesn't match your expectations,
point me to it and I'll adjust.
```

**The workflow halts. Workflow complete.**

---

## Synchronization Mode

Executes when `/narrate` is invoked and `docs/LIVING-DOCUMENT.md` already exists.

### Step 1: Drift Detection

The agent compares the Living Document's content against the current project state:

1. **Read the existing Living Document** chapter by chapter.
2. **For each chapter,** verify that the explanation still matches reality:
   - Does the described structure still exist?
   - Have new components been added that the chapter does not cover?
   - Have existing components been modified in ways the chapter does not reflect?
   - Has the WHY changed (new decisions, changed constraints, revised goals)?

### Step 2: Drift Report

The agent generates a drift summary:

| Chapter | Status | Drift Description |
|---|---|---|
| [chapter title] | Current / Stale / Missing Coverage | [what changed] |

### Step 3: Update Execution

For each chapter with drift:

1. The agent loads the voice protocol and narrator role.
2. The agent regenerates the stale sections within the chapter, preserving sections that are still current.
3. If new topics exist that do not fit into any existing chapter, the agent proposes a new chapter. The agent awaits user confirmation.
4. The agent verifies all updates against anti-slop constraints.

### Step 4: EPUB Generation

See **Mandatory EPUB Generation** section below. The system executes it now.

After EPUB generation, the agent reports to the user:

```
Living Document synchronized: docs/LIVING-DOCUMENT.md
EPUB exported: docs/LIVING-DOCUMENT.epub
[N] chapters updated, [M] unchanged, [K] new chapters added.
```

**The workflow halts. Workflow complete.**

---

## Targeted Mode

Executes when the user specifies a chapter or topic: `/narrate [chapter/topic]`.

### Step 1: Locate or Create

```
Does the specified chapter/topic exist in the Living Document?
  YES → The system regenerates that chapter from current project state.
  NO  → The system creates a new chapter for the specified topic and inserts it at
        the appropriate position in the book's flow.
```

### Step 2: Generate

1. The agent loads the voice protocol and narrator role.
2. The agent gathers all source material relevant to the specified topic.
3. The agent generates the chapter using the narrator's reasoning scaffold.
4. The agent verifies against anti-slop constraints.
5. If creating a new chapter, the agent updates the table of contents.

### Step 3: EPUB Generation

See **Mandatory EPUB Generation** section below. The system executes it now.

After EPUB generation, the agent reports to the user:

```
Chapter "[Title]" [regenerated / created].
EPUB exported: docs/LIVING-DOCUMENT.epub
```

**The workflow halts. Workflow complete.**

---

## Mandatory EPUB Generation

This step runs at the end of EVERY /narrate execution, in all three modes. It is not optional.

### Prerequisite Check

```
Is pandoc installed? (run: which pandoc)
  YES → The system proceeds.
  NO  → The system runs: sudo apt install pandoc
        If installation fails, the system reports the error and skips EPUB generation.
        The system logs a warning that EPUB was not generated.
```

### Extract Project Title

The system reads the project title from:
1. `docs/MASTER-SPEC.md` §1 Identity section (preferred).
2. The `docs/LIVING-DOCUMENT.md` first `# Heading` (fallback).
3. The repository directory name (last resort).

### Execute Export

```bash
pandoc docs/LIVING-DOCUMENT.md \
  -o docs/LIVING-DOCUMENT.epub \
  --metadata title="[PROJECT TITLE]" \
  --metadata lang="[DETECTED LANGUAGE: en or es]" \
  --css .agents/epub/style.css \
  --toc \
  --toc-depth=2 \
  --epub-chapter-level=2 \
  --split-level=2
```

**Flag rationale:**

| Flag | Effect |
|---|---|
| `--css .agents/epub/style.css` | Applies the Kairos EPUB stylesheet: no hyphenation, page breaks after every h1/h2/h3, anti-muralla spacing, serif typography |
| `--toc` | Generates a navigable table of contents |
| `--toc-depth=2` | TOC shows chapters (h1) and sections (h2) only, not subsections |
| `--epub-chapter-level=2` | Every `##` heading begins a new EPUB chapter/spine item |
| `--split-level=2` | Splits the EPUB file at h1 and h2 boundaries for clean chapter navigation |
| `--metadata lang` | Sets the EPUB language for correct e-reader rendering |

No `--epub-embed-font` is used. The stylesheet's font stack relies on the e-reader's built-in serif fonts for maximum compatibility.

### Verify Export

```
Did pandoc exit with code 0?
  YES → docs/LIVING-DOCUMENT.epub was created. The agent reports to user.
  NO  → The agent reports the pandoc error output. The system does not count the EPUB as generated.
        The Markdown Living Document is still valid. EPUB failure is non-blocking.
```

---

## Subset Classification

- Genesis Mode Steps 1-4: `.LLM` (automated generation). Step 5 presentation: `.MIX` (user reviews and calibrates voice).
- Synchronization Mode Steps 1-3: `.LLM` (automated detection and update). Step 4 presentation: `.MIX` (user validates).
- Targeted Mode: `.LLM` (generation and export).
- Mandatory EPUB Generation: `.LLM` (fully automated, no human action required).
