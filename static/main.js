let currentEventSource = null;
let historyVisible = false; // Track history panel status

function createTask() {
    const promptInput = document.getElementById('prompt-input');
    const prompt = promptInput.value.trim();

    if (!prompt) {
        alert("Please enter a valid task");
        promptInput.focus();
        return;
    }

    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    const taskContainer = document.getElementById('task-container');
    const stepsContainer = document.getElementById('steps-container');
    const resultContainer = document.getElementById('result-container');
    
    // Hide result panel
    hideResultPanel();
    
    // Hide welcome message, show step loading status
    const welcomeMessage = taskContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }
    
    stepsContainer.innerHTML = '<div class="loading">Initializing task...</div>';
    resultContainer.innerHTML = '';

    // Close history panel on mobile devices
    closeHistoryOnMobile();

    fetch('/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.detail || 'Request failed') });
        }
        return response.json();
    })
    .then(data => {
        if (!data.task_id) {
            throw new Error('Invalid task ID');
        }
        setupSSE(data.task_id);
        loadHistory();
        promptInput.value = '';
    })
    .catch(error => {
        stepsContainer.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        updateResultPanel({result: error.message}, 'error');
        showResultPanel();
        console.error('Failed to create task:', error);
    });
}

function setupSSE(taskId) {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    let lastResultContent = '';
    let stepsData = [];

    const stepsContainer = document.getElementById('steps-container');
    const resultContainer = document.getElementById('result-container');
    
    // Hide result panel by default
    hideResultPanel();

    function connect() {
        const eventSource = new EventSource(`/tasks/${taskId}/events`);
        currentEventSource = eventSource;

        let heartbeatTimer = setInterval(() => {
            const pingDiv = document.createElement('div');
            pingDiv.className = 'ping';
            pingDiv.innerHTML = '·';
            stepsContainer.appendChild(pingDiv);
        }, 5000);

        // Initial polling
        fetch(`/tasks/${taskId}`)
            .then(response => response.json())
            .then(task => {
                updateTaskStatus(task);
            })
            .catch(error => {
                console.error('Initial status retrieval failed:', error);
            });

        const handleEvent = (event, type) => {
            clearInterval(heartbeatTimer);
            try {
                const data = JSON.parse(event.data);
                const loadingDiv = stepsContainer.querySelector('.loading');
                if (loadingDiv) loadingDiv.remove();

                const { formattedContent, timestamp, isoTimestamp } = formatStepContent(data, type);
                
                stepsData.push({
                    type: type,
                    content: formattedContent,
                    timestamp: timestamp,
                    isoTimestamp: isoTimestamp,
                    element: createStepElement(type, formattedContent, timestamp)
                });
                
                stepsData.sort((a, b) => {
                    return new Date(a.isoTimestamp) - new Date(b.isoTimestamp);
                });
                
                stepsContainer.innerHTML = '';
                stepsData.forEach(step => {
                    stepsContainer.appendChild(step.element);
                });
                
                document.querySelectorAll('.step-item').forEach(item => {
                    item.classList.remove('active');
                });
                
                const latestStep = stepsData[stepsData.length - 1];
                if (latestStep && latestStep.element) {
                    latestStep.element.classList.add('active');
                }
                
                autoScroll(stepsContainer);
                
                if (type === 'tool' || type === 'act' || type === 'result') {
                    updateResultPanel(data, type);
                    showResultPanel();
                }

                fetch(`/tasks/${taskId}`)
                    .then(response => response.json())
                    .then(task => {
                        updateTaskStatus(task);
                    })
                    .catch(error => {
                        console.error('Failed to update status:', error);
                    });
            } catch (e) {
                console.error(`Error processing ${type} event:`, e);
            }
        };

        const eventTypes = ['think', 'tool', 'act', 'log', 'run', 'message'];
        eventTypes.forEach(type => {
            eventSource.addEventListener(type, (event) => handleEvent(event, type));
        });

        eventSource.addEventListener('complete', (event) => {
            clearInterval(heartbeatTimer);
            try {
                const data = JSON.parse(event.data);
                lastResultContent = data.result || '';

                const completeDiv = document.createElement('div');
                completeDiv.className = 'complete';
                completeDiv.innerHTML = '<div>✅ Task completed</div>';
                stepsContainer.appendChild(completeDiv);
                
                updateResultPanel({result: lastResultContent}, 'complete');
                showResultPanel();

                fetch(`/tasks/${taskId}`)
                    .then(response => response.json())
                    .then(task => {
                        updateTaskStatus(task);
                    })
                    .catch(error => {
                        console.error('Failed to update final status:', error);
                    });

                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error processing completion event:', e);
            }
        });

        eventSource.addEventListener('error', (event) => {
            clearInterval(heartbeatTimer);
            try {
                const data = JSON.parse(event.data);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error';
                errorDiv.innerHTML = `<div>❌ Error: ${data.message}</div>`;
                stepsContainer.appendChild(errorDiv);
                
                updateResultPanel({result: data.message}, 'error');
                showResultPanel();
                
                eventSource.close();
                currentEventSource = null;
            } catch (e) {
                console.error('Error processing error:', e);
            }
        });

        eventSource.onerror = (err) => {
            if (eventSource.readyState === EventSource.CLOSED) return;

            console.error('SSE connection error:', err);
            clearInterval(heartbeatTimer);
            eventSource.close();

            fetch(`/tasks/${taskId}`)
                .then(response => response.json())
                .then(task => {
                    if (task.status === 'completed' || task.status === 'failed') {
                        updateTaskStatus(task);
                        if (task.status === 'completed') {
                            const completeDiv = document.createElement('div');
                            completeDiv.className = 'complete';
                            completeDiv.innerHTML = '<div>✅ Task completed</div>';
                            stepsContainer.appendChild(completeDiv);
                            
                            if (task.steps && task.steps.length > 0) {
                                const lastStep = task.steps[task.steps.length - 1];
                                updateResultPanel({result: lastStep.result}, 'complete');
                                showResultPanel();
                            }
                        } else {
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'error';
                            errorDiv.innerHTML = `<div>❌ Error: ${task.error || 'Task failed'}</div>`;
                            stepsContainer.appendChild(errorDiv);
                            
                            updateResultPanel({result: task.error || 'Task failed'}, 'error');
                            showResultPanel();
                        }
                    } else if (retryCount < maxRetries) {
                        retryCount++;
                        const warningDiv = document.createElement('div');
                        warningDiv.className = 'warning';
                        warningDiv.innerHTML = `<div>⚠ Connection lost, retrying in ${retryDelay/1000} seconds (${retryCount}/${maxRetries})...</div>`;
                        stepsContainer.appendChild(warningDiv);
                        setTimeout(connect, retryDelay);
                    } else {
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'error';
                        errorDiv.innerHTML = '<div>⚠ Connection lost, please refresh the page</div>';
                        stepsContainer.appendChild(errorDiv);
                        
                        updateResultPanel({result: 'Connection lost, please refresh the page'}, 'error');
                        showResultPanel();
                    }
                })
                .catch(error => {
                    console.error('Failed to check task status:', error);
                    if (retryCount < maxRetries) {
                        retryCount++;
                        setTimeout(connect, retryDelay);
                    }
                });
        };
    }

    connect();
}

function updateResultPanel(data, type) {
    const resultContainer = document.getElementById('result-container');
    const currentStep = document.getElementById('current-step');
    
    if (!resultContainer || !currentStep) return;
    
    // Update top step information
    const typeLabel = getEventLabel(type);
    const icon = getEventIcon(type);
    
    // Clear and build new UI
    currentStep.innerHTML = '';
    
    // Add icon
    const iconSpan = document.createElement('span');
    iconSpan.className = 'emoji-icon';
    iconSpan.textContent = icon;
    currentStep.appendChild(iconSpan);
    
    // Create status text element, add typewriter effect
    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    currentStep.appendChild(statusText);
    
    // Typewriter effect displaying status text
    let i = 0;
    let typingEffect = setInterval(() => {
        if (i < typeLabel.length) {
            statusText.textContent += typeLabel.charAt(i);
            i++;
        } else {
            clearInterval(typingEffect);
        }
    }, 50);
    
    // Update content area
    let content = '';
    
    if (data.result) {
        content = data.result;
    } else if (data.message) {
        content = data.message;
    } else {
        content = JSON.stringify(data, null, 2);
    }
    
    // Clear previous content, add new content
    resultContainer.innerHTML = '';
    
    // Create content area
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('content-box');
    contentDiv.innerHTML = `<pre>${content}</pre>`;
    resultContainer.appendChild(contentDiv);
    
    // Delay adding visible class to trigger fade-in animation
    setTimeout(() => {
        contentDiv.classList.add('visible');
    }, 100);
}

function loadHistory() {
    fetch('/tasks')
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(`Request failed: ${response.status} - ${text.substring(0, 100)}`);
            });
        }
        return response.json();
    })
    .then(tasks => {
        const listContainer = document.getElementById('task-list');
        if (tasks.length === 0) {
            listContainer.innerHTML = '<div class="info">No history tasks</div>';
            return;
        }
        
        // Update history count
        const historyCount = document.querySelector('.history-count');
        if (historyCount) {
            historyCount.textContent = tasks.length;
        }
        
        listContainer.innerHTML = tasks.map(task => `
            <div class="task-card" data-task-id="${task.id}" onclick="loadTask('${task.id}')">
                <div class="task-title">${task.prompt}</div>
                <div class="task-meta">
                    <span>${new Date(task.created_at).toLocaleString()}</span>
                    <span class="status status-${task.status ? task.status.toLowerCase() : 'unknown'}">
                        ${getStatusText(task.status)}
                    </span>
                </div>
            </div>
        `).join('');
    })
    .catch(error => {
        console.error('Failed to load history:', error);
        const listContainer = document.getElementById('task-list');
        listContainer.innerHTML = `<div class="error">Loading failed: ${error.message}</div>`;
    });
}

function loadTask(taskId) {
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    
    const taskContainer = document.getElementById('task-container');
    const stepsContainer = document.getElementById('steps-container');
    const resultContainer = document.getElementById('result-container');
    
    // Hide welcome message
    const welcomeMessage = taskContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }
    
    // Hide result panel by default
    hideResultPanel();
    
    stepsContainer.innerHTML = '<div class="loading">Loading task...</div>';
    resultContainer.innerHTML = '';
    
    // Close history panel on mobile devices
    closeHistoryOnMobile();
    
    fetch(`/tasks/${taskId}`)
        .then(response => response.json())
        .then(task => {
            const taskCards = document.querySelectorAll('.task-card');
            taskCards.forEach(card => {
                card.classList.remove('active');
                if (card.getAttribute('data-task-id') === taskId) {
                    card.classList.add('active');
                }
            });
            
            stepsContainer.innerHTML = '';
            if (task.steps && task.steps.length > 0) {
                // 存储步骤集合
                let taskSteps = [];
                
                task.steps.forEach((step, index) => {
                    const stepTimestamp = new Date(step.created_at || task.created_at).toLocaleTimeString();
                    const stepElement = createStepElement(
                        step.type, 
                        step.result, 
                        stepTimestamp
                    );
                    
                    // 将步骤添加到集合而非直接添加到DOM
                    taskSteps.push({
                        index: index,
                        timestamp: stepTimestamp,
                        element: stepElement,
                        step: step
                    });
                });
                
                // 根据时间戳和索引排序步骤
                taskSteps.sort((a, b) => {
                    // 尝试使用ISO时间戳进行比较
                    try {
                        // 如果步骤数据中包含created_at字段，使用它来排序
                        if (a.step.created_at && b.step.created_at) {
                            return new Date(a.step.created_at) - new Date(b.step.created_at);
                        }
                    } catch (e) {
                        console.error('Error sorting by ISO timestamp:', e);
                    }
                    
                    // 首先按时间戳排序
                    const timeCompare = new Date(a.timestamp) - new Date(b.timestamp);
                    // 如果时间相同，按索引排序
                    return timeCompare !== 0 ? timeCompare : a.index - b.index;
                });
                
                // 将排序后的步骤添加到容器
                taskSteps.forEach((stepData, index) => {
                    // 只将最后一个步骤设为展开状态
                    if (index === taskSteps.length - 1) {
                        stepData.element.classList.add('expanded');
                        stepData.element.classList.add('active');
                    }
                    
                    stepsContainer.appendChild(stepData.element);
                    
                    // 显示最后一个步骤的结果
                    if (index === taskSteps.length - 1) {
                        updateResultPanel({result: stepData.step.result}, stepData.step.type);
                        showResultPanel();
                    }
                });
            } else {
                stepsContainer.innerHTML = '<div class="info">No steps recorded for this task</div>';
            }
            
            updateTaskStatus(task);
        })
        .catch(error => {
            console.error('Failed to load task:', error);
            stepsContainer.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        });
}

function formatStepContent(data, eventType) {
    // 创建具有ISO格式的时间戳，确保排序一致性
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const localTime = now.toLocaleTimeString();
    
    return {
        formattedContent: data.result || (data.message || JSON.stringify(data)),
        timestamp: localTime,
        isoTimestamp: isoTimestamp // 添加ISO格式时间戳，用于排序
    };
}

function createStepElement(type, content, timestamp) {
    const step = document.createElement('div');

    // Executing step
    const stepRegex = /Executing step (\d+)\/(\d+)/;
    if (type === 'log' && stepRegex.test(content)) {
        const match = content.match(stepRegex);
        const currentStep = parseInt(match[1]);
        const totalSteps = parseInt(match[2]);

        step.className = 'step-divider';
        step.innerHTML = `
            <div class="step-circle">${currentStep}</div>
            <div class="step-line"></div>
            <div class="step-info">${currentStep}/${totalSteps}</div>
        `;
    } else {
        // Get content preview
        let contentPreview = "";
        if (type === 'think' && content.length > 0) {
            // Extract the first 50 characters of the thinking content as preview
            contentPreview = content.substring(0, 50) + (content.length > 50 ? "..." : "");
        } else if (type === 'tool' && content.includes('selected')) {
            // Tool selection content remains as is
            contentPreview = content;
        } else if (type === 'log') {
            // Log content remains as is, usually short
            contentPreview = content;
        } else {
            // Other types take the first 30 characters
            contentPreview = content.substring(0, 30) + (content.length > 30 ? "..." : "");
        }

        step.className = `step-item ${type}`;
        step.dataset.type = type;
        step.dataset.timestamp = timestamp; // 存储时间戳为数据属性
        
        // 增强时间戳显示格式
        const formattedTimestamp = `<time>${timestamp}</time>`;
        
        // Use modified layout, remove arrow indicator
        step.innerHTML = `
            <div class="log-header" onclick="toggleStepContent(this)">
                <div class="log-prefix">
                    <span class="log-prefix-icon">${getEventIcon(type)}</span>
                    [${formattedTimestamp}] ${getEventLabel(type)}
                    <span class="content-preview">${contentPreview}</span>
                </div>
                <div class="step-controls">
                    <span class="minimize-btn" onclick="minimizeStep(event, this)"></span>
                </div>
            </div>
            <div class="log-body">
                <div class="log-content">
                    <pre>${content}</pre>
                </div>
            </div>
        `;
    }
    
    // Apply fade-in animation
    step.style.opacity = '0';
    step.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        step.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        step.style.opacity = '1';
        step.style.transform = 'translateY(0)';
    }, 10);
    
    return step;
}

// Toggle display/hide of step content
function toggleStepContent(header) {
    const stepItem = header.closest('.step-item');
    if (!stepItem) return;
    
    const logBody = stepItem.querySelector('.log-body');
    if (!logBody) return;
    
    stepItem.classList.toggle('expanded');
    
    // Highlight current step
    highlightStep(stepItem);
    
    // If expanded, update result panel and show
    if (stepItem.classList.contains('expanded')) {
        const type = stepItem.dataset.type;
        const content = stepItem.querySelector('pre')?.textContent || '';
        updateResultPanel({result: content}, type);
        showResultPanel();
    }
}

// Minimize step
function minimizeStep(event, btn) {
    event.stopPropagation(); // Prevent event bubbling
    
    const stepItem = btn.closest('.step-item');
    if (!stepItem) return;
    
    stepItem.classList.toggle('expanded');
}

// Toggle result panel display state
function toggleResultPanel() {
    const resultPanel = document.getElementById('result-panel');
    const container = document.querySelector('.container');
    if (!resultPanel) return;
    
    // If panel is already minimized, fully display
    if (resultPanel.classList.contains('minimized')) {
        resultPanel.classList.remove('minimized');
        container.classList.add('with-result');
    } else {
        // Otherwise minimize panel
        resultPanel.classList.add('minimized');
        container.classList.remove('with-result');
    }
}

// Hide result panel
function hideResultPanel() {
    const resultPanel = document.getElementById('result-panel');
    const container = document.querySelector('.container');
    if (resultPanel) {
        resultPanel.classList.add('hidden');
        resultPanel.classList.remove('minimized'); // Ensure minimized state is reset when hiding
        container.classList.remove('with-result'); // Remove container style
    }
}

// Show result panel
function showResultPanel() {
    const resultPanel = document.getElementById('result-panel');
    const container = document.querySelector('.container');
    if (resultPanel) {
        resultPanel.classList.remove('hidden');
        resultPanel.classList.remove('minimized'); // Ensure not minimized when showing
        container.classList.add('with-result'); // Add container style
    }
}

function autoScroll(element) {
    requestAnimationFrame(() => {
        element.scrollTo({
            top: element.scrollHeight,
            behavior: 'smooth'
        });
    });
    setTimeout(() => {
        element.scrollTop = element.scrollHeight;
    }, 100);
}

function getEventIcon(type) {
    switch (type) {
        case 'think': return '🤔';
        case 'tool': return '🛠️';
        case 'act': return '🚀';
        case 'log': return '📝';
        case 'run': return '▶️';
        case 'message': return '💬';
        case 'complete': return '✅';
        case 'error': return '❌';
        default: return '📌';
    }
}

function getEventLabel(type) {
    switch (type) {
        case 'think': return 'Thinking';
        case 'tool': return 'Using Tool';
        case 'act': return 'Taking Action';
        case 'log': return 'Log';
        case 'run': return 'Running';
        case 'message': return 'Message';
        case 'complete': return 'Completed';
        case 'error': return 'Error';
        default: return 'Step';
    }
}

function updateTaskStatus(task) {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;

    if (task.status === 'completed') {
        statusBar.innerHTML = `<span class="status-complete">✅ Task completed</span>`;

        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
    } else if (task.status === 'failed') {
        statusBar.innerHTML = `<span class="status-error">❌ Task failed: ${task.error || 'Unknown error'}</span>`;

        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
    } else {
        statusBar.innerHTML = `<span class="status-running">⚙️ Task running: ${task.status}</span>`;
    }
}

function showFullImage(imageSrc) {
    let modal = document.getElementById('image-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'image-modal';
        modal.className = 'image-modal';
        modal.innerHTML = `
            <span class="close-modal">&times;</span>
            <img src="${imageSrc}" class="modal-content" id="full-image">
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.close-modal');
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    } else {
        document.getElementById('full-image').src = imageSrc;
    }
    
    modal.classList.add('active');
}

function simulateRunPython(filePath) {
    let modal = document.getElementById('python-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'python-modal';
        modal.className = 'python-modal';
        modal.innerHTML = `
            <div class="python-console">
                <div class="close-modal">&times;</div>
                <div class="python-output">Loading Python file content...</div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.close-modal');
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }

    modal.classList.add('active');

    // Load Python file content
    fetch(filePath)
        .then(response => response.text())
        .then(code => {
            const outputDiv = modal.querySelector('.python-output');
            outputDiv.innerHTML = '';

            const codeElement = document.createElement('pre');
            codeElement.textContent = code;
            codeElement.style.marginBottom = '20px';
            codeElement.style.padding = '10px';
            codeElement.style.borderBottom = '1px solid #444';
            outputDiv.appendChild(codeElement);

            // Add simulation run results
            const resultElement = document.createElement('div');
            resultElement.innerHTML = `
                <div style="color: #4CAF50; margin-top: 10px; margin-bottom: 10px;">
                    > Simulation run output results:</div>
                <pre style="color: #f8f8f8;">
# This is the simulation run output results
# Actual run results may vary

# Running ${filePath.split('/').pop()}...
print("Hello from Python Simulated environment!")

# Code execution completed
</pre>
            `;
            outputDiv.appendChild(resultElement);
        })
        .catch(error => {
            console.error('Failed to load Python file:', error);
            const outputDiv = modal.querySelector('.python-output');
            outputDiv.innerHTML = `File loading error: ${error.message}`;
        });
}

// Highlight current selected step
function highlightStep(stepElement) {
    // Remove highlight from other steps
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add highlight to current step
    stepElement.classList.add('active');
}

// Toggle history panel display state
function toggleHistory() {
    const historyPanel = document.querySelector('.history-panel');
    const overlay = document.querySelector('.overlay');
    const historyToggle = document.querySelector('.history-toggle');
    const container = document.querySelector('.container');
    
    if (historyVisible) {
        // Hide history
        historyPanel.classList.remove('show');
        overlay.classList.remove('show');
        historyToggle.classList.remove('active');
        container.classList.remove('with-history');
    } else {
        // Show history
        historyPanel.classList.add('show');
        overlay.classList.add('show');
        historyToggle.classList.add('active');
        // Add spacing on large screens
        if (window.innerWidth > 768) {
            container.classList.add('with-history');
        }
    }
    
    historyVisible = !historyVisible;
}

// Close history panel on small screens
function closeHistoryOnMobile() {
    if (window.innerWidth <= 768 && historyVisible) {
        toggleHistory();
    }
}

// Get status text
function getStatusText(status) {
    switch (status) {
        case 'pending': return 'Pending';
        case 'running': return 'Running';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        default: return 'Unknown';
    }
}

// Initialize interface
document.addEventListener('DOMContentLoaded', () => {
    // Add history toggle logic
    const historyToggle = document.querySelector('.history-toggle');
    if (historyToggle) {
        historyToggle.addEventListener('click', toggleHistory);
    }
    
    // Add overlay click to close history
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        overlay.addEventListener('click', toggleHistory);
    }
    
    // Load history
    loadHistory();
    
    // Bind input field events
    document.getElementById('prompt-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            createTask();
        }
    });
    
    // Listen for window size changes
    window.addEventListener('resize', () => {
        const container = document.querySelector('.container');
        
        // Maintain history sidebar effect on large screens, remove on small screens
        if (window.innerWidth > 768 && historyVisible) {
            container.classList.add('with-history');
        } else {
            container.classList.remove('with-history');
        }
    });
    
    // Add keyboard event listener to close modal
    document.addEventListener('keydown', (e) => {
        // ESC key closes history panel
        if (e.key === 'Escape') {
            if (historyVisible) {
                toggleHistory();
            }
            
            const imageModal = document.getElementById('image-modal');
            if (imageModal && imageModal.classList.contains('active')) {
                imageModal.classList.remove('active');
            }

            const pythonModal = document.getElementById('python-modal');
            if (pythonModal && pythonModal.classList.contains('active')) {
                pythonModal.classList.remove('active');
            }
        }
    });
});
