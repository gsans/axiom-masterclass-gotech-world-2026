# 04 Deep Research (exercise)

Build a basic version of the Gemini app's Deep Research: **plan, search, write a cited report in Markdown**.

The planner already works. Complete the three TODOs in `agent.ts`.

Try: `How do MCP and A2A differ?`

Done when the State tab shows `research_plan`, `research_notes` and `final_report`, and the report is Markdown with a Sources list. Search results are mocked, so sources start with `mock://`.

Stuck? Don't worry: the full solution is published after the exercise, so you can `git pull` and carry on.

## Optional task

Once the pipeline works, add a `max_results` input (1 to 3) to `web_search` in `search-server.ts`, and tell the researcher to use 2.

Check the tool results in the Events tab: each search should return at most 2 pages.
