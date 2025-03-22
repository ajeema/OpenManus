import asyncio
import os
import threading
import tomllib
import uuid
import webbrowser
import json
import re
import subprocess
import sys
from datetime import datetime
from functools import partial
from json import dumps
from pathlib import Path
from typing import Dict, List, DefaultDict
from collections import defaultdict
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

from app.schema import Message
from app.logger import logger
from app.flow.planning import PlanningFlow
from app.agent.manus import Manus
from app.flow.flow_factory import FlowFactory
from app.flow.base import FlowType

import httpx
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

app = FastAPI(
    title="Manus Backend",
    description="Backend API for the Manus autonomous AI agent",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:8000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
FRONTEND_URL = "http://localhost:3000"
BACKEND_API_PREFIX = "/api"

# Task Model
class Step(BaseModel):
    id: int
    description: str
    status: str = "pending"  # pending, running, completed, failed
    result: str = ""

class Plan(BaseModel):
    steps: List[Step] = []

class Task(BaseModel):
    id: str
    prompt: str
    created_at: datetime
    status: str
    steps: List[Dict] = []
    plan: Plan = Plan()
    token_usage: Dict[str, int] = {"total_input_tokens": 0, "total_completion_tokens": 0}
    execution_time: float = 0.0
    project_path: str = ""
    language: str = ""  # e.g., "python", "javascript"

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        data["created_at"] = self.created_at.isoformat()
        return data

class FileManager:
    def __init__(self, base_dir="workspace"):
        self.base_dir = base_dir
        if not os.path.exists(self.base_dir):
            os.makedirs(self.base_dir)

    def create_project_dir(self, project_id: str) -> str:
        project_path = os.path.join(self.base_dir, project_id)
        if not os.path.exists(project_path):
            os.makedirs(project_path)
        return project_path

    def create_folder_structure(self, project_path: str, structure: dict):
        for folder, contents in structure.items():
            folder_path = os.path.join(project_path, folder)
            os.makedirs(folder_path, exist_ok=True)
            if isinstance(contents, dict):
                self.create_folder_structure(folder_path, contents)
            elif isinstance(contents, list):
                for file_info in contents:
                    if isinstance(file_info, dict) and "name" in file_info and "content" in file_info:
                        file_path = os.path.join(folder_path, file_info["name"])
                        with open(file_path, "w") as f:
                            f.write(file_info["content"])
                    elif isinstance(file_info, str):
                        with open(os.path.join(folder_path, "README.md"), "w") as f:
                            f.write(f"# {folder.capitalize()}\n\n{file_info}")

    def determine_file_location(self, project_path: str, filename: str, content: str) -> str:
        ext = os.path.splitext(filename)[1].lower()
        if ext in ['.py', '.js', '.ts', '.cpp', '.java']:
            return os.path.join(project_path, "src", filename)
        elif ext in ['.test.js', '.test.py', '_test.py', '.spec.js']:
            return os.path.join(project_path, "tests", filename)
        elif ext in ['.md', '.txt', '.pdf']:
            return os.path.join(project_path, "docs", filename)
        elif ext in ['.json', '.yaml', '.toml', '.ini']:
            return os.path.join(project_path, "config", filename)
        elif ext in ['.jpg', '.png', '.gif', '.svg']:
            return os.path.join(project_path, "assets", filename)
        elif ext in ['.html', '.css']:
            return os.path.join(project_path, "static", filename)
        else:
            return os.path.join(project_path, "utils", filename)

    def write_file(self, project_path: str, file_path: str, content: str):
        full_path = self.determine_file_location(project_path, file_path, content) if "/" not in file_path else os.path.join(project_path, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
        return full_path

    def read_file(self, project_path: str, file_path: str) -> str:
        full_path = os.path.join(project_path, file_path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"File {full_path} does not exist")
        with open(full_path, "r") as f:
            return f.read()

    def update_file(self, project_path: str, file_path: str, new_content: str):
        full_path = os.path.join(project_path, file_path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"File {full_path} does not exist")
        with open(full_path, "w") as f:
            f.write(new_content)
        return full_path

class TaskManager:
    def __init__(self):
        self.tasks: Dict[str, Task] = {}
        self.queues: Dict[str, asyncio.Queue] = {}
        self.task_files: DefaultDict[str, list] = defaultdict(list)
        self.file_manager = FileManager()

    async def track_file(self, task_id: str, file_path: str):
        self.task_files[task_id].append(file_path)
        await self.update_task_step(task_id, 0, f"Updated {file_path}", "file_update")

    def create_task(self, prompt: str) -> Task:
        task_id = str(uuid.uuid4())
        project_path = self.file_manager.create_project_dir(task_id)
        task = Task(
            id=task_id,
            prompt=prompt,
            created_at=datetime.now(),
            status="pending",
            project_path=project_path
        )
        self.tasks[task_id] = task
        self.queues[task_id] = asyncio.Queue()
        return task

    async def update_task_step(self, task_id: str, step: int, result: str, step_type: str = "step"):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.steps.append({"step": step, "result": result, "type": step_type})
            await self.queues[task_id].put({"type": step_type, "step": step, "result": result})
            await self._update_status(task_id)

    async def update_plan_step(self, task_id: str, step_id: int, status: str, result: str = ""):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            for step in task.plan.steps:
                if step.id == step_id:
                    step.status = status
                    step.result = result
                    break
            await self.queues[task_id].put({"type": "plan", "plan": task.plan.dict()})
            await self._update_status(task_id)

    async def update_token_usage(self, task_id: str, token_usage: Dict[str, int]):
        if task_id in self.tasks:
            self.tasks[task_id].token_usage = token_usage
            await self._update_status(task_id)

    async def update_execution_time(self, task_id: str, execution_time: float):
        if task_id in self.tasks:
            self.tasks[task_id].execution_time = execution_time
            await self._update_status(task_id)

    async def complete_task(self, task_id: str):
        if task_id in self.tasks:
            self.tasks[task_id].status = "completed"
            await self._update_status(task_id)
            await self.queues[task_id].put({"type": "complete"})

    async def fail_task(self, task_id: str, error: str):
        if task_id in self.tasks:
            self.tasks[task_id].status = f"failed: {error}"
            await self.queues[task_id].put({"type": "error", "message": error})

    async def _update_status(self, task_id: str):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            await self.queues[task_id].put({
                "type": "status",
                "status": task.status,
                "steps": task.steps,
                "plan": task.plan.dict(),
                "token_usage": task.token_usage,
                "execution_time": task.execution_time,
            })

task_manager = TaskManager()

# API Endpoints
@app.get("/download")
async def download_file(file_path: str):
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=os.path.basename(file_path))

@app.post("/api/tasks")
async def create_task(prompt: str = Body(..., embed=True)):
    print(f"Received POST /api/tasks with prompt: {prompt}")
    if not prompt or not isinstance(prompt, str):
        raise HTTPException(status_code=400, detail="Prompt must be a non-empty string")
    try:
        task = task_manager.create_task(prompt)
        asyncio.create_task(run_task(task.id, prompt))
        return {"task_id": task.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")

@app.get("/api/tasks")
async def get_tasks():
    sorted_tasks = sorted(task_manager.tasks.values(), key=lambda task: task.created_at, reverse=True)
    return JSONResponse(content=[task.model_dump() for task in sorted_tasks])

@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_manager.tasks[task_id]

@app.get("/api/tasks/{task_id}/plan")
async def get_task_plan(task_id: str):
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = task_manager.tasks[task_id]
    from app.flow.planning import PlanningFlow
    from app.agent.manus import Manus
    from app.flow.flow_factory import FlowFactory
    from app.flow.base import FlowType

    agents = {"manus": Manus()}
    flow = FlowFactory.create_flow(flow_type=FlowType.PLANNING, agents=agents)

    system_message = Message.system_message(
        "You are a planning assistant. Create a concise, actionable plan with clear steps. "
        "Focus on key milestones rather than detailed sub-steps. "
        "Analyze the request and create steps that are appropriate for the specific task."
    )

    user_message = Message.user_message(
        f"Create a reasonable plan with clear steps to accomplish this task: {task.prompt}"
    )

    response = await flow.llm.ask(
        messages=[user_message],
        system_msgs=[system_message]
    )

    steps = [step.strip() for step in response.split('\n') if step.strip()]

    await flow.planning_tool.execute(
        command="create",
        plan_id=flow.active_plan_id,
        title=f"Plan for: {task.prompt}",
        steps=steps
    )

    @app.post("/api/tasks/{task_id}/mark_step")
    async def mark_plan_step(task_id: str, step_index: int, status: str):
        if task_id not in task_manager.tasks:
            raise HTTPException(status_code=404, detail="Task not found")

        try:
            flow = FlowFactory.create_flow(flow_type=FlowType.PLANNING, agents={"manus": Manus()})
            result = await flow.planning_tool.execute(
                command="mark_step",
                plan_id=flow.active_plan_id,
                step_index=step_index,
                step_status=status
            )
            return {"success": True, "plan": result.output}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    if flow.planning_tool and flow.active_plan_id:
        return flow.planning_tool.plans.get(flow.active_plan_id, {"error": "No active plan found"})
    return {"error": "No active plan found"}

@app.get("/api/tasks/{task_id}/events")
async def task_events(task_id: str):
    async def event_generator():
        if task_id not in task_manager.queues:
            yield f"event: error\ndata: {dumps({'message': 'Task not found'})}\n\n"
            return

        queue = task_manager.queues[task_id]
        task = task_manager.tasks.get(task_id)
        if task:
            yield f"event: status\ndata: {dumps(task.model_dump())}\n\n"

        while True:
            try:
                event = await queue.get()
                formatted_event = dumps(event)
                yield ": heartbeat\n\n"
                if event["type"] == "complete":
                    yield f"event: complete\ndata: {formatted_event}\n\n"
                    break
                elif event["type"] == "error":
                    yield f"event: error\ndata: {formatted_event}\n\n"
                    break
                elif event["type"] in ["think", "tool", "act", "run", "plan", "status"]:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
                else:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
            except asyncio.CancelledError:
                print(f"Client disconnected for task {task_id}")
                break
            except Exception as e:
                print(f"Error in event stream for task {task_id}: {str(e)}")
                yield f"event: error\ndata: {dumps({'message': str(e)})}\n\n"
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )

@app.get("/api/config")
async def get_config():
    root_dir = Path(__file__).parent
    config_dir = root_dir / "config"
    config_path = config_dir / "config.toml"
    example_config_path = config_dir / "config.example.toml"

    try:
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                return JSONResponse({"content": f.read(), "source": "config.toml"})
        elif example_config_path.exists():
            with open(example_config_path, "r", encoding="utf-8") as f:
                return JSONResponse({"content": f.read(), "source": "config.example.toml"})
        else:
            return JSONResponse(
                status_code=404,
                content={"error": f"No config.toml or config.example.toml found in {config_dir}"}
            )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Failed to read config: {str(e)}"})

@app.post("/api/config")
async def save_config(request: Request):
    config_path = Path("config/config.toml")
    try:
        content = await request.json()
        os.makedirs(config_path.parent, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(content["content"])
        return JSONResponse({"status": "success"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save config: {str(e)}")

# Task Execution
async def run_task(task_id: str, prompt: str):
    try:
        print(f"Starting task {task_id} with prompt: {prompt}")
        start_time = datetime.now()
        task_manager.tasks[task_id].status = "running"
        await task_manager._update_status(task_id)

        # Step 1: Initialize Agents and Flow
        from app.agent.manus import Manus
        from app.agent.swe import SWEAgent
        from app.agent.browser import BrowserAgent
        from app.agent.planning import PlanningAgent
        from app.flow.flow_factory import FlowFactory
        from app.flow.base import FlowType

        # Agent selection
        prompt_lower = prompt.lower()
        active_agents = {}
        task_needs = {}

        if any(keyword in prompt_lower for keyword in ['code', 'program', 'implement', 'write']):
            agent = SWEAgent(name="SWE", description="A software engineering agent focused on coding tasks")
            active_agents['swe'] = agent
            task_needs['code'] = True
        elif any(keyword in prompt_lower for keyword in ['browse', 'search', 'navigate', 'website']):
            agent = BrowserAgent(name="Browser", description="A browser-focused agent for web interactions")
            active_agents['browser'] = agent
        elif any(keyword in prompt_lower for keyword in ['plan', 'organize', 'structure']):
            agent = PlanningAgent(name="Planner", description="A planning-focused agent for structured task execution")
            active_agents['planner'] = agent
        else:
            agent = Manus(name="Manus", description="A versatile agent that can solve various tasks using multiple tools")
            active_agents['manus'] = agent

        # Initialize planning flow
        planning_flow = FlowFactory.create_flow(flow_type=FlowType.PLANNING, agents=active_agents)

        # Step 2: Determine the Programming Language
        lang_prompt = f"""
        Based on the task: '{prompt}', determine the primary programming language to use.
        Respond with the language name in lowercase (e.g., 'python', 'javascript', 'java').
        """
        from app.llm import LLM
        llm = LLM()
        language = await llm.ask(
            messages=[Message.user_message(lang_prompt)],
            system_msgs=[Message.system_message("You are a language identifier for software projects.")],
            temperature=0.1
        )
        language = language.strip().lower()
        task_manager.tasks[task_id].language = language
        await task_manager.update_task_step(task_id, 0, f"Determined language: {language}", "log")

        # Step 3: Create a Plan
        await task_manager.update_task_step(task_id, 0, "Creating a plan for the task...", "log")
        system_message = Message.system_message(
            "You are a planning assistant. Create a concise, actionable plan with clear steps. "
            "Focus on key milestones rather than detailed sub-steps. "
            "Analyze the request and create steps that are appropriate for the specific task."
        )
        user_message = Message.user_message(
            f"Create a reasonable plan with clear steps to accomplish this task: {prompt}"
        )
        response = await planning_flow.llm.ask(
            messages=[user_message],
            system_msgs=[system_message]
        )
        steps = [step.strip() for step in response.split('\n') if step.strip()]
        plan_steps = [Step(id=i+1, description=step) for i, step in enumerate(steps)]
        task_manager.tasks[task_id].plan.steps = plan_steps
        await task_manager.update_plan_step(task_id, 0, "completed", "Plan created")
        await task_manager._update_status(task_id)

        # Step 4: Create Folder Structure
        task_workspace = task_manager.tasks[task_id].project_path
        structure_prompt = f"""
        Create a JSON object for a project folder structure based on this request: {prompt}
        The primary programming language is: {language}

        Rules:
        1. Response must be valid JSON
        2. Each key is a folder name
        3. Each value is either a string description or nested object
        4. No comments or extra text

        Example format:
        {{
            "src": "Source code files",
            "docs": {{
                "api": "API documentation",
                "guides": "User guides"
            }}
        }}
        """
        try:
            structure_response = await llm.ask(
                messages=[Message.user_message(structure_prompt)],
                system_msgs=[Message.system_message(
                    "You are a project architect that outputs only valid JSON folder structures."
                )],
                temperature=0.1
            )
            cleaned_response = structure_response.strip()
            if not cleaned_response.startswith('{'):
                cleaned_response = cleaned_response[cleaned_response.find('{'):]
            if not cleaned_response.endswith('}'):
                cleaned_response = cleaned_response[:cleaned_response.rfind('}') + 1]
            folders = json.loads(cleaned_response)
        except Exception as e:
            logger.error(f"Failed to get folder structure from LLM: {e}")
            folders = {
                "src": "Source code files",
                "tests": "Test files",
                "docs": "Documentation",
                "config": "Configuration files",
                "assets": "Static assets",
                "static": "Static files (HTML, CSS)" if language == "javascript" else "Static files"
            }

        task_manager.file_manager.create_folder_structure(task_workspace, folders)
        await task_manager.update_task_step(task_id, 0, "Created project folder structure", "log")
        task_manager.task_files[task_id].extend([os.path.join(task_workspace, folder) for folder in folders.keys()])

        # Step 5: Execute the Plan
        action_history = []
        MAX_RETRIES = 3
        dependencies = []  # Track dependencies for documentation

        for step in task_manager.tasks[task_id].plan.steps:
            step_id = step.id
            await task_manager.update_plan_step(task_id, step_id, "running")
            await task_manager.update_task_step(task_id, step_id, f"Executing step {step_id}: {step.description}", "log")

            success, step_deps = await execute_step(agent, task_id, step, task_manager.file_manager, active_agents, prompt, language)
            if not success:
                action_key = f"{step.description}"
                action_history.append(action_key)
                if action_history.count(action_key) >= MAX_RETRIES:
                    error_message = f"Task stuck in a loop: Repeated step '{step.description}' {MAX_RETRIES} times."
                    await task_manager.fail_task(task_id, error_message)
                    return
                await task_manager.update_plan_step(task_id, step_id, "failed", "Step execution failed")
                await task_manager.fail_task(task_id, f"Step {step_id} failed: {step.description}")
                return

            dependencies.extend(step_deps)
            await task_manager.update_plan_step(task_id, step_id, "completed", "Step completed successfully")

        # Step 6: Finalize and Document
        doc_content = [
            "# Project Documentation\n",
            f"## Overview\n{prompt}\n",
            "## Structure\n",
            "\n".join([f"- {folder}" for folder in folders.keys()]),
            "## Requirements\n",
            f"### Language\n- {language.capitalize()}\n",
            "### Dependencies\n",
            "\n".join([f"- {dep}" for dep in set(dependencies)]) if dependencies else "- None",
            f"\n### Installation\n",
            f"1. Install {language.capitalize()} if not already installed.\n",
            "2. Install dependencies:\n",
            f"   - For Python: `pip install {' '.join(set(dependencies))}`\n" if language == "python" and dependencies else "",
            f"   - For JavaScript: `npm install` (see `package.json`)\n" if language == "javascript" and dependencies else "",
            "## Setup Instructions\n",
            f"1. Clone or download this project.\n",
            f"2. Navigate to the project directory: `cd {task_workspace}`\n",
            f"3. Install dependencies as listed above.\n",
            "## Usage\n",
            f"1. Run the main script:\n",
            f"   - For Python: `python src/main.py`\n" if language == "python" else "",
            f"   - For JavaScript: `node src/main.js` or open `index.html` in a browser\n" if language == "javascript" else "",
            "## Testing\n",
            f"1. Run tests:\n",
            f"   - For Python: `pytest tests/`\n" if language == "python" else "",
            f"   - For JavaScript: `npm test`\n" if language == "javascript" else "",
        ]
        doc_path = os.path.join(task_workspace, "README.md")
        with open(doc_path, "w") as f:
            f.write("\n".join(doc_content))
        await task_manager.track_file(task_id, doc_path)

        execution_time = (datetime.now() - start_time).total_seconds()
        await task_manager.update_execution_time(task_id, execution_time)

        if hasattr(agent, 'llm') and hasattr(agent.llm, 'total_tokens'):
            await task_manager.update_token_usage(task_id, {
                "total_input_tokens": agent.llm.input_tokens,
                "total_completion_tokens": agent.llm.completion_tokens,
                "total": agent.llm.total_tokens
            })

        await task_manager.complete_task(task_id)

    except Exception as e:
        error_message = f"Task execution failed: {str(e)}"
        print(f"Task {task_id} failed: {error_message}")
        await task_manager.fail_task(task_id, error_message)

async def execute_step(agent, task_id: str, step: Step, file_manager: FileManager, active_agents: dict, prompt: str, language: str) -> tuple[bool, list]:
    task = task_manager.tasks[task_id]
    project_path = task.project_path
    dependencies = []

    async def on_think(thought):
        await task_manager.update_task_step(task_id, step.id, thought, "think")

    async def on_tool_execute(tool, input):
        await task_manager.update_task_step(
            task_id, step.id, f"Executing tool: {tool}\nInput: {input}", "tool"
        )

    async def on_action(action):
        await task_manager.update_task_step(
            task_id, step.id, f"Executing action: {action}", "act"
        )

    async def on_run(step_num, result):
        await task_manager.update_task_step(task_id, step.id, result, "run")
        return True

    # Use the LLM to interpret the step and decide how to execute it
    step_description = step.description.lower()

    # Step 1: Determine the action type using the LLM
    action_prompt = f"""
    Analyze the following step in the context of the task: '{prompt}'
    Step: '{step.description}'
    Language: '{language}'

    Determine the type of action required for this step. Respond with one of the following action types:
    - 'install_dependencies': Install required libraries or dependencies.
    - 'generate_code': Generate code or scripts.
    - 'execute_code': Execute a script or program.
    - 'generate_tests': Generate test files.
    - 'run_tests': Run tests.
    - 'edit_code': Edit existing code to add features or fix bugs.
    - 'generate_documentation': Generate documentation (e.g., README).
    - 'generic': Perform a generic action (e.g., research, analysis).

    Respond with only the action type, nothing else.
    """
    from app.llm import LLM
    llm = LLM()
    action_type = await llm.ask(
        messages=[Message.user_message(action_prompt)],
        system_msgs=[Message.system_message("You are an action classifier for task steps.")],
        temperature=0.1
    )
    action_type = action_type.strip()

    # Step 2: Execute the step based on the action type
    if action_type == "install_dependencies":
        try:
            dep_prompt = f"""
            Based on the task: '{prompt}', and the language: '{language}',
            identify the dependencies required for the project.
            Respond with a JSON object in the following format:
            {{
                "dependencies": ["dependency1", "dependency2"],
                "dependency_file": "requirements.txt"  // or "package.json" for JavaScript
            }}
            """
            dep_response = await llm.ask(
                messages=[Message.user_message(dep_prompt)],
                system_msgs=[Message.system_message("You are a dependency identifier for software projects.")],
                temperature=0.1
            )
            dep_info = json.loads(dep_response.strip())
            dependencies = dep_info.get("dependencies", [])
            dep_file = dep_info.get("dependency_file", "requirements.txt" if language == "python" else "package.json")

            if language == "python":
                # Install dependencies and create requirements.txt
                for dep in dependencies:
                    try:
                        subprocess.check_call([sys.executable, "-m", "pip", "install", dep])
                        await task_manager.update_task_step(task_id, step.id, f"Successfully installed {dep}", "log")
                    except Exception as e:
                        await task_manager.update_task_step(task_id, step.id, f"Failed to install {dep}: {str(e)}", "error")
                        return False, dependencies
                # Create requirements.txt
                req_path = file_manager.write_file(project_path, "requirements.txt", "\n".join(dependencies))
                await task_manager.track_file(task_id, req_path)
            elif language == "javascript":
                # Create package.json and install dependencies
                package_json = {
                    "name": "project",
                    "version": "1.0.0",
                    "dependencies": {dep: "latest" for dep in dependencies},
                    "scripts": {
                        "start": "node src/main.js",
                        "test": "jest"
                    }
                }
                pkg_path = file_manager.write_file(project_path, "package.json", json.dumps(package_json, indent=2))
                await task_manager.track_file(task_id, pkg_path)
                try:
                    subprocess.check_call(["npm", "install"], cwd=project_path)
                    await task_manager.update_task_step(task_id, step.id, "Successfully installed JavaScript dependencies", "log")
                except Exception as e:
                    await task_manager.update_task_step(task_id, step.id, f"Failed to install JavaScript dependencies: {str(e)}", "error")
                    return False, dependencies

            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to identify/install dependencies: {str(e)}", "error")
            return False, dependencies

    elif action_type == "generate_code":
        try:
            code_prompt = f"""
            Based on the task: '{prompt}', the step: '{step.description}', and the language: '{language}',
            determine the appropriate filename and content for the code to be generated.
            Respond with a JSON object in the following format:
            {{
                "filename": "example.{language == 'python' and 'py' or 'js'}",
                "content": "print('Hello, World!')"
            }}
            """
            code_response = await llm.ask(
                messages=[Message.user_message(code_prompt)],
                system_msgs=[Message.system_message("You are a code generator for software projects.")],
                temperature=0.1
            )
            code_info = json.loads(code_response.strip())
            filename = code_info.get("filename", f"main.{language == 'python' and 'py' or 'js'}")
            content = code_info.get("content", "")

            file_path = file_manager.write_file(project_path, filename, content)
            await task_manager.track_file(task_id, file_path)
            await task_manager.update_task_step(task_id, step.id, f"Generated {file_path}", "log")
            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to generate code: {str(e)}", "error")
            return False, dependencies

    elif action_type == "edit_code":
        try:
            # Find the main script to edit
            src_dir = os.path.join(project_path, "src")
            script_files = [f for f in os.listdir(src_dir) if f.endswith(f".{language == 'python' and 'py' or 'js'}")]
            if not script_files:
                await task_manager.update_task_step(task_id, step.id, "No script found to edit", "error")
                return False, dependencies
            script_file = script_files[0]
            script_path = f"src/{script_file}"

            current_code = file_manager.read_file(project_path, script_path)
            edit_prompt = f"""
            Based on the task: '{prompt}', the step: '{step.description}', and the language: '{language}',
            edit the following code to fulfill the step requirements:
            {current_code}
            Respond with the updated code as a string.
            """
            updated_code = await llm.ask(
                messages=[Message.user_message(edit_prompt)],
                system_msgs=[Message.system_message("You are a code editor for software projects.")],
                temperature=0.1
            )
            file_manager.update_file(project_path, script_path, updated_code)
            await task_manager.track_file(task_id, script_path)
            await task_manager.update_task_step(task_id, step.id, f"Updated {script_path}", "log")
            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to edit code: {str(e)}", "error")
            return False, dependencies

    elif action_type == "execute_code":
        try:
            src_dir = os.path.join(project_path, "src")
            script_files = [f for f in os.listdir(src_dir) if f.endswith(f".{language == 'python' and 'py' or 'js'}")]
            if not script_files:
                await task_manager.update_task_step(task_id, step.id, "No script found to execute", "error")
                return False, dependencies
            script_file = script_files[0]
            script_path = f"src/{script_file}"

            if language == "python":
                cmd = [sys.executable, script_path]
            elif language == "javascript":
                cmd = ["node", script_path]
            else:
                await task_manager.update_task_step(task_id, step.id, f"Unsupported language for execution: {language}", "error")
                return False, dependencies

            process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
            result = process.stdout + process.stderr

            # Check for missing dependencies
            if "No module named" in result and language == "python":
                match = re.search(r"No module named '(\w+)'", result)
                if match:
                    module_name = match.group(1)
                    await task_manager.update_task_step(task_id, step.id, f"Missing module '{module_name}'. Attempting to install...", "log")
                    try:
                        subprocess.check_call([sys.executable, "-m", "pip", "install", module_name])
                        dependencies.append(module_name)
                        await task_manager.update_task_step(task_id, step.id, f"Successfully installed {module_name}", "log")
                        # Retry execution
                        process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
                        result = process.stdout + process.stderr
                    except Exception as e:
                        await task_manager.update_task_step(task_id, step.id, f"Failed to install {module_name}: {str(e)}", "error")
                        return False, dependencies
            elif "Cannot find module" in result and language == "javascript":
                match = re.search(r"Cannot find module '(\w+)'", result)
                if match:
                    module_name = match.group(1)
                    await task_manager.update_task_step(task_id, step.id, f"Missing module '{module_name}'. Attempting to install...", "log")
                    try:
                        subprocess.check_call(["npm", "install", module_name], cwd=project_path)
                        dependencies.append(module_name)
                        await task_manager.update_task_step(task_id, step.id, f"Successfully installed {module_name}", "log")
                        # Retry execution
                        process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
                        result = process.stdout + process.stderr
                    except Exception as e:
                        await task_manager.update_task_step(task_id, step.id, f"Failed to install {module_name}: {str(e)}", "error")
                        return False, dependencies

            if process.returncode == 0:
                await task_manager.update_task_step(task_id, step.id, "Script executed successfully", "log")
                return True, dependencies
            else:
                swe_agent = active_agents.get('swe')
                if swe_agent:
                    fix_prompt = f"The script {script_path} failed with error: {result}. Fix the code."
                    current_code = file_manager.read_file(project_path, script_path)
                    fixed_code = await swe_agent.run(
                        f"Fix the following code:\n{current_code}\nError: {result}",
                        on_think=on_think,
                        on_tool_execute=on_tool_execute,
                        on_action=on_action,
                        on_run=on_run
                    )
                    file_manager.update_file(project_path, script_path, fixed_code)
                    await task_manager.track_file(task_id, script_path)
                    await task_manager.update_task_step(task_id, step.id, f"Fixed script and saved to {script_path}", "log")
                    # Retry execution
                    process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
                    result = process.stdout + process.stderr
                    if process.returncode == 0:
                        await task_manager.update_task_step(task_id, step.id, "Script executed successfully after fix", "log")
                        return True, dependencies
                await task_manager.update_task_step(task_id, step.id, f"Script execution failed: {result}", "error")
                return False, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to execute script: {str(e)}", "error")
            return False, dependencies

    elif action_type == "generate_tests":
        try:
            test_prompt = f"""
            Based on the task: '{prompt}', the step: '{step.description}', and the language: '{language}',
            generate a test file for the main script.
            Respond with a JSON object in the following format:
            {{
                "filename": "test_main.{language == 'python' and 'py' or 'js'}",
                "content": "import pytest\\ndef test_example():\\n    assert True"
            }}
            """
            test_response = await llm.ask(
                messages=[Message.user_message(test_prompt)],
                system_msgs=[Message.system_message("You are a test generator for software projects.")],
                temperature=0.1
            )
            test_info = json.loads(test_response.strip())
            filename = test_info.get("filename", f"test_main.{language == 'python' and 'py' or 'js'}")
            content = test_info.get("content", "")

            file_path = file_manager.write_file(project_path, filename, content)
            await task_manager.track_file(task_id, file_path)
            await task_manager.update_task_step(task_id, step.id, f"Generated test file {file_path}", "log")

            # Ensure test framework is installed
            if language == "python":
                try:
                    subprocess.check_call([sys.executable, "-m", "pip", "install", "pytest"])
                    dependencies.append("pytest")
                except Exception as e:
                    await task_manager.update_task_step(task_id, step.id, f"Failed to install pytest: {str(e)}", "error")
                    return False, dependencies
            elif language == "javascript":
                try:
                    subprocess.check_call(["npm", "install", "--save-dev", "jest"], cwd=project_path)
                    dependencies.append("jest")
                except Exception as e:
                    await task_manager.update_task_step(task_id, step.id, f"Failed to install jest: {str(e)}", "error")
                    return False, dependencies

            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to generate tests: {str(e)}", "error")
            return False, dependencies

    elif action_type == "run_tests":
        try:
            if language == "python":
                cmd = [sys.executable, "-m", "pytest", "tests/"]
            elif language == "javascript":
                cmd = ["npm", "test"]
            else:
                await task_manager.update_task_step(task_id, step.id, f"Unsupported language for testing: {language}", "error")
                return False, dependencies

            process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
            result = process.stdout + process.stderr

            if process.returncode == 0:
                await task_manager.update_task_step(task_id, step.id, "Tests passed successfully", "log")
                return True, dependencies
            else:
                swe_agent = active_agents.get('swe')
                if swe_agent:
                    test_fix_prompt = f"The tests failed with error: {result}. Fix the code and tests."
                    src_dir = os.path.join(project_path, "src")
                    script_files = [f for f in os.listdir(src_dir) if f.endswith(f".{language == 'python' and 'py' or 'js'}")]
                    script_file = script_files[0] if script_files else None
                    test_dir = os.path.join(project_path, "tests")
                    test_files = [f for f in os.listdir(test_dir) if f.endswith(f".{language == 'python' and 'py' or 'js'}")]
                    test_file = test_files[0] if test_files else None

                    if script_file and test_file:
                        script_path = f"src/{script_file}"
                        test_path = f"tests/{test_file}"
                        current_code = file_manager.read_file(project_path, script_path)
                        current_test = file_manager.read_file(project_path, test_path)
                        fix_response = await swe_agent.run(
                            f"Fix the following code and tests:\nMain Code:\n{current_code}\nTests:\n{current_test}\nError: {result}",
                            on_think=on_think,
                            on_tool_execute=on_tool_execute,
                            on_action=on_action,
                            on_run=on_run
                        )
                        # Assume the response contains both updated code and tests
                        fix_info = json.loads(fix_response) if fix_response.startswith("{") else {
                            "main_code": fix_response,
                            "test_code": current_test
                        }
                        file_manager.update_file(project_path, script_path, fix_info.get("main_code", current_code))
                        file_manager.update_file(project_path, test_path, fix_info.get("test_code", current_test))
                        await task_manager.track_file(task_id, script_path)
                        await task_manager.track_file(task_id, test_path)
                        await task_manager.update_task_step(task_id, step.id, f"Fixed code and tests", "log")
                        # Retry tests
                        process = subprocess.run(cmd, cwd=project_path, capture_output=True, text=True)
                        result = process.stdout + process.stderr
                        if process.returncode == 0:
                            await task_manager.update_task_step(task_id, step.id, "Tests passed successfully after fix", "log")
                            return True, dependencies
                await task_manager.update_task_step(task_id, step.id, f"Tests failed: {result}", "error")
                return False, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to run tests: {str(e)}", "error")
            return False, dependencies

    elif action_type == "generate_documentation":
        try:
            doc_prompt = f"""
            Based on the task: '{prompt}', the step: '{step.description}', and the language: '{language}',
            generate documentation content for the project.
            Respond with the content as a string.
            """
            readme_content = await llm.ask(
                messages=[Message.user_message(doc_prompt)],
                system_msgs=[Message.system_message("You are a documentation generator for software projects.")],
                temperature=0.1
            )
            file_path = file_manager.write_file(project_path, "README.md", readme_content)
            await task_manager.track_file(task_id, file_path)
            await task_manager.update_task_step(task_id, step.id, "Updated README.md", "log")
            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to generate documentation: {str(e)}", "error")
            return False, dependencies

    else:  # Generic action
        try:
            result = await agent.run(
                step.description,
                on_think=on_think,
                on_tool_execute=on_tool_execute,
                on_action=on_action,
                on_run=on_run
            )
            await task_manager.update_task_step(task_id, step.id, f"Step result: {result}", "log")
            return True, dependencies
        except Exception as e:
            await task_manager.update_task_step(task_id, step.id, f"Failed to execute step: {str(e)}", "error")
            return False, dependencies

# Frontend Proxying
async def check_frontend_health(url: str) -> bool:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=5.0)
            return response.status_code == 200
        except httpx.RequestError:
            return False

def frontend_not_available_response(path: str) -> HTMLResponse:
    return HTMLResponse(
        content=f"""
        <h1>Frontend Server Not Available</h1>
        <p>Could not connect to the React development server at {FRONTEND_URL}.</p>
        <p><b>Requested Path:</b> /{path}</p>
        <h2>Troubleshooting Steps:</h2>
        <ul>
            <li>Run <code>npm start</code> in the <code>frontend</code> directory.</li>
            <li>Verify <a href="{FRONTEND_URL}">{FRONTEND_URL}</a> or adjust <code>FRONTEND_URL</code> in <code>app.py</code>.</li>
            <li>Set a fixed port in <code>frontend/.env</code>: <pre>PORT=3000</pre></li>
            <li>Check network/firewall settings.</li>
        </ul>
        <p><a href="/">Refresh</a> after starting the server.</p>
        """,
        status_code=503
    )

@app.get("/{path:path}")
async def proxy_to_frontend_get(path: str, request: Request):
    backend_api_routes = ["/api/tasks", "/api/config", "/tasks", "/download"]
    normalized_path = path.rstrip('/')
    if normalized_path.startswith(BACKEND_API_PREFIX.lstrip("/")) or any(
            normalized_path == route.lstrip("/").rstrip("/") for route in backend_api_routes
    ):
        raise HTTPException(status_code=404, detail="Not found")

    frontend_url = f"{FRONTEND_URL}/{path}"
    if not await check_frontend_health(FRONTEND_URL):
        return frontend_not_available_response(path)

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception_type(httpx.RequestError))
    async def make_get_request(client, url, params):
        return await client.get(url, params=params, timeout=15.0)

    async with httpx.AsyncClient() as client:
        try:
            print(f"Proxying GET request to: {frontend_url}")
            response = await make_get_request(client, frontend_url, dict(request.query_params))
            return StreamingResponse(
                content=response.aiter_text(),
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type", "text/html")
            )
        except httpx.RequestError as e:
            print(f"Error proxying GET to frontend: {str(e)}")
            return frontend_not_available_response(path)

@app.post("/{path:path}")
async def proxy_to_frontend_post(path: str, request: Request):
    backend_api_routes = ["/api/tasks", "/api/config", "/tasks", "/download"]
    normalized_path = path.rstrip('/')
    if normalized_path.startswith(BACKEND_API_PREFIX.lstrip("/")) or any(
            normalized_path == route.lstrip("/").rstrip("/") for route in backend_api_routes
    ):
        raise HTTPException(status_code=404, detail="Not found")

    frontend_url = f"{FRONTEND_URL}/{path}"
    if not await check_frontend_health(FRONTEND_URL):
        return frontend_not_available_response(path)

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception_type(httpx.RequestError))
    async def make_post_request(client, url, params, content):
        return await client.post(url, params=params, content=content, timeout=15.0)

    async with httpx.AsyncClient() as client:
        try:
            print(f"Proxying POST request to: {frontend_url}")
            body = await request.body()
            response = await make_post_request(client, frontend_url, dict(request.query_params), body)
            return StreamingResponse(
                content=response.aiter_text(),
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type", "text/html")
            )
        except httpx.RequestError as e:
            print(f"Error proxying POST to frontend: {str(e)}")
            return frontend_not_available_response(path)

# Exception Handling
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled server error: {str(exc)}")
    return JSONResponse(status_code=500, content={"message": f"Server error: {str(exc)}", "path": request.url.path})

# Startup Configuration
def open_local_browser(config):
    webbrowser.open_new_tab(f"http://{config['host']}:{config['port']}/")

def load_config():
    try:
        config_path = Path(__file__).parent / "config" / "config.toml"
        with open(config_path, "rb") as f:
            config = tomllib.load(f)
        return {
            "host": config["server"].get("host", "127.0.0.1"),
            "port": config["server"].get("port", 8000)
        }
    except (FileNotFoundError, KeyError) as e:
        print(f"Config error: {str(e)}, using defaults: host=127.0.0.1, port=8000")
        return {"host": "127.0.0.1", "port": 8000}

if __name__ == "__main__":
    import uvicorn

    config = load_config()
    if config["port"] == 11434:  # Avoid conflict with Ollama
        print("Port 11434 in use, switching to 8000")
        config["port"] = 8000
    threading.Timer(3, partial(open_local_browser, config)).start()
    uvicorn.run(app, host=config["host"], port=config["port"], log_level="info")