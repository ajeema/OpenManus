import asyncio
import json
import logging
import os
import uuid
import re
from typing import Any, Dict, List, Optional

from pydantic import PrivateAttr

# Adjust these imports to your project structure.
from app.agent.toolcall import ToolCallAgent
from app.agent.cot import CoTAgent
from app.schema import Message, AgentState
from app.tool.browser_use_tool import BrowserUseTool
from app.tool.file_saver import FileSaver
from app.tool.python_execute import PythonExecute
from app.tool.str_replace_editor import StrReplaceEditor
from app.tool.terminal import Terminal
from app.tool.web_search import WebSearch
from app.tool.create_chat_completion import CreateChatCompletion
from app.tool.mcp import MCPClients
from app.tool.terminate import Terminate
from app.tool.planning import PlanningTool
from app.tool.base import ToolResult


class UniversalAgent(ToolCallAgent):
    """
    A flexible agent that:
      1. Creates a dynamic, persistent plan based on the user's request (with a unique plan ID).
      2. Progresses sequentially through the plan—covering planning, building, reviewing, and finalizing.
      3. Uses tools and LLM calls to produce output for each step.
      4. Saves the cumulative output in /workspace/<plan_id>/ without hardcoding file names.
    """

    _scratchpad: Dict[str, Any] = PrivateAttr(default_factory=dict)

    def __init__(self, name: str = "FlexibleUniversalAgent", description: Optional[str] = None):
        super().__init__(
            name=name,
            description=description or "A flexible multi-step agent for dynamic output generation.",
            tools=[
                BrowserUseTool(),
                FileSaver(),
                PythonExecute(),
                StrReplaceEditor(),
                Terminal(),
                WebSearch(),
                CreateChatCompletion(),
                MCPClients(),
                Terminate(),
                PlanningTool(),
            ],
            max_steps=30
        )
        self.logger = logging.getLogger("app.agent.flexible")
        self.cot_agent = CoTAgent(
            name="CoTSubAgent",
            description="Sub-agent for reflection and plan generation."
        )
        self._scratchpad["unified_output"] = ""
        self._scratchpad["plan_steps"] = []  # Dynamic list of plan steps
        self._plan_id: Optional[str] = None  # Unique plan id per request
        self.current_plan_step: int = 0
        self.long_term_store: List[str] = []

    async def run(self, prompt: str = None) -> str:
        """
        - Creates a persistent plan based on the prompt (if not already created).
        - Iterates through the plan steps sequentially.
        - Merges each step's output into a unified output.
        - After all steps finish, finalizes by saving the output in /workspace/<plan_id>/.
        """
        if prompt:
            self.memory.add_message(Message.user_message(prompt))
        await self._maybe_create_plan()
        # Loop through all plan steps
        while self.state != AgentState.FINISHED and self.current_plan_step < len(self._scratchpad.get("plan_steps", [])):
            step_text = self._scratchpad["plan_steps"][self.current_plan_step]
            self.logger.info(f"Executing plan step {self.current_plan_step + 1}: {step_text}")
            self.memory.add_message(Message.system_message(
                f"Executing plan step {self.current_plan_step + 1}: {step_text}"
            ))
            step_result = await self._execute_plan_step(step_text)
            self._merge_output(step_result)
            reflection = await self._reflect_on_result(step_result, step_text)
            await self._mark_step_completed(self.current_plan_step)
            self.logger.info(f"Step {self.current_plan_step + 1} result: {step_result}\nReflection: {reflection}")
            self.current_plan_step += 1

        final = await self.finalize_output()
        self.state = AgentState.FINISHED
        return final

    async def finalize_output(self) -> str:
        """
        Saves the cumulative output to a file in /workspace/<plan_id>/.
        """
        saver = self.get_tool("file_saver")
        if not saver:
            msg = "[Error] file_saver tool missing, cannot save final output!"
            self.logger.error(msg)
            return msg

        folder = os.path.join("workspace", self._plan_id if self._plan_id else "default")
        os.makedirs(folder, exist_ok=True)
        # Generate a dynamic filename using the plan id and current timestamp
        final_filename = os.path.join(folder, f"{self._plan_id}_{int(os.times()[4])}.txt")
        unified_output = self._scratchpad.get("unified_output", "")
        if not unified_output.strip():
            return "[Info] No output to save."

        self.logger.info(f"Saving final output to {final_filename} ...")
        result = await self._async_execute(saver, content=unified_output, file_path=final_filename)
        return str(result)

    # ----- Internal Helper Methods -----

    async def _maybe_create_plan(self):
        """
        Creates a dynamic plan based on the user's request using the CoT sub-agent.
        Generates a unique plan ID and stores the plan steps in _scratchpad["plan_steps"].
        """
        if self._plan_id and self._scratchpad.get("plan_steps"):
            return

        planning_tool = self.get_tool("planning")
        if not planning_tool:
            self.logger.warning("No planning tool available; skipping plan creation.")
            return

        user_request = self._get_last_user_request()
        if not user_request:
            self.logger.info("No user request found; cannot create plan.")
            return

        self._plan_id = str(uuid.uuid4())
        prompt = (
            f"Create a multi-step plan for the following task: {user_request}. "
            "Return a JSON object with key 'plan_steps' that is a non-empty list of step descriptions."
        )
        self.cot_agent.memory.add_message(Message.user_message(prompt))
        cot_plan = await self.cot_agent.run() or ""  # Guard against None
        self.logger.info(f"CoT plan result: {cot_plan}")
        try:
            parsed = json.loads(cot_plan)
            steps = parsed.get("plan_steps", [])
            if not (isinstance(steps, list) and steps):
                raise ValueError("No valid plan_steps found")
            plan_steps = [str(step).strip() for step in steps if str(step).strip()]
        except Exception as e:
            self.logger.error(f"Error parsing CoT plan result: {e}")
            # Fallback default plan if CoT fails:
            plan_steps = [
                "Plan the structure and design based on the user's request",
                "Implement the core functionality based on the user's requirements",
                "Test and review the output for correctness",
                "Refine and optimize the implementation",
                "Finalize and save the output"
            ]
        # Call the planning tool to register the plan
        if asyncio.iscoroutinefunction(planning_tool.execute):
            plan_result = await planning_tool.execute(
                command="create",
                plan_id=self._plan_id,
                title=f"Plan for: {user_request}",
                steps=plan_steps,
            )
        else:
            plan_result = await asyncio.to_thread(planning_tool.execute, **{
                "command": "create",
                "plan_id": self._plan_id,
                "title": f"Plan for: {user_request}",
                "steps": plan_steps,
            })
        self.logger.info(f"Plan creation result: {plan_result}")
        self._scratchpad["plan_steps"] = plan_steps
        self.current_plan_step = 0

    async def _mark_step_completed(self, step_index: int) -> None:
        """
        Marks a plan step as completed via the planning tool.
        """
        if step_index is None:
            return

        progress_args = {
            "command": "mark_step",
            "plan_id": self._plan_id,
            "step_index": step_index,
            "step_status": "completed",
        }
        try:
            update = await self._async_execute(self.planning_tool, **progress_args)
            self.logger.info(f"Marked step {step_index + 1} as complete in plan {self._plan_id}: {update}")
        except Exception as e:
            self.logger.warning(f"Failed to update plan status for step {step_index}: {e}")

    def _get_last_user_request(self) -> Optional[str]:
        for msg in reversed(self.memory.messages):
            if msg.role == "user":
                return msg.content
        return None

    async def _execute_plan_step(self, step_text: str) -> str:
        """
        Executes a plan step. If the step text mentions "code", it uses the chat completion tool;
        otherwise, falls back to standard tool execution.
        """
        lower = step_text.lower()
        if "generate code" in lower or "write code" in lower or "code" in lower:
            prompt = f"Generate output for the following step: {step_text}"
            chat_tool = self.get_tool("create_chat_completion")
            if chat_tool:
                output = await self._async_execute(chat_tool, prompt=prompt)
                self.logger.info(f"Generated output: {output}")
                return output
            else:
                return "Error: Chat completion tool not available."
        elif "finalize" in lower:
            final_output = await self.finalize_output()
            return f"Final output saved: {final_output}"
        else:
            return await self._execute_single_step(step_text)

    async def _execute_single_step(self, text: str) -> str:
        """
        Interprets the given text as an instruction for a tool and executes it.
        """
        tool, args = self._interpret_tool_usage(text)
        if tool:
            self.logger.info(f"Using tool: {tool.name} with arguments: {args}")
            outcome = await self._async_execute(tool, **args)
            outcome_str = str(outcome) if isinstance(outcome, ToolResult) else str(outcome)
            self.memory.add_message(Message.system_message(f"Tool {tool.name} executed: {outcome_str}"))
            if tool.name.lower() == "terminate":
                await self._cleanup_browser_tool()
                self.state = AgentState.FINISHED
            return outcome_str
        else:
            self.handle_stuck_state()
            return "No valid tool selected. Possibly stuck."

    async def _async_execute(self, tool, **kwargs):
        """
        Calls a tool's execute method asynchronously. If it's not a coroutine, runs it in a thread.
        """
        if tool is None:
            self.logger.error("No valid tool provided to execute.")
            return ""
        if not hasattr(tool, "execute") or not callable(tool.execute):
            self.logger.error(f"Tool {tool} does not have a callable execute method.")
            return ""
        if not asyncio.iscoroutinefunction(tool.execute):
            return await asyncio.to_thread(tool.execute, **kwargs)
        return await tool.execute(**kwargs)

    def _merge_output(self, text: str):
        """
        Merges the output from a step into the unified output buffer.
        """
        blocks = self._extract_code_blocks(text)
        if blocks:
            for block in blocks:
                self._scratchpad["unified_output"] += f"\n\n# [CODE BLOCK]\n{block}\n# [END CODE BLOCK]\n"
            self.logger.info(f"Merged {len(blocks)} code block(s) into unified output.")
        else:
            self._scratchpad["unified_output"] += "\n" + text

    def _extract_code_blocks(self, text: str) -> List[str]:
        pattern = re.compile(r"```(?:[\w+-]+)?\s*(.*?)```", re.DOTALL)
        return [match.strip() for match in pattern.findall(text)]

    async def _reflect_on_result(self, step_result: str, step_desc: str) -> str:
        prompt = f"Reflect on the step: '{step_desc}'. The outcome was: '{step_result}'. What improvements or next steps do you suggest?"
        self.cot_agent.memory.add_message(Message.user_message(prompt))
        reflection = await self.cot_agent.run() or ""
        return reflection.strip()

    def _interpret_tool_usage(self, text: str):
        tool_name, args = self._extract_tool_json(text)
        if tool_name:
            found_tool = self.get_tool(tool_name)
            if found_tool:
                return found_tool, args
        return self._fallback_tool_selection(text)

    def _extract_tool_json(self, text: str):
        pattern = r'{\"tool\":.*?}'
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                return data.get("tool"), data.get("args", {})
            except json.JSONDecodeError:
                pass
        return None, {}

    def _fallback_tool_selection(self, text: str):
        lower_text = text.lower()
        if "browse" in lower_text or "visit" in lower_text:
            return self.get_tool("browser_use"), {"action": "go_to_url", "url": self._extract_url(text)}
        elif "run python" in lower_text or "execute code" in lower_text:
            return self.get_tool("python_execute"), {"code": "print('Fallback execution')"}
        elif "search web" in lower_text or "google" in lower_text:
            return self.get_tool("web_search"), {"query": "fallback search"}
        elif "save file" in lower_text or "write file" in lower_text:
            path = os.path.join("workspace", self._plan_id if self._plan_id else "default", "fallback_save.txt")
            return self.get_tool("file_saver"), {"content": self._scratchpad["unified_output"], "file_path": path}
        elif "terminate" in lower_text or "finish" in lower_text:
            return self.get_tool("terminate"), {"status": "success"}
        return None, {}

    def get_tool(self, name: Optional[str]):
        if not name:
            return None
        name = name.lower()
        for tool in self.tools:
            if hasattr(tool, "execute") and callable(tool.execute) and tool.name.lower() == name:
                return tool
        return None

    def _extract_url(self, text: str) -> str:
        match = re.search(r"(https?://\S+)", text)
        return match.group(1) if match else "https://www.example.com"
