/**
 * Voice Live Avatar - Client-side JavaScript
 * Handles audio capture (AudioWorklet 24kHz PCM16), WebSocket communication,
 * WebRTC avatar video, and UI state management.
 */

// ===== State =====
let ws = null;
let audioContext = null;
let workletNode = null;
let mediaStream = null;
let playbackContext = null;
let playbackBufferQueue = [];
let nextPlaybackTime = 0;
let isConnected = false;
let isConnecting = false;
let isRecording = false;
let audioChunksSent = 0;
let isDeveloperMode = false;
let avatarEnabled = false;
let peerConnection = null;
let avatarVideoElement = null;
let isSpeaking = false;
let avatarOutputMode = 'webrtc';
let cachedIceServers = null;
let peerConnectionQueue = [];

// Volume animation state
let analyserNode = null;
let analyserDataArray = null;
let micAnalyserNode = null;
let micAnalyserDataArray = null;
let recordAnimationFrameId = null;
let playChunkAnimationFrameId = null;

// WebSocket video playback (MediaSource Extensions)
let mediaSource = null;
let sourceBuffer = null;
let videoChunksQueue = [];
let pendingWsVideoElement = null;

const clientId = 'client-' + Math.random().toString(36).substr(2, 9);

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
    setupUIBindings();
    updateConditionalFields();
    updateControlStates();
    fetchServerConfig();
});

// ===== Server Config =====
async function fetchServerConfig() {
    try {
        const resp = await fetch('/api/config');
        const config = await resp.json();
        if (config.endpoint) document.getElementById('endpoint').value = config.endpoint;
        if (config.model) {
            const modelEl = document.getElementById('model');
            modelEl.value = config.model;
            modelEl.dispatchEvent(new Event('change'));
        }
        if (config.voice) document.getElementById('voiceName').value = config.voice;
    } catch (e) {
        console.log('No server config available, using defaults');
    }
}

// ===== UI Bindings =====
function setupUIBindings() {
    // Mode change
    document.getElementById('mode').addEventListener('change', updateConditionalFields);
    // Model change
    document.getElementById('model').addEventListener('change', (e) => {
        const voiceTypeEl = document.getElementById('voiceType');
        if (e.target.value === 'azure-realtime') {
            voiceTypeEl.value = 'azure-realtime-native';
            const nativeEl = document.getElementById('nativeVoiceName');
            if (nativeEl) nativeEl.value = 'ava';
        } else if (voiceTypeEl.value === 'azure-realtime-native') {
            voiceTypeEl.value = 'standard';
        }
        updateConditionalFields();
    });
    // Voice type change
    document.getElementById('voiceType').addEventListener('change', updateConditionalFields);
    // Voice name change
    document.getElementById('voiceName').addEventListener('change', updateConditionalFields);
    // Avatar enabled
    document.getElementById('avatarEnabled').addEventListener('change', updateConditionalFields);
    // Photo avatar
    document.getElementById('isPhotoAvatar').addEventListener('change', updateConditionalFields);
    // Custom avatar
    document.getElementById('isCustomAvatar').addEventListener('change', updateConditionalFields);
    // Developer mode
    document.getElementById('developerMode').addEventListener('change', (e) => {
        isDeveloperMode = e.target.checked;
        updateDeveloperModeLayout();
    });
    // Turn detection type
    document.getElementById('turnDetectionType').addEventListener('change', updateConditionalFields);
    // SR Model
    document.getElementById('srModel').addEventListener('change', updateConditionalFields);

    // Range sliders - display values
    setupRangeDisplay('temperature', 'tempValue', v => v);
    setupRangeDisplay('voiceTemperature', 'voiceTempValue', v => v);
    setupRangeDisplay('voiceSpeed', 'voiceSpeedValue', v => v + '%');
    setupRangeDisplay('sceneZoom', 'sceneZoomLabel', v => 'Zoom: ' + v + '%');
    setupRangeDisplay('scenePositionX', 'scenePositionXLabel', v => 'Position X: ' + v + '%');
    setupRangeDisplay('scenePositionY', 'scenePositionYLabel', v => 'Position Y: ' + v + '%');
    setupRangeDisplay('sceneRotationX', 'sceneRotationXLabel', v => 'Rotation X: ' + v + ' deg');
    setupRangeDisplay('sceneRotationY', 'sceneRotationYLabel', v => 'Rotation Y: ' + v + ' deg');
    setupRangeDisplay('sceneRotationZ', 'sceneRotationZLabel', v => 'Rotation Z: ' + v + ' deg');
    setupRangeDisplay('sceneAmplitude', 'sceneAmplitudeLabel', v => 'Amplitude: ' + v + '%');

    // Scene sliders: send real-time updates when connected
    const sceneSliders = ['sceneZoom', 'scenePositionX', 'scenePositionY',
        'sceneRotationX', 'sceneRotationY', 'sceneRotationZ', 'sceneAmplitude'];
    sceneSliders.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', throttledUpdateAvatarScene);
    });

    // Accordion behavior: only one settings group open at a time
    const settingsGroups = document.querySelectorAll('.sidebar .settings-group');
    settingsGroups.forEach(group => {
        group.addEventListener('toggle', () => {
            if (group.open) {
                settingsGroups.forEach(other => {
                    if (other !== group && other.open) {
                        other.removeAttribute('open');
                    }
                });
            }
        });
    });
}

function setupRangeDisplay(sliderId, displayId, formatter) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (slider && display) {
        slider.addEventListener('input', () => {
            display.textContent = formatter(slider.value);
        });
    }
}

// ===== Photo Avatar Scene Update =====
let lastSceneUpdate = 0;
const SCENE_THROTTLE_MS = 50;

function throttledUpdateAvatarScene() {
    const now = Date.now();
    if (now - lastSceneUpdate < SCENE_THROTTLE_MS) return;
    lastSceneUpdate = now;
    updateAvatarScene();
}

function updateAvatarScene() {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!document.getElementById('isPhotoAvatar')?.checked) return;
    if (!document.getElementById('avatarEnabled')?.checked) return;

    const isCustom = document.getElementById('isCustomAvatar')?.checked || false;
    const avatarName = isCustom
        ? document.getElementById('customAvatarName')?.value || ''
        : document.getElementById('photoAvatarName')?.value || 'Anika';
    const parts = avatarName.split('-');
    const character = parts[0].toLowerCase();
    const style = parts.slice(1).join('-') || undefined;

    const scene = {
        zoom: parseInt(document.getElementById('sceneZoom').value) / 100,
        position_x: parseInt(document.getElementById('scenePositionX').value) / 100,
        position_y: parseInt(document.getElementById('scenePositionY').value) / 100,
        rotation_x: parseInt(document.getElementById('sceneRotationX').value) * Math.PI / 180,
        rotation_y: parseInt(document.getElementById('sceneRotationY').value) * Math.PI / 180,
        rotation_z: parseInt(document.getElementById('sceneRotationZ').value) * Math.PI / 180,
        amplitude: parseInt(document.getElementById('sceneAmplitude').value) / 100,
    };

    const avatar = {
        type: 'photo-avatar',
        model: 'vasa-1',
        character: character,
        scene: scene,
    };
    if (isCustom) {
        avatar.customized = true;
    } else if (style) {
        avatar.style = style;
    }

    ws.send(JSON.stringify({
        type: 'update_scene',
        avatar: avatar,
    }));
}

// ===== Conditional Field Visibility =====
function updateConditionalFields() {
    const mode = document.getElementById('mode').value;
    const model = document.getElementById('model').value;
    const voiceType = document.getElementById('voiceType').value;
    const voiceName = document.getElementById('voiceName').value;
    const avatarEnabled = document.getElementById('avatarEnabled').checked;
    const isPhotoAvatar = document.getElementById('isPhotoAvatar').checked;
    const isCustomAvatar = document.getElementById('isCustomAvatar').checked;
    const turnDetectionType = document.getElementById('turnDetectionType').value;
    const srModel = document.getElementById('srModel').value;

    // Cascaded models
    const cascadedModels = [
        'gpt-5.4', 'gpt-5.3-chat', 'gpt-5.2', 'gpt-5.2-chat', 'gpt-5.1', 'gpt-5.1-chat',
        'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat',
        'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini',
    ];
    const isCascaded = cascadedModels.includes(model);
    const isRealtime = model && model.includes('realtime');

    // Mode: agent vs model -> show/hide fields
    const isAgent = mode === 'agent' || mode === 'agent-v2';
    show('agentFields', isAgent);
    show('modelField', !isAgent);
    show('instructionsField', !isAgent);
    show('temperatureField', !isAgent);

    // Agent ID vs Agent Name
    show('agentIdField', mode === 'agent');
    show('agentNameField', mode === 'agent-v2');

    // Subscription key vs Entra token (agents = entra, model = subscription key)
    show('subscriptionKeyField', !isAgent);
    show('entraTokenField', isAgent);

    // Cascaded-only fields
    show('srModelField', !isAgent && isCascaded);
    show('recognitionLanguageField', !isAgent && isCascaded && srModel !== 'mai-ears-1');
    show('eouDetectionField', !isAgent && isCascaded);

    // Filler words (semantic VAD)
    show('fillerWordsField', turnDetectionType === 'azure_semantic_vad');

    // Voice type variants
    show('standardVoiceField', voiceType === 'standard');
    show('customVoiceFields', voiceType === 'custom');
    show('personalVoiceFields', voiceType === 'personal');
    show('nativeVoiceField', voiceType === 'azure-realtime-native');

    // Voice temperature (DragonHD or personal voice)
    const isDragonHD = voiceName && voiceName.includes('DragonHD');
    const isPersonal = voiceType === 'personal';
    show('voiceTempField', voiceType !== 'azure-realtime-native' && (isDragonHD || isPersonal));

    show('voiceSpeedField', voiceType !== 'azure-realtime-native');

    const nativeOpt = document.querySelector('#voiceType option[value="azure-realtime-native"]');
    if (nativeOpt) nativeOpt.hidden = (model !== 'azure-realtime');

    // Avatar settings
    show('avatarSettings', avatarEnabled);
    show('standardAvatarField', !isPhotoAvatar && !isCustomAvatar);
    show('photoAvatarField', isPhotoAvatar && !isCustomAvatar);
    show('customAvatarField', isCustomAvatar);
    show('photoAvatarSceneSettings', isPhotoAvatar);
}

function show(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
}

// ===== Sidebar Toggle (mobile) =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ===== Chat =====
function addMessage(role, text, isDev = false) {
    if (isDev && !isDeveloperMode) return;
    const messagesEl = document.getElementById('messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isDev ? 'dev' : role}`;

    if (!isDev) {
        const roleSpan = document.createElement('div');
        roleSpan.className = 'message-role';
        roleSpan.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System';
        msgDiv.appendChild(roleSpan);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;
    msgDiv.appendChild(contentDiv);

    messagesEl.appendChild(msgDiv);
    scrollChatToBottom();
    updateClearChatButton();
    return contentDiv;
}

function updateLastAssistantMessage(text) {
    const messages = document.querySelectorAll('.message.assistant .message-content');
    if (messages.length > 0) {
        messages[messages.length - 1].textContent = text;
        scrollChatToBottom();
    }
}

function scrollChatToBottom() {
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;
}

function clearChat() {
    const messages = document.getElementById('messages');
    if (messages.children.length === 0) return;
    messages.innerHTML = '';
    updateClearChatButton();
}

function updateClearChatButton() {
    const btn = document.getElementById('clearChatBtn');
    const messages = document.getElementById('messages');
    if (!btn || !messages) return;
    const hasMessages = messages.children.length > 0;
    btn.disabled = !hasMessages;
    btn.style.opacity = hasMessages ? '' : '0.5';
}

// ===== Gather Config =====
function gatherConfig() {
    const mode = document.getElementById('mode').value;
    const model = document.getElementById('model').value;
    const voiceType = document.getElementById('voiceType').value;
    const isPhotoAvatar = document.getElementById('isPhotoAvatar').checked;
    const isCustomAvatar = document.getElementById('isCustomAvatar').checked;

    const voiceSpeed = parseFloat(document.getElementById('voiceSpeed').value) / 100;

    const voiceName = voiceType === 'azure-realtime-native'
        ? document.getElementById('nativeVoiceName').value
        : document.getElementById('voiceName').value;

    const config = {
        mode: mode,
        model: model,
        voiceType: voiceType,
        voiceName: voiceName,
        voiceSpeed: voiceSpeed,
        voiceTemperature: parseFloat(document.getElementById('voiceTemperature').value),
        voiceDeploymentId: document.getElementById('voiceDeploymentId').value,
        customVoiceName: document.getElementById('customVoiceName').value,
        personalVoiceName: document.getElementById('personalVoiceName').value,
        personalVoiceModel: document.getElementById('personalVoiceModel').value,
        avatarEnabled: document.getElementById('avatarEnabled').checked,
        isPhotoAvatar: isPhotoAvatar,
        isCustomAvatar: isCustomAvatar,
        avatarName: isCustomAvatar
            ? document.getElementById('customAvatarName').value
            : isPhotoAvatar
                ? document.getElementById('photoAvatarName').value
                : document.getElementById('avatarName').value,
        avatarOutputMode: document.getElementById('avatarOutputMode').value,
        avatarBackgroundImageUrl: document.getElementById('avatarBackgroundImageUrl').value,
        useNS: document.getElementById('useNS').checked,
        useEC: document.getElementById('useEC').checked,
        turnDetectionType: document.getElementById('turnDetectionType').value,
        removeFillerWords: document.getElementById('removeFillerWords').checked,
        srModel: document.getElementById('srModel').value,
        recognitionLanguage: document.getElementById('recognitionLanguage').value,
        eouDetectionType: document.getElementById('eouDetectionType').value,
        instructions: document.getElementById('instructions').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        enableProactive: document.getElementById('enableProactive').checked,
        // Agent fields
        agentId: document.getElementById('agentId').value,
        agentName: document.getElementById('agentName').value,
        agentProjectName: document.getElementById('agentProjectName').value,
    };

    // Photo avatar scene settings
    if (isPhotoAvatar) {
        config.photoScene = {
            zoom: parseInt(document.getElementById('sceneZoom').value),
            positionX: parseInt(document.getElementById('scenePositionX').value),
            positionY: parseInt(document.getElementById('scenePositionY').value),
            rotationX: parseInt(document.getElementById('sceneRotationX').value),
            rotationY: parseInt(document.getElementById('sceneRotationY').value),
            rotationZ: parseInt(document.getElementById('sceneRotationZ').value),
            amplitude: parseInt(document.getElementById('sceneAmplitude').value),
        };
    }

    return config;
}

// ===== Connection =====
async function toggleConnection() {
    if (isConnecting) return;
    if (isConnected) {
        await disconnect();
    } else {
        await connectSession();
    }
}

async function connectSession() {
    const endpoint = document.getElementById('endpoint').value.trim();
    const mode = document.getElementById('mode').value;
    const isAgent = mode === 'agent' || mode === 'agent-v2';

    if (!endpoint) {
        addMessage('system', 'Please enter Azure AI Services Endpoint');
        return;
    }

    // Validate credentials
    const apiKey = document.getElementById('apiKey')?.value.trim();
    const entraToken = document.getElementById('entraToken')?.value.trim();

    if (!isAgent && !apiKey) {
        addMessage('system', 'Please enter Subscription Key');
        return;
    }
    if (isAgent && !entraToken) {
        addMessage('system', 'Please enter Entra ID Token');
        return;
    }

    setConnecting(true);
    addMessage('system', 'Session started, click on the mic button to start conversation! debug id: connecting...');

    try {
        // Open WebSocket to Python backend
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/ws/${clientId}`);

        ws.onopen = () => {
            const config = gatherConfig();
            // Send credentials to server
            config.endpoint = endpoint;
            if (isAgent) {
                config.entraToken = entraToken;
            } else {
                config.apiKey = apiKey;
            }
            ws.send(JSON.stringify({ type: 'start_session', config }));
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleServerMessage(msg);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error', err);
            addMessage('system', 'WebSocket error');
            setConnecting(false);
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
            if (isConnected) {
                addMessage('system', 'Disconnected');
            }
            handleDisconnect();
        };

    } catch (err) {
        console.error('Connection error', err);
        addMessage('system', 'Failed to connect: ' + err.message);
        setConnecting(false);
    }
}

async function disconnect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop_session' }));
    }
    handleDisconnect();
}

function handleDisconnect() {
    isConnected = false;
    isConnecting = false;
    isRecording = false;
    audioChunksSent = 0;
    avatarEnabled = false;

    stopAudioCapture();
    stopAudioPlayback();
    cleanupWebRTC();
    cleanupWebSocketVideo();
    updateSoundWaveAnimation();

    // Prepare next peer connection for faster reconnection
    if (cachedIceServers) {
        preparePeerConnection(cachedIceServers);
    }

    if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
    }

    updateConnectionUI();
    updateDeveloperModeLayout();
}

// ===== Handle Server Messages =====
function handleServerMessage(msg) {
    const type = msg.type;

    switch (type) {
        case 'session_started':
            onSessionStarted(msg);
            break;
        case 'session_error':
            addMessage('system', 'Error: ' + (msg.error || 'Unknown error'));
            setConnecting(false);
            break;
        case 'ice_servers':
            // Only setup WebRTC when avatar output mode is webrtc
            if (avatarOutputMode === 'webrtc') {
                setupWebRTC(msg.iceServers);
            }
            break;
        case 'avatar_sdp_answer':
            handleAvatarSdpAnswer(msg.serverSdp);
            break;
        case 'audio_data':
            handleAudioDelta(msg.data);
            break;
        case 'transcript_done':
            if (msg.role === 'user') {
                // Update existing placeholder by itemId, or add new message
                const itemId = msg.itemId;
                if (itemId) {
                    const existing = document.querySelector(`.message.user[data-item-id="${itemId}"] .message-content`);
                    if (existing) {
                        existing.textContent = msg.transcript;
                        scrollChatToBottom();
                        break;
                    }
                }
                addMessage('user', msg.transcript);
            } else if (msg.role === 'assistant') {
                // Finalize the streaming assistant message (don't create a new one)
                if (msg.transcript) {
                    const assistantMsgs = document.querySelectorAll('.message.assistant .message-content');
                    if (assistantMsgs.length > 0) {
                        assistantMsgs[assistantMsgs.length - 1].textContent = msg.transcript;
                    }
                    pendingAssistantText = '';
                }
            }
            break;
        case 'transcript_delta':
            if (msg.role === 'assistant') {
                onAssistantDelta(msg.delta);
            }
            break;
        case 'text_delta':
            onAssistantDelta(msg.delta);
            break;
        case 'text_done':
            // Text response complete - already accumulated via deltas
            break;
        case 'speech_started':
            onSpeechStarted(msg.itemId);
            break;
        case 'speech_stopped':
            onSpeechStopped();
            break;
        case 'response_created':
            pendingAssistantText = '';
            addMessage('assistant', '');
            isSpeaking = true;
            break;
        case 'response_done':
            isSpeaking = false;
            // Don't stop play-chunk animation here - the animation loop
            // will self-terminate when all buffered audio finishes playing
            break;
        case 'session_closed':
            addMessage('system', 'Session closed');
            handleDisconnect();
            break;
        case 'avatar_connecting':
            addMessage('system', 'Avatar connecting...');
            break;
        case 'video_data':
            handleVideoChunk(msg.delta);
            break;
        default:
            // Log unknown events in dev mode
            if (isDeveloperMode) {
                console.log('Unhandled:', type, msg);
            }
    }
}

let pendingAssistantText = '';

function onAssistantDelta(text) {
    pendingAssistantText += text;
    const messages = document.querySelectorAll('.message.assistant .message-content');
    if (messages.length > 0) {
        messages[messages.length - 1].textContent = pendingAssistantText;
        scrollChatToBottom();
    } else {
        // Fallback: create new message if none exists
        addMessage('assistant', pendingAssistantText);
    }
}

async function onSessionStarted(msg) {
    isConnected = true;
    isConnecting = false;
    updateConnectionUI();

    // Update the "connecting..." status message with the real session ID
    const sessionId = msg.sessionId || '';
    const statusMessages = document.querySelectorAll('.message.system .message-content');
    for (const el of statusMessages) {
        if (el.textContent.includes('debug id: connecting...')) {
            el.textContent = `Session started, click on the mic button to start conversation! debug id: ${sessionId || 'unknown'}`;
            break;
        }
    }

    // Show appropriate content area
    avatarEnabled = msg.config?.avatarEnabled || false;
    avatarOutputMode = msg.config?.avatarOutputMode || 'webrtc';
    const isPhotoAvatarSession = document.getElementById('isPhotoAvatar')?.checked || false;
    const avatarContainer = document.getElementById('avatarVideoContainer');
    if (avatarContainer) {
        avatarContainer.classList.toggle('photo-avatar', isPhotoAvatarSession);
    }
    updateDeveloperModeLayout();

    // If avatar is enabled with websocket mode, set up MediaSource video playback
    if (avatarEnabled && avatarOutputMode === 'websocket') {
        setupWebSocketVideoPlayback(isPhotoAvatarSession);
    }

    // Show record button for non-dev mode
    document.getElementById('recordContainer').style.display = '';

    // Start audio capture but leave mic off by default
    await startAudioCapture();
    isRecording = false;
    stopRecordAnimation();
    resetVolumeCircle();
    updateMicUI();
}

// ===== UI State =====
function setConnecting(connecting) {
    isConnecting = connecting;
    updateConnectionUI();
}

function updateConnectionUI() {
    const btn = document.getElementById('connectBtn');
    const text = document.getElementById('connectBtnText');

    btn.classList.remove('connected', 'connecting');
    if (isConnected) {
        btn.classList.add('connected');
        text.textContent = 'Disconnect';
    } else if (isConnecting) {
        btn.classList.add('connecting');
        text.textContent = 'Connecting...';
    } else {
        text.textContent = 'Connect';
    }

    // Disable connect button while connecting
    btn.disabled = isConnecting;

    // Scene Settings title: show "(Live Adjustable)" when connected
    const sceneTitle = document.getElementById('sceneSettingsTitle');
    if (sceneTitle) {
        sceneTitle.textContent = isConnected ? 'Scene Settings (Live Adjustable)' : 'Scene Settings';
    }

    // Update all control disabled states
    updateControlStates();

    // Mic buttons
    updateMicUI();
}

// ===== Control Enable/Disable States =====
// Controls that should be disabled when connected (locked during session)
const SETTINGS_CONTROLS = [
    // Connection Settings
    'mode', 'endpoint', 'apiKey', 'entraToken',
    'agentProjectName', 'agentId', 'agentName', 'model',
    // Conversation Settings
    'srModel', 'recognitionLanguage',
    'useNS', 'useEC', 'turnDetectionType', 'removeFillerWords',
    'eouDetectionType', 'instructions', 'enableProactive',
    'temperature', 'voiceTemperature', 'voiceSpeed',
    // Voice Configuration
    'voiceType', 'voiceDeploymentId', 'customVoiceName',
    'personalVoiceName', 'personalVoiceModel', 'voiceName',
    // Avatar Configuration
    'avatarEnabled', 'isPhotoAvatar', 'avatarOutputMode',
    'isCustomAvatar', 'avatarName', 'photoAvatarName',
    'customAvatarName', 'avatarBackgroundImageUrl',
];

// Controls that should be disabled when NOT connected (chat interaction)
const CHAT_CONTROLS = [
    'textInput',
];

function updateControlStates() {
    // Disable all settings controls when connected
    for (const id of SETTINGS_CONTROLS) {
        const el = document.getElementById(id);
        if (el) el.disabled = isConnected;
    }

    // Disable chat controls when NOT connected
    for (const id of CHAT_CONTROLS) {
        const el = document.getElementById(id);
        if (el) el.disabled = !isConnected;
    }

    // Mic button (developer mode) - disabled when not connected
    const micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.disabled = !isConnected;

    // Send button - disabled when not connected
    const sendBtns = document.querySelectorAll('.send-btn');
    sendBtns.forEach(btn => btn.disabled = !isConnected);

    // Record button (non-developer mode footer) - disabled when not connected
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) recordBtn.disabled = !isConnected;
}

function updateDeveloperModeLayout() {
    const contentArea = document.getElementById('contentArea');
    const avatarVideoContainer = document.getElementById('avatarVideoContainer');
    const volumeAnimation = document.getElementById('volumeAnimation');
    const chatArea = document.getElementById('chatArea');
    const inputArea = document.getElementById('inputArea');
    const footerArea = document.getElementById('footerArea');

    if (isDeveloperMode) {
        // Developer mode: show input area, hide footer
        inputArea.style.display = '';
        footerArea.style.display = 'none';

        if (isConnected && avatarEnabled) {
            // Avatar + developer: side-by-side layout (avatar + chat)
            contentArea.classList.add('developer-layout');
            avatarVideoContainer.style.display = '';
            chatArea.style.display = '';
            volumeAnimation.style.display = 'none';
        } else if (isConnected) {
            // No avatar + developer: side-by-side layout (robot + chat)
            contentArea.classList.add('developer-layout');
            avatarVideoContainer.style.display = 'none';
            chatArea.style.display = '';
            volumeAnimation.style.display = '';
        } else {
            // Not connected: just show chat
            contentArea.classList.remove('developer-layout');
            avatarVideoContainer.style.display = 'none';
            chatArea.style.display = '';
            volumeAnimation.style.display = 'none';
        }
    } else {
        // Normal mode: show footer, hide input area
        inputArea.style.display = 'none';
        footerArea.style.display = '';
        contentArea.classList.remove('developer-layout');

        if (isConnected && avatarEnabled) {
            // Avatar + normal: only avatar video, no chat
            avatarVideoContainer.style.display = '';
            chatArea.style.display = 'none';
            volumeAnimation.style.display = 'none';
        } else if (isConnected) {
            // No avatar + normal: only robot, no chat
            avatarVideoContainer.style.display = 'none';
            chatArea.style.display = 'none';
            volumeAnimation.style.display = '';
        } else {
            // Not connected: show chat history
            avatarVideoContainer.style.display = 'none';
            chatArea.style.display = '';
            volumeAnimation.style.display = 'none';
        }
    }
}

let soundWaveIntervalId = null;

function updateSoundWaveAnimation() {
    const leftWave = document.getElementById('soundWaveLeft');
    const rightWave = document.getElementById('soundWaveRight');

    if (isConnected && avatarEnabled && isRecording && !isDeveloperMode) {
        // Create sound wave bars if not already present
        if (leftWave && leftWave.children.length === 0) {
            for (let i = 0; i < 10; i++) {
                const bar = document.createElement('div');
                bar.className = 'bar';
                bar.id = `item-${i}`;
                bar.style.height = '2px';
                leftWave.appendChild(bar);
            }
        }
        if (rightWave && rightWave.children.length === 0) {
            for (let i = 10; i < 20; i++) {
                const bar = document.createElement('div');
                bar.className = 'bar';
                bar.id = `item-${i}`;
                bar.style.height = '2px';
                rightWave.appendChild(bar);
            }
        }
        // Start animation
        if (!soundWaveIntervalId) {
            soundWaveIntervalId = setInterval(() => {
                for (let i = 0; i < 20; i++) {
                    const ele = document.getElementById(`item-${i}`);
                    const height = 50 * Math.sin((Math.PI / 20) * i) * Math.random();
                    if (ele) {
                        ele.style.transition = 'height 0.15s ease';
                        ele.style.height = `${Math.max(2, height)}px`;
                    }
                }
            }, 150);
        }
        if (leftWave) leftWave.style.display = '';
        if (rightWave) rightWave.style.display = '';
    } else {
        // Stop animation, hide waves
        if (soundWaveIntervalId) {
            clearInterval(soundWaveIntervalId);
            soundWaveIntervalId = null;
        }
        if (leftWave) leftWave.style.display = 'none';
        if (rightWave) rightWave.style.display = 'none';
    }
}
function updateMicUI() {
    const micBtn = document.getElementById('micBtn');
    const recordBtn = document.getElementById('recordBtn');

    // Toggle recording class
    if (micBtn) micBtn.classList.toggle('recording', isRecording);
    if (recordBtn) recordBtn.classList.toggle('recording', isRecording);

    // Toggle icon visibility: show off-icon when not recording, on-icon when recording
    document.querySelectorAll('.mic-off-icon').forEach(el => {
        el.style.display = isRecording ? 'none' : '';
    });
    document.querySelectorAll('.mic-on-icon').forEach(el => {
        el.style.display = isRecording ? '' : 'none';
    });

    // Update label text
    const label = document.querySelector('.microphone-label');
    if (label) {
        label.textContent = isRecording ? 'Turn off microphone' : 'Turn on microphone';
    }

    // Update sound wave visibility
    updateSoundWaveAnimation();
}

// ===== Audio Capture (24kHz PCM16 via AudioWorklet) =====
async function startAudioCapture() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 24000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });
        audioContext = new AudioContext({ sampleRate: 24000 });
        console.log('[Audio] AudioContext created, actual sampleRate:', audioContext.sampleRate);

        // Register AudioWorklet processor inline via Blob
        const processorCode = `
class PCM16Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2400; // 100ms at 24kHz
        this.buffer = new Float32Array(this.bufferSize);
        this.offset = 0;
    }
    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        const data = input[0];
        for (let i = 0; i < data.length; i++) {
            this.buffer[this.offset++] = data[i];
            if (this.offset >= this.bufferSize) {
                const pcm16 = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    const s = Math.max(-1, Math.min(1, this.buffer[j]));
                    pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                this.buffer = new Float32Array(this.bufferSize);
                this.offset = 0;
            }
        }
        return true;
    }
}
registerProcessor('pcm16-processor', PCM16Processor);
`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');

        // Create analyser for mic volume visualization
        const micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 2048;
        micAnalyser.smoothingTimeConstant = 0.85;
        const micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);

        workletNode.port.onmessage = (e) => {
            if (!isConnected || !isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
            const base64 = arrayBufferToBase64(e.data);
            audioChunksSent++;
            if (audioChunksSent <= 3 || audioChunksSent % 100 === 0) {
                console.log(`[Audio] Sending chunk #${audioChunksSent}, size=${base64.length}`);
            }
            ws.send(JSON.stringify({ type: 'audio_chunk', data: base64 }));
        };

        source.connect(workletNode);
        source.connect(micAnalyser);
        workletNode.connect(audioContext.destination);

        // Store mic analyser so volume animation can use it
        micAnalyserNode = micAnalyser;
        micAnalyserDataArray = micDataArray;
        analyserNode = micAnalyser;
        analyserDataArray = micDataArray;
        startVolumeAnimation('record');

        console.log('[Audio] Capture started (24kHz PCM16)');
    } catch (err) {
        console.error('Audio capture error', err);
        addMessage('system', 'Microphone access denied or not available');
    }
}

function stopAudioCapture() {
    stopRecordAnimation();
    micAnalyserNode = null;
    micAnalyserDataArray = null;
    if (workletNode) { try { workletNode.disconnect(); } catch (e) {} workletNode = null; }
    if (audioContext) { try { audioContext.close(); } catch (e) {} audioContext = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    resetVolumeCircle();
}

// ===== Audio Playback (24kHz PCM16) =====
function handleAudioDelta(base64Data) {
    if (!base64Data) return;
    if (!playbackContext) {
        playbackContext = new AudioContext({ sampleRate: 24000 });
        // Create analyser for volume visualization
        analyserNode = playbackContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.85;
        analyserDataArray = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.connect(playbackContext.destination);
        nextPlaybackTime = 0;
    }
    const arrayBuffer = base64ToArrayBuffer(base64Data);
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
    }
    const buffer = playbackContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserNode);

    const now = playbackContext.currentTime;
    if (nextPlaybackTime < now) nextPlaybackTime = now;
    source.start(nextPlaybackTime);
    nextPlaybackTime += buffer.duration;

    // Start playback volume animation (only if not already running)
    if (!playChunkAnimationFrameId) {
        startVolumeAnimation('play-chunk');
    }
}

function stopAudioPlayback() {
    stopPlayChunkAnimation();
    if (playbackContext) { try { playbackContext.close(); } catch (e) {} playbackContext = null; }
    playbackBufferQueue = [];
    nextPlaybackTime = 0;
    // Switch back to mic analyser if mic is on
    if (isRecording && micAnalyserNode) {
        analyserNode = micAnalyserNode;
        analyserDataArray = micAnalyserDataArray;
        startVolumeAnimation('record');
    } else {
        analyserNode = null;
        analyserDataArray = null;
        resetVolumeCircle();
    }
}

// ===== Volume Animation =====
function startVolumeAnimation(animationType) {
    if (animationType === 'record') {
        stopPlayChunkAnimation();
    } else {
        stopPlayChunkAnimation();
        stopRecordAnimation();
    }
    const isRecord = animationType === 'record';
    const calculateVolume = () => {
        if (analyserNode && analyserDataArray) {
            analyserNode.getByteFrequencyData(analyserDataArray);
            const volume = Array.from(analyserDataArray).reduce((acc, v) => acc + v, 0) / analyserDataArray.length;
            updateVolumeCircle(volume, animationType);
        }

        if (isRecord) {
            // Stop record animation if mic was turned off
            if (!isRecording) {
                recordAnimationFrameId = null;
                resetVolumeCircle();
                return;
            }
            recordAnimationFrameId = requestAnimationFrame(calculateVolume);
        } else {
            // For playback: self-terminate when response is done AND audio finished
            if (!isSpeaking && (!playbackContext || playbackContext.currentTime >= nextPlaybackTime + 0.3)) {
                playChunkAnimationFrameId = null;
                // Switch back to mic animation or reset
                if (isRecording && micAnalyserNode) {
                    analyserNode = micAnalyserNode;
                    analyserDataArray = micAnalyserDataArray;
                    startVolumeAnimation('record');
                } else {
                    analyserNode = null;
                    analyserDataArray = null;
                    resetVolumeCircle();
                }
                return;
            }
            playChunkAnimationFrameId = requestAnimationFrame(calculateVolume);
        }
    };
    calculateVolume();
}

function stopRecordAnimation() {
    if (recordAnimationFrameId) {
        cancelAnimationFrame(recordAnimationFrameId);
        recordAnimationFrameId = null;
    }
}

function stopPlayChunkAnimation() {
    if (playChunkAnimationFrameId) {
        cancelAnimationFrame(playChunkAnimationFrameId);
        playChunkAnimationFrameId = null;
    }
}

function stopVolumeAnimation() {
    stopRecordAnimation();
    stopPlayChunkAnimation();
}

function updateVolumeCircle(volume, animationType) {
    const circle = document.getElementById('volumeCircle');
    if (!circle) return;
    const minSize = 160;
    const size = minSize + volume;
    circle.style.backgroundColor = animationType === 'record' ? 'lightgray' : 'lightblue';
    circle.style.width = size + 'px';
    circle.style.height = size + 'px';
}

function resetVolumeCircle() {
    const circle = document.getElementById('volumeCircle');
    if (!circle) return;
    circle.style.width = '';
    circle.style.height = '';
    circle.style.backgroundColor = '';
}

// ===== WebSocket Video Playback (MediaSource Extensions) =====
function setupWebSocketVideoPlayback(isPhotoAvatar) {
    // Clean any existing video
    cleanupWebSocketVideo();
    const container = document.getElementById('avatarVideo');
    if (container) container.innerHTML = '';

    // Create video element
    const videoElement = document.createElement('video');
    videoElement.id = 'ws-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;

    if (isPhotoAvatar) {
        videoElement.style.borderRadius = '10%';
    }
    videoElement.style.width = 'auto';
    videoElement.style.height = isDeveloperMode ? 'auto' : '';
    videoElement.style.objectFit = 'cover';
    videoElement.style.display = 'block';

    videoElement.addEventListener('canplay', () => {
        videoElement.play().catch(e => console.error('Play error:', e));
    });

    // fMP4 codec: H.264 video + AAC audio
    const FMP4_MIME_CODEC = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';

    if (!MediaSource.isTypeSupported(FMP4_MIME_CODEC)) {
        console.error('MediaSource fMP4 codec not supported');
        addMessage('system', 'WebSocket video playback not supported in this browser. Please use WebRTC mode.');
        return;
    }

    mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        try {
            if (mediaSource.readyState === 'open') {
                sourceBuffer = mediaSource.addSourceBuffer(FMP4_MIME_CODEC);
                sourceBuffer.addEventListener('updateend', () => {
                    processVideoChunkQueue();
                });
            }
        } catch (e) {
            console.error('Error creating SourceBuffer:', e);
        }
    });

    // Append to container
    if (container) {
        container.appendChild(videoElement);
    } else {
        pendingWsVideoElement = videoElement;
    }
}

let videoChunkCount = 0;

function handleVideoChunk(base64Data) {
    if (!base64Data) return;
    videoChunkCount++;
    if (videoChunkCount <= 5 || videoChunkCount % 100 === 0) {
        console.log(`[VIDEO] chunk #${videoChunkCount}, length=${base64Data.length}, mediaSource=${mediaSource?.readyState}, sourceBuffer=${!!sourceBuffer}`);
    }
    try {
        const binaryString = atob(base64Data);
        const arrayBuffer = new ArrayBuffer(binaryString.length);
        const bytes = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        videoChunksQueue.push(arrayBuffer);
        processVideoChunkQueue();
    } catch (e) {
        console.error('Error handling video chunk:', e);
    }
}

function processVideoChunkQueue() {
    if (!sourceBuffer || sourceBuffer.updating || !mediaSource || mediaSource.readyState !== 'open') {
        return;
    }
    const next = videoChunksQueue.shift();
    if (!next) return;
    try {
        sourceBuffer.appendBuffer(next);
    } catch (e) {
        console.error('Error appending video chunk:', e);
    }
}

function cleanupWebSocketVideo() {
    videoChunksQueue = [];
    if (sourceBuffer && mediaSource) {
        try {
            if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
                mediaSource.endOfStream();
            }
        } catch (e) {
            console.error('Error ending MediaSource stream:', e);
        }
    }
    sourceBuffer = null;
    mediaSource = null;
    pendingWsVideoElement = null;
}

// ===== WebRTC for Avatar =====

// Prepare a peer connection ahead of time so ICE candidates are pre-gathered.
// This avoids the ICE gathering delay when the user starts a new session.
function preparePeerConnection(iceServers) {
    const iceConfig = iceServers.map(s => ({
        urls: s.urls,
        username: s.username || undefined,
        credential: s.credential || undefined,
    }));

    const pc = new RTCPeerConnection({ iceServers: iceConfig });
    let iceGatheringDone = false;

    // Handle incoming tracks (video and audio)
    pc.ontrack = (event) => {
        const container = document.getElementById('avatarVideo');
        const mediaPlayer = document.createElement(event.track.kind);
        mediaPlayer.id = event.track.kind;
        mediaPlayer.srcObject = event.streams[0];
        mediaPlayer.autoplay = false;
        mediaPlayer.addEventListener('loadeddata', () => {
            mediaPlayer.play();
        });
        if (container) container.appendChild(mediaPlayer);
        if (event.track.kind === 'video') {
            avatarVideoElement = mediaPlayer;
            mediaPlayer.style.width = '0.1%';
            mediaPlayer.style.height = '0.1%';
            mediaPlayer.onplaying = () => {
                setTimeout(() => {
                    mediaPlayer.style.width = '';
                    mediaPlayer.style.height = '';
                }, 0);
            };
        }
    };

    pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
            // ICE gathering complete
        }
    };

    pc.onicecandidate = (event) => {
        if (!event.candidate && !iceGatheringDone) {
            iceGatheringDone = true;
            peerConnectionQueue.push(pc);
            console.log('[' + new Date().toISOString() + '] ICE gathering done, new peer connection prepared.');
            // Keep only the latest prepared connection
            if (peerConnectionQueue.length > 1) {
                const old = peerConnectionQueue.shift();
                try { old.close(); } catch (e) {}
            }
        }
    };

    // Add transceivers for video and audio
    pc.addTransceiver('video', { direction: 'sendrecv' });
    pc.addTransceiver('audio', { direction: 'sendrecv' });

    // Listen for data channel events
    pc.addEventListener('datachannel', (event) => {
        const dataChannel = event.channel;
        dataChannel.onmessage = (e) => {
            console.log('[' + new Date().toISOString() + '] WebRTC event received: ' + e.data);
        };
        dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
    });
    pc.createDataChannel('eventChannel');

    pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        // Timeout fallback: if ICE gathering hasn't completed after 10 seconds, push anyway
        setTimeout(() => {
            if (!iceGatheringDone) {
                iceGatheringDone = true;
                peerConnectionQueue.push(pc);
                console.log('[' + new Date().toISOString() + '] ICE gathering timed out, peer connection prepared with available candidates.');
                if (peerConnectionQueue.length > 1) {
                    const old = peerConnectionQueue.shift();
                    try { old.close(); } catch (e) {}
                }
            }
        }, 10000);
    }).catch(err => {
        console.error('preparePeerConnection offer error', err);
    });
}

function setupWebRTC(iceServers) {
    if (peerConnection) cleanupWebRTC();

    // Cache ICE servers for future peer connection preparation
    cachedIceServers = iceServers;

    // Clear existing video container
    const container = document.getElementById('avatarVideo');
    if (container) container.innerHTML = '';

    if (peerConnectionQueue.length > 0) {
        // Use cached peer connection with pre-gathered ICE candidates
        peerConnection = peerConnectionQueue.shift();
        console.log('[' + new Date().toISOString() + '] Using cached peer connection with pre-gathered ICE candidates.');

        // Send SDP offer immediately (no need to wait for ICE gathering)
        const sdpJson = JSON.stringify(peerConnection.localDescription);
        const sdpBase64 = btoa(sdpJson);
        console.log('[SDP] Sending cached base64 SDP, starts with:', sdpBase64.substring(0, 40));
        ws.send(JSON.stringify({ type: 'avatar_sdp_offer', clientSdp: sdpBase64 }));
        console.log('[WebRTC] Cached SDP offer sent (base64)');

        // Prepare next peer connection for future use
        preparePeerConnection(iceServers);
        return;
    }

    // No cached peer connection available (first connection), create one from scratch
    const iceConfig = iceServers.map(s => ({
        urls: s.urls,
        username: s.username || undefined,
        credential: s.credential || undefined,
    }));

    peerConnection = new RTCPeerConnection({ iceServers: iceConfig });

    // Handle incoming tracks (video and audio)
    peerConnection.ontrack = (event) => {
        const mediaPlayer = document.createElement(event.track.kind);
        mediaPlayer.id = event.track.kind;
        mediaPlayer.srcObject = event.streams[0];
        mediaPlayer.autoplay = false;
        mediaPlayer.addEventListener('loadeddata', () => {
            mediaPlayer.play();
        });
        if (container) container.appendChild(mediaPlayer);
        if (event.track.kind === 'video') {
            avatarVideoElement = mediaPlayer;
            mediaPlayer.style.width = '0.1%';
            mediaPlayer.style.height = '0.1%';
            mediaPlayer.onplaying = () => {
                setTimeout(() => {
                    mediaPlayer.style.width = '';
                    mediaPlayer.style.height = '';
                }, 0);
            };
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === 'complete') {
            // ICE gathering complete
        }
    };

    let iceGatheringDone = false;
    peerConnection.onicecandidate = (event) => {
        if (!event.candidate && !iceGatheringDone) {
            iceGatheringDone = true;
            // ICE gathering complete, send SDP offer now
            const sdpJson = JSON.stringify(peerConnection.localDescription);
            const sdpBase64 = btoa(sdpJson);
            console.log('[SDP] Sending base64 SDP, starts with:', sdpBase64.substring(0, 40));
            ws.send(JSON.stringify({ type: 'avatar_sdp_offer', clientSdp: sdpBase64 }));
            console.log('[WebRTC] SDP offer sent (base64)');
        }
    };

    // Add transceivers for video and audio
    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    // Listen for data channel events
    peerConnection.addEventListener('datachannel', (event) => {
        const dataChannel = event.channel;
        dataChannel.onmessage = (e) => {
            console.log('[' + new Date().toISOString() + '] WebRTC event received: ' + e.data);
        };
        dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
    });
    peerConnection.createDataChannel('eventChannel');

    peerConnection.createOffer().then(offer => {
        return peerConnection.setLocalDescription(offer);
    }).then(() => {
        // Timeout fallback: send SDP after 10 seconds if ICE gathering hasn't completed
        setTimeout(() => {
            if (!iceGatheringDone) {
                iceGatheringDone = true;
                const sdpJson = JSON.stringify(peerConnection.localDescription);
                const sdpBase64 = btoa(sdpJson);
                console.log('[SDP] Sending base64 SDP (timeout), starts with:', sdpBase64.substring(0, 40));
                ws.send(JSON.stringify({ type: 'avatar_sdp_offer', clientSdp: sdpBase64 }));
                console.log('[WebRTC] SDP offer sent after timeout (base64)');
            }
        }, 10000);
    }).catch(err => {
        console.error('WebRTC offer error', err);
        addMessage('system', 'WebRTC setup failed');
    });

    // Prepare a peer connection for future use
    preparePeerConnection(iceServers);
}

function handleAvatarSdpAnswer(serverSdpBase64) {
    if (!peerConnection || !serverSdpBase64) return;
    try {
        // Server SDP is base64-encoded JSON: {"type":"answer","sdp":"..."}
        const serverSdpJson = atob(serverSdpBase64);
        const serverSdpObj = JSON.parse(serverSdpJson);
        peerConnection.setRemoteDescription(new RTCSessionDescription(serverSdpObj)).then(() => {
            console.log('[WebRTC] Remote SDP set');
        }).catch(err => {
            console.error('SDP answer error', err);
        });
    } catch (e) {
        console.error('Failed to parse server SDP', e);
    }
}

function cleanupWebRTC() {
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
    }
    if (avatarVideoElement) {
        avatarVideoElement.srcObject = null;
        avatarVideoElement = null;
    }
    const container = document.getElementById('avatarVideo');
    if (container) container.innerHTML = '';
}

// ===== Mic Toggle =====
function toggleMicrophone() {
    if (!isConnected) return;
    isRecording = !isRecording;
    updateMicUI();
    // Start/stop volume animation based on mic state
    if (isRecording && micAnalyserNode) {
        analyserNode = micAnalyserNode;
        analyserDataArray = micAnalyserDataArray;
        startVolumeAnimation('record');
    } else if (!isRecording) {
        stopRecordAnimation();
        resetVolumeCircle();
    }
}

// ===== Send Text =====
function sendTextMessage() {
    const input = document.getElementById('textInput');
    const text = input.value.trim();
    if (!text || !isConnected || !ws) return;

    addMessage('user', text);
    ws.send(JSON.stringify({ type: 'send_text', text }));
    input.value = '';
}

// ===== Speech Events (sound wave animation) =====
function onSpeechStarted(itemId) {
    isSpeaking = true;
    // Stop assistant audio playback (barge-in) in speech-only mode
    stopAudioPlayback();
    // Add user placeholder message (will be updated when transcription completes)
    if (itemId) {
        const contentDiv = addMessage('user', '...');
        if (contentDiv) {
            contentDiv.closest('.message').setAttribute('data-item-id', itemId);
        }
    }
}

function onSpeechStopped() {
    pendingAssistantText = '';
    isSpeaking = false;
}

// ===== Utilities =====
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
