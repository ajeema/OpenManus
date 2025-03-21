import { useState, useRef, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import TaskArea from '../components/TaskArea';
import ResultPanel from '../components/ResultPanel';
import TaskStatus from '../components/TaskStatus'; // Added import
import '../style.css';

const BACKEND_URL = 'http://0.0.0.0:8000';

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
      const response = await fetch(`${BACKEND_URL}/tasks`);
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
        throw new Error(error.detail || 'Request failed');
      }

      const data = await response.json();
      if (data.task_id) {
        setCurrentTaskStatus('running');
        setupSSE(data.task_id);
        loadHistory();
        setPrompt('');

      }
    } catch (error) {
      setSteps([{ type: 'error', content: `Error: ${error.message}` }]);
      setResult(error.message);
      setIsResultPanelVisible(true);
      setCurrentTaskStatus(''); 
    }
  };

  const setupSSE = (taskId) => {
    const eventSource = new EventSource(`/tasks/${taskId}/events`);
    eventSourceRef.current = eventSource;

    ['think', 'tool', 'act', 'log', 'run', 'message'].forEach(type => {
      eventSource.addEventListener(type, (event) => {
        const data = JSON.parse(event.data);
        const newStep = {
          type,
          content: data.result || data.message,
          timestamp: new Date().toLocaleTimeString()
        };
        setSteps(prev => [...prev, newStep]);

        if (type === 'tool' || type === 'act') {
          setResult(data.result);
          setIsResultPanelVisible(true);
        }
      });
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      setSteps(prev => [...prev, {
        type: 'complete',
        content: '✅ Task completed',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setResult(data.result);
      setIsResultPanelVisible(true);
      eventSource.close();
      setCurrentTaskStatus(''); 
    });

    eventSource.addEventListener('error', (event) => {
      setSteps(prev => [...prev, {
        type: 'error',
        content: `❌ Error: ${event.data}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
      setIsResultPanelVisible(true);
      eventSource.close();
      setCurrentTaskStatus(''); 
    });
  };

  const saveConfig = async () => {
    setConfigStatus('Saving...');
    setConfigError('');
    try {
      const response = await fetch(`${BACKEND_URL}/config`, {
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
          <TaskStatus status={currentTaskStatus} /> {/* Displaying task status */}
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