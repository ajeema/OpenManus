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

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    token_usage: dict = {"input": 0, "completion": 0, "total": 0}  # Added token_usage
    execution_time: float = 0.0  # Added execution_time

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

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/chat", response_class=HTMLResponse)
async def chat(request: Request):
    return templates.TemplateResponse("chat.html", {"request": request})

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
        start_time = datetime.now()
        task_manager.tasks[task_id].status = "running"

        agent = Manus(
            name="Manus",
            description="A versatile agent that can solve various tasks using multiple tools",
        )

        async def on_think(thought):
            await task_manager.update_task_step(task_id, 0, thought, "think")

        async def on_tool_execute(tool, input):
            await task_manager.update_task_step(
                task_id, 0, f"Executing tool: {tool}\nInput: {input}", "tool"
            )

        async def on_action(action):
            await task_manager.update_task_step(
                task_id, 0, f"Executing action: {action}", "act"
            )

        async def on_run(step, result):
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

                await task_manager.update_task_step(self.task_id, step, result, event_type)

        sse_handler = SSELogHandler(task_id)
        logger.add(sse_handler)

        result = await agent.run(prompt)
        execution_time = (datetime.now() - start_time).total_seconds()
        await task_manager.update_execution_time(task_id, execution_time)
        await task_manager.update_task_step(task_id, 1, result, "result")
        await task_manager.complete_task(task_id)
    except Exception as e:
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

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500, content={"message": f"Server error: {str(exc)}"}
    )

def open_local_browser(config):
    webbrowser.open_new_tab(f"http://{config['host']}:{config['port']}")

def load_config():
    try:
        config_path = Path(__file__).parent / "config" / "config.toml"
        with open(config_path, "rb") as f:
            config = tomllib.load(f)
        # Override port to 8000 if not specified or conflicting
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