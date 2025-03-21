import React from 'react';

const Sidebar = ({ tasks, loadTask, isOpen, toggleSidebar, loadHistory, activeTaskId, setActiveTaskId }) => {
  const handleDelete = async (taskId) => {
    try {
      const response = await fetch(`/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete task');
      }
      await loadHistory();
      if (activeTaskId === taskId) {
        setActiveTaskId(null);
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleLoadTask = (taskId) => {
    setActiveTaskId(taskId);
    loadTask(taskId);
  };

  return (
    <div className={`history-panel ${isOpen ? 'open' : ''}`}>
      <div className="history-header">
        <h2 className="text-lg font-semibold text-white">Manus History</h2>
        <button
          className="close-history text-white hover:text-gray-200 md:hidden"
          onClick={toggleSidebar}
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      <div className="history-content">
        <div className="history-section">
          <div className="history-section-title">Tasks</div>
          {tasks.length === 0 ? (
            <p className="text-gray-400 px-4">No tasks yet.</p>
          ) : (
            <ul className="space-y-1">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={`history-item ${activeTaskId === task.id ? 'active' : ''}`}
                >
                  <span className="history-item-icon">
                    <i className="fas fa-tasks"></i>
                  </span>
                  <div className="task-info" onClick={() => handleLoadTask(task.id)}>
                    <p className="task-prompt">{task.prompt}</p>
                    <p className="task-status">{task.status}</p>
                  </div>
                  <button
                    className="delete-task"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(task.id);
                    }}
                  >
                    <i className="fas fa-trash-alt"></i>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
