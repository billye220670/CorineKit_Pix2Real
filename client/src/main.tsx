import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './components/App.js';
import { fetchSystemPrompts } from './components/prompt-assistant/systemPrompts.js';
import './styles/global.css';

// 预加载提示词助手的 system prompts（不阻塞渲染）
fetchSystemPrompts();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
