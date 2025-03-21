import React from 'react';

const ResultPanel = ({ result, isVisible, toggleResultPanel }) => {
  return (
    <div
      id="result-panel"
      className={`result-panel ${isVisible ? '' : 'hidden'}`}
    >
      <div className="result-header bg-dark-primary">
        <h2 className="text-lg font-semibold text-white">Manus Computer</h2>
        <div className="result-controls">
          <button
            className="minimize-result text-white hover:text-gray-200"
            onClick={toggleResultPanel}
          >
            <i className="fas fa-minus"></i>
          </button>
        </div>
      </div>

      <div className="step-info-container p-3">
        <div id="current-step" className="step-info-box bg-gray-100 p-3 rounded">
          {result ? (
            <p>Type: {result.type}</p>
          ) : (
            <p>No step information available.</p>
          )}
        </div>
      </div>

      <div id="result-container" className="result-container p-4">
        {result ? (
          <div>
            <p>{result.result}</p>
          </div>
        ) : (
          <p>No result yet.</p>
        )}
      </div>
    </div>
  );
};

export default ResultPanel;
