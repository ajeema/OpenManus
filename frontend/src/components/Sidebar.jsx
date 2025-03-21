import React from 'react';

const Sidebar = ({ isOpen, onClose, tasks, activeTaskId, onTaskSelect, className = '' }) => {
  return (
    <div className={`
      fixed md:relative
      w-64 h-full
      transform transition-transform duration-200
      ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      bg-editor-surface border-r border-editor-border
      ${className}
    `}>
      <div className="flex items-center justify-between p-4 border-b border-editor-border">
        <h2 className="text-lg font-semibold">History</h2>
        <button
          onClick={onClose}
          className="md:hidden p-2 hover:bg-editor-bg rounded-full transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto h-[calc(100%-4rem)]">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => onTaskSelect(task.id)}
            className={`
              w-full text-left p-4 hover:bg-editor-bg
              transition-colors border-b border-editor-border
              ${activeTaskId === task.id ? 'bg-editor-bg' : ''}
              ${task.status.includes('failed') ? 'text-red-500' : ''}
            `}
          >
            <p className="truncate">{task.prompt}</p>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(task.created_at).toLocaleTimeString()}
            </p>
            {task.status.includes('failed') && (
              <p className="text-sm text-red-500 mt-1 truncate">
                Error: {task.status.split('failed: ')[1] || 'Unknown error'}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;