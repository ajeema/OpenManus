import React, { useEffect } from 'react';

const TaskArea = ({ steps, createTask, stepsContainerRef }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    const prompt = e.target.elements.prompt.value.trim();
    createTask(prompt);
    e.target.elements.prompt.value = '';
  };

  const getEventIcon = (type) => {
    switch (type) {
      case 'think': return '🤔';
      case 'tool': return '🛠️';
      case 'act': return '🚀';
      case 'log': return '📝';
      case 'run': return '▶️';
      case 'message': return '💬';
      case 'complete': return '✅';
      case 'error': return '❌';
      case 'ping': return '·';
      default: return '📌';
    }
  };

  const getEventLabel = (type) => {
    switch (type) {
      case 'think': return 'Thinking';
      case 'tool': return 'Using Tool';
      case 'act': return 'Taking Action';
      case 'log': return 'Log';
      case 'run': return 'Running';
      case 'message': return 'Message';
      case 'complete': return 'Completed';
      case 'error': return 'Error';
      default: return 'Step';
    }
  };

  useEffect(() => {
    if (stepsContainerRef.current) {
      stepsContainerRef.current.scrollTop = stepsContainerRef.current.scrollHeight;
    }
  }, [steps, stepsContainerRef]);

  return (
    <div id="task-container" className="task-container bg-white shadow-md">
      {steps.length === 0 ? (
        <div className="welcome-message">
          <div className="logo-animation animate-float">
            <img
              src="/static/logo.png"
              alt="Manus logo"
              className="welcome-logo shadow-md"
              onError={(e) => (e.target.src = 'https://via.placeholder.com/100?text=Logo')}
            />
          </div>
          <h1 className="text-4xl font-bold animate-glow">Welcome to Manus</h1>
          <p className="highlight-text text-lg">Your autonomous intelligent assistant</p>
          <div className="animated-subtext animate-fade-in">
            Ready to help with anything, anytime
          </div>
        </div>
      ) : (
        <div id="steps-container" className="steps-container" ref={stepsContainerRef}>
          {steps.map((step, index) => {
            if (step.type === 'ping') {
              return (
                <div key={index} className="ping text-center text-gray-500">
                  {step.content}
                </div>
              );
            }

            if (step.type === 'log' && /Executing step (\d+)\/(\d+)/.test(step.content)) {
              const match = step.content.match(/Executing step (\d+)\/(\d+)/);
              const currentStep = parseInt(match[1]);
              const totalSteps = parseInt(match[2]);
              return (
                <div key={index} className="step-divider text-center text-gray-500 py-2">
                  <span>{`Step ${currentStep}/${totalSteps}`}</span>
                </div>
              );
            }

            return (
              <div key={index} className="step-item">
                <span className="step-icon">{getEventIcon(step.type)}</span>
                <div className="step-content">
                  <div className="step-header">
                    <span className="step-label">{getEventLabel(step.type)}</span>
                    <span className="step-timestamp">{step.timestamp}</span>
                  </div>
                  <div className="step-body">
                    <p>{step.content}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="input-container shadow-md">
        <div className="flex-1">
          <input
            className="w-full p-2 text-gray-800 rounded border border-gray-300 focus:border-dark-primary focus:outline-none"
            type="text"
            id="prompt-input"
            name="prompt"
            placeholder="Message Manus..."
          />
        </div>
        <button type="submit" className="send-btn ml-4 w-10 h-10 flex items-center justify-center rounded-full bg-dark-primary hover:bg-dark-secondary transition-colors shadow-md">
          <i className="fas fa-paper-plane"></i>
        </button>
      </form>
    </div>
  );
};

export default TaskArea;
