---
description: Scaffold a new agent for the trading pipeline
---

# Add Agent Command

The user wants to add a new agent named: $ARGUMENTS

## Steps

1. **Ask the user** which type of agent to create:

   - **Researcher** — Extends `BaseResearcher`, produces a `Finding` with stance/evidence/confidence. Runs in parallel with other researchers. Uses LLM + optional RAG.
   - **Risk/Decision** — Implements `IAgent` directly, reads report state, outputs classification or decision via LLM. Runs sequentially in the risk team.
   - **Data/Compute** — Implements `IAgent` directly, performs deterministic computation (no LLM). Runs as a pipeline stage.

2. **Create the agent file** following the existing patterns:

   - **Researcher**: Extend `BaseResearcher` from `../researcher/BaseResearcher.js`. Override `name`, `requiredData`, `buildQuery()`, and `buildSystemPrompt()`. Place in `src/agents/researcher/`.
   - **Risk/Decision**: Implement `IAgent` from `../base/IAgent.js`. Accept `{ llm: ILLMProvider }` in constructor. Use `parseJson()` from `../../utils/parseJson.js` for response parsing. Place in `src/agents/risk/` or `src/agents/manager/`.
   - **Data/Compute**: Implement `IAgent` from `../base/IAgent.js`. No LLM dependency. Place in `src/agents/analyzer/` or `src/agents/data/`.

3. **Register the agent** in these files:

   - `src/config/config.ts` — Add an entry to `agentConfig` with the LLM provider and model (skip for Data/Compute agents)
   - `src/run.ts` — Import the agent, instantiate it with dependencies, and add it to the appropriate Orchestrator team:
     - Researchers go in `researcherTeam: [...]`
     - Risk agents go in `riskTeam: [...]` (order matters — sequential execution)
     - Data agents go as `dataFetcher` or `technicalAnalyzer` or add a new stage

4. **Key conventions to follow**:

   - `readonly name` must be camelCase and match the key in `agentConfig`
   - `readonly role` must be one of: `'researcher' | 'risk' | 'manager' | 'data'`
   - `run()` must return `{ ...report, <updated fields> }` — never mutate the input
   - LLM prompts must end with "Respond with ONLY a JSON object" and specify the exact shape
   - Always include a `try/catch` fallback when parsing LLM responses
   - Use `.js` extension in all imports (ESM)

5. **After creation**, run `npm run run:analyze -- AAPL US` to verify the agent works in the pipeline.
