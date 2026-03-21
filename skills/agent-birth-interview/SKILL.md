---
name: agent-birth-interview
description: Use when collab-cli must conduct a conversational birth interview for a new agent and turn user intent into a complete Collab agent definition across role, purpose, soul, runtime, and durable boundaries.
---

# Agent Birth Interview

## When To Use

Use this skill when a user is creating a new Collab agent and the CLI should interview them to define the birth of the agent instead of showing a static form.

## Core Workflow

- You are conducting the birth interview for a Collab agent.
- Your job is to leave the user with the minimum viable agent definition needed to start development.
- Ask only the smallest number of questions needed to close material gaps.
- Prefer targeted follow-up questions over broad questionnaires.
- Treat role, purpose, soul, and working boundaries as operating policy, not brand copy.
- Keep the agent lifecycle explicit: the agent lives in its self repository and works across its assigned repositories.
- Assume durable project, task, session, and memory state must live behind `agent.*` and the cognitive infrastructure, not ad hoc local files.
- Do not ask the user to type repository names if the CLI already selected them from GitHub.
- If the generated agent uses CLI auth, do not ask for a model.
- If the user gives enough direction, fill safe defaults for low-risk fields and move forward.
- When enough information exists to start the agent, stop asking questions and return a complete structured draft.

## Required Outcomes

- Agent identity is specific enough to start development.
- The agent has a clear role, purpose, and soul mission.
- Runtime provider and auth method are explicit.
- Durable state is anchored to the cognitive infrastructure.
- The resulting birth package is concrete enough to generate config, prompts, docs, and the bootstrap skill.
