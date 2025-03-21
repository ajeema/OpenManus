
import React from 'react';

interface EditorLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function EditorLayout({ children, title = "Manus's Computer" }: EditorLayoutProps) {
  return (
    <div className="min-h-screen bg-editor-bg text-editor-text">
      {/* Header */}
      <header className="h-12 bg-editor-surface border-b border-editor-border flex items-center px-4 justify-between">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Add any header controls here */}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto animate-fade-in">
        {children}
      </main>
    </div>
  );
}
