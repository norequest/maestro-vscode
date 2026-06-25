# Third-Party Notices

Hallucinate includes software from third parties. The notices below are reproduced
to satisfy the attribution and license-notice requirements of the upstream
projects. Each notice travels with the copies of the corresponding material that
Hallucinate ships.

## wshobson/agents

- Project: wshobson/agents
- Homepage: https://github.com/wshobson/agents
- Upstream path: `plugins/agent-teams/skills/`
- License: MIT

Hallucinate vendors and adapts a small set of agent-coordination skills from
wshobson/agents. The adapted copies are rewritten to fit Hallucinate's engine model
(worktree-isolated CLI workers coordinated through a lead), so they are
derivative works rather than verbatim copies. Because they derive from the
upstream MIT-licensed material, the upstream copyright notice and the full MIT
license text below are included and must travel with these copies.

The adapted skills derived from wshobson/agents are:

- `task-coordination-strategies`
- `team-communication-protocols`
- `team-composition-patterns`

These ship in the repository under:

- `packages/config/src/vendored-skills.ts` (the canonical adapted skill bodies)
- `packages/extension/.hallucinate/skills/<skill>/SKILL.md`
- `packages/extension/.github/skills/<skill>/SKILL.md`

### MIT License (wshobson/agents)

```
MIT License

Copyright (c) 2024 Seth Hobson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
