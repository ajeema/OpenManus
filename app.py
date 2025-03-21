import asyncio
import os
import threading
import tomllib
import uuid
import webbrowser
from datetime import datetime
from functools import partial
from json import dumps
from pathlib import Path
from typing import Dict, List

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
class Task(BaseModel):
    id: str
    prompt: str
    created_at: datetime
    status: str
    steps: List[Dict] = []
    token_usage: Dict[str, int] = {"input": 0, "completion": 0, "total": 0}
    execution_time: float = 0.0

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        data["created_at"] = self.created_at.isoformat()
        return data

# Task Manager
class TaskManager:
    def __init__(self):
        self.tasks: Dict[str, Task] = {}
        self.queues: Dict[str, asyncio.Queue] = {}

    def create_task(self, prompt: str) -> Task:
        task_id = str(uuid.uuid4())
        task = Task(id=task_id, prompt=prompt, created_at=datetime.now(), status="pending")
        self.tasks[task_id] = task
        self.queues[task_id] = asyncio.Queue()
        return task

    async def update_task_step(self, task_id: str, step: int, result: str, step_type: str = "step"):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.steps.append({"step": step, "result": result, "type": step_type})
            await self.queues[task_id].put({"type": step_type, "step": step, "result": result})
            await self._update_status(task_id)

    async def update_token_usage(self, task_id: str, token_usage: Dict[str, int]):
        if task_id in self.tasks:
            self.tasks[task_id].token_usage.update(token_usage)
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
        task = self.tasks[task_id]
        await self.queues[task_id].put({
            "type": "status",
            "status": task.status,
            "steps": task.steps,
            "token_usage": task.token_usage,
            "execution_time": task.execution_time,
        })

task_manager = TaskManager()

# API Endpoints
@app.get("/download")
async def download_file(file_path: str):
    """Download a file from the server."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=os.path.basename(file_path))

@app.post("/api/tasks")
async def create_task(prompt: str = Body(..., embed=True)):
    """Create a new task and start processing it."""
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
    """Retrieve all tasks sorted by creation date."""
    sorted_tasks = sorted(task_manager.tasks.values(), key=lambda task: task.created_at, reverse=True)
    return JSONResponse(content=[task.model_dump() for task in sorted_tasks])

@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    """Retrieve a specific task by ID."""
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_manager.tasks[task_id]

@app.get("/api/tasks/{task_id}/events")
async def task_events(task_id: str):
    """Stream task events via Server-Sent Events (SSE)."""
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
    """Retrieve the configuration file content."""
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
    """Save the configuration file content."""
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
    """Execute a task using the Manus agent."""
    try:
        print(f"Starting task {task_id} with prompt: {prompt}")
        start_time = datetime.now()
        task_manager.tasks[task_id].status = "running"

        from app.agent.manus import Manus
        agent = Manus(
            name="Manus",
            description="A versatile agent that can solve various tasks using multiple tools",
        )
        print("Manus agent initialized")

        async def on_think(thought): await task_manager.update_task_step(task_id, 0, thought, "think")
        async def on_tool_execute(tool, input): await task_manager.update_task_step(task_id, 0, f"Executing tool: {tool}\nInput: {input}", "tool")
        async def on_action(action): await task_manager.update_task_step(task_id, 0, f"Executing action: {action}", "act")
        async def on_run(step, result): await task_manager.update_task_step(task_id, step, result, "run")

        from app.logger import logger
        class SSELogHandler:
            def __init__(self, task_id): self.task_id = task_id

            async def __call__(self, message):
                import re
                cleaned_message = re.sub(r"^.*? - ", "", message)
                event_type, step, result = "log", 0, cleaned_message

                if "✨ Manus's thoughts:" in cleaned_message:
                    event_type, result = "think", cleaned_message.replace("✨ Manus's thoughts: ", "").strip()
                elif "🛠️ Manus selected" in cleaned_message:
                    event_type = "tool"
                elif "🎯 Tool" in cleaned_message:
                    event_type, result = "act", cleaned_message.replace("🎯 Tool 'browser_use' completed its mission! Result: ", "").strip()
                    # Check for specific browser_use error and fail the task
                    if "net::ERR_NAME_NOT_RESOLVED" in result:
                        error_message = f"Failed to navigate to URL: {result}"
                        await task_manager.fail_task(self.task_id, error_message)
                        return
                elif "Token usage:" in cleaned_message:
                    match = re.search(r"Input=(\d+), Completion=(\d+),.*Total=(\d+)", cleaned_message)
                    if match:
                        await task_manager.update_token_usage(self.task_id, {
                            "input": int(match.group(1)), "completion": int(match.group(2)), "total": int(match.group(3))
                        })
                    return
                elif "📝 Oops!" in cleaned_message:
                    event_type, result = "error", cleaned_message.replace("📝 Oops!", "").strip()
                elif "🏁 Special tool" in cleaned_message:
                    event_type, result = "complete", cleaned_message.replace("🏁 Special tool", "").strip()
                elif "Browser state error" in cleaned_message:
                    # Log but continue processing
                    event_type, result = "info", cleaned_message
                    await task_manager.update_task_step(self.task_id, step, result, event_type)
                    return

                print(f"Emitting event: type={event_type}, result={result}")
                await task_manager.update_task_step(self.task_id, step, result, event_type)

        logger.add(SSELogHandler(task_id))
        result = await agent.run(prompt)
        print(f"Task {task_id} completed. Result: {result}")
        execution_time = (datetime.now() - start_time).total_seconds()
        await task_manager.update_execution_time(task_id, execution_time)
        await task_manager.update_task_step(task_id, 1, result, "result")
        await task_manager.complete_task(task_id)
    except Exception as e:
        error_message = f"Task execution failed: {str(e)}"
        print(f"Task {task_id} failed: {error_message}")
        await task_manager.fail_task(task_id, error_message)

# Frontend Proxying
async def check_frontend_health(url: str) -> bool:
    """Check if the frontend server is available."""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=5.0)
            return response.status_code == 200
        except httpx.RequestError:
            return False

def frontend_not_available_response(path: str) -> HTMLResponse:
    """Return an HTML response when the frontend is unavailable."""
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
    """Proxy GET requests to the frontend, excluding backend API routes."""
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
    """Proxy POST requests to the frontend, excluding backend API routes."""
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
    """Handle uncaught exceptions."""
    print(f"Unhandled server error: {str(exc)}")
    return JSONResponse(status_code=500, content={"message": f"Server error: {str(exc)}", "path": request.url.path})

# Startup Configuration
def open_local_browser(config):
    """Open the app in the default browser after startup."""
    webbrowser.open_new_tab(f"http://{config['host']}:{config['port']}/")

def load_config():
    """Load configuration from config.toml or use defaults."""
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