import React, { useState, useEffect } from 'react';
import { BACKEND_URL } from '../config.js';

const PlanDisplay = ({ taskId }) => {
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        if (!taskId) return;

        console.log("Fetching plan for taskId:", taskId);
        const response = await fetch(`${BACKEND_URL}/api/tasks/${taskId}/plan`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log("Plan data received:", data);
        setPlan(data);
      } catch (error) {
        console.error('Error fetching plan:', error);
        setPlan({ error: error.message });
      }
    };

    if (taskId) {
      const interval = setInterval(fetchPlan, 2000);
      fetchPlan();
      return () => clearInterval(interval);
    }
  }, [taskId]);

  if (!taskId) return <div className="text-gray-400 p-4">No task ID provided</div>;
  if (!plan) return <div className="text-gray-400 p-4">Loading plan...</div>;
  if (plan.error) return <div className="text-red-400 p-4">Error: {plan.error}</div>;
  if (!plan.steps?.length) return <div className="text-gray-400 p-4">No plan steps available</div>;

  return (
    <div className="mb-6 p-4 bg-gray-800 rounded-lg">
      <h3 className="text-lg font-semibold text-white mb-3">{plan.title}</h3>
      <ul className="space-y-2">
        {plan.steps?.map((step, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
              plan.step_statuses[index] === 'completed' ? 'bg-green-500' :
              plan.step_statuses[index] === 'in_progress' ? 'bg-blue-500' :
              plan.step_statuses[index] === 'blocked' ? 'bg-red-500' :
              'bg-gray-500'
            }`} />
            <div>
              <span className="text-gray-300">{step}</span>
              {plan.step_notes[index] && (
                <p className="text-gray-500 text-xs mt-1">{plan.step_notes[index]}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PlanDisplay;

