import React from 'react';

const TaskArea = React.forwardRef(({ steps, className = '' }, ref) => {
TaskArea.displayName = 'TaskArea';
  const getStepIcon = (type) => {
    const icons = {
      think: '🤔',
      tool: '🛠️',
      act: '🚀',
      log: '📝',
      run: '▶️',
      message: '💬',
      complete: '✅',
      error: '❌',
      planning: '📝' // Added planning icon
    };
    return icons[type] || '📌';
  };

  const getStepClass = (type) => {
    switch (type) {
      case 'think':
        return 'bg-blue-100 text-blue-800';
      case 'tool':
        return 'bg-green-100 text-green-800';
      case 'act':
        return 'bg-purple-100 text-purple-800';
      case 'planning':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div ref={ref} className={`prose prose-invert max-w-none ${className}`}>
      {steps.length === 0 ? (
        <p className="text-gray-500">No steps yet...</p>
      ) : (
        steps.map((step, index) => (
          <div key={index} className="mb-4">
            <div className="flex items-center text-sm text-gray-500">
              <span className="mr-2">{getStepIcon(step.type)}</span>
              <span>{step.timestamp}</span>
              {/* Added step number display */}
              {step.step !== undefined && (
                <span className="ml-2 px-2 py-1 bg-gray-200 rounded-full text-xs">
                  Step {step.step}
                </span>
              )}
            </div>
            <div className={`mt-1 p-3 rounded ${getStepClass(step.type)}`}>
              {step.content}
            </div>
          </div>
        ))
      )}
    </div>
  );
});

export default TaskArea;