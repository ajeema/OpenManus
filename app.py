# File: app.py
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

import httpx
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

app = FastAPI()

# Update CORS to allow requests from the React dev server (localhost:3000 and others)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:8000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Task(BaseModel):
    id: str
    prompt: str
    created_at: datetime
    status: str
    steps: list = []
    token_usage: dict = {"input": 0, "completion": 0, "total": 0}
    execution_time: float = 0.0

    def model_dump(self, *args, **kwargs):
        data = super().model_dump(*args, **kwargs)
        data["created_at"] = self.created_at.isoformat()
        return data

class TaskManager:
    def __init__(self):
        self.tasks = {}
        self.queues = {}

    def create_task(self, prompt: str) -> Task:
        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id, prompt=prompt, created_at=datetime.now(), status="pending"
        )
        self.tasks[task_id] = task
        self.queues[task_id] = asyncio.Queue()
        return task

    async def update_task_step(
            self, task_id: str, step: int, result: str, step_type: str = "step"
    ):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.steps.append({"step": step, "result": result, "type": step_type})
            await self.queues[task_id].put(
                {"type": step_type, "step": step, "result": result}
            )
            await self.queues[task_id].put(
                {
                    "type": "status",
                    "status": task.status,
                    "steps": task.steps,
                    "token_usage": task.token_usage,
                    "execution_time": task.execution_time,
                }
            )

    async def update_token_usage(self, task_id: str, token_usage: dict):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.token_usage.update(token_usage)
            await self.queues[task_id].put(
                {
                    "type": "status",
                    "status": task.status,
                    "steps": task.steps,
                    "token_usage": task.token_usage,
                    "execution_time": task.execution_time,
                }
            )

    async def update_execution_time(self, task_id: str, execution_time: float):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.execution_time = execution_time
            await self.queues[task_id].put(
                {
                    "type": "status",
                    "status": task.status,
                    "steps": task.steps,
                    "token_usage": task.token_usage,
                    "execution_time": task.execution_time,
                }
            )

    async def complete_task(self, task_id: str):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.status = "completed"
            await self.queues[task_id].put(
                {
                    "type": "status",
                    "status": task.status,
                    "steps": task.steps,
                    "token_usage": task.token_usage,
                    "execution_time": task.execution_time,
                }
            )
            await self.queues[task_id].put({"type": "complete"})

    async def fail_task(self, task_id: str, error: str):
        if task_id in self.tasks:
            self.tasks[task_id].status = f"failed: {error}"
            await self.queues[task_id].put({"type": "error", "message": error})

task_manager = TaskManager()

@app.get("/download")
async def download_file(file_path: str):
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=os.path.basename(file_path))

@app.post("/tasks")
async def create_task(prompt: str = Body(..., embed=True)):
    task = task_manager.create_task(prompt)
    asyncio.create_task(run_task(task.id, prompt))
    return {"task_id": task.id}

from app.agent.manus import Manus

async def run_task(task_id: str, prompt: str):
    try:
        print(f"run_task - Starting task {task_id} with prompt: {prompt}")
        start_time = datetime.now()
        task_manager.tasks[task_id].status = "running"

        agent = Manus(
            name="Manus",
            description="A versatile agent that can solve various tasks using multiple tools",
        )
        print("run_task - Manus agent initialized")

        async def on_think(thought):
            print(f"run_task - on_think: {thought}")
            await task_manager.update_task_step(task_id, 0, thought, "think")

        async def on_tool_execute(tool, input):
            print(f"run_task - on_tool_execute: tool={tool}, input={input}")
            await task_manager.update_task_step(
                task_id, 0, f"Executing tool: {tool}\nInput: {input}", "tool"
            )

        async def on_action(action):
            print(f"run_task - on_action: {action}")
            await task_manager.update_task_step(
                task_id, 0, f"Executing action: {action}", "act"
            )

        async def on_run(step, result):
            print(f"run_task - on_run: step={step}, result={result}")
            await task_manager.update_task_step(task_id, step, result, "run")

        from app.logger import logger

        class SSELogHandler:
            def __init__(self, task_id):
                self.task_id = task_id

            async def __call__(self, message):
                import re
                cleaned_message = re.sub(r"^.*? - ", "", message)
                event_type = "log"
                step = 0
                result = cleaned_message

                if "✨ Manus's thoughts:" in cleaned_message:
                    event_type = "think"
                    result = cleaned_message.replace("✨ Manus's thoughts: ", "").strip()
                elif "🛠️ Manus selected" in cleaned_message:
                    event_type = "tool"
                elif "🎯 Tool" in cleaned_message:
                    event_type = "act"
                    result = cleaned_message.replace("🎯 Tool 'browser_use' completed its mission! Result: ", "").strip()
                elif "Token usage:" in cleaned_message:
                    match = re.search(r"Input=(\d+), Completion=(\d+),.*Total=(\d+)", cleaned_message)
                    if match:
                        token_usage = {
                            "input": int(match.group(1)),
                            "completion": int(match.group(2)),
                            "total": int(match.group(3)),
                        }
                        await task_manager.update_token_usage(task_id, token_usage)
                    return
                elif "📝 Oops!" in cleaned_message:
                    event_type = "error"
                    result = cleaned_message.replace("📝 Oops!", "").strip()
                elif "🏁 Special tool" in cleaned_message:
                    event_type = "complete"
                    result = cleaned_message.replace("🏁 Special tool", "").strip()

                print(f"SSELogHandler - Emitting event: type={event_type}, result={result}")
                await task_manager.update_task_step(self.task_id, step, result, event_type)

        sse_handler = SSELogHandler(task_id)
        logger.add(sse_handler)

        result = await agent.run(prompt)
        print(f"run_task - Agent run completed. Result: {result}")
        execution_time = (datetime.now() - start_time).total_seconds()
        await task_manager.update_execution_time(task_id, execution_time)
        await task_manager.update_task_step(task_id, 1, result, "result")
        await task_manager.complete_task(task_id)
    except Exception as e:
        print(f"run_task - Error: {str(e)}")
        await task_manager.fail_task(task_id, str(e))

@app.get("/tasks/{task_id}/events")
async def task_events(task_id: str):
    async def event_generator():
        if task_id not in task_manager.queues:
            yield f"event: error\ndata: {dumps({'message': 'Task not found'})}\n\n"
            return

        queue = task_manager.queues[task_id]
        task = task_manager.tasks.get(task_id)
        if task:
            yield f"event: status\ndata: {dumps({'type': 'status', 'status': task.status, 'steps': task.steps, 'token_usage': task.token_usage, 'execution_time': task.execution_time})}\n\n"

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
                elif event["type"] == "step":
                    task = task_manager.tasks.get(task_id)
                    if task:
                        yield f"event: status\ndata: {dumps({'type': 'status', 'status': task.status, 'steps': task.steps, 'token_usage': task.token_usage, 'execution_time': task.execution_time})}\n\n"
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
                elif event["type"] in ["think", "tool", "act", "run"]:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
                else:
                    yield f"event: {event['type']}\ndata: {formatted_event}\n\n"
            except asyncio.CancelledError:
                print(f"Client disconnected for task {task_id}")
                break
            except Exception as e:
                print(f"Error in event stream: {str(e)}")
                yield f"event: error\ndata: {dumps({'message': str(e)})}\n\n"
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/tasks")
async def get_tasks():
    sorted_tasks = sorted(
        task_manager.tasks.values(), key=lambda task: task.created_at, reverse=True
    )
    return JSONResponse(
        content=[task.model_dump() for task in sorted_tasks],
        headers={"Content-Type": "application/json"},
    )

@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    if task_id not in task_manager.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_manager.tasks[task_id]

# Proxy requests to the React development server
FRONTEND_URL = "http://localhost:3000"

# Health check for the frontend server
async def check_frontend_health(url: str) -> bool:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=5.0)
            return response.status_code == 200
        except httpx.RequestError:
            return False

# Fallback response if the frontend server is not running
def frontend_not_available_response(path: str) -> HTMLResponse:
    return HTMLResponse(
        content=f"""
        <h1>Frontend Server Not Available</h1>
        <p>Could not connect to the React development server at {FRONTEND_URL}.</p>
        <p><b>Requested Path:</b> /{path}</p>
        <h2>Troubleshooting Steps:</h2>
        <ul>
            <li>Ensure the React development server is running. In the <code>frontend</code> directory, run:
                <pre>npm start</pre>
            </li>
            <li>Check if the server is running on <a href="{FRONTEND_URL}" target="_blank">{FRONTEND_URL}</a>. If not, it may be on a different port (e.g., 3001).</li>
            <li>If the port is different, update the <code>FRONTEND_URL</code> in <code>app.py</code> to match the correct port.</li>
            <li>Alternatively, set a fixed port in <code>frontend/.env</code> by adding:
                <pre>PORT=3000</pre>
                Then restart the React server.
            </li>
            <li>Check for network issues or firewall settings that might be blocking connections to {FRONTEND_URL}.</li>
        </ul>
        <p>After starting the React server, <a href="/">refresh this page</a>.</p>
        """,
        status_code=503
    )

@app.get("/api/config")
async def get_config():
    root_dir = Path(__file__).parent
    config_dir = root_dir / "config"
    config_path = config_dir / "config.toml"
    example_config_path = config_dir / "config.example.toml"
    
    try:
        # First try reading config.toml
        if config_path.exists():
            with open(config_path, "r", encoding='utf-8') as f:
                return JSONResponse({"content": f.read(), "source": "config.toml"})
        
        # If no config.toml, try reading config.example.toml
        if example_config_path.exists():
            with open(example_config_path, "r", encoding='utf-8') as f:
                return JSONResponse({"content": f.read(), "source": "config.example.toml"})
                
        # No config files found
        return JSONResponse(
            status_code=404,
            content={"error": f"No config.toml or config.example.toml found in {config_dir}"}
        )
        
        return JSONResponse({"content": config_content})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to read config: {str(e)}"}
        )

@app.post("/api/config")
async def save_config(request: Request):
    config_path = Path("config/config.toml")
    try:
        content = await request.json()
        with open(config_path, "w") as f:
            f.write(content["content"])
        return JSONResponse({"status": "success"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/{path:path}")
async def proxy_to_frontend_get(path: str, request: Request):
    api_routes = ["/tasks", "/download", "/tasks/"]  # Include "/tasks/" to handle trailing slashes
    # Normalize the path by removing trailing slashes for comparison
    normalized_path = path.rstrip('/')
    if any(normalized_path == api_route.lstrip("/").rstrip("/") for api_route in api_routes):
        raise HTTPException(status_code=404, detail="Not found")

    # Check if the frontend server is available
    frontend_url = f"{FRONTEND_URL}/{path}"
    if not await check_frontend_health(FRONTEND_URL):
        return frontend_not_available_response(path)

    # Retry logic for proxying requests
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_fixed(2),
        retry=retry_if_exception_type(httpx.RequestError),
        before=lambda _: print(f"Retrying GET request to {frontend_url}...")
    )
    async def make_get_request(client, url, params):
        return await client.get(url, params=params, timeout=15.0)

    async with httpx.AsyncClient() as client:
        try:
            print(f"Proxying GET request to: {frontend_url}")
            print(f"Query params: {dict(request.query_params)}")
            response = await make_get_request(client, frontend_url, dict(request.query_params))
            print(f"Received response from frontend: {response.status_code}")
            print(f"Response headers: {dict(response.headers)}")
            return StreamingResponse(
                content=response.aiter_text(),
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type", "text/html")
            )
        except httpx.RequestError as e:
            print(f"Error proxying GET to frontend: {str(e)}")
            print(f"Request URL: {frontend_url}")
            print(f"Exception type: {type(e).__name__}")
            return frontend_not_available_response(path)

@app.post("/{path:path}")
async def proxy_to_frontend_post(path: str, request: Request):
    api_routes = ["/tasks", "/download", "/tasks/"]
    normalized_path = path.rstrip('/')
    if any(normalized_path == api_route.lstrip("/").rstrip("/") for api_route in api_routes):
        raise HTTPException(status_code=404, detail="Not found")

    frontend_url = f"{FRONTEND_URL}/{path}"
    if not await check_frontend_health(FRONTEND_URL):
        return frontend_not_available_response(path)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_fixed(2),
        retry=retry_if_exception_type(httpx.RequestError),
        before=lambda _: print(f"Retrying POST request to {frontend_url}...")
    )
    async def make_post_request(client, url, params, content):
        return await client.post(url, params=params, content=content, timeout=15.0)

    async with httpx.AsyncClient() as client:
        try:
            print(f"Proxying POST request to: {frontend_url}")
            body = await request.body()
            response = await make_post_request(client, frontend_url, dict(request.query_params), body)
            print(f"Received response from frontend: {response.status_code}")
            return StreamingResponse(
                content=response.aiter_text(),
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type", "text/html")
            )
        except httpx.RequestError as e:
            print(f"Error proxying POST to frontend: {str(e)}")
            print(f"Request URL: {frontend_url}")
            print(f"Exception type: {type(e).__name__}")
            return frontend_not_available_response(path)

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled server error: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"message": f"Server error: {str(exc)}", "path": request.url.path},
    )

def open_local_browser(config):
    webbrowser.open_new_tab(f"http://{config['host']}:{config['port']}/")

def load_config():
    try:
        config_path = Path(__file__).parent / "config" / "config.toml"
        with open(config_path, "rb") as f:
            config = tomllib.load(f)
        config["server"]["port"] = config["server"].get("port", 8000)
        return {"host": config["server"]["host"], "port": config["server"]["port"]}
    except FileNotFoundError:
        print("Config file not found, using default host: 127.0.0.1, port: 8000")
        return {"host": "127.0.0.1", "port": 8000}
    except KeyError as e:
        print(f"Config missing field {str(e)}, using default host: 127.0.0.1, port: 8000")
        return {"host": "127.0.0.1", "port": 8000}

if __name__ == "__main__":
    import uvicorn

    config = load_config()
    if config["port"] == 11434:  # Avoid conflict with Ollama
        print("Port 11434 is in use (likely by Ollama), switching to 8000")
        config["port"] = 8000
    open_with_config = partial(open_local_browser, config)
    threading.Timer(3, open_with_config).start()
    uvicorn.run(app, host=config["host"], port=config["port"])