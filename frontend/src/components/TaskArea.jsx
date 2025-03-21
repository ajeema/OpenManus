import React, { useRef, useEffect } from 'react';

const TaskArea = ({ steps, className = '' }) => {
  const stepsEndRef = useRef(null);

  const scrollToBottom = () => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [steps]);

  if (steps.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="welcome-message text-center">
          <div className="logo-animation">
            <img 
              src="/static/logo.png"
              alt="Manus logo"
              className="w-24 h-24 mx-auto rounded-lg shadow-lg animate-bounce"
              onError={(e) => (e.target.src = 'https://via.placeholder.com/100?text=Logo')}
            />
          </div>
          <h1 className="text-4xl font-bold text-editor-accent">Welcome to Manus</h1>
          <p className="text-xl text-gray-600 mt-4">Your autonomous intelligent assistant</p>
          <div className="text-gray-500 mt-2">Ready to help with anything, anytime</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`} ref={stepsEndRef}> {/* Added ref for scrolling */}
      {steps.map((step, index) => {
        if (step.type === 'ping') {
          return (
            <div key={index} className="text-center text-gray-400 text-sm">
              ·
            </div>
          );
        }

        return (
          <div key={index} className={`step-item ${step.type} bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700`}> {/* Added dark theme styling */}
            <div className="log-header flex justify-between items-center"> {/* Added flexbox for better layout */}
              <div className="log-prefix">
                <span className="log-prefix-icon text-blue-500 text-xl">{getStepIcon(step.type)}</span> {/* Added color */}
                <span className="text-gray-300">{step.timestamp} </span> {/* Added color */}
                <span className="text-gray-200">{getStepLabel(step.type)}</span> {/* Added color */}
              </div>
              <span className="text-gray-400 text-sm">{index + 1}</span> {/* Added step number */}

            </div>
            <div className="log-body mt-2">
              <pre className="whitespace-pre-wrap break-words text-gray-200"> {/* Added color */}
                {step.content}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const getStepIcon = (type) => {
  const icons = {
    think: '🤔',
    tool: '🛠️',
    act: '🚀',
    log: '📝',
    run: '▶️',
    message: '💬',
    complete: '✅',
    error: '❌'
  };
  return icons[type] || '📌';
};

const getStepLabel = (type) => {
  const labels = {
    think: 'Thinking',
    tool: 'Using Tool',
    act: 'Taking Action',
    log: 'Log',
    run: 'Running',
    message: 'Message',
    complete: 'Completed',
    error: 'Error'
  };
  return labels[type] || 'Step';
};

export default TaskArea;