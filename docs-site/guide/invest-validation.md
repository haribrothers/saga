# INVEST Validation

Saga scores every story against the six INVEST criteria:

| Criterion | What it checks |
|---|---|
| **I**ndependent | The story can be delivered without hard dependencies on other in-flight stories |
| **N**egotiable | The story describes intent, not a rigid spec — room for implementation discussion |
| **V**aluable | Delivers clear value to a user or stakeholder |
| **E**stimable | Enough detail exists to size the work |
| **S**mall | Fits in a single iteration; not a disguised epic |
| **T**estable | Has concrete, verifiable acceptance criteria (Gherkin) |

Validation combines heuristic checks (field presence, AC structure, length) with LLM-assisted judgment for the more subjective criteria.

## Where you see it

- **Sidebar tree** — a badge appears next to each story summarizing pass/fail
- **Generation Review panel** — full per-criterion badges plus specific issues found, with a **Validate All** button
- **Story Editor** — re-run validation after manual edits

## Acting on a failure

- **Fails "Small"** → use [Split Story](/guide/splitting-stories) to break it up
- **Fails "Testable"** → add or tighten Gherkin acceptance criteria
- **Fails "Independent"/"Negotiable"/"Valuable"** → usually needs a manual rewrite or a **Refine** pass with a specific instruction
