// File: src/pages/Chat.jsx
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TaskArea from '../components/TaskArea';
import ResultPanel from '../components/ResultPanel';
import '../style.css';

// Define the backend URL (adjust if your backend is running on a different port)
const BACKEND_URL = 'http://localhost:8000';

const Chat = () => {
  const [tasks, setTasks] = useState([]);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isResultPanelVisible, setIsResultPanelVisible] = useState(false);
  const [imageModalSrc, setImageModalSrc] = useState(null);
  const [pythonModalContent, setPythonModalContent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const eventSourceRef = useRef(null);
  const stepsContainerRef = useRef(null);

  const loadHistory = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${BACKEND_URL}/tasks`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to load history: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      console.log('loadHistory - Fetched tasks:', data);
      setTasks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('loadHistory - Failed to load history:', error);
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const createTask = async (prompt) => {
    if (!prompt) {
      alert('Please enter a valid task');
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setSteps([]);
    setResult(null);
    setIsResultPanelVisible(false);
    setActiveTaskId(null);

    try {
      const response = await fetch(`${BACKEND_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create task: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log('createTask - Response:', data);
      if (!data.task_id) {
        throw new Error('Invalid task ID: Response does not contain task_id');
      }

      setActiveTaskId(data.task_id);
      setupSSE(data.task_id);
      await loadHistory();
    } catch (error) {
      console.error('createTask - Failed to create task:', error);
      setSteps([{ type: 'error', content: `Error: ${error.message}`, timestamp: new Date().toLocaleTimeString() }]);
      setResult({ result: error.message, type: 'error' });
      setIsResultPanelVisible(true);
      console.log('createTask - Showing ResultPanel on error. Result:', { result: error.message, type: 'error' });
    }
  };

  const setupSSE = (taskId) => {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    let stepsData = [];

    const connect = () => {
      console.log(`setupSSE - Connecting to SSE for task ${taskId}`);
      const eventSource = new EventSource(`${BACKEND_URL}/tasks/${taskId}/events`);
      eventSourceRef.current = eventSource;

      let heartbeatTimer = setInterval(() => {
        setSteps((prev) => [...prev, { type: 'ping', content: '·', timestamp: new Date().toLocaleTimeString() }]);
        autoScroll();
      }, 5000);

      fetch(`${BACKEND_URL}/tasks/${taskId}`)
        .then((response) => response.json())
        .then((task) => {
          console.log(`setupSSE - Initial task status for ${taskId}:`, task);
          updateTaskStatus(task);
        })
        .catch((error) => {
          console.error('setupSSE - Initial status retrieval failed:', error);
        });

      const handleEvent = (event, type) => {
        clearInterval(heartbeatTimer);
        try {
          const data = JSON.parse(event.data);
          console.log(`setupSSE - Received ${type} event:`, data);
          const { formattedContent, timestamp, isoTimestamp } = formatStepContent(data, type);

          stepsData.push({
            type,
            content: formattedContent,
            timestamp,
            isoTimestamp,
            expanded: false,
          });

          stepsData.sort((a, b) => {
            const timeCompare = new Date(a.isoTimestamp) - new Date(b.isoTimestamp);
            return timeCompare !== 0 ? timeCompare : stepsData.indexOf(a) - stepsData.indexOf(b);
          });

          setSteps([...stepsData]);
          autoScroll();

          if (type === 'tool' || type === 'act' || type === 'result') {
            setResult({ result: formattedContent, type });
            setIsResultPanelVisible(true);
            console.log('setupSSE - Showing ResultPanel for event type', type, '. Result:', { result: formattedContent, type });
          }

          fetch(`${BACKEND_URL}/tasks/${taskId}`)
            .then((response) => response.json())
            .then((task) => {
              console.log(`setupSSE - Updated task status for ${taskId}:`, task);
              updateTaskStatus(task);
            })
            .catch((error) => {
              console.error('setupSSE - Failed to update status:', error);
            });
        } catch (e) {
          console.error(`setupSSE - Error processing ${type} event:`, e);
        }
      };

      const eventTypes = ['think', 'tool', 'act', 'log', 'run', 'message'];
      eventTypes.forEach((type) => {
        eventSource.addEventListener(type, (event) => handleEvent(event, type));
      });

      eventSource.addEventListener('complete', (event) => {
        clearInterval(heartbeatTimer);
        try {
          const data = JSON.parse(event.data);
          console.log('setupSSE - Received complete event:', data);
          setSteps((prev) => [...prev, { type: 'complete', content: '✅ Task completed', timestamp: new Date().toLocaleTimeString() }]);
          setResult({ result: data.result || '', type: 'complete' });
          setIsResultPanelVisible(true);
          console.log('setupSSE - Showing ResultPanel on complete. Result:', { result: data.result || '', type: 'complete' });
          eventSource.close();
          eventSourceRef.current = null;
        } catch (e) {
          console.error('setupSSE - Error processing completion event:', e);
        }
      });

      eventSource.addEventListener('error', (event) => {
        clearInterval(heartbeatTimer);
        try {
          const data = JSON.parse(event.data);
          console.log('setupSSE - Received error event:', data);
          setSteps((prev) => [...prev, { type: 'error', content: `❌ Error: ${data.message}`, timestamp: new Date().toLocaleTimeString() }]);
          setResult({ result: data.message, type: 'error' });
          setIsResultPanelVisible(true);
          console.log('setupSSE - Showing ResultPanel on error. Result:', { result: data.message, type: 'error' });
          eventSource.close();
          eventSourceRef.current = null;
        } catch (e) {
          console.error('setupSSE - Error processing error event:', e);
        }
      });

      eventSource.onerror = (err) => {
        if (eventSource.readyState === EventSource.CLOSED) return;

        console.error('setupSSE - SSE connection error:', err);
        clearInterval(heartbeatTimer);
        eventSource.close();

        fetch(`${BACKEND_URL}/tasks/${taskId}`)
          .then((response) => response.json())
          .then((task) => {
            console.log(`setupSSE - Task status after SSE error for ${taskId}:`, task);
            if (task.status === 'completed' || task.status.includes('failed')) {
              updateTaskStatus(task);
              if (task.status === 'completed') {
                setSteps((prev) => [...prev, { type: 'complete', content: '✅ Task completed', timestamp: new Date().toLocaleTimeString() }]);
                if (task.steps && task.steps.length > 0) {
                  const lastStep = task.steps[task.steps.length - 1];
                  setResult({ result: lastStep.result, type: 'complete' });
                  setIsResultPanelVisible(true);
                  console.log('setupSSE - Showing ResultPanel on SSE complete. Result:', { result: lastStep.result, type: 'complete' });
                }
              } else {
                setSteps((prev) => [...prev, { type: 'error', content: `❌ Error: ${task.status || 'Task failed'}`, timestamp: new Date().toLocaleTimeString() }]);
                setResult({ result: task.status || 'Task failed', type: 'error' });
                setIsResultPanelVisible(true);
                console.log('setupSSE - Showing ResultPanel on SSE error. Result:', { result: task.status || 'Task failed', type: 'error' });
              }
            } else if (retryCount < maxRetries) {
              retryCount++;
              setSteps((prev) => [
                ...prev,
                { type: 'warning', content: `⚠ Connection lost, retrying in ${retryDelay / 1000} seconds (${retryCount}/${maxRetries})...`, timestamp: new Date().toLocaleTimeString() },
              ]);
              setTimeout(connect, retryDelay);
            } else {
              setSteps((prev) => [...prev, { type: 'error', content: '⚠ Connection lost, please refresh the page', timestamp: new Date().toLocaleTimeString() }]);
              setResult({ result: 'Connection lost, please refresh the page', type: 'error' });
              setIsResultPanelVisible(true);
              console.log('setupSSE - Showing ResultPanel on connection lost. Result:', { result: 'Connection lost, please refresh the page', type: 'error' });
            }
          })
          .catch((error) => {
            console.error('setupSSE - Failed to check task status:', error);
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(connect, retryDelay);
            }
          });
      };
    };

    connect();
  };

  const loadTask = async (taskId) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setSteps([]);
    setResult(null);
    setIsResultPanelVisible(false);
    setActiveTaskId(taskId);

    try {
      const response = await fetch(`${BACKEND_URL}/tasks/${taskId}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to load task: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const task = await response.json();
      console.log('loadTask - Fetched task:', task);

      if (task.steps && task.steps.length > 0) {
        let taskSteps = [];
        task.steps.forEach((step, index) => {
          const stepTimestamp = new Date(step.created_at || task.created_at).toLocaleTimeString();
          taskSteps.push({
            type: step.type,
            content: step.result,
            timestamp: stepTimestamp,
            expanded: index === task.steps.length - 1,
          });
        });

        taskSteps.sort((a, b) => {
          const timeCompare = new Date(a.timestamp) - new Date(b.timestamp);
          return timeCompare !== 0 ? timeCompare : taskSteps.indexOf(a) - taskSteps.indexOf(b);
        });

        setSteps(taskSteps);
        const lastStep = taskSteps[taskSteps.length - 1];
        setResult({ result: lastStep.content, type: lastStep.type });
        setIsResultPanelVisible(true);
        console.log('loadTask - Showing ResultPanel. Result:', { result: lastStep.content, type: lastStep.type });
      } else {
        setSteps([{ type: 'info', content: 'No steps recorded for this task', timestamp: new Date().toLocaleTimeString() }]);
        setResult({ result: 'No steps recorded for this task', type: 'info' });
        setIsResultPanelVisible(true);
        console.log('loadTask - Showing ResultPanel (no steps). Result:', { result: 'No steps recorded for this task', type: 'info' });
      }

      updateTaskStatus(task);
    } catch (error) {
      console.error('loadTask - Failed to load task:', error);
      setSteps([{ type: 'error', content: `Error: ${error.message}`, timestamp: new Date().toLocaleTimeString() }]);
      setResult({ result: error.message, type: 'error' });
      setIsResultPanelVisible(true);
      console.log('loadTask - Showing ResultPanel on error. Result:', { result: error.message, type: 'error' });
    }
  };

  const formatStepContent = (data) => {
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const localTime = now.toLocaleTimeString();

    return {
      formattedContent: data.result || data.message || JSON.stringify(data),
      timestamp: localTime,
      isoTimestamp,
    };
  };

  const updateTaskStatus = (task) => {
    setTasks((prevTasks) =>
      prevTasks.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
    );
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      console.log('toggleSidebar - New isSidebarOpen:', !prev);
      return !prev;
    });
  };

  const toggleResultPanel = () => {
    setIsResultPanelVisible((prev) => {
      console.log('toggleResultPanel - New visibility:', !prev);
      return !prev;
    });
  };

  const autoScroll = () => {
    if (stepsContainerRef.current) {
      requestAnimationFrame(() => {
        stepsContainerRef.current.scrollTo({
          top: stepsContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
      setTimeout(() => {
        stepsContainerRef.current.scrollTop = stepsContainerRef.current.scrollHeight;
      }, 100);
    }
  };

  const closeImageModal = () => {
    setImageModalSrc(null);
  };

  const closePythonModal = () => {
    setPythonModalContent(null);
  };

  useEffect(() => {
    loadHistory();

    if (window.componentHandler) {
      window.componentHandler.upgradeAllRegistered();
    }

    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setIsSidebarOpen(false);
      }
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        if (isSidebarOpen) {
          setIsSidebarOpen(false);
        }
        if (imageModalSrc) {
          closeImageModal();
        }
        if (pythonModalContent) {
          closePythonModal();
        }
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeydown);

    handleResize();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [isSidebarOpen, imageModalSrc, pythonModalContent]);

  useEffect(() => {
    console.log('useEffect - isResultPanelVisible updated:', isResultPanelVisible);
  }, [isResultPanelVisible]);

  console.log('Rendering Chat. isResultPanelVisible:', isResultPanelVisible, 'Result:', result);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <header className="header mdl-shadow--2dp">
        <div className="header-left">
          <button className="menu-toggle" onClick={toggleSidebar}>
            <i className="fas fa-bars"></i>
          </button>
          <Link to="/" className="logo">
            <img
              src="/static/logo.png"
              alt="OpenManus logo"
              className="logo-img mdl-shadow--2dp"
              onError={(e) => (e.target.src = 'https://via.placeholder.com/100?text=Logo')}
            />
            <span className="logo-text mdl-typography--headline">OpenManus</span>
          </Link>
        </div>
        <div className="header-right">
          <button className="login-btn mdl-button mdl-js-button mdl-button--raised">
            <i className="fas fa-user"></i>
            Login
          </button>
        </div>
      </header>

      <Sidebar
        tasks={tasks}
        loadTask={loadTask}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        loadHistory={loadHistory}
        activeTaskId={activeTaskId}
        setActiveTaskId={setActiveTaskId}
      />

      {window.innerWidth <= 768 && (
        <div
          className={`overlay ${isSidebarOpen ? 'show' : ''}`}
          onClick={toggleSidebar}
        ></div>
      )}

      <main className={`container mdl-layout__content ${isResultPanelVisible ? 'with-result' : ''}`}>
        <div className="main-panel">
          <TaskArea
            steps={steps}
            createTask={createTask}
            stepsContainerRef={stepsContainerRef}
          />
          <ResultPanel
            result={result}
            isVisible={isResultPanelVisible}
            toggleResultPanel={toggleResultPanel}
          />
          <button
            onClick={() => {
              setIsResultPanelVisible(true);
              setResult({ result: 'Test result', type: 'test' });
              console.log('Manually showing ResultPanel. isResultPanelVisible:', true, 'Result:', { result: 'Test result', type: 'test' });
            }}
            style={{ position: 'fixed', top: '100px', left: '20px', zIndex: 1000 }}
          >
            Show ResultPanel (Debug)
          </button>
        </div>
      </main>

      {imageModalSrc && (
        <div className="image-modal active">
          <span className="close-modal" onClick={closeImageModal}>×</span>
          <img src={imageModalSrc} className="modal-content" alt="Full view" />
        </div>
      )}

      {pythonModalContent && (
  <div className="python-modal active">
    <div className="python-console">
      <div className="close-modal" onClick={closePythonModal}>×</div>
      <div className="python-output">
        <pre>{pythonModalContent.code}</pre>
        <div style={{ color: '#4CAF50', marginTop: '10px', marginBottom: '10px' }}>
          &gt; Simulation run output results:
        </div>
        <pre style={{ color: '#f8f8f8' }}>{pythonModalContent.output}</pre>
      </div>
    </div>
  </div>
)}
    </>
  );
};

export default Chat;