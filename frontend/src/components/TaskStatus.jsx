
import React from 'react';

const TaskStatus = ({ status }) => {
  if (!status) return null;
  
  const getStatusColor = () => {
    switch (status) {
      case 'creating':
        return 'text-yellow-500';
      case 'running':
        return 'text-blue-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className={`text-sm font-medium ${getStatusColor()}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}...
    </div>
  );
};

export default TaskStatus;
