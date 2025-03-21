import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg relative">
      <Link 
        to="/config" 
        className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        aria-label="Settings"
      >
        <i className="fas fa-cog text-2xl"></i>
      </Link>
      <div className="text-center p-8 max-w-3xl relative">
        <div className="absolute inset-0 pointer-events-none">
          <span className="absolute text-4xl animate-float" style={{ top: '20%', left: '20%', animationDelay: '0s' }}>🤖</span>
          <span className="absolute text-4xl animate-float" style={{ top: '30%', left: '80%', animationDelay: '2s' }}>🧠</span>
          <span className="absolute text-4xl animate-float" style={{ top: '70%', left: '30%', animationDelay: '4s' }}>⚡</span>
          <span className="absolute text-4xl animate-float" style={{ top: '60%', left: '70%', animationDelay: '6s' }}>🔮</span>
          <span className="absolute text-4xl animate-float" style={{ top: '40%', left: '50%', animationDelay: '8s' }}>🎯</span>
        </div>
        <h1 className="text-7xl font-bold mb-6 bg-gradient-to-r from-dark-primary via-dark-secondary to-blue-600 bg-clip-text text-transparent animate-glow">
          Manus
        </h1>
        <p className="text-2xl text-gray-400 mb-4">Your Autonomous AI Agent</p>
        <p className="text-gray-500 mb-8 max-w-2xl mx-auto">
          Powered by advanced LLMs and equipped with diverse tools.<br />
          Manus autonomously solves complex tasks through reasoning.
        </p>
        <Link
          to="/chat"
          className="inline-block px-10 py-3 bg-gradient-to-r from-dark-primary to-dark-secondary rounded-full text-white font-semibold uppercase tracking-wider hover:transform hover:-translate-y-1 hover:shadow-lg transition-all"
        >
          Start
        </Link>
      </div>
    </div>
  );
};

export default Home;
