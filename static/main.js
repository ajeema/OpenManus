let currentEventSource = null;
let isSubmitting = false;

// Utility function to escape HTML to prevent XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
}

// Initialize the application
window.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const modal = document.getElementById('config-modal');
    const promptInput = document.getElementById('prompt-input');
    const chatInputContainer = document.querySelector('.chat-input-container');
    const sendBtn = document.querySelector('.btn-send');
    const chatMessages = document.getElementById('chat-messages');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    const container = document.querySelector('.container');
    const collapseBtn = document.querySelector('.btn-collapse');
    const fullscreenBtn = document.querySelector('.btn-fullscreen');
    const miniViewToggle = document.querySelector('.mini-view-toggle');
    const expandBtn = document.querySelector('.btn-expand');
    const tasks = document.querySelectorAll('.task');
    const playBtn = document.querySelector('.playback-left .btn-play');
    const muteBtn = document.querySelector('.playback-left .btn-mute');
    const progressBar = document.querySelector('.progress-fill');
    const completionHeader = document.querySelector('.completion-header');
    const completionContent = document.querySelector('.completion-content');
    const filePath = document.querySelector('.file-path');
    const languageSelect = document.querySelector('.language-select');
    const configBtn = document.querySelector('.config-btn');

    // Ensure modal is hidden on page load
    modal.classList.remove('active');
    modal.style.display = 'none';

    // Initialize UI components
    checkConfigStatus();
    loadHistory();
    createThinkingUI();
    document.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));

    // Event Listeners for Chat Input
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            createTask();
        }
    });

    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        const existingError = chatInputContainer.querySelector('.input-error');
        if (existingError) {
            existingError.remove();
        }
        this.classList.remove('error');
        sendBtn.disabled = this.value.trim() === '';
    });

    // Sidebar Toggle (for mobile)
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('expanded');
        });
    }

    // Collapsible Code Panel
    collapseBtn.addEventListener('click', () => {
        container.classList.toggle('panel-collapsed');
        if (container.classList.contains('panel-collapsed')) {
            setTimeout(() => miniViewToggle.classList.remove('hidden'), 300);
        } else {
            miniViewToggle.classList.add('hidden');
        }
    });

    // Fullscreen Functionality
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const codePanel = document.querySelector('.code-panel');
            const icon = fullscreenBtn.querySelector('i');
            if (!document.fullscreenElement) {
                codePanel.requestFullscreen?.() ||
                codePanel.mozRequestFullScreen?.() ||
                codePanel.webkitRequestFullscreen?.() ||
                codePanel.msRequestFullscreen?.();
                icon.classList.replace('fa-expand', 'fa-compress');
            } else {
                document.exitFullscreen?.() ||
                document.mozCancelFullScreen?.() ||
                document.webkitExitFullscreen?.() ||
                document.msExitFullscreen?.();
                icon.classList.replace('fa-compress', 'fa-expand');
            }
        });

        document.addEventListener('fullscreenchange', () => {
            const icon = fullscreenBtn.querySelector('i');
            icon.classList.toggle('fa-expand', !document.fullscreenElement);
            icon.classList.toggle('fa-compress', !!document.fullscreenElement);
        });
    }

    // Mini-View Toggle
    miniViewToggle.addEventListener('click', () => {
        container.classList.remove('panel-collapsed');
        miniViewToggle.classList.add('hidden');
    });

    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        container.classList.remove('panel-collapsed');
        miniViewToggle.classList.add('hidden');
    });

    // Task Selection
    tasks.forEach(task => {
        task.addEventListener('click', function() {
            tasks.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            updateThinkingUI(this.querySelector('.task-title').textContent);
        });
    });

    // Task Completion Toggle
    if (completionHeader) {
        completionHeader.addEventListener('click', () => {
            completionContent.classList.toggle('hidden');
            const chevron = completionHeader.querySelector('i');
            chevron.classList.toggle('fa-chevron-down');
            chevron.classList.toggle('fa-chevron-up');
        });
    }

    // Playback Controls
    if (playBtn) {
        let isPlaying = false;
        playBtn.addEventListener('click', function() {
            isPlaying = !isPlaying;
            const icon = this.querySelector('i');
            icon.classList.toggle('fa-play', !isPlaying);
            icon.classList.toggle('fa-pause', isPlaying);

            if (isPlaying) {
                addStepToThinkingUI("Playing code execution simulation");
                let progress = 0;
                const interval = setInterval(() => {
                    progress += 1;
                    if (progress > 100 || !isPlaying) {
                        clearInterval(interval);
                        isPlaying = false;
                        icon.classList.replace('fa-pause', 'fa-play');
                        addStepToThinkingUI("Code execution completed");
                        return;
                    }
                    progressBar.style.width = `${progress}%`;
                    if (progress % 25 === 0) {
                        addStepToThinkingUI(`Code execution progress: ${progress}%`);
                    }
                }, 100);
            } else {
                addStepToThinkingUI("Paused code execution");
            }
        });
    }

    if (muteBtn) {
        let isMuted = true;
        muteBtn.addEventListener('click', function() {
            isMuted = !isMuted;
            const icon = this.querySelector('i');
            icon.classList.toggle('fa-volume-mute', isMuted);
            icon.classList.toggle('fa-volume-up', !isMuted);
            addStepToThinkingUI(isMuted ? "Muted audio output" : "Unmuted audio output");
        });
    }

    // Language Selection
    if (filePath && languageSelect) {
        languageSelect.addEventListener('change', function() {
            const language = this.value;
            filePath.textContent = `main.${language}`;
            const codeBlock = document.querySelector('.code-content pre code');
            if (codeBlock) {
                codeBlock.className = `language-${language}`;
                codeBlock.textContent = getDefaultCode(language);
                hljs.highlightElement(codeBlock);
            }
            addStepToThinkingUI(`Changed language to ${language}`);
        });
    }

    // Config Button
    if (configBtn) {
        configBtn.addEventListener('click', () => showConfigModal());
    }

    // Close Modal on Click Outside
    window.onclick = function(event) {
        if (event.target === modal) {
            closeConfigModal();
        }
    };
});

// Task Creation
function createTask() {
    if (isSubmitting) return;

    const promptInput = document.getElementById('prompt-input');
    const prompt = promptInput.value.trim();
    const errorMessage = document.createElement('div');
    errorMessage.className = 'input-error';
    errorMessage.textContent = 'Please enter a valid prompt';
    const chatInputContainer = document.querySelector('.chat-input-container');
    const sendBtn = document.querySelector('.btn-send');

    // Remove any existing error message
    const existingError = chatInputContainer.querySelector('.input-error');
    if (existingError) {
        existingError.remove();
    }

    // Reset any previous error styling
    promptInput.classList.remove('error');

    if (!prompt) {
        promptInput.classList.add('error');
        chatInputContainer.insertBefore(errorMessage, chatInputContainer.firstChild);
        promptInput.focus();
        return;
    }

    // Display user message in chat
    const chatMessages = document.getElementById('chat-messages');
    const userMessage = document.createElement('div');
    userMessage.className = 'message user-message';
    userMessage.innerHTML = `
        <div class="message-content">
            <p>${escapeHTML(prompt)}</p>
        </div>
    `;
    chatMessages.appendChild(userMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Clear the input immediately
    promptInput.value = '';
    promptInput.style.height = 'auto';
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

    // Clear thinking steps for new task
    const thinkingSteps = document.querySelector('#thinking-steps');
    if (thinkingSteps) {
        thinkingSteps.innerHTML = '';
        addStepToThinkingUI("Cleared thinking steps for new task");
    }

    isSubmitting = true;

    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    fetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.task_id) throw new Error('Invalid task ID');
        setupSSE(data.task_id);
        loadHistory();
    })
    .catch(error => {
        console.error('Failed to create task:', error);
        const errorMessage = document.createElement('div');
        errorMessage.className = 'input-error';
        errorMessage.textContent = 'Failed to create task. Please try again.';
        chatInputContainer.insertBefore(errorMessage, chatInputContainer.firstChild);
    })
    .finally(() => {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        isSubmitting = false;
    });
}

// Parse code blocks from the result string, handling multiple code blocks
function parseCodeFromResult(result, defaultLanguage = 'plaintext') {
    console.log('Parsing code from result:', result);

    // Check if result is a string
    if (typeof result !== 'string') {
        console.log('Result is not a string, returning default');
        return {
            code: result?.code || '// No code provided',
            language: result?.language || defaultLanguage,
            output: result?.output || ''
        };
    }

    // Look for all code blocks in the result (e.g., ```language\ncode\n```)
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
    const matches = [...result.matchAll(codeBlockRegex)];

    console.log('Found code block matches:', matches);

    if (matches.length > 0) {
        // Find the first Python code block (or first code block if no Python is found)
        let primaryMatch = matches[0];
        for (const match of matches) {
            const lang = match[1] || 'plaintext';
            if (lang.toLowerCase() === 'python') {
                primaryMatch = match;
                break;
            }
        }

        const language = primaryMatch[1] || defaultLanguage;
        const code = primaryMatch[2].trim();

        console.log('Primary code block - Language:', language, 'Code:', code);

        // Collect additional code blocks and remaining text as output
        let output = result;
        const additionalCodeBlocks = [];
        matches.forEach((match, index) => {
            const blockLanguage = match[1] || 'plaintext';
            const blockCode = match[2].trim();
            output = output.replace(match[0], '').trim();
            if (match !== primaryMatch) {
                additionalCodeBlocks.push(`[${blockLanguage}]\n${blockCode}`);
            }
        });

        console.log('Remaining output after removing code blocks:', output);
        console.log('Additional code blocks:', additionalCodeBlocks);

        // Combine the remaining text and additional code blocks as output
        if (additionalCodeBlocks.length > 0) {
            output = `${output}\n\nAdditional Code Blocks:\n${additionalCodeBlocks.join('\n\n')}`.trim();
        }

        return { code, language, output };
    }

    console.log('No code blocks found, treating result as output');
    // If no code block is found, treat the entire result as plain text output
    return { code: '// No code provided', language: 'plaintext', output: result };
}

// Update the Manus Computer screen with code and output
function updateCodeOutput({ code, language, output }) {
    const codeOutput = document.getElementById('code-output');
    const codeExecutionOutput = document.getElementById('code-execution-output');
    const languageSelect = document.querySelector('.language-select');
    const filePath = document.querySelector('.file-path');

    console.log('Updating code output - Code:', code, 'Language:', language, 'Output:', output);

    if (!codeOutput) {
        console.error('code-output element not found in the DOM');
        return;
    }
    if (!codeExecutionOutput) {
        console.error('code-execution-output element not found in the DOM');
        return;
    }

    // Update the code block
    codeOutput.textContent = code;
    codeOutput.className = `language-${language}`;
    hljs.highlightElement(codeOutput);

    // Update the language selector and file path
    if (languageSelect) {
        languageSelect.value = language;
    } else {
        console.warn('language-select element not found');
    }
    if (filePath) {
        filePath.textContent = `main.${language}`;
    } else {
        console.warn('file-path element not found');
    }

    // Display execution output if provided
    if (output) {
        codeExecutionOutput.innerHTML = `
            <div class="code-output-header">
                <span>Output</span>
                <button class="btn-close-output"><i class="fas fa-times"></i></button>
            </div>
            <div class="code-output-content">
                <pre class="code-output">${escapeHTML(output)}</pre>
            </div>
        `;
        const closeButton = codeExecutionOutput.querySelector('.btn-close-output');
        closeButton.addEventListener('click', () => {
            codeExecutionOutput.innerHTML = '';
        });
    } else {
        codeExecutionOutput.innerHTML = '';
    }

    addStepToThinkingUI(`Updated Manus Computer with ${language} code`);
}

// Setup Server-Sent Events (SSE) to handle backend updates
function setupSSE(taskId) {
    const eventSource = new EventSource(`/tasks/${taskId}/events`);
    currentEventSource = eventSource;

    showThinking();
    addStepToThinkingUI(`Connected to task ${taskId}`);

    eventSource.onmessage = event => {
        const data = JSON.parse(event.data);
        console.log('Received SSE event:', data);

        if (data.type === 'heartbeat') return;
        updateUI(data);

        // Check if the event contains code output
        if (['think', 'tool', 'act', 'run', 'result'].includes(data.type) && data.result) {
            console.log(`Processing ${data.type} event for code output`);
            const defaultLanguage = document.querySelector('.language-select')?.value || 'plaintext';
            const { code, language, output } = parseCodeFromResult(data.result, defaultLanguage);
            updateCodeOutput({ code, language, output });
        } else {
            console.log(`Event type ${data.type} does not require code output processing or result is missing`);
        }
    };

    eventSource.addEventListener('status', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI(`Task status updated: ${data.status}`);
    });

    eventSource.addEventListener('think', event => {
        const data = JSON.parse(event.data);
        console.log('Received think event:', data);
        addStepToThinkingUI(`Thought: ${data.result}`);
        updateUI(data);
    });

    eventSource.addEventListener('tool', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI(`Tool execution: ${data.result}`);
        updateUI(data);
    });

    eventSource.addEventListener('act', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI(`Action: ${data.result}`);
        updateUI(data);
    });

    eventSource.addEventListener('run', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI(`Step ${data.step}: ${data.result}`);
        updateUI(data);
    });

    eventSource.addEventListener('complete', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI("Task completed successfully");
        showCompletion(data);
        hideThinking();
        eventSource.close();
    });

    eventSource.addEventListener('error', event => {
        const data = JSON.parse(event.data);
        addStepToThinkingUI(`Error: ${data.message}`);
        hideThinking();
        eventSource.close();

        // Display error in the code output
        updateCodeOutput({
            code: '// Error occurred',
            language: 'plaintext',
            output: data.message || 'An error occurred while processing the task.'
        });
    });

    eventSource.onerror = () => {
        console.error('SSE connection error');
        addStepToThinkingUI("Disconnected from task updates due to an error");
        hideThinking();
        eventSource.close();

        // Display connection error in the code output
        updateCodeOutput({
            code: '// Connection error',
            language: 'plaintext',
            output: 'Failed to connect to the server for task updates.'
        });
    };
}

// UI Updates
function updateUI(data) {
    const container = document.getElementById('chat-messages');
    const message = document.createElement('div');
    message.className = 'message ai-message';

    let content = '';
    switch (data.type) {
        case 'think':
            content = `🤔 Thought: ${data.result}`;
            break;
        case 'tool':
            content = `🛠️ Tool: ${data.result}`;
            break;
        case 'act':
            content = `🎯 Action: ${data.result}`;
            break;
        case 'run':
            content = `📝 Step ${data.step}: ${data.result}`;
            break;
        case 'result':
            content = `✅ Result: ${data.result}`;
            break;
        default:
            content = data.result || 'Processing...';
    }

    message.innerHTML = `
        <div class="message-avatar">
            <img src="../static/images/avatar.jpg" alt="Manus Avatar">
        </div>
        <div class="message-content">
            <p>${content}</p>
        </div>
    `;
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

function showCompletion(data) {
    const container = document.querySelector('.completion-content');
    if (container) {
        container.innerHTML = `<p>✅ Task completed: ${data.result || 'Success'}</p>`;
        container.classList.remove('hidden');
    }
}

// Thinking UI
function createThinkingUI() {
    const thinkingContainer = document.querySelector('.thinking-container');
    if (thinkingContainer) {
        thinkingContainer.innerHTML = `
            <div class="thinking-header">
                <span>Thinking...</span>
                <div class="thinking-actions">
                    <button class="btn-clear-thinking"><i class="fas fa-trash"></i></button>
                </div>
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
            <div class="thinking-steps" id="thinking-steps"></div>
        `;
        thinkingContainer.classList.add('hidden');

        const clearBtn = thinkingContainer.querySelector('.btn-clear-thinking');
        clearBtn.addEventListener('click', () => {
            const thinkingSteps = document.querySelector('#thinking-steps');
            if (thinkingSteps) {
                thinkingSteps.innerHTML = '';
                addStepToThinkingUI("Cleared thinking steps");
            }
        });
    }
}

function showThinking() {
    const thinkingContainer = document.querySelector('.thinking-container');
    if (thinkingContainer) {
        thinkingContainer.classList.remove('hidden');
        const thinkingSteps = document.querySelector('#thinking-steps');
        if (thinkingSteps) {
            thinkingSteps.innerHTML = '';
        }
        addStepToThinkingUI("Starting to process request");
    }
}

function hideThinking() {
    const thinkingContainer = document.querySelector('.thinking-container');
    if (thinkingContainer) {
        thinkingContainer.classList.add('hidden');
    }
}

window.addStepToThinkingUI = function(step) {
    const thinkingSteps = document.querySelector('#thinking-steps');
    if (thinkingSteps) {
        const stepElement = document.createElement('div');
        stepElement.className = 'thinking-step';
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        stepElement.innerHTML = `
            <span class="step-timestamp">[${timestamp}]</span>
            <span class="step-content">${step}</span>
        `;
        thinkingSteps.appendChild(stepElement);
        thinkingSteps.scrollTop = thinkingSteps.scrollHeight;
    }
};

window.updateThinkingUI = function(taskTitle) {
    const thinkingContainer = document.querySelector('.thinking-container');
    if (thinkingContainer) {
        const thinkingHeader = thinkingContainer.querySelector('.thinking-header span');
        if (thinkingHeader) {
            thinkingHeader.textContent = `Thinking about: ${taskTitle}`;
        }
        addStepToThinkingUI(`Focusing on task: ${taskTitle}`);
    }
};

// Task History
function loadHistory() {
    fetch('/tasks')
    .then(res => res.json())
    .then(tasks => {
        const list = document.getElementById('task-list');
        list.innerHTML = tasks.map(task => `
            <div class="task" onclick="setupSSE('${task.id}')">
                <div class="task-icon"><i class="fas fa-robot"></i></div>
                <div class="task-info">
                    <div class="task-title">${task.prompt}</div>
                    <div class="task-meta">${new Date(task.created_at).toLocaleString()}</div>
                </div>
            </div>
        `).join('');
    })
    .catch(err => console.error('Failed to load history:', err));
}

// Configuration Modal
function checkConfigStatus() {
    fetch('/config/status')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'missing') {
            showConfigModal(data.example_config);
        }
    })
    .catch(err => console.error('Failed to check config status:', err));
}

function showConfigModal(exampleConfig = null) {
    const modal = document.getElementById('config-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'flex';
        modal.classList.add('active');
        if (exampleConfig) {
            fillConfigForm(exampleConfig);
        }
    }, 10);
}

function closeConfigModal() {
    const modal = document.getElementById('config-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function fillConfigForm(cfg) {
    ['llm-model', 'llm-base-url', 'llm-api-key', 'server-host', 'server-port'].forEach(id => {
        if (cfg.llm && cfg.llm[id]) {
            document.getElementById(id).value = cfg.llm[id];
        } else if (cfg.server && (id === 'server-host' || id === 'server-port')) {
            document.getElementById(id).value = cfg.server[id.split('-')[1]];
        }
    });
}

function saveConfig() {
    const cfg = {
        llm: {
            model: document.getElementById('llm-model').value,
            base_url: document.getElementById('llm-base-url').value,
            api_key: document.getElementById('llm-api-key').value
        },
        server: {
            host: document.getElementById('server-host').value,
            port: parseInt(document.getElementById('server-port').value)
        }
    };

    fetch('/config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(cfg)
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const modal = document.getElementById('config-modal');
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
                location.reload();
            }, 300);
        } else {
            alert(`Error saving config: ${data.message}`);
        }
    })
    .catch(err => console.error('Config save failed:', err));
}

// Code Panel Utilities
function getDefaultCode(language) {
    const defaultCodes = {
        'python': `def fibonacci(n_terms):
    sequence = [0, 1]
    for i in range(2, n_terms):
        sequence.append(sequence[i-1] + sequence[i-2])
    return sequence

n_terms = 10
result = fibonacci(n_terms)
print(f"Fibonacci sequence with {n_terms} terms:")
print(result)`,
        'javascript': `function calculateProgress() {
    const container = document.querySelector('.progress-fill');
    let progress = 0;
    
    const interval = setInterval(() => {
        progress += 10;
        if (progress > 100) {
            clearInterval(interval);
            return;
        }
        container.style.width = \`\${progress}%\`;
        console.log(\`Progress: \${progress}%\`);
    }, 500);
}

calculateProgress();`,
        'markdown': `# Welcome to Manus

This is a **Markdown** file.

- Create tasks
- Write code
- Collaborate with AI

## Getting Started

1. Select a task from the sidebar
2. Enter your prompt
3. Watch Manus work!`
    };
    return defaultCodes[language] || '// Code output will appear here';
}

// Interactive Features
function implementMessageThreading() {
    const messages = document.querySelectorAll('.message');
    messages.forEach(message => {
        const messageContent = message.querySelector('.message-content');
        if (messageContent && !messageContent.querySelector('.reply-button')) {
            const replyButton = document.createElement('div');
            replyButton.className = 'message-action reply-button';
            replyButton.innerHTML = '<i class="fas fa-reply"></i> Reply';
            messageContent.appendChild(replyButton);
            replyButton.addEventListener('click', () => showReplyInterface(message));
        }
    });
}

function showReplyInterface(parentMessage) {
    const replyInterface = document.createElement('div');
    replyInterface.className = 'reply-interface';
    const parentText = parentMessage.querySelector('.message-content p').textContent;
    const isAiMessage = parentMessage.classList.contains('ai-message');
    const sender = isAiMessage ? 'Manus' : 'You';

    replyInterface.innerHTML = `
        <div class="reply-preview">
            <div class="reply-indicator">
                <i class="fas fa-reply"></i>
                <span>Replying to ${sender}</span>
            </div>
            <div class="reply-text">${parentText.substring(0, 60)}${parentText.length > 60 ? '...' : ''}</div>
            <button class="btn-icon btn-cancel-reply"><i class="fas fa-times"></i></button>
        </div>
        <div class="reply-input-wrapper">
            <textarea placeholder="Type your reply..."></textarea>
            <button class="btn-send-reply"><i class="fas fa-paper-plane"></i></button>
        </div>
    `;

    const chatInputContainer = document.querySelector('.chat-input-container');
    chatInputContainer.prepend(replyInterface);
    const replyTextarea = replyInterface.querySelector('textarea');
    replyTextarea.focus();

    const cancelButton = replyInterface.querySelector('.btn-cancel-reply');
    cancelButton.addEventListener('click', () => replyInterface.remove());

    const sendButton = replyInterface.querySelector('.btn-send-reply');
    sendButton.addEventListener('click', () => {
        const replyText = replyTextarea.value.trim();
        if (replyText) {
            sendReply(replyText, parentMessage);
            replyInterface.remove();
        }
    });

    replyTextarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const replyText = replyTextarea.value.trim();
            if (replyText) {
                sendReply(replyText, parentMessage);
                replyInterface.remove();
            }
        }
    });
}

function sendReply(replyText, parentMessage) {
    const parentText = parentMessage.querySelector('.message-content p').textContent;
    const isAiMessage = parentMessage.classList.contains('ai-message');
    const sender = isAiMessage ? 'Manus' : 'You';
    const chatMessages = document.querySelector('.chat-messages');

    const replyMessage = document.createElement('div');
    replyMessage.className = 'message user-message';
    replyMessage.innerHTML = `
        <div class="message-content">
            <div class="replied-to">
                <div class="replied-to-indicator">
                    <i class="fas fa-reply"></i>
                    <span>Replied to ${sender}</span>
                </div>
                <div class="replied-to-text">${parentText.substring(0, 60)}${parentText.length > 60 ? '...' : ''}</div>
            </div>
            <p>${escapeHTML(replyText)}</p>
        </div>
    `;
    chatMessages.appendChild(replyMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    addStepToThinkingUI("Processing reply to message");

    setTimeout(() => {
        const aiReply = document.createElement('div');
        aiReply.className = 'message ai-message';
        aiReply.innerHTML = `
            <div class="message-avatar">
                <img src="../static/images/avatar.png" alt="Manus Avatar">
            </div>
            <div class="message-content">
                <div class="replied-to">
                    <div class="replied-to-indicator">
                        <i class="fas fa-reply"></i>
                        <span>Replied to You</span>
                    </div>
                    <div class="replied-to-text">${replyText.substring(0, 60)}${replyText.length > 60 ? '...' : ''}</div>
                </div>
                <p>I understand your reply. Let me address that specifically...</p>
            </div>
        `;
        chatMessages.appendChild(aiReply);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        addStepToThinkingUI("Generated contextual response to user's reply");
    }, 1500);
}

function implementTypingIndicators() {
    const chatInput = document.querySelector('.input-wrapper textarea');
    let typingTimeout;

    chatInput.addEventListener('input', function() {
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            addStepToThinkingUI("User stopped typing");
        }, 1000);

        if (this.value.trim().length > 0 && !document.querySelector('.typing-indicator-step')) {
            addStepToThinkingUI(`User is typing: ${this.value.substring(0, 20)}${this.value.length > 20 ? "..." : ""}`);
        }
    });

    const sendBtn = document.querySelector('.btn-send');
    const originalClickHandler = sendBtn.onclick;
    sendBtn.onclick = function(e) {
        if (originalClickHandler) {
            originalClickHandler.call(this, e);
        }
        setTimeout(showAiTypingIndicator, 500);
    };
}

function showAiTypingIndicator() {
    const chatMessages = document.querySelector('.chat-messages');
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'message ai-message ai-typing';
    typingIndicator.innerHTML = `
        <div class="message-avatar">
            <img src="../static/images/avatar.png" alt="Manus Avatar">
        </div>
        <div class="message-content typing-indicator-content">
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => typingIndicator.remove(), 1500);
}

function implementMessageReactions() {
    const messages = document.querySelectorAll('.message');
    messages.forEach(message => {
        const messageContent = message.querySelector('.message-content');
        if (messageContent && !messageContent.querySelector('.message-reactions')) {
            const reactionsContainer = document.createElement('div');
            reactionsContainer.className = 'message-reactions';
            reactionsContainer.innerHTML = `
                <div class="reaction" data-emoji="👍">
                    <span class="reaction-emoji">👍</span>
                    <span class="reaction-count">0</span>
                </div>
                <div class="reaction" data-emoji="❤️">
                    <span class="reaction-emoji">❤️</span>
                    <span class="reaction-count">0</span>
                </div>
                <div class="reaction" data-emoji="🎉">
                    <span class="reaction-emoji">🎉</span>
                    <span class="reaction-count">0</span>
                </div>
                <div class="reaction add-reaction">
                    <span class="reaction-emoji">+</span>
                </div>
            `;
            messageContent.appendChild(reactionsContainer);

            const reactions = reactionsContainer.querySelectorAll('.reaction');
            reactions.forEach(reaction => {
                if (!reaction.classList.contains('add-reaction')) {
                    reaction.addEventListener('click', function() {
                        const countElement = this.querySelector('.reaction-count');
                        let count = parseInt(countElement.textContent);
                        if (this.classList.contains('reacted')) {
                            this.classList.remove('reacted');
                            count--;
                        } else {
                            this.classList.add('reacted');
                            count++;
                            addStepToThinkingUI(`User reacted with ${this.dataset.emoji} to message`);
                        }
                        countElement.textContent = count;
                    });
                } else {
                    reaction.addEventListener('click', () => showEmojiPicker(reaction));
                }
            });
        }
    });
}

function showEmojiPicker(addButton) {
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    const commonEmojis = ['😊', '😂', '🤔', '👏', '🙌', '🔥', '✅', '❓'];
    let emojiHtml = '';
    commonEmojis.forEach(emoji => {
        emojiHtml += `<span class="emoji-option">${emoji}</span>`;
    });
    emojiPicker.innerHTML = emojiHtml;

    const rect = addButton.getBoundingClientRect();
    emojiPicker.style.position = 'absolute';
    emojiPicker.style.top = `${rect.bottom + window.scrollY + 5}px`;
    emojiPicker.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(emojiPicker);

    const emojiOptions = emojiPicker.querySelectorAll('.emoji-option');
    emojiOptions.forEach(option => {
        option.addEventListener('click', () => {
            const emoji = option.textContent;
            addCustomReaction(addButton, emoji);
            emojiPicker.remove();
        });
    });

    document.addEventListener('click', function closeEmojiPicker(e) {
        if (!emojiPicker.contains(e.target) && e.target !== addButton) {
            emojiPicker.remove();
            document.removeEventListener('click', closeEmojiPicker);
        }
    });
}

function addCustomReaction(addButton, emoji) {
    const reactionsContainer = addButton.parentElement;
    const existingReaction = Array.from(reactionsContainer.querySelectorAll('.reaction')).find(r => r.dataset.emoji === emoji);

    if (existingReaction) {
        existingReaction.click();
    } else {
        const newReaction = document.createElement('div');
        newReaction.className = 'reaction reacted';
        newReaction.dataset.emoji = emoji;
        newReaction.innerHTML = `
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">1</span>
        `;
        reactionsContainer.insertBefore(newReaction, addButton);

        newReaction.addEventListener('click', function() {
            const countElement = this.querySelector('.reaction-count');
            let count = parseInt(countElement.textContent);
            if (this.classList.contains('reacted')) {
                this.classList.remove('reacted');
                count--;
            } else {
                this.classList.add('reacted');
                count++;
            }
            countElement.textContent = count;
            if (count === 0) {
                this.remove();
            }
        });

        addStepToThinkingUI(`User added custom reaction ${emoji} to message`);
    }
}

function implementFileUpload() {
    const fileButton = document.querySelector('.input-actions .btn-icon');
    const chatInput = document.querySelector('.input-wrapper textarea');

    if (fileButton) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        fileInput.accept = 'image/*,.pdf,.doc,.docx,.txt';
        document.body.appendChild(fileInput);

        fileButton.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFileUpload(fileInput.files);
            }
        });

        if (chatInput) {
            const inputWrapper = chatInput.parentElement;
            inputWrapper.addEventListener('dragover', e => {
                e.preventDefault();
                inputWrapper.classList.add('drag-over');
            });

            inputWrapper.addEventListener('dragleave', () => {
                inputWrapper.classList.remove('drag-over');
            });

            inputWrapper.addEventListener('drop', e => {
                e.preventDefault();
                inputWrapper.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    handleFileUpload(e.dataTransfer.files);
                }
            });
        }
    }
}

function handleFileUpload(files) {
    let filePreviewContainer = document.querySelector('.file-preview-container');
    if (!filePreviewContainer) {
        filePreviewContainer = document.createElement('div');
        filePreviewContainer.className = 'file-preview-container';
        const chatInputContainer = document.querySelector('.chat-input-container');
        chatInputContainer.insertBefore(filePreviewContainer, chatInputContainer.firstChild);
    }

    Array.from(files).forEach(file => {
        const filePreview = document.createElement('div');
        filePreview.className = 'file-preview';
        let fileIcon = 'fa-file';
        if (file.type.startsWith('image/')) fileIcon = 'fa-file-image';
        else if (file.type === 'application/pdf') fileIcon = 'fa-file-pdf';
        else if (file.type.includes('word')) fileIcon = 'fa-file-word';
        else if (file.type === 'text/plain') fileIcon = 'fa-file-alt';

        filePreview.innerHTML = `
            <div class="file-preview-icon">
                <i class="fas ${fileIcon}"></i>
            </div>
            <div class="file-preview-info">
                <div class="file-preview-name">${file.name}</div>
                <div class="file-preview-size">${formatFileSize(file.size)}</div>
            </div>
            <button class="btn-remove-file"><i class="fas fa-times"></i></button>
        `;

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = e => {
                const imgPreview = document.createElement('div');
                imgPreview.className = 'image-preview';
                imgPreview.style.backgroundImage = `url(${e.target.result})`;
                filePreview.insertBefore(imgPreview, filePreview.firstChild);
            };
            reader.readAsDataURL(file);
        }

        filePreviewContainer.appendChild(filePreview);
        const removeButton = filePreview.querySelector('.btn-remove-file');
        removeButton.addEventListener('click', () => {
            filePreview.remove();
            if (filePreviewContainer.children.length === 0) {
                filePreviewContainer.remove();
            }
        });
    });

    addStepToThinkingUI(`User attached ${files.length} file(s) to message`);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function implementCodeEditing() {
    const codeContent = document.querySelector('.code-content');
    const codeElement = codeContent?.querySelector('code');

    if (codeContent && codeElement) {
        const editButton = document.createElement('button');
        editButton.className = 'code-edit-button';
        editButton.innerHTML = '<i class="fas fa-edit"></i> Edit';
        codeContent.appendChild(editButton);

        editButton.addEventListener('click', () => enableCodeEditing(codeElement));

        const executeButton = document.createElement('button');
        executeButton.className = 'code-execute-button';
        executeButton.innerHTML = '<i class="fas fa-play"></i> Run';
        codeContent.appendChild(executeButton);

        executeButton.addEventListener('click', () => executeCode(codeElement));
    }
}

function enableCodeEditing(codeElement) {
    codeElement.contentEditable = true;
    codeElement.focus();
    codeElement.classList.add('editing');
    addStepToThinkingUI("Enabled code editing mode");

    const codeContent = codeElement.parentElement.parentElement;
    if (!codeContent.querySelector('.code-save-button')) {
        const saveButton = document.createElement('button');
        saveButton.className = 'code-save-button';
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save';
        codeContent.appendChild(saveButton);
        saveButton.addEventListener('click', () => saveCodeChanges(codeElement));
    }

    if (!codeContent.querySelector('.code-cancel-button')) {
        const cancelButton = document.createElement('button');
        cancelButton.className = 'code-cancel-button';
        cancelButton.innerHTML = '<i class="fas fa-times"></i> Cancel';
        codeContent.appendChild(cancelButton);
        cancelButton.addEventListener('click', () => cancelCodeEditing(codeElement));
    }

    codeElement.dataset.originalCode = codeElement.innerHTML;
    const filePath = document.querySelector('.file-path');
    if (filePath) {
        filePath.innerHTML = filePath.textContent + ' <span class="editing-indicator">(editing)</span>';
    }
}

function saveCodeChanges(codeElement) {
    codeElement.classList.remove('editing');
    codeElement.contentEditable = false;
    const codeContent = codeElement.parentElement.parentElement;
    const saveButton = codeContent.querySelector('.code-save-button');
    const cancelButton = codeContent.querySelector('.code-cancel-button');
    if (saveButton) saveButton.remove();
    if (cancelButton) cancelButton.remove();

    const filePath = document.querySelector('.file-path');
    if (filePath) {
        const editingIndicator = filePath.querySelector('.editing-indicator');
        if (editingIndicator) editingIndicator.remove();
    }

    addStepToThinkingUI("Saved code changes");
    hljs.highlightElement(codeElement);
}

function cancelCodeEditing(codeElement) {
    if (codeElement.dataset.originalCode) {
        codeElement.innerHTML = codeElement.dataset.originalCode;
    }
    codeElement.classList.remove('editing');
    codeElement.contentEditable = false;
    const codeContent = codeElement.parentElement.parentElement;
    const saveButton = codeContent.querySelector('.code-save-button');
    const cancelButton = codeContent.querySelector('.code-cancel-button');
    if (saveButton) saveButton.remove();
    if (cancelButton) cancelButton.remove();

    const filePath = document.querySelector('.file-path');
    if (filePath) {
        const editingIndicator = filePath.querySelector('.editing-indicator');
        if (editingIndicator) editingIndicator.remove();
    }

    addStepToThinkingUI("Cancelled code editing");
    hljs.highlightElement(codeElement);
}

function executeCode(codeElement) {
    const code = codeElement.textContent;
    addStepToThinkingUI("Executing code");

    let outputContainer = document.querySelector('.code-output-container');
    if (!outputContainer) {
        outputContainer = document.createElement('div');
        outputContainer.className = 'code-output-container';
        const codeContent = codeElement.parentElement.parentElement;
        codeContent.parentElement.insertBefore(outputContainer, codeContent.nextSibling);
    }

    outputContainer.innerHTML = `
        <div class="code-output-header">
            <span>Output</span>
            <button class="btn-close-output"><i class="fas fa-times"></i></button>
        </div>
        <div class="code-output-content">
            <div class="code-output-loading">
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <span>Executing code...</span>
            </div>
        </div>
    `;

    const closeButton = outputContainer.querySelector('.btn-close-output');
    closeButton.addEventListener('click', () => outputContainer.remove());

    setTimeout(() => {
        const outputContent = outputContainer.querySelector('.code-output-content');
        const language = codeElement.className.replace('language-', '');
        let output = '';

        if (language === 'python') {
            if (code.includes('print')) {
                output = simulatePythonOutput(code);
            } else if (code.includes('def fibonacci')) {
                output = 'Fibonacci sequence with 10 terms:\n[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]';
            } else {
                output = 'Execution completed successfully.';
            }
        } else if (language === 'javascript') {
            if (code.includes('console.log')) {
                output = simulateJavaScriptOutput(code);
            } else {
                output = 'Execution completed successfully.';
            }
        } else if (language === 'markdown') {
            output = 'Markdown rendering completed.';
        } else {
            output = 'Execution completed for ' + (language || 'unknown') + ' code.';
        }

        outputContent.innerHTML = `<pre class="code-output">${output}</pre>`;
        addStepToThinkingUI("Code execution completed with output");
    }, 1500);
}

function simulatePythonOutput(code) {
    const printRegex = /print\s*\((.*?)\)/g;
    const matches = code.matchAll(printRegex);
    let output = '';
    for (const match of matches) {
        if (match[1]) {
            let content = match[1].trim();
            if (content.startsWith('f"') || content.startsWith("f'")) {
                content = content.substring(2, content.length - 1);
                content = content.replace(/\{([^}]+)\}/g, (_, expr) => {
                    if (expr === 'n_terms') return '10';
                    if (expr === 'result') return '[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]';
                    return expr;
                });
            } else if (content.startsWith('"') || content.startsWith("'")) {
                content = content.substring(1, content.length - 1);
            }
            output += content + '\n';
        }
    }
    return output || 'Execution completed successfully.';
}

function simulateJavaScriptOutput(code) {
    const logRegex = /console\.log\s*\((.*?)\)/g;
    const matches = code.matchAll(logRegex);
    let output = '';
    for (const match of matches) {
        if (match[1]) {
            let content = match[1].trim();
            if (content.startsWith('"') || content.startsWith("'") || content.startsWith('`')) {
                content = content.substring(1, content.length - 1);
                content = content.replace(/\${([^}]+)}/g, (_, expr) => {
                    if (expr === 'container') return '[object HTMLDivElement]';
                    if (expr === 'progress') return '50';
                    return expr;
                });
            }
            output += content + '\n';
        }
    }
    return output || 'Execution completed successfully.';
}

function implementTaskManagement() {
    const newTaskButton = document.querySelector('.new-task');
    if (newTaskButton) {
        newTaskButton.addEventListener('click', showNewTaskForm);
    }

    const tasks = document.querySelectorAll('.task');
    const taskList = document.querySelector('.task-list');
    if (tasks.length > 0 && taskList) {
        tasks.forEach(task => {
            task.draggable = true;
            task.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', task.dataset.taskId || 'task');
                task.classList.add('dragging');
            });
            task.addEventListener('dragend', () => task.classList.remove('dragging'));
        });

        taskList.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingTask = document.querySelector('.dragging');
            if (draggingTask) {
                const afterElement = getDragAfterElement(taskList, e.clientY);
                if (afterElement) {
                    taskList.insertBefore(draggingTask, afterElement);
                } else {
                    taskList.appendChild(draggingTask);
                }
            }
        });
    }
}

function showNewTaskForm() {
    const newTaskForm = document.createElement('div');
    newTaskForm.className = 'new-task-form';
    newTaskForm.innerHTML = `
        <div class="new-task-header">
            <h3>Create New Task</h3>
            <button class="btn-close-form"><i class="fas fa-times"></i></button>
        </div>
        <div class="new-task-content">
            <div class="form-group">
                <label for="task-title">Task Title</label>
                <input type="text" id="task-title" placeholder="Enter task title">
            </div>
            <div class="form-group">
                <label for="task-description">Description</label>
                <textarea id="task-description" placeholder="Enter task description"></textarea>
            </div>
            <div class="form-group">
                <label for="task-icon">Icon</label>
                <select id="task-icon">
                    <option value="fa-robot">Robot</option>
                    <option value="fa-code">Code</option>
                    <option value="fa-file">Document</option>
                    <option value="fa-chart-bar">Chart</option>
                    <option value="fa-database">Database</option>
                </select>
            </div>
            <div class="form-actions">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-create">Create Task</button>
            </div>
        </div>
    `;

    document.body.appendChild(newTaskForm);
    const closeButton = newTaskForm.querySelector('.btn-close-form');
    closeButton.addEventListener('click', () => newTaskForm.remove());

    const cancelButton = newTaskForm.querySelector('.btn-cancel');
    cancelButton.addEventListener('click', () => newTaskForm.remove());

    const createButton = newTaskForm.querySelector('.btn-create');
    createButton.addEventListener('click', () => {
        const title = newTaskForm.querySelector('#task-title').value.trim();
        const description = newTaskForm.querySelector('#task-description').value.trim();
        const icon = newTaskForm.querySelector('#task-icon').value;
        if (title) {
            createNewTask(title, description, icon);
            newTaskForm.remove();
            addStepToThinkingUI(`Created new task: ${title}`);
        }
    });

    setTimeout(() => newTaskForm.querySelector('#task-title').focus(), 100);
}

function createNewTask(title, description, icon) {
    const newTask = document.createElement('div');
    newTask.className = 'task';
    newTask.dataset.taskId = 'task-' + Date.now();
    newTask.innerHTML = `
        <div class="task-icon"><i class="fas ${icon}"></i></div>
        <div class="task-info">
            <div class="task-title">${title}</div>
            <div class="task-meta">Just now</div>
        </div>
    `;

    const taskList = document.querySelector('.task-list');
    if (taskList) {
        const tasks = taskList.querySelectorAll('.task');
        tasks.forEach(task => task.classList.remove('active'));
        newTask.classList.add('active');
        taskList.insertBefore(newTask, taskList.firstChild);

        newTask.draggable = true;
        newTask.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', newTask.dataset.taskId);
            newTask.classList.add('dragging');
        });
        newTask.addEventListener('dragend', () => newTask.classList.remove('dragging'));

        newTask.addEventListener('click', function() {
            const tasks = taskList.querySelectorAll('.task');
            tasks.forEach(task => task.classList.remove('active'));
            this.classList.add('active');
            updateThinkingUI(this.querySelector('.task-title').textContent);
            addStepToThinkingUI(`Switched to task: ${title}`);
        });
    }
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Initialize Interactive Features
document.addEventListener('DOMContentLoaded', () => {
    implementMessageThreading();
    implementTypingIndicators();
    implementMessageReactions();
    implementFileUpload();
    implementCodeEditing();
    implementTaskManagement();
});