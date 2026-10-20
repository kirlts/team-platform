# MASTER-SPEC: [Project Name] v0.1.0

> [One-line project description]

---

## §1. Project Identity

**Purpose:** [What it does, for whom, and why it matters. Not as an elevator pitch; as an intention statement that a contributor can use to make decisions without asking.]

**Name:** [Project Name]

**Domain:** [Problem category: e.g., "Data Security", "Education", "RegTech"]

**Problem it solves:** [What friction, inefficiency, or concrete need this project attacks. A person unfamiliar with the project should be able to understand the pain it alleviates.]

**Direct beneficiary:** [Who receives concrete value from this project. Not "users" in the abstract; the specific entity whose situation improves.]

**Indirect beneficiary:** [If applicable: who benefits as a secondary consequence.]

**What it IS NOT:** [What this project does NOT attempt to be. This protects the scope from unintended expansion. If there are no scope constraints, the statement "No defined scope constraints." is written.]

---

## §2. Architecture

**Type:** [Zero-backend / Client-Server / Monolith / Microservices / etc.]

**Component Diagram:**

```
[Component A] → [Component B] → [Component C]
```

**Main Data Flow:**

1. [Step 1]
2. [Step 2]
3. [Step N]

---

## §3. Technical Stack

| Layer | Technology | Justification |
| --- | --- | --- |
| Frontend | [e.g., React + Vite] | [why this and not another] |
| Backend | [e.g., Zero-backend] | [why] |
| Data | [e.g., IndexedDB] | [why] |
| Hosting | [e.g., GitHub Pages] | [why] |

---

## §4. Constraints (Inviolable Boundaries)

> These constraints override any other decision. They are lines that the system prevents from being crossed.

1. [e.g., Zero user data transmission outside the browser]
2. [e.g., Compatibility with Chrome, Firefox, and Safari]
3. [constraint N]

---

## §5. Agreed Trade-offs

> Decisions where one quality was sacrificed in favor of another, with the explicit reason.

| Trade-off | In favor of | Against | Justification |
| --- | --- | --- | --- |
| [e.g., Bundle size vs functionality] | [Functionality] | [Bundle size] | [why this was chosen] |

---

## §6. UI and User Experience

**Reference atmosphere:** [Description of the desired "feel". Not generic adjectives ("modern", "clean"); concrete referents, colors, sensations, analogies.]

**Main user flow:**

1. [Step 1]
2. [Step 2]
3. [Step N]

**Interface components:**

| Component | Function | File |
| --- | --- | --- |
| [e.g., DropZone] | [e.g., File upload area] | [e.g., src/components/DropZone.tsx] |

---

## §7. Module Specifications

> Technical detail of each module or critical system component.

### 7.1. [Module Name]

**Purpose:** [what it does and why it exists as a separate module]

**Interface:**

```
[function/API/endpoint signature]
```

**Dependencies:** [dependency list]

---

## §8. Operational Rules

> How the AI agent operates within this repository.

**Rules location:** [One of the following]
- `docs/RULES.md`
- [Custom path or system description]
- No operational rules defined for this repository.

**Scope:** [When do the rules apply? Examples: "All file modifications",
"Only changes to src/", "Only database migrations". If no scope is defined,
rules apply to all agent operations.]
