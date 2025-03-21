
import { useState, useEffect } from 'react';

const Config = () => {
  const [config, setConfig] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setConfig(data.content);
        setError(null);
      }
    } catch (error) {
      setError(`Error loading config: ${error.message}`);
      setConfig('');
    }
  };

  const saveConfig = async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: config })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      setStatus('Config saved successfully');
      setError(null);
    } catch (error) {
      setStatus('');
      setError(`Error saving config: ${error.message}`);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Configuration Editor</h1>
      {error ? (
        <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      ) : (
        <div className="mb-4">
          <textarea
            className="w-full h-96 font-mono bg-editor-bg text-editor-foreground p-4 rounded"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
        </div>
      )}
      <div className="flex gap-4 items-center">
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          onClick={saveConfig}
        >
          Save Config
        </button>
        {status && <span className="text-sm text-green-500">{status}</span>}
      </div>
    </div>
  );
};

export default Config;
