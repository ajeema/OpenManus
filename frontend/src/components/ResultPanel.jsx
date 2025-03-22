import PlanDisplay from './PlanDisplay';

const ResultPanel = ({ result, isResultPanelCollapsed, setIsResultPanelCollapsed, tokenUsage, className = '', taskId }) => {
  if (isResultPanelCollapsed) {
    return (
      <div
        className="fixed bottom-4 right-4 cursor-pointer hover:scale-105 transition-transform"
        onClick={() => setIsResultPanelCollapsed(false)}
        style={{
          background: 'linear-gradient(135deg, #1a1b26 0%, #24283b 100%)',
          border: '2px solid #7aa2f7',
          borderRadius: '10px',
          boxShadow: '0 0 20px rgba(122, 162, 247, 0.3)',
          padding: '12px',
          width: '200px',
          zIndex: 50,
          transition: 'all 0.3s ease'
        }}>
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="text-white text-sm">Manus Computer</span>
          </div>
          <span className="text-blue-400 text-xs">Click to expand</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`result-panel ${className}`}>
      <div className="py-4 px-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-between flex-1 mr-4">
            <div className="flex items-center space-x-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-100"></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-200"></div>
              </div>
              <h2 className="text-white text-lg font-medium">Manus Computer</h2>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <span>Input:</span>
                <span className="text-blue-400">{tokenUsage?.total_input_tokens || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Output:</span>
                <span className="text-blue-400">{tokenUsage?.total_completion_tokens || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Total:</span>
                <span className="text-blue-400">
                  {(tokenUsage?.total_input_tokens || 0) + (tokenUsage?.total_completion_tokens || 0)}
                </span>
              </div>
            </div>
          </div>
          <button
            className="p-2 hover:bg-gray-700/30 rounded-lg transition-colors"
            onClick={() => setIsResultPanelCollapsed(true)}
            aria-label="Collapse"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        <div className="mt-3 h-1 bg-gray-700/30 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500/50 rounded-full w-3/4 animate-pulse"></div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <PlanDisplay taskId={taskId} />
        <div className="prose prose-invert max-w-none">
          <pre className="whitespace-pre-wrap break-words text-gray-300 font-mono text-sm leading-relaxed">
            {result}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default ResultPanel;