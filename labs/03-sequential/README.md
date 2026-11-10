# 03 Sequential

Three agents run in a fixed order and pass results through session state.

Try: `Compare London and Bucharest`

Open the State tab and watch `weather_report` and `total_temp` appear.

## Optional task

Add a condition in code. Have `weather_agent` write `NO_DATA` for an unknown city, then use `beforeAgentCallback` on the calculator and reporter to skip them when `weather_report` contains `NO_DATA`. Returning content from the callback skips the agent; returning `undefined` lets it run.

Try: `Compare London and Atlantis`
