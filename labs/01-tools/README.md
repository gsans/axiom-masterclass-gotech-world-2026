# 01 Tools

An agent with two function tools: `add` and a mock `get_weather`.

Try: `What is 21 + 21?`, `What's the weather in Bucharest?`, `What's the weather in Atlantis?`

Select the tool call in the conversation, then read the details in the Info tab: the arguments the model chose and what your code returned.

## Optional task

Make `add` reject numbers above 1000 with Zod's `.max()`, and give `get_weather` a `unit` input using `z.enum(['C', 'F'])`.

Try: `What is 5000 + 1?`, `What's the weather in Tokyo in Fahrenheit?`
