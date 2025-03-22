import { useState, useRef, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import TaskArea from '../components/TaskArea';
import ResultPanel from '../components/ResultPanel';
import TaskStatus from '../components/TaskStatus';

import '../style.css';

const BACKEND_URL = 'http://localhost:8000';  // Local development URL

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
  let retryCount = 0;
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  let heartbeatTimer;

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
    setResult("Processing request...");
    setIsResultPanelVisible(true);
    setIsResultPanelCollapsed(false);

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
        setActiveTaskId(data.task_id);
        setCurrentTaskStatus('running');
        setupSSE(data.task_id);
        loadHistory();
        setPrompt('');
      }
    } catch (error) {
      const errorMessage = error.message || 'An unexpected error occurred';
      setSteps(prev => [...prev, { type: 'error', content: `❌ ${errorMessage}`, timestamp: new Date().toLocaleTimeString() }]);
      setResult(prev => `${prev}\n\nError: ${errorMessage}`);
      setCurrentTaskStatus('');
      // Panel stays visible
    }
  };

  const setupSSE = (taskId) => {
    const eventSource = new EventSource(`${BACKEND_URL}/api/tasks/${taskId}/events`);
    eventSourceRef.current = eventSource;
    retryCount = 0;

    const seenSteps = new Set();

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      if (eventSource.readyState === EventSource.CLOSED) {
        console.log('Connection was closed, retrying...');
        setTimeout(() => {
          setupSSE(taskId);
        }, 2000);
      }
    };

    // Handle all event types
    ['think', 'tool', 'act', 'log', 'run', 'message', 'step', 'planning', 'error', 'status'].forEach(type => {
      eventSource.addEventListener(type, (event) => {
        try {
          const data = JSON.parse(event.data);
          const stepKey = `${type}-${data.result || data.message || ''}-${data.step || 0}`;
          if (seenSteps.has(stepKey)) return;
          seenSteps.add(stepKey);

          const content = data.result || data.message || (data.status ? `Status: ${data.status}` : 'No content available');
          const step = data.step !== undefined ? data.step : undefined;

          const newStep = {
            type,
            content,
            step,
            timestamp: new Date().toLocaleTimeString()
          };

          setSteps(prev => [...prev, newStep]);
          setCurrentTaskStatus(data.status || 'processing');

          if (['tool', 'act', 'complete', 'error'].includes(type)) {
            setResult(content);
            setIsResultPanelVisible(true);
          }
        } catch (error) {
          console.error('Error handling event:', error);
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


    const eventTypes = ['think', 'tool', 'act', 'log', 'run', 'message', 'step', 'status', 'planning'];

    eventTypes.forEach(type => {
      eventSource.addEventListener(type, (event) => {
        try {
          const data = JSON.parse(event.data);
          // Create unique key including step number if available
          const stepKey = `${type}-${data.step || 0}-${data.result || data.message}`;

          if (!seenSteps.has(stepKey)) {
            seenSteps.add(stepKey);

            // Process content based on event type
            let content = data.result || data.message || 'No content available';
            let icon = '💭';

            switch(type) {
              case 'think':
                icon = '💭';
                break;
              case 'tool':
                icon = '🛠️';
                setResult(`Tool execution: ${content}`);
                setIsResultPanelVisible(true);
                break;
              case 'act':
                icon = '🎯';
                setResult(`Action completed: ${content}`);
                setIsResultPanelVisible(true);
                break;
              case 'planning':
                icon = '📋';
                break;
              case 'status':
                icon = '📊';
                if (data.token_usage) {
                  content = `Token usage - Input: ${data.token_usage.input}, Completion: ${data.token_usage.completion}, Total: ${data.token_usage.total}`;
                }
                if (data.execution_time) {
                  content += `\nExecution time: ${data.execution_time.toFixed(2)}s`;
                }
                break;
              case 'step':
                icon = '📍';
                break;
              default:
                icon = '📝';
            }

            setSteps(prev => [...prev, {
              type,
              icon,
              content,
              step: data.step,
              timestamp: new Date().toLocaleTimeString()
            }]);
          }
        } catch (e) {
          console.error(`Error processing ${type} event:`, e);
        }
      });
    });

    eventSource.addEventListener('error', (event) => {
      clearInterval(heartbeatTimer);
      try {
        const data = event.data ? JSON.parse(event.data) : {};
        console.warn('Error event received:', data);

        if (eventSource.readyState === EventSource.CLOSED) {
          if (retryCount < maxRetries) {
            retryCount++;
            setSteps(prev => [...prev, {
              type: 'warning',
              content: `Connection lost, retrying in ${retryDelay/1000} seconds (${retryCount}/${maxRetries})...`,
              timestamp: new Date().toLocaleTimeString()
            }]);
            setTimeout(setupSSE, retryDelay, taskId);
          } else {
            setSteps(prev => [...prev, {
              type: 'error',
              content: 'Connection lost, please refresh the page',
              timestamp: new Date().toLocaleTimeString()
            }]);
          }
          return;
        }

        const errorMessage = data.message || data.result || '';
        const stepKey = `error-${errorMessage}`;
        if (!seenSteps.has(stepKey)) {
          seenSteps.add(stepKey);
          setSteps(prev => [...prev, {
            type: 'error',
            content: errorMessage,
            timestamp: new Date().toLocaleTimeString()
          }]);
        }
      } catch (e) {
        console.error('Error parsing error event:', e);
        setSteps(prev => [...prev, {
          type: 'error',
          content: event.data || 'An unexpected error occurred',
          timestamp: new Date().toLocaleTimeString()
        }]);
      }
    });

    eventSource.addEventListener('status', (event) => {
      const data = JSON.parse(event.data);
      if (data.token_usage) {
        setTasks(prev => prev.map(task =>
          task.id === taskId ? {
            ...task,
            token_usage: {
              input: data.token_usage.total_input_tokens || 0,
              completion: data.token_usage.total_completion_tokens || 0,
              total: (data.token_usage.total_input_tokens || 0) + (data.token_usage.total_completion_tokens || 0)
            }
          } : task
        ));
      }
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
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
              <TaskArea
                ref={stepsContainerRef}
                steps={steps}
                taskId={activeTaskId}
                className="flex-1 overflow-y-auto"
              />
            </div>
            <div className="border-t border-editor-border p-4 bg-editor-bg">
              <div className="flex items-center gap-4">
                  <TaskStatus status={currentTaskStatus} />
                </div>
            </div>
          </div>
          {isResultPanelVisible && (
            <ResultPanel
              result={result}
              isResultPanelCollapsed={isResultPanelCollapsed}
              setIsResultPanelCollapsed={setIsResultPanelCollapsed}
              tokenUsage={tasks.find(t => t.id === activeTaskId)?.token_usage}
              taskId={activeTaskId}
            />
          )}
        </div>

        <div className="border-t border-editor-border bg-editor-surface p-4">
          <div className="max-w-4xl mx-auto flex flex-col gap-2">
            <div className="flex gap-4 items-center">
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
            </div>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-gray-400 hover:text-white transition-colors"
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