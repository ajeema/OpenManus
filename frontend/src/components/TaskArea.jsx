import React from 'react';

const TaskArea = React.forwardRef(({ steps, className = '' }, ref) => {
  const [expandedSteps, setExpandedSteps] = React.useState({});

  // Filter to show only major steps
  const isMajorStep = (step) => {
    // Include observe steps but filter out other minor types
    const minorTypes = ['log', 'message'];
    return !minorTypes.includes(step.type);
  };

  const getStepContent = (step) => {
    if (!step || !step.content) return 'No content';

    // Handle string content
    if (typeof step.content === 'string') {
      return step.content;
    }

    // Handle object content
    if (typeof step.content === 'object') {
      // Check for nested content structures
      const message = step.content.message || step.content.text;
      if (message) {
        if (typeof message === 'string') {
          return message;
        }
        if (typeof message === 'object') {
          return message.text || message.message || JSON.stringify(message);
        }
      }
      // Fallback to direct JSON string if no message/text found
      try {
        return JSON.stringify(step.content);
      } catch (e) {
        return `${step.type || 'Step'} ${step.step || ''}`;
      }
    }

    return `${step.type || 'Step'} ${step.step || ''}`;
  };

  const majorSteps = steps.filter(isMajorStep);

  const toggleStep = (index) => {
    setExpandedSteps(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const renderStep = (step, index) => {
    const isExpanded = expandedSteps[index];

    return (
      <div key={index} className={`timeline-step ${step.status === 'completed' ? 'completed' : ''}`}>
        <div className="timeline-header" onClick={() => toggleStep(index)}>
          <span>{step.status === 'completed' ? '✓' : '◯'}</span>
          <span className="flex-1">
            {getStepContent(step).split('\n')[0]}
          </span>
          <span>{isExpanded ? '∧' : '∨'}</span>
        </div>
        {isExpanded && (
          <div className="timeline-content">
            <p className="task-description">
              {getStepContent(step)}
            </p>
            {step.files && step.files.map((file, fileIndex) => (
              <div key={fileIndex} className="file-creation">
                <span className="file-icon">📄</span>
                <span>{file}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={ref} className={`prose prose-invert max-w-none p-6 ${className}`}>
      {majorSteps.length === 0 ? (
        <p className="text-gray-500">No steps yet...</p>
      ) : (
        <div className="space-y-1">
          {majorSteps.map((step, index) => renderStep(step, index))}
        </div>
      )}
    </div>
  );
});

TaskArea.displayName = 'TaskArea';

export default TaskArea;