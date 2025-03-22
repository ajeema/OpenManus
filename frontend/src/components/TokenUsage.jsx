
import React from 'react';

const TokenUsage = ({ tokenUsage }) => {
  const inputTokens = tokenUsage?.total_input_tokens || 0;
  const completionTokens = tokenUsage?.total_completion_tokens || 0;
  const total = inputTokens + completionTokens;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-editor-surface rounded-lg text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Input:</span>
        <span>{inputTokens}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Output:</span>
        <span>{completionTokens}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Total:</span>
        <span>{total}</span>
      </div>
    </div>
  );
};

export default TokenUsage;
