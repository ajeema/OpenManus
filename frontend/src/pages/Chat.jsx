import { useState, useRef, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import TaskArea from '../components/TaskArea';
import ResultPanel from '../components/ResultPanel';
import TaskStatus from '../components/TaskStatus';
import '../style.css';

const BACKEND_URL = 'http://localhost:8000';

const Chat = () => {
  const [tasks, setTasks] = useState([]);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isResultPanelVisible, setIsResultPanelVisible] = useState(true);
  const [isResultPanelCollapsed, setIsResultPanelCollapsed] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const eventSourceRef = useRef(null);
  const stepsContainerRef = useRef(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState('');
  const [configError, setConfigError] = useState('');
  const [configStatus, setConfigStatus] = useState('');
  const [prompt, setPrompt] = useState('');
  const [currentTaskStatus, setCurrentTaskStatus] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tasks`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to load history: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('loadHistory - Failed to load history:', error);
      setTasks([]);
    }
  };

  const createTask = async () => {
    if (!prompt.trim()) return;
    setCurrentTaskStatus('creating');

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setSteps([]);
    setResult(null);
    setIsResultPanelVisible(false);

    try {
      const response = await fetch(`${BACKEND_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create task');
      }

      const data = await response.json();
      if (data.task_id) {
        setCurrentTaskStatus('running');
        setupSSE(data.task_id);
        loadHistory();
        setPrompt('');
      }
    } catch (error) {
      const errorMessage = error.message || 'An unexpected error occurred';
      setSteps([{ type: 'error', content: `❌ ${errorMessage}`, timestamp: new Date().toLocaleTimeString() }]);
      setResult(errorMessage);
      setIsResultPanelVisible(true);
      setCurrentTaskStatus('');
    }
  };

  const setupSSE = (taskId) => {
    const eventSource = new EventSource(`/api/tasks/${taskId}/events`);
    eventSourceRef.current = eventSource;

    const seenSteps = new Set();

    // Handle all event types
    ['think', 'tool', 'act', 'log', 'run', 'message', 'step'].forEach(type => {
      eventSource.addEventListener(type, (event) => {
        const data = JSON.parse(event.data);
        const stepKey = `${type}-${data.result || data.message}-${data.step || 0}`;
        if (seenSteps.has(stepKey)) return;
        seenSteps.add(stepKey);

        const newStep = {
          type,
          content: data.result || data.message || 'No content available',
          timestamp: new Date().toLocaleTimeString()
        };
        setSteps(prev => [...prev, newStep]);

        if (type === 'tool' || type === 'act') {
          setResult(data.result || 'Action completed');
          setIsResultPanelVisible(true);
        }
      });
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      const stepKey = `complete-${data.result || 'Task completed'}`;
      if (seenSteps.has(stepKey)) return;
      seenSteps.add(stepKey);

      setSteps(prev => [...prev, {
        type: 'complete',
        content: '✅ Task completed successfully',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setResult(data.result || 'Task completed');
      setIsResultPanelVisible(true);
      eventSource.close();
      setCurrentTaskStatus('');
    });

    eventSource.addEventListener('error', (event) => {
      const data = event.data ? JSON.parse(event.data) : {};
      let errorMessage = data.message || 'An unexpected error occurred during task execution';
      // Customize error messages for clarity
      if (errorMessage.includes("No module named")) {
        const match = errorMessage.match(/No module named '(\w+)'/);
        const moduleName = match ? match[1] : 'unknown';
        errorMessage = `Failed to execute Python code: The '${moduleName}' module is not installed.`;
      } else if (errorMessage.includes("Task stuck in a loop")) {
        errorMessage = "Task failed: The agent got stuck in a loop while trying to complete the task.";
      }
      const stepKey = `error-${errorMessage}`;
      if (seenSteps.has(stepKey)) return;
      seenSteps.add(stepKey);

      setSteps(prev => [...prev, {
        type: 'error',
        content: `❌ ${errorMessage}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
      setResult(errorMessage);
      setIsResultPanelVisible(true);
      eventSource.close();
      setCurrentTaskStatus('');
    });

    eventSource.addEventListener('status', (event) => {
      const data = JSON.parse(event.data);
      if (data.steps && Array.isArray(data.steps)) {
        const newSteps = data.steps
          .filter(step => {
            const stepKey = `${step.type}-${step.result || step.message}-${step.step || 0}`;
            if (seenSteps.has(stepKey)) return false;
            seenSteps.add(stepKey);
            return true;
          })
          .map(step => ({
            type: step.type,
            content: step.result || step.message || 'No content available',
            timestamp: new Date().toLocaleTimeString()
          }));
        setSteps(prev => [...prev, ...newSteps]);
      }
    });
  };

  const saveConfig = async () => {
    setConfigStatus('Saving...');
    setConfigError('');
    try {
      const response = await fetch(`${BACKEND_URL}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save config');
      }
      setConfigStatus('Config saved successfully!');
      setTimeout(() => setConfigStatus(''), 3000);
    } catch (error) {
      setConfigError(`Failed to save config: ${error.message}`);
    }
  };

  return (
    <div className="flex h-screen bg-dark-bg text-editor-text overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        tasks={tasks}
        activeTaskId={activeTaskId}
        onTaskSelect={(taskId) => setActiveTaskId(taskId)}
        className="z-30"
      />

      <main className="flex-1 flex flex-col h-full">
        <div className="flex-1 overflow-hidden relative">
          <TaskArea
            steps={steps}
            ref={stepsContainerRef}
            className="h-full overflow-y-auto px-4 py-6 bg-editor-bg"
          />
          <TaskStatus status={currentTaskStatus} />
          {isResultPanelVisible && (
            <ResultPanel
              result={result}
              isResultPanelCollapsed={isResultPanelCollapsed}
              setIsResultPanelCollapsed={setIsResultPanelCollapsed}
            />
          )}
        </div>

        <div className="border-t border-editor-border bg-editor-surface p-4">
          <div className="max-w-4xl mx-auto flex gap-4 items-center">
            <input
              type="text"
              placeholder="Type your question here..."
              className="flex-1 px-4 py-2 rounded-lg bg-editor-bg border border-editor-border focus:border-editor-accent focus:outline-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              onClick={createTask}
              className="px-6 py-2 rounded-lg bg-editor-accent text-white hover:bg-opacity-90 transition-colors"
            >
              Send
            </button>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              aria-label="Settings"
            >
              <i className="fas fa-cog text-2xl"></i>
            </button>

            {showConfig && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Configuration</h2>
                    <button onClick={() => setShowConfig(false)} className="text-gray-500 hover:text-gray-700">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  {configError && (
                    <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
                      {configError}
                    </div>
                  )}
                  <textarea
                    className="w-full h-96 font-mono bg-gray-100 p-4 rounded mb-4"
                    value={config}
                    onChange={(e) => setConfig(e.target.value)}
                  />
                  <div className="flex gap-4 items-center">
                    <button
                      className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                      onClick={saveConfig}
                    >
                      Save Config
                    </button>
                    {configStatus && <span className="text-sm text-green-500">{configStatus}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;