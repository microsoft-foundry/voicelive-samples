"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AudioHandler } from "@/lib/audio";
import { ProactiveEventManager } from "@/lib/proactive-event-manager";
import { int16PCMToFloat32, downsampleBuffer, float32ToInt16PCM } from "@/lib/audioConverters";
import { Power, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  VoiceLiveClient,
  VoiceLiveSession,
  VoiceLiveSubscription,
  Voice,
  AzureVoice,
  OpenAIVoice,
  TurnDetection,
  Modality,
  RequestSession,
  FunctionCallOutputItem,
  ResponseMCPApprovalRequestItem,
  KnownServerEventType,
  SystemMessageItem,
  AgentSessionConfig,
  InterimResponseConfig,
  InterimResponseTrigger,
} from "@azure/ai-voicelive";
import { AzureKeyCredential, TokenCredential } from "@azure/core-auth";
import { SearchClient } from "@azure/search-documents";
import "./index.css";
import {
  clearChatSvg,
  offSvg,
  recordingSvg,
  robotSvg,
  settingsSvg,
} from "./svg";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { log } from "console";

// Type for avatar config video params (local definition since SDK types may differ)
interface AvatarConfigVideoParams {
  codec?: string;
  crop?: {
    top_left: [number, number];
    bottom_right: [number, number];
  };
  background?: {
    image_url?: URL;
  };
}

// Type for EOUDetection
interface EOUDetection {
  model: string;
}

interface Message {
  type: "user" | "assistant" | "status" | "error" | "mcp_approval" | "foundry_agent";
  content: string;
  id?: string; // Optional ID for tracking streaming messages
  // MCP approval request fields
  mcpApproval?: {
    approvalRequestId: string;
    serverLabel: string;
    name: string;
    arguments: string;
    handled?: boolean;
  };
  // Foundry agent call tracking fields
  foundryAgent?: {
    name: string;
    arguments?: string;
    agentResponseId?: string;
    output?: string;
  };
}

interface ToolDeclaration {
  type: "function";
  name: string;
  parameters: object | null;
  description: string;
}

interface SystemToolDeclaration{
   type: string;
   description: string;
}

interface PredefinedScenario {
  name: string;
  instructions?: string;
  pro_active?: boolean;
  voice?: {
    custom_voice: boolean;
    deployment_id?: string;
    voice_name: string;
    temperature?: number;
    speed?: number;
  };
  avatar?: {
    enabled: boolean;
    customized: boolean;
    avatar_name: string;
  };
}

interface MCPServerConfig {
  id: string;
  serverUrl: string;
  authorization?: string;
  serverLabel: string;
  requireApproval: boolean;
}

interface PersonalVoiceInfo {
  id: string;
  displayName?: string;
  status: string;
}

interface CustomAvatarInfo {
  id: string;
  description?: string;
  state: string;
  previewImageUrl?: string;
}

interface FoundryAgentToolConfig {
  id: string;
  agentName: string;
  agentVersion: string;
  projectName: string;
  description?: string;
  clientId?: string;
}

/** Minimal local type for foundry agent call items (SDK removed these types in beta.3) */
interface FoundryAgentCallItem {
  type: "foundry_agent_call";
  id?: string;
  name?: string;
  output?: string;
  arguments?: string;
}

/** Minimal local type for foundry agent call events */
interface FoundryAgentCallEvent {
  type: string;
  item_id?: string;
  arguments?: string;
  agent_response_id?: string;
}

function isFoundryAgentCallItem(item: unknown): item is FoundryAgentCallItem {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "foundry_agent_call";
}

function isFoundryAgentCallEvent(event: unknown, eventType: string): event is FoundryAgentCallEvent {
  return typeof event === "object" && event !== null && (event as Record<string, unknown>).type === eventType;
}

interface AudioChunksForPA {
  audioBuffer: ArrayBuffer;
  timestamp: number;
}

// Define predefined tool templates
const predefinedTools = [
  {
    id: "language_detection",
    label: "[System] Language Detection",
    is_system_tool: true,
    tool: {
      type: "language_detection",
    } as SystemToolDeclaration,
    enabled: true,
  },
  {
    id: "search",
    label: "Search",
    tool: {
      type: "function",
      name: "search",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      description:
        "Search the knowledge base. The knowledge base is in English, translate to and from English if " +
        "needed. Results are formatted as a source name first in square brackets, followed by the text " +
        "content, and a line with '-----' at the end of each result.",
    } as ToolDeclaration,
    enabled: false,
  },
  {
    id: "time",
    label: "Time Lookup",
    tool: {
      type: "function",
      name: "get_time",
      parameters: null,
      description: "Get the current time.",
    } as ToolDeclaration,
    enabled: true,
  },
  {
    id: "weather",
    label: "Weather Checking",
    tool: {
      type: "function",
      name: "get_weather",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "Location to check the weather for",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Unit of temperature",
          },
        },
        required: ["location", "unit"],
        additionalProperties: false,
      },
      description:
        "Get the current weather. The location is a string, and the unit is either 'celsius' or 'fahrenheit'.",
    } as ToolDeclaration,
    enabled: false,
  },
  {
    id: "calculator",
    label: "Calculator",
    tool: {
      type: "function",
      name: "calculate",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Mathematical expression to calculate",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
      description: "Perform a calculation. The expression is a string.",
    } as ToolDeclaration,
    enabled: false,
  },
  {
    id: "pronunciation_assessment",
    label: "Pronunciation Assessment",
    tool: {
      type: "function",
      name: "pronunciation_assessment",
      parameters: null,
      description:
        "Every time a user sends any message, this function should be called to handle the request.",
    } as ToolDeclaration,
    enabled: true,
  },
];

// Helper to map message type to class names.
const getMessageClassNames = (type: Message["type"]): string => {
  switch (type) {
    case "user":
      return "bg-blue-100 ml-auto max-w-[80%]";
    case "assistant":
      return "bg-gray-100 mr-auto max-w-[80%]";
    case "status":
      return "bg-yellow-200 mx-auto max-w-[80%]";
    case "mcp_approval":
      return "bg-purple-100 mx-auto max-w-[80%] border border-purple-300";
    case "foundry_agent":
      return "bg-blue-50 mx-auto max-w-[80%] border border-blue-300";
    default:
      return "bg-red-100 mx-auto max-w-[80%]";
  }
};

let peerConnection: RTCPeerConnection;

const defaultAvatar = "Lisa-casual-sitting";
const defaultPhotoAvatar = "Anika";

// New state for the readme content
const readme = `
    1. **Configure your Azure AI Services resource**
        - Obtain your endpoint and API key from the \`Keys and Endpoint\` tab in your Azure AI Services resource.
        - The endpoint can be the regional endpoint (e.g., \`https://<region>.api.cognitive.microsoft.com/\`) or a custom domain endpoint (e.g., \`https://<custom-domain>.cognitiveservices.azure.com/\`).
        - The resource must be in the \`eastus2\` or \`swedencentral\` region. Other regions are not supported.

    2. **(Optional) Set the Agent**
        - Set the project name and agent name to connect to a specific agent.
        - Entra ID auth is required for agent mode, use \`az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv\` to get the token.

    2. **Select noise suppression or echo cancellation**
        - Enable noise suppression and/or echo cancellation to improve audio quality.

    3. **Select the Turn Detection**
        - Choose the desired turn detection method. The default is \`Server VAD\`, which uses server-side voice activity detection.
        - The \`Azure Semantic VAD\` option is also available for better performance.

    4. **Select the Voice**
       - Choose the desired voice from the list.
       - If using a custom voice, select the "Use Custom Voice" option and enter the Voice Deployment ID and the custom voice name.

    5. **Start conversation**
        - Click on the "Connect" button to start the conversation.
        - Click on the mic button to start recording audio. Click again to stop recording.
`;

let default_instructions_for_agent =
`You are a helpful agent. Your task is to maintain a natural conversation flow with the user, help them resolve their query in a way that's helpful, efficient, and correct, and to defer heavily to a more experienced and intelligent Foundry Agent.

# General Instructions
- You are very new and can only handle basic tasks, and will rely heavily on the Foundry Agent via the <agent_name> tool
- By default, you must always use the <agent_name> tool to get your next response, except for very specific exceptions.
- If the user says "hi", "hello", or similar greetings in later messages, respond naturally and briefly (e.g., "Hello!" or "Hi there!") instead of repeating the canned greeting.
- In general, don't say the same thing twice, always vary it to ensure the conversation feels natural.

# Tools
- You can ONLY call <agent_name>
- Even if you're provided other tools in this prompt as a reference, NEVER call them directly.

# Allow List of Permitted Actions
You can take the following actions directly, and don't need to call <agent_name> tool.

## Basic chitchat
- Handle greetings (e.g., "hello", "hi there").
- Engage in basic chitchat (e.g., "how are you?", "thank you").
- Respond to requests to repeat or clarify information (e.g., "can you repeat that?").

# <agent_name> Usage
- For ALL requests that are not strictly and explicitly listed above, you MUST ALWAYS use the <agent_name> tool, which will ask the Foundry Agent for a high-quality response you can use.
- Do NOT attempt to answer, resolve, or speculate on any other requests, even if you think you know the answer or it seems simple.
- You should make NO assumptions about what you can or can't do. Always defer to <agent_name> for all non-trivial queries.
- Before calling <agent_name>, you MUST ALWAYS say something to the user (see the 'Sample Filler Phrases' section). Never call <agent_name> without first saying something to the user.
  - Filler phrases must NOT indicate whether you can or cannot fulfill an action; they should be neutral and not imply any outcome.
  - After the filler phrase YOU MUST ALWAYS call the <agent_name> tool.
  - This is required for every use of <agent_name>, without exception. Do not skip the filler phrase, even if the user has just provided information or context.
  - You only need to choose one filler phrase per use of <agent_name>.
- You will use this tool extensively.

# Sample Filler Phrases
- "Just a second."
- "Let me check."
- "One moment."
- "Let me look into that."
- "Give me a moment."
- "Let me see."`;

// Define the list of available languages.
const availableLanguages = [
  { id: "auto", name: "Auto Detect" },
  { id: "en-US", name: "English (United States)" },
  { id: "zh-CN", name: "Chinese (China)" },
  { id: "de-DE", name: "German (Germany)" },
  { id: "en-GB", name: "English (United Kingdom)" },
  { id: "en-IN", name: "English (India)" },
  { id: "es-ES", name: "Spanish (Spain)" },
  { id: "es-MX", name: "Spanish (Mexico)" },
  { id: "fr-FR", name: "French (France)" },
  { id: "hi-IN", name: "Hindi (India)" },
  { id: "it-IT", name: "Italian (Italy)" },
  { id: "ja-JP", name: "Japanese (Japan)" },
  { id: "ko-KR", name: "Korean (South Korea)" },
  { id: "pt-BR", name: "Portuguese (Brazil)" },
];

// Define the list of available turn detection.
const availableTurnDetection = [
  { id: "server_vad", name: "Server VAD", disable: false },
  {
    id: "azure_semantic_vad",
    name: "Azure Semantic VAD",
    disabled: false,
  },
  // { id: "none", name: "None", disable: true },
];

const availableEouDetection = [
  { id: "none", name: "Disabled", disabled: false },
  { id: "semantic_detection_v1", name: "Semantic Detection", disabled: false },
];

// Define the updated list of available voices.
const availableVoices = [
  // openai voices:  "alloy" | "ash" | "ballad" | "coral" | "echo" | "sage" | "shimmer" | "verse"
  {
    id: "en-us-ava:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Ava (HD)",
  },
  {
    id: "en-us-steffan:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Steffan (HD)",
  },
  {
    id: "en-us-andrew:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Andrew (HD)",
  },
  {
    id: "zh-cn-xiaochen:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Xiaochen (HD)",
  },
  {
    id: "en-us-emma:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Emma (HD)",
  },
  {
    id: "en-us-emma2:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Emma (HD 2)",
  },
  {
    id: "en-us-andrew2:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Andrew (HD 2)",
  },
  {
    id: "de-DE-Seraphina:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Seraphina (HD)",
  },
  {
    id: "en-us-aria:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Aria (HD)",
  },
  {
    id: "en-us-davis:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Davis (HD)",
  },
  {
    id: "en-us-jenny:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Jenny (HD)",
  },
  {
    id: "ja-jp-masaru:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Masaru (HD)",
  },
  { id: "en-US-AvaMultilingualNeural", name: "Ava Multilingual" },
  {
    id: "en-US-AlloyTurboMultilingualNeural",
    name: "Alloy Turbo Multilingual",
  },
  { id: "en-US-AndrewNeural", name: "Andrew" },
  { id: "en-US-AndrewMultilingualNeural", name: "Andrew Multilingual" },
  { id: "en-US-BrianMultilingualNeural", name: "Brian Multilingual" },
  { id: "en-US-EmmaMultilingualNeural", name: "Emma Multilingual" },
  {
    id: "en-US-NovaTurboMultilingualNeural",
    name: "Nova Turbo Multilingual",
  },
  { id: "zh-CN-XiaoxiaoMultilingualNeural", name: "Xiaoxiao Multilingual" },
  { id: "en-US-AvaNeural", name: "Ava" },
  { id: "en-US-JennyNeural", name: "Jenny" },
  { id: "zh-HK-HiuMaanNeural", name: "HiuMaan (Cantonese)" },
  { id: "mt-MT-JosephNeural", name: "Joseph (Maltese)" },
  { id: "zh-cn-xiaoxiao2:DragonHDFlashLatestNeural", name: "Xiaoxiao2 HDFlash" },
  { id: "zh-cn-yunyi:DragonHDFlashLatestNeural", name: "Yunyi HDFlash" },
  { id: "zh-cn-xiaoxiao:DragonHDFlashLatestNeural", name: "Xiaoxiao HDFlash" },
  { id: "zh-cn-yunxiao:DragonHDFlashLatestNeural", name: "Yunxiao HDFlash" },
  { id: "zh-cn-xiaochen:DragonHDFlashLatestNeural", name: "Xiaochen HDFlash" },
  { id: "zh-cn-yunhan:DragonHDFlashLatestNeural", name: "Yunhan HDFlash" },
  { id: "zh-cn-xiaoyi:DragonHDFlashLatestNeural", name: "Xiaoyi HDFlash" },
  { id: "zh-cn-yunxia:DragonHDFlashLatestNeural", name: "Yunxia HDFlash" },
  {
    id: "alloy",
    name: "Alloy (OpenAI)",
  },
  {
    id: "ash",
    name: "Ash (OpenAI)",
  },
  {
    id: "ballad",
    name: "Ballad (OpenAI)",
  },
  {
    id: "coral",
    name: "Coral (OpenAI)",
  },
  {
    id: "echo",
    name: "Echo (OpenAI)",
  },
  {
    id: "sage",
    name: "Sage (OpenAI)",
  },
  {
    id: "shimmer",
    name: "Shimmer (OpenAI)",
  },
  {
    id: "verse",
    name: "Verse (OpenAI)",
  },
];

const avatarNames = [
  "Harry-business",
  "Harry-casual",
  "Harry-youthful",
  "Jeff-business",
  "Jeff-formal",
  "Lisa-casual-sitting",
  "Lori-casual",
  "Lori-formal",
  "Lori-graceful",
  "Max-business",
  "Max-casual",
  "Max-formal",
  "Meg-business",
  "Meg-casual",
  "Meg-formal",
];

const photoAvatarNames = [
  "Adrian",
  "Amara",
  "Amira",
  "Anika",
  "Bianca",
  "Camila",
  "Carlos",
  "Clara",
  "Darius",
  "Diego",
  "Elise",
  "Farhan",
  "Faris",
  "Gabrielle",
  "Hyejin",
  "Imran",
  "Isabella",
  "Layla",
  "Ling",
  "Liwei",
  "Marcus",
  "Matteo",
  "Rahul",
  "Rana",
  "Ren",
  "Riya",
  "Sakura",
  "Simone",
  "Zayd",
  "Zoe",
];

let intervalId: NodeJS.Timeout | null = null;

const ChatInterface = () => {
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [entraToken, setEntraToken] = useState("");
  const [authType, setAuthType] = useState<"apiKey" | "entraToken">("apiKey");
  const credentialRef = useRef<AzureKeyCredential | TokenCredential | null>(null);
  const [model, setModel] = useState("gpt-realtime");
  const [searchEndpoint, setSearchEndpoint] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [searchIndex, setSearchIndex] = useState("");
  const [searchContentField, setSearchContentField] = useState("chunk");
  const [searchIdentifierField, setSearchIdentifierField] =
    useState("chunk_id");
  const [recognitionLanguage, setRecognitionLanguage] = useState("auto");
  const [srModel, setSrModel] = useState<"azure-speech" | "mai-transcribe-1" | "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | "gpt-4o-transcribe-diarize">("azure-speech");
  const [phraseList, setPhraseList] = useState<string[]>([]);
  const [customSpeechModels, setCustomSpeechModels] = useState<Record<string, string>>({});
  const [useNS, setUseNS] = useState(false);
  const [useEC, setUseEC] = useState(true);
  const [turnDetectionType, setTurnDetectionType] = useState<TurnDetection | null>({
    type: "azure_semantic_vad",
  });
  const [eouDetectionType, setEouDetectionType] = useState<string>("none");
  const [instructions, setInstructions] = useState("");
  const [enableProactive, setEnableProactive] = useState(false);
  const [temperature, setTemperature] = useState(0.9);
  const [voiceTemperature, setVoiceTemperature] = useState(0.9);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voiceType, setVoiceType] = useState<"standard" | "custom" | "personal" | "azure-realtime-native" | "avatar-voice-sync">("standard");
  const [avatarVoiceSyncModel, setAvatarVoiceSyncModel] = useState<"DragonLatestNeural" | "DragonHDOmniLatestNeural" | "mai-voice-1">("DragonLatestNeural");
  const [voiceName, setVoiceName] = useState("en-US-AvaMultilingualNeural");
  const [customVoiceName, setCustomVoiceName] = useState("");
  const [personalVoiceName, setPersonalVoiceName] = useState("");
  const [personalVoiceModel, setPersonalVoiceModel] = useState<"DragonLatestNeural" | "DragonHDOmniLatestNeural" | "mai-voice-1">("DragonLatestNeural");
  const [personalVoices, setPersonalVoices] = useState<PersonalVoiceInfo[]>([]);
  const [isFetchingPersonalVoices, setIsFetchingPersonalVoices] = useState(false);
  const [avatarName, setAvatarName] = useState(defaultAvatar);
  const [photoAvatarName, setPhotoAvatarName] = useState(defaultPhotoAvatar);
  const [customAvatarName, setCustomAvatarName] = useState("");
  const [customAvatars, setCustomAvatars] = useState<CustomAvatarInfo[]>([]);
  const [isFetchingCustomAvatars, setIsFetchingCustomAvatars] = useState(false);
  const [avatarBackgroundImageUrl, setAvatarBackgroundImageUrl] = useState("");
  const [voiceDeploymentId, setVoiceDeploymentId] = useState("");
  const [tools, setTools] = useState<(ToolDeclaration | SystemToolDeclaration)[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [isMcpDialogOpen, setIsMcpDialogOpen] = useState(false);
  const [newMcpServer, setNewMcpServer] = useState<Omit<MCPServerConfig, 'id'>>({
    serverUrl: "",
    authorization: "",
    serverLabel: "",
    requireApproval: false,
  });
  const [foundryAgentTools, setFoundryAgentTools] = useState<FoundryAgentToolConfig[]>([]);
  const [isFoundryDialogOpen, setIsFoundryDialogOpen] = useState(false);
  const [newFoundryTool, setNewFoundryTool] = useState<Omit<FoundryAgentToolConfig, 'id'>>({
    agentName: "",
    agentVersion: "",
    projectName: "",
    description: "",
    clientId: "",
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAvatar, setIsAvatar] = useState(true);
  const [isPhotoAvatar, setIsPhotoAvatar] = useState(false);
  const [isCustomAvatar, setIsCustomAvatar] = useState(false);
  // Avatar output mode: 'webrtc' or 'websocket'
  const [avatarOutputMode, setAvatarOutputMode] = useState<"webrtc" | "websocket">("webrtc");
  // Scene parameters for photo avatar
  const [sceneZoom, setSceneZoom] = useState(100.0);
  const [scenePositionX, setScenePositionX] = useState(0.0);
  const [scenePositionY, setScenePositionY] = useState(0.0);
  const [sceneRotationX, setSceneRotationX] = useState(0.0);
  const [sceneRotationY, setSceneRotationY] = useState(0.0);
  const [sceneRotationZ, setSceneRotationZ] = useState(0.0);
  const [sceneAmplitude, setSceneAmplitude] = useState(60.0);
  const [isDevelop, setIsDevelop] = useState(false);
  const [enableSearch, setEnableSearch] = useState(false);
  const [enablePA, setEnablePA] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  // Add new state variables for predefined scenarios
  const [predefinedScenarios, setPredefinedScenarios] = useState<
    Record<string, PredefinedScenario>
  >({});
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [isSettings, setIsSettings] = useState(false);

  const referenceText = useRef<string>("");
  const audioChunksForPA = useRef<AudioChunksForPA[]>([]);
  const pauseDurations = useRef<number[]>([]);
  const lastPauseTimestamp = useRef<number | null>(null);
  const startRecordingTimestamp = useRef<number | null>(null);

  // Add mode state and agent fields
  const [mode, setMode] = useState<"model" | "agent">("model");
  const [agentProjectName, setAgentProjectName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentVersion, setAgentVersion] = useState("");
  const [agents, setAgents] = useState<{ name: string; version: string }[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);

  // Interim response configuration
  const [interimResponseEnabled, setInterimResponseEnabled] = useState(false);
  const [interimResponseType, setInterimResponseType] = useState<"static_interim_response" | "llm_interim_response">("static_interim_response");
  const [interimResponseTriggers, setInterimResponseTriggers] = useState<InterimResponseTrigger[]>(["latency"]);
  const [interimResponseLatencyThreshold, setInterimResponseLatencyThreshold] = useState(500);
  // Static interim response fields
  const [interimResponseTexts, setInterimResponseTexts] = useState<string>("Let me think about that...\nOne moment please...\nGood question, let me check...");
  // LLM interim response fields
  const [interimResponseModel, setInterimResponseModel] = useState("gpt-4.1-mini");
  const [interimResponseInstructions, setInterimResponseInstructions] = useState("");
  const [interimResponseMaxTokens, setInterimResponseMaxTokens] = useState(50);

  const clientRef = useRef<VoiceLiveClient | null>(null);
  const sessionRef = useRef<VoiceLiveSession | null>(null);
  const subscriptionRef = useRef<VoiceLiveSubscription | null>(null);
  const audioHandlerRef = useRef<AudioHandler | null>(null);
  const proactiveManagerRef = useRef<ProactiveEventManager | null>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const wsVideoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const videoChunksQueueRef = useRef<BufferSource[]>([]);
  const pendingVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const isUserSpeaking = useRef(false);
  const avatarOutputModeRef = useRef<"webrtc" | "websocket">("webrtc");
  const searchClientRef = useRef<SearchClient<object> | null>(null);
  const animationRef = useRef(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  // Track current streaming message for real-time updates
  const currentStreamingMessageRef = useRef<{ id: string; content: string } | null>(null);

  const isEnableAvatar = isAvatar && (avatarName || photoAvatarName || customAvatarName);

  // Keep avatarOutputModeRef in sync with state for use in event handlers
  useEffect(() => {
    avatarOutputModeRef.current = avatarOutputMode;
  }, [avatarOutputMode]);

  // Default instructions for foundry agent tools
  const defaultFoundryInstructions = "You are a helpful assistant with tools. Please response a short message like 'I am working on this', 'getting the information for you, please wait' before calling the function. The response can be varied based on the question.";

  // Update instructions when foundry agent tools are added and instructions are empty
  useEffect(() => {
    if (foundryAgentTools.length > 0 && (!instructions || instructions.length === 0)) {
      // Check if any foundry agent tool has a name to use in the instructions template
      const firstAgentName = foundryAgentTools[0]?.agentName;
      if (firstAgentName) {
        // Use the detailed instructions template with the agent name
        const customInstructions = default_instructions_for_agent.replace(/<agent_name>/g, firstAgentName);
        setInstructions(customInstructions);
      } else {
        setInstructions(defaultFoundryInstructions);
      }
    }
  }, [foundryAgentTools]);

  // Read profile query parameter from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const profileParam = params.get("profile");
    if (profileParam) {
      setProfile(profileParam);
    }
  }, []);

  // Fetch configuration from /config endpoint when component loads
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/config");
        if (response.status === 404) {
          setConfigLoaded(false);
          return;
        }

        const config = await response.json();
        if (config.endpoint) {
          setEndpoint(config.endpoint);
        }
        if (config.token) {
          setEntraToken(config.token);
        }
        if (config.pre_defined_scenarios) {
          setPredefinedScenarios(config.pre_defined_scenarios);
        }
        // Parse agent configs from /config
        if (config.agent && config.agent.project_name) {
          setAgentProjectName(config.agent.project_name);
        }
        if (config.agent && Array.isArray(config.agent.agents)) {
          setAgents(config.agent.agents);
          if (config.agent.agents.length > 0 && !agentName) {
            setAgentName(config.agent.agents[0].name);
            setAgentVersion(config.agent.agents[0].version);
          }
        }
        setConfigLoaded(true);
      } catch (error) {
        console.error("Failed to fetch config:", error);
        setConfigLoaded(true);
      }
    };

    fetchConfig();
  }, []);

  // Setup subscription handlers for VoiceLive events
  const setupEventSubscription = () => {
    if (!sessionRef.current) return;

    subscriptionRef.current = sessionRef.current.subscribe({
      // Handle session connected
      onConnected: async (_event, context) => {
        console.log("Session connected, sessionId:", context.sessionId);
        if (context.sessionId) {
          setSessionId(context.sessionId);
        }
      },

      // Handle session created - update sessionId when received
      onSessionCreated: async (event, context) => {
        console.log("Session created event received:", event, context);
        const sid = context.sessionId || event.session?.id;
        if (sid) {
          setSessionId(sid);
          // Update the "connecting..." message with actual session ID
          setMessages((prev) => {
            // Find and update the connecting status message
            const connectingIdx = prev.findIndex(m => m.content.includes("debug id: connecting..."));
            if (connectingIdx >= 0) {
              const updated = [...prev];
              updated[connectingIdx] = {
                type: "status",
                content: "Session started, click on the mic button to start conversation! debug id: " + sid,
              };
              return updated;
            }
            return prev;
          });
        }
      },

      // Handle session errors
      onError: async (error, _context) => {
        console.error("Session error:", error);
        setMessages((prev) => [
          ...prev,
          { type: "error", content: `Session error: ${error.error?.message || "Unknown error"}` },
        ]);
      },

      // Handle when a new response is created
      onResponseCreated: async (event, _context) => {
        // Start a new streaming message with unique ID
        const messageId = event.response?.id || Date.now().toString();
        currentStreamingMessageRef.current = {
          id: messageId,
          content: "",
        };
        setMessages((prev) => [...prev, { type: "assistant", content: "", id: messageId }]);
      },

      // Handle text delta streaming
      onResponseTextDelta: async (event, _context) => {
        if (currentStreamingMessageRef.current && event.delta) {
          currentStreamingMessageRef.current.content += event.delta;
          const targetId = currentStreamingMessageRef.current.id;
          const newContent = currentStreamingMessageRef.current.content;
          setMessages((prev) => {
            // Find the message by ID to handle out-of-order events
            const idx = prev.findIndex((m) => m.id === targetId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], content: newContent };
              return updated;
            }
            return prev;
          });
        }
      },

      // Handle audio transcription delta (assistant's response transcript)
      onResponseAudioTranscriptDelta: async (event, _context) => {
        if (currentStreamingMessageRef.current && event.delta) {
          currentStreamingMessageRef.current.content += event.delta;
          const targetId = currentStreamingMessageRef.current.id;
          const newContent = currentStreamingMessageRef.current.content;
          setMessages((prev) => {
            // Find the message by ID to handle out-of-order events
            const idx = prev.findIndex((m) => m.id === targetId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], content: newContent };
              return updated;
            }
            return prev;
          });
        }
      },

      // Handle audio delta (play audio chunks)
      onResponseAudioDelta: async (event, _context) => {
        if (event.delta) {
          if (audioHandlerRef.current?.isPlaying === false) {
            audioHandlerRef.current?.startStreamingPlayback();
          }
          // delta is already a Uint8Array in the new SDK
          audioHandlerRef.current?.playChunk(event.delta, async () => {
            proactiveManagerRef.current?.updateActivity("agent speaking");
          });
        }
      },

      // Handle response done
      onResponseDone: async (_event, _context) => {
        currentStreamingMessageRef.current = null;
        referenceText.current = "";
        audioChunksForPA.current = [];
      },

      // Handle user speech transcription completed
      onConversationItemInputAudioTranscriptionCompleted: async (event, _context) => {
        // Find the message by itemId and update the content with transcription
        const itemId = event.itemId;
        if (itemId) {
          setMessages((prev) => {
            const existingIdx = prev.findIndex((m) => m.id === itemId);
            if (existingIdx >= 0) {
              // Update existing message with transcription
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                content: event.transcript || "",
              };
              return updated;
            }
            // If no existing message found, create a new one
            return [...prev, { type: "user", content: event.transcript || "", id: itemId }];
          });
        } else {
          // Fallback: add as new message if no itemId
          setMessages((prev) => [
            ...prev,
            { type: "user", content: event.transcript || "" },
          ]);
        }
        referenceText.current = event.transcript || "";
      },

      // Handle user started speaking (for barge-in)
      onInputAudioBufferSpeechStarted: async (event, _context) => {
        isUserSpeaking.current = true;
        proactiveManagerRef.current?.updateActivity("user start to speak");
        audioHandlerRef.current?.stopStreamingPlayback();
        // Create a placeholder message for the user with the item ID
        const itemId = event.itemId;
        if (itemId) {
          setMessages((prev) => [
            ...prev,
            { type: "user", content: "...", id: itemId },
          ]);
        }
      },

      // Handle user stopped speaking
      onInputAudioBufferSpeechStopped: async (_event, _context) => {
        isUserSpeaking.current = false;
      },

      // Handle function call arguments done
      onResponseFunctionCallArgumentsDone: async (event, _context) => {
        console.log("Function call:", event.name, event.arguments);

        if (event.name === "get_time") {
          const formattedTime = new Date().toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short",
          });
          await sessionRef.current?.addConversationItem({
            type: "function_call_output",
            callId: event.callId,
            output: formattedTime,
          } as FunctionCallOutputItem);
          await sessionRef.current?.sendEvent({ type: "response.create" });
        } else if (event.name === "search") {
          const query = JSON.parse(event.arguments || "{}").query;
          if (searchClientRef.current && query) {
            setMessages((prev) => [
              ...prev,
              { type: "status", content: `Searching [${query}]...` },
            ]);
            const searchResults = await searchClientRef.current.search(query, {
              top: 5,
              queryType: "semantic",
              semanticSearchOptions: { configurationName: "default" },
              select: [searchContentField, searchIdentifierField],
            });
            let resultText = "";
            for await (const result of searchResults.results) {

              const document = result.document as any;
              resultText += `[${document[searchIdentifierField]}]: ${document[searchContentField]}\n-----\n`;
            }
            await sessionRef.current?.addConversationItem({
              type: "function_call_output",
              callId: event.callId,
              output: resultText,
            } as FunctionCallOutputItem);
            await sessionRef.current?.sendEvent({ type: "response.create" });
          }
        } else if (event.name === "pronunciation_assessment") {
          const PAResult = await startPAWithStream();
          await sessionRef.current?.addConversationItem({
            type: "function_call_output",
            callId: event.callId,
            output: PAResult,
          } as FunctionCallOutputItem);
          await sessionRef.current?.sendEvent({ type: "response.create" });
          referenceText.current = "";
          audioChunksForPA.current = [];
        }
      },

      onConversationItemCreated: async (event, _context) => {
        console.log("Conversation item created:", event);
        if (event.item && event.item.type === "mcp_approval_request") {
          const approvalItem = event.item as ResponseMCPApprovalRequestItem;
          const messageId = approvalItem.id || Date.now().toString();
          setMessages((prev) => [
            ...prev,
            {
              type: "mcp_approval",
              content: `MCP Tool Approval Request`,
              id: messageId,
              mcpApproval: {
                approvalRequestId: approvalItem.id || "",
                serverLabel: approvalItem.serverLabel || "Unknown Server",
                name: approvalItem.name || "Unknown Tool",
                arguments: approvalItem.arguments || "{}",
                handled: false,
              },
            },
          ]);
        }
        else if (event.item && isFoundryAgentCallItem(event.item)) {
          const foundryCallItem = event.item;
          const messageId = foundryCallItem.id || Date.now().toString();
          setMessages((prev) => [
            ...prev,
            {
              type: "foundry_agent",
              content: `Foundry Agent "${foundryCallItem.name || "Unknown"}" is triggered`,
              id: messageId,
              foundryAgent: {
                name: foundryCallItem.name || "Unknown",
              },
            },
          ]);
        }
      },

      onResponseOutputItemDone: async (event, _context) => {
        if (event.item && isFoundryAgentCallItem(event.item)) {
          const foundryCallItem = event.item;
          const messageId = foundryCallItem.id;
          if (messageId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId && m.foundryAgent
                  ? {
                      ...m,
                      foundryAgent: {
                        ...m.foundryAgent,
                        output: foundryCallItem.output || "(no output)",
                      },
                    }
                  : m
              )
            );
          }
        }
      },

      // Handle all server events as catch-all for video and MCP
      onServerEvent: async (event, _context) => {

        const anyEvent = event as any;
        // Note: response.video.delta is handled via monkey-patch in session setup
        // because the SDK's message parser drops unknown event types

        // Handle MCP call completed - trigger response generation
        if (anyEvent.type === KnownServerEventType.ResponseMcpCallCompleted) {
          console.log("MCP call completed, triggering response.create");
          await sessionRef.current?.sendEvent({ type: "response.create" });
        }

        // Handle Foundry Agent call arguments done
        if (isFoundryAgentCallEvent(anyEvent, "response.foundry_agent_call.arguments_done")) {
          const foundryCallArgsEvent = anyEvent;
          const messageId = foundryCallArgsEvent.item_id;
          if (messageId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId && m.foundryAgent
                  ? {
                      ...m,
                      foundryAgent: {
                        ...m.foundryAgent,
                        arguments: foundryCallArgsEvent.arguments || "{}",
                      },
                    }
                  : m
              )
            );
          }
        }

        // Handle Foundry Agent call in progress
        if (isFoundryAgentCallEvent(anyEvent, "response.foundry_agent_call.in_progress")) {
          const foundryCallInProgressEvent = anyEvent;
          const messageId = foundryCallInProgressEvent.item_id;
          if (messageId && foundryCallInProgressEvent.agent_response_id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId && m.foundryAgent
                  ? {
                      ...m,
                      foundryAgent: {
                        ...m.foundryAgent,
                        agentResponseId: foundryCallInProgressEvent.agent_response_id,
                      },
                    }
                  : m
              )
            );
          }
        }
      }
    });
  };

  const handleConnect = async () => {
    if (!isConnected) {
      try {
        setIsConnecting(true);

        // Refresh the token before connecting
        if (configLoaded) {
          try {
            const response = await fetch("/config");
            if (response.ok) {
              const config = await response.json();
              if (config.endpoint) {
                setEndpoint(config.endpoint);
              }
              if (config.token) {
                setEntraToken(config.token);
              }
            }
          } catch (error) {
            console.error("Failed to refresh token:", error);
            // Continue with existing token if refresh fails
          }
        }

        // Set up credentials for the new SDK
        credentialRef.current = entraToken
          ? {
              getToken: async () => ({
                token: entraToken,
                expiresOnTimestamp: Date.now() + 3600000,
              }),
            }
          : new AzureKeyCredential(apiKey);

        if (mode === "agent" && (!agentName || !agentProjectName)) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              type: "error",
              content: "Please input both agent name and project name.",
            },
          ]);
          return;
        }

        // Create VoiceLiveClient with apiVersion option
        // Build effective endpoint with query parameters
        const endpointUrl = new URL(endpoint);
        endpointUrl.searchParams.set("debug", "on");
        if (profile) {
          endpointUrl.searchParams.set("profile", profile);
        }
        clientRef.current = new VoiceLiveClient(endpointUrl.toString(), credentialRef.current!, {
          apiVersion: "2026-01-01-preview",
        });

        // Start session with model or agent SessionTarget
        if (mode === "agent") {
          const agentConfig: AgentSessionConfig = {
            agentName: agentName,
            projectName: agentProjectName,
            agentVersion: agentVersion || undefined,
          };
          sessionRef.current = await clientRef.current.startSession({ agent: agentConfig });
        } else {
          sessionRef.current = await clientRef.current.startSession(model);
        }

        // Monkey-patch the session to intercept raw messages for response.video.delta
        // The SDK's message parser drops unknown event types like response.video.delta

        const session = sessionRef.current as any;
        if (session._handleIncomingMessage) {
          const originalHandler = session._handleIncomingMessage.bind(session);
          session._handleIncomingMessage = (data: string | ArrayBuffer) => {
            // First, call the original handler
            originalHandler(data);

            // Then, check for response.video.delta which the SDK drops
            try {
              const messageText = typeof data === "string" ? data : new TextDecoder().decode(data);
              const parsed = JSON.parse(messageText);
              if (parsed.type === "response.video.delta" && parsed.delta) {
                // Handle video chunk directly since SDK drops this event type
                if (avatarOutputModeRef.current === "websocket") {
                  handleVideoChunk(parsed.delta);
                }
              }
            } catch {
              // Ignore parsing errors
            }
          };
        }

        // Start event subscription immediately after session is created to catch all events
        setupEventSubscription();

        console.log("Session created, sessionId:", sessionRef.current.sessionId);
        const modalities: Modality[] = ["text", "audio"];

        // Build turn detection config

        const turnDetectionConfig: any = turnDetectionType ? { ...turnDetectionType } : undefined;
        if (
          turnDetectionConfig &&
          eouDetectionType !== "none" &&
          isCascaded(mode, model)
        ) {
          turnDetectionConfig.endOfUtteranceDetection = {
            model: eouDetectionType,
          };
        }
        // Build voice config for the new SDK

        const voiceConfig: any = voiceType === "avatar-voice-sync"
          ? {
              type: "avatar-voice-sync",
              model: avatarVoiceSyncModel,
              temperature: voiceTemperature,
            }
          : voiceType === "azure-realtime-native"
          ? { name: voiceName || "ava", type: "azure-realtime-native" }
          : voiceType === "custom"
          ? {
              name: customVoiceName,
              endpointId: voiceDeploymentId,
              temperature: customVoiceName.toLowerCase().includes("dragonhd")
                ? voiceTemperature
                : undefined,
              rate: voiceSpeed.toString(),
              type: "azure-custom",
            }
          : voiceType === "personal"
            ? {
                name: personalVoiceName,
                type: "azure-personal",
                temperature: voiceTemperature,
                model: personalVoiceModel,
              }
            : (voiceName.includes("-") || voiceName.includes(":"))
              ? {
                  name: voiceName,
                  type: "azure-standard",
                  temperature: voiceName.toLowerCase().includes("dragonhd")
                    ? voiceTemperature
                    : undefined,
                  rate: voiceSpeed.toString(),
                }
              : { name: voiceName, type: "openai" };

        if (enableSearch) {
          searchClientRef.current = new SearchClient(
            searchEndpoint,
            searchIndex,
            new AzureKeyCredential(searchApiKey)
          );
        }
        // Set default instructions if foundry agent tools are configured
        const effectiveInstructions = foundryAgentTools.length > 0 && (!instructions || instructions.length === 0)
          ? defaultFoundryInstructions
          : instructions;

        // Get avatar config before updating session
        const avatarConfig = getAvatarConfig();

        // Build tools array - only include if there are actual tools
        const allTools = [
          ...(tools || []),
          ...(mcpServers || []).map((mcp) => ({
            type: "mcp" as const,
            serverUrl: mcp.serverUrl,
            authorization: mcp.authorization || undefined,
            serverLabel: mcp.serverLabel,
            requireApproval: mcp.requireApproval ? "always" : "never",
          })),
          ...(foundryAgentTools || []).map((tool) => ({
            type: "foundry_agent" as const,
            agentName: tool.agentName,
            agentVersion: tool.agentVersion,
            projectName: tool.projectName,
            description: tool.description || undefined,
            clientId: tool.clientId || undefined,
          })),
        ];

        // Update session configuration using the new SDK pattern
        await sessionRef.current!.updateSession({
          instructions: effectiveInstructions?.length > 0 ? effectiveInstructions : undefined,
          inputAudioTranscription: {
            model: srModel,
            // Language cannot be configured for mai-transcribe-1 model
            language:
              srModel === "mai-transcribe-1" ? undefined : (recognitionLanguage === "auto" ? undefined : recognitionLanguage),
            phraseList: phraseList.length > 0 ? phraseList : undefined,
            customSpeech: Object.keys(customSpeechModels).length > 0 ? customSpeechModels : undefined,
          },
          turnDetection: turnDetectionConfig,
          voice: voiceConfig,
          avatar: avatarConfig,
          tools: allTools.length > 0 ? allTools : undefined,
          // Temperature is not supported in agent mode (configured in agent definition)
          temperature: mode === "agent" ? undefined : temperature,
          modalities,
          inputAudioNoiseReduction: useNS
            ? {
                type: "azure_deep_noise_suppression" as const,
              }
            : undefined,
          inputAudioEchoCancellation: useEC
            ? {
                type: "server_echo_cancellation" as const,
              }
            : undefined,
          interimResponse: interimResponseEnabled ? buildInterimResponseConfig() : undefined,
        });

        // For photo avatar, send an additional session.update with scene config
        // using sendRawEvent to bypass SDK serialization which strips 'scene' property
        // Build minimal avatar config for scene - without outputProtocol, video, crop
        if (isPhotoAvatar && avatarConfig?.scene) {
          const sceneAvatarConfig = isCustomAvatar
            ? {
                type: "photo-avatar",
                model: "vasa-1",
                character: customAvatarName,
                customized: true,
                scene: avatarConfig.scene,
              }
            : {
                type: "photo-avatar",
                model: "vasa-1",
                character: photoAvatarName.split("-")[0].toLowerCase(),
                style: photoAvatarName.split("-").slice(1).join("-"),
                scene: avatarConfig.scene,
              };
          await sendRawEvent({
            type: "session.update",
            session: {
              avatar: sceneAvatarConfig,
            },
          });
        }

        // Setup avatar if enabled
        if (isAvatar && avatarConfig) {
          if (avatarOutputMode === "webrtc") {
            // For WebRTC, subscribe to session.updated to get ICE servers, then initiate connection
            const iceServersPromise = new Promise<RTCIceServer[] | undefined>((resolve) => {
              const timeout = setTimeout(() => {
                console.log("ICE servers timeout, proceeding without ICE servers");
                resolve(undefined);
              }, 5000);

              const tempSub = sessionRef.current!.subscribe({
                onSessionUpdated: async (event) => {
                  clearTimeout(timeout);

                  const avatarInfo = (event.session as any)?.avatar;
                  if (avatarInfo?.iceServers) {
                    console.log("Received ICE servers from session.updated:", avatarInfo.iceServers);
                    resolve(avatarInfo.iceServers);
                  } else {
                    console.log("No ICE servers in session.updated, proceeding without");
                    resolve(undefined);
                  }
                  await tempSub.close();
                },
              });
            });

            const iceServers = await iceServersPromise;
            await getLocalDescription(iceServers);
          } else {
            // Setup MediaSource before setIsConnected - video element will be appended via useEffect
            setupWebSocketVideoPlayback();
          }
        }

        // Start recording the session
        if (audioHandlerRef.current) {
          audioHandlerRef.current.startSessionRecording();
        }

        setIsConnected(true);
        // Get session ID - may be available now or will be updated via onSessionCreated handler
        const currentSessionId = sessionRef.current?.sessionId || "connecting...";
        setSessionId(currentSessionId);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "status",
            content:
              "Session started, click on the mic button to start conversation! debug id: " +
              currentSessionId,
          },
        ]);

        if (enableProactive) {
          proactiveManagerRef.current = new ProactiveEventManager(
            whenGreeting,
            whenInactive,
            10000
          );
          proactiveManagerRef.current.start();
        }
      } catch (error) {
        console.error("Connection failed:", error);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "error",
            content: "Error connecting to the server: " + error,
          },
        ]);
      } finally {
        setIsConnecting(false);
      }
    } else {
      clearVideo();
      await disconnect();
    }
  };

  const whenGreeting = async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.addConversationItem({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Please greet the user to start the conversation.",
            },
          ],
        } as SystemMessageItem);
        // Disable tool calls for greeting
        await sessionRef.current.sendEvent({ type: "response.create", response: { toolChoice: "none" } });
      } catch (error) {
        console.error("Error generating greeting message:", error);
      }
    }
  };

  const whenInactive = async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.addConversationItem({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: "User hasn't responded for a while, please say something to continue the conversation.",
            },
          ],
        } as SystemMessageItem);
        // Disable tool calls for inactivity prompt
        await sessionRef.current.sendEvent({ type: "response.create", response: { toolChoice: "none" } });
      } catch (error) {
        console.error("Error sending no activity message:", error);
      }
    }
  };

  const buildInterimResponseConfig = (): InterimResponseConfig => {
    const base = {
      triggers: interimResponseTriggers,
      latencyThresholdInMs: interimResponseLatencyThreshold,
    };
    if (interimResponseType === "static_interim_response") {
      return {
        ...base,
        type: "static_interim_response" as const,
        texts: interimResponseTexts.split("\n").map(t => t.trim()).filter(t => t.length > 0),
      };
    } else {
      return {
        ...base,
        type: "llm_interim_response" as const,
        model: interimResponseModel || undefined,
        instructions: interimResponseInstructions || undefined,
        maxCompletionTokens: interimResponseMaxTokens || undefined,
      };
    }
  };

  const getAvatarConfig = (): any => {
    if (!isAvatar) {
      return undefined;
    }

    // Build video params - only include background if URL is provided

    const videoParams: any = {
      codec: "h264",
      resolution: {
        width: 1920,
        height: 1080,
      },
      crop: {
        topLeft: [560, 0],
        bottomRight: [1360, 1080],
      },
      bitrate: isPhotoAvatar ? 500000 : 1000000,
    };

    // Only add background if URL is provided (avoid undefined values)
    if (avatarBackgroundImageUrl) {
      videoParams.background = {
        imageUrl: avatarBackgroundImageUrl,
      };
    }

    // Base config with output_protocol
    const baseConfig = {
      outputProtocol: avatarOutputMode as "webrtc" | "websocket",
    };

    if (isCustomAvatar && customAvatarName && !isPhotoAvatar) {
      return {
        ...baseConfig,
        character: customAvatarName,
        customized: true,
        video: videoParams,
      };
    } else if (isCustomAvatar && customAvatarName && isPhotoAvatar) {
      return {
        ...baseConfig,
        type: "photo-avatar",
        model: "vasa-1",
        character: customAvatarName,
        customized: true,
        video: videoParams,
        scene: {
          zoom: sceneZoom / 100,
          position_x: scenePositionX / 100,
          position_y: scenePositionY / 100,
          rotation_x: sceneRotationX * Math.PI / 180,
          rotation_y: sceneRotationY * Math.PI / 180,
          rotation_z: sceneRotationZ * Math.PI / 180,
          amplitude: sceneAmplitude / 100,
        },
      };
    } else if (isAvatar && !isCustomAvatar && !isPhotoAvatar) {
      return {
        ...baseConfig,
        character: avatarName.split("-")[0].toLowerCase(),
        style: avatarName.split("-").slice(1).join("-"),
        video: videoParams,
      };
    } else if (isAvatar && !isCustomAvatar && isPhotoAvatar) {
      return {
        ...baseConfig,
        type: "photo-avatar",
        model: "vasa-1",
        character: photoAvatarName.split("-")[0].toLowerCase(),
        style: photoAvatarName.split("-").slice(1).join("-"),
        video: videoParams,
        scene: {
          zoom: sceneZoom / 100,
          position_x: scenePositionX / 100,
          position_y: scenePositionY / 100,
          rotation_x: sceneRotationX * Math.PI / 180,
          rotation_y: sceneRotationY * Math.PI / 180,
          rotation_z: sceneRotationZ * Math.PI / 180,
          amplitude: sceneAmplitude / 100,
        },
      };
    } else {
      return undefined;
    }
  };

  // Helper function to send raw JSON through the SDK's internal connection manager
  // This bypasses the SDK's serializer which strips unknown properties like 'scene'

  const sendRawEvent = async (event: any): Promise<void> => {
    if (!sessionRef.current) {
      throw new Error("Session not connected");
    }
    // Access the internal connection manager to send raw JSON

    const session = sessionRef.current as any;
    if (session._connectionManager?.send) {
      const serialized = JSON.stringify(event);
      await session._connectionManager.send(serialized);
    } else {
      throw new Error("Cannot access connection manager for raw send");
    }
  };

  // Ref to track the last time we sent an update (for throttling)
  const lastSceneUpdateRef = useRef<number>(0);
  const sceneUpdateThrottleMs = 50; // Send updates at most every 50ms

  // Update avatar scene settings at runtime when connected
  const updateAvatarScene = useCallback(async () => {
    if (!isConnected || !sessionRef.current || !isAvatar || !isPhotoAvatar) {
      return;
    }

    // Throttle updates to avoid overwhelming the server
    const now = Date.now();
    if (now - lastSceneUpdateRef.current < sceneUpdateThrottleMs) {
      return;
    }
    lastSceneUpdateRef.current = now;

    try {
      // Build minimal avatar config for scene update only
      // Do not include outputProtocol, video, crop - only identification and scene
      const avatarConfig = isCustomAvatar
        ? {
            type: "photo-avatar",
            model: "vasa-1",
            character: customAvatarName,
            customized: true,
            scene: {
              zoom: sceneZoom / 100,
              position_x: scenePositionX / 100,
              position_y: scenePositionY / 100,
              rotation_x: sceneRotationX * Math.PI / 180,
              rotation_y: sceneRotationY * Math.PI / 180,
              rotation_z: sceneRotationZ * Math.PI / 180,
              amplitude: sceneAmplitude / 100,
            },
          }
        : {
            type: "photo-avatar",
            model: "vasa-1",
            character: photoAvatarName.split("-")[0].toLowerCase(),
            style: photoAvatarName.split("-").slice(1).join("-"),
            scene: {
              zoom: sceneZoom / 100,
              position_x: scenePositionX / 100,
              position_y: scenePositionY / 100,
              rotation_x: sceneRotationX * Math.PI / 180,
              rotation_y: sceneRotationY * Math.PI / 180,
              rotation_z: sceneRotationZ * Math.PI / 180,
              amplitude: sceneAmplitude / 100,
            },
          };

      // Use sendRawEvent to bypass SDK serialization which strips 'scene' property
      await sendRawEvent({
        type: "session.update",
        session: {
          avatar: avatarConfig,
        },
      });
    } catch (error) {
      console.error("Error updating avatar scene:", error);
    }
  }, [isConnected, isAvatar, isPhotoAvatar, isCustomAvatar, customAvatarName, photoAvatarName, sceneZoom, scenePositionX, scenePositionY, sceneRotationX, sceneRotationY, sceneRotationZ, sceneAmplitude]);

  const disconnect = async () => {
    // Unsubscribe from events first
    if (subscriptionRef.current) {
      await subscriptionRef.current.close();
      subscriptionRef.current = null;
    }

    // Disconnect the session
    if (sessionRef.current) {
      try {
        await sessionRef.current.disconnect();
        sessionRef.current = null;
      } catch (error) {
        console.error("Error disconnecting session:", error);
      }
    }

    // Clear the client reference (VoiceLiveClient doesn't need explicit dispose)
    if (clientRef.current) {
      try {
        clientRef.current = null;
        peerConnection = null as unknown as RTCPeerConnection;
        setIsConnected(false);
        audioHandlerRef.current?.stopStreamingPlayback();
        proactiveManagerRef.current?.stop();
        isUserSpeaking.current = false;
        audioHandlerRef.current?.stopRecordAnimation();
        audioHandlerRef.current?.stopPlayChunkAnimation();
        if (isRecording) {
          audioHandlerRef.current?.stopRecording();
          setIsRecording(false);
        }
        startRecordingTimestamp.current = null;
        pauseDurations.current = [];
        lastPauseTimestamp.current = null;

        // Clean up WebSocket video resources
        cleanupWebSocketVideo();

        // Stop recording and check if there's any recorded audio
        if (audioHandlerRef.current) {
          audioHandlerRef.current.stopSessionRecording();
          setHasRecording(audioHandlerRef.current.hasRecordedAudio());
        }
      } catch (error) {
        console.error("Disconnect failed:", error);
      }
    }
  };

  // Extract valid audio chunks from a time range (kept for potential PA usage)
  function extractValidAudioFromTimeRange(startMillis: number, endMillis: number) {
    audioChunksForPA.current = audioChunksForPA.current.filter(
      (c) =>
        c.timestamp >= startMillis &&
        c.timestamp <= endMillis,
    );
  }

  // Handle MCP approval response (approve or deny)
  const handleMcpApprovalResponse = async (messageId: string, approve: boolean) => {
    // Find the message to get the approval request ID
    const message = messages.find((m) => m.id === messageId);
    if (!message?.mcpApproval || !sessionRef.current) {
      console.error("Could not find MCP approval request or session");
      return;
    }

    try {
      // Send the approval response
      await sessionRef.current.addConversationItem({
        type: "mcp_approval_response",
        approve: approve,
        approvalRequestId: message.mcpApproval.approvalRequestId,

      } as any);

      // Mark the message as handled
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, mcpApproval: { ...m.mcpApproval!, handled: true } }
            : m
        )
      );

      // Add a status message indicating the response
      const toolName = message.mcpApproval.name;
      setMessages((prev) => [
        ...prev,
        {
          type: "status",
          content: `MCP tool "${toolName}" ${approve ? "approved" : "denied"}`,
        },
      ]);

      console.log(`MCP approval response sent: ${approve ? "approved" : "denied"} for ${toolName}`);
    } catch (error) {
      console.error("Failed to send MCP approval response:", error);
      setMessages((prev) => [
        ...prev,
        { type: "error", content: `Failed to send approval response: ${error}` },
      ]);
    }
  };

  const sendMessage = async () => {
    if (currentMessage.trim() && sessionRef.current) {
      try {
        const temporaryStorageMessage = currentMessage;
        setCurrentMessage("");
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "user",
            content: temporaryStorageMessage,
          },
        ]);
        referenceText.current = temporaryStorageMessage;


        await sessionRef.current.addConversationItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: temporaryStorageMessage }],
        } as any);
        await sessionRef.current.sendEvent({ type: "response.create" });
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    }
  };

  const startPAWithStream = async (): Promise<string> => {

    return new Promise((resolve, _) => {
      if (!audioChunksForPA.current || audioChunksForPA.current.length === 0) {
        console.log("No audio chunks available for pronunciation assessment.");
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "status",
            content: "No audio chunks available for pronunciation assessment.",
          },
        ]);
        resolve("");
      }
      const pushStream = speechSDK.AudioInputStream.createPushStream();
      const audioConfig = speechSDK.AudioConfig.fromStreamInput(pushStream);
      const speechConfig = speechSDK.SpeechConfig.fromEndpoint(
        new URL(endpoint),
        apiKey  // Use the apiKey directly for speech SDK
      );

      speechConfig.setProperty(
        speechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs,
        "1500"
      );

      const pronunciationAssessmentConfig =
        new speechSDK.PronunciationAssessmentConfig(
          referenceText.current,
          speechSDK.PronunciationAssessmentGradingSystem.HundredMark,
          speechSDK.PronunciationAssessmentGranularity.Phoneme,
          true
        );
      pronunciationAssessmentConfig.enableProsodyAssessment = true;

      if (recognitionLanguage !== "auto") {
        speechConfig.speechRecognitionLanguage = recognitionLanguage;
      }
      let reco: speechSDK.SpeechRecognizer | undefined = undefined;
      try {
        reco = new speechSDK.SpeechRecognizer(speechConfig, audioConfig);
      } catch (error) {
        const msg = "Error setting up pronunciation assessment:" + error;
        console.error(msg);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "error",
            content: msg,
          },
        ]);
      }

      if (!reco) {
        resolve("");
        return;
      }

      pronunciationAssessmentConfig.applyTo(reco);

      const PAResults: string[] = [];

      reco.recognized = function (_s, e) {
        PAResults.push(
          e.result.properties.getProperty(
            speechSDK.PropertyId.SpeechServiceResponse_JsonResult
          )
        );
      };


      reco.sessionStopped = function (_s, _e) {
        reco.stopContinuousRecognitionAsync();
        reco.close();
        resolve(`"[${PAResults.join(',')}]"`);
      };

      reco.startContinuousRecognitionAsync();

      for (const item of audioChunksForPA.current) {
        pushStream.write(item.audioBuffer);
      }
      pushStream.close();
    });
  };

  function cacheAudioChunksForPA(chunk: Uint8Array) {
    if (!audioHandlerRef.current) return;
    const floatData = int16PCMToFloat32(chunk);
    const downsampled = downsampleBuffer(
      floatData,
      audioHandlerRef.current.getSampleRate(),
      16000
    );
    const int16Buffer = float32ToInt16PCM(downsampled);
    const arrayBuffer = new ArrayBuffer(int16Buffer.length);
    new Uint8Array(arrayBuffer).set(int16Buffer);
    if (startRecordingTimestamp.current) {
      audioChunksForPA.current.push({
        audioBuffer: arrayBuffer,
        timestamp:
          Date.now() -
          pauseDurations.current.reduce((acc, curr) => acc + curr, 0) -
          startRecordingTimestamp.current
      });
    }
  }

  const toggleRecording = async () => {
    if (!isRecording && sessionRef.current) {
      try {
        if (!startRecordingTimestamp.current) {
          startRecordingTimestamp.current = Date.now();
        }
        if (lastPauseTimestamp.current) {
          pauseDurations.current.push(Date.now() - lastPauseTimestamp.current);
        }
        if (!audioHandlerRef.current) {
          audioHandlerRef.current = new AudioHandler();
          await audioHandlerRef.current.initialize();
        }
        await audioHandlerRef.current.startRecording(async (chunk) => {
          cacheAudioChunksForPA(chunk);
          await sessionRef.current?.sendAudio(chunk);
          if (isUserSpeaking.current) {
            proactiveManagerRef.current?.updateActivity("user speaking");
          }
        });
        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
      }
    } else if (audioHandlerRef.current) {
      try {
        audioHandlerRef.current.stopRecording();
        audioHandlerRef.current.stopRecordAnimation();
        lastPauseTimestamp.current = Date.now();
        if (turnDetectionType === null) {
          // Commit audio buffer and request response for manual turn detection
          await sessionRef.current?.sendEvent({ type: "input_audio_buffer.commit" });
          proactiveManagerRef.current?.updateActivity("user speaking");
          await sessionRef.current?.sendEvent({ type: "response.create" });
        }
        setIsRecording(false);
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    }
  };

  const getLocalDescription = (ice_servers?: RTCIceServer[]) => {
    console.log("Received ICE servers" + JSON.stringify(ice_servers));

    peerConnection = new RTCPeerConnection({ iceServers: ice_servers });

    setupPeerConnection();

    peerConnection.onicegatheringstatechange = (): void => {
      if (peerConnection.iceGatheringState === "complete") {
      }
    };

    peerConnection.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ): void => {
      if (!event.candidate) {
      }
    };

    setRemoteDescription();
  };

  const setRemoteDescription = async () => {
    try {
      const sdp = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(sdp);

      // sleep 2 seconds to wait for ICE candidates to be gathered
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Local SDP offer created:", peerConnection.localDescription);

      // In the new SDK, avatar connection is done via session.avatar.connect event
      // Send the SDP offer and wait for the server's SDP answer via the onSessionAvatarConnecting handler
      if (sessionRef.current && peerConnection.localDescription) {
        // We need to set up a one-time handler for the avatar connecting event
        const avatarConnectPromise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Avatar connection timeout"));
          }, 30000);

          // Store the original onServerEvent if it exists
          const tempSubscription = sessionRef.current!.subscribe({
            onSessionAvatarConnecting: async (event) => {
              clearTimeout(timeout);
              if (event.serverSdp) {
                resolve(event.serverSdp);
              } else {
                reject(new Error("No server SDP received"));
              }
              await tempSubscription.close();
            },
          });
        });

        // Send the avatar connect event
        await sessionRef.current.sendEvent({
          type: "session.avatar.connect",
          clientSdp: btoa(JSON.stringify(peerConnection.localDescription)),
        });

        // Wait for the server's SDP answer (base64 encoded JSON)
        const serverSdpBase64 = await avatarConnectPromise;
        const serverSdpJson = atob(serverSdpBase64);
        const serverSdpObj = JSON.parse(serverSdpJson) as RTCSessionDescriptionInit;
        await peerConnection.setRemoteDescription(serverSdpObj);
      }
    } catch (error) {
      console.error("Connection failed:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "error",
          content: "Error establishing avatar connection: " + error,
        },
      ]);
    }
  };

  const setupPeerConnection = () => {
    clearVideo();

    peerConnection.ontrack = function (event) {
      const mediaPlayer = document.createElement(
        event.track.kind
      ) as HTMLMediaElement;
      mediaPlayer.id = event.track.kind;
      mediaPlayer.srcObject = event.streams[0];
      mediaPlayer.autoplay = false;
      mediaPlayer.addEventListener('loadeddata', () => {
          mediaPlayer.play()
      })
      videoRef?.current?.appendChild(mediaPlayer);
      if (event.track.kind === "video") {
        mediaPlayer.style.width = "0.1%";
        mediaPlayer.style.height = "0.1%";
        mediaPlayer.onplaying = () => {
          let delayMs = 0;
          if (isPhotoAvatar) {
            delayMs = 240; // delay some time to skip black screen for photo avatar
            mediaPlayer.style.borderRadius = "10%"; // apply border radius for photo avatar
          }
          setTimeout(() => {
            if (isPhotoAvatar) {
              if (isDevelop) {
                mediaPlayer.style.width = "auto";
                mediaPlayer.style.height = "auto";
              } else {
                mediaPlayer.style.width = "auto";
                mediaPlayer.style.height = "";
              }
            } else {
              mediaPlayer.style.width = "";
              mediaPlayer.style.height = "";
            }
          }, delayMs);
        }
      }
    };

    peerConnection.addTransceiver("video", { direction: "sendrecv" });
    peerConnection.addTransceiver("audio", { direction: "sendrecv" });

    peerConnection.addEventListener("datachannel", (event) => {
      const dataChannel = event.channel;
      dataChannel.onmessage = (e) => {
        console.log(
          "[" + new Date().toISOString() + "] WebRTC event received: " + e.data
        );
      };
      dataChannel.onclose = () => {
        console.log("Data channel closed");
      };
    });
    peerConnection.createDataChannel("eventChannel");
  };

  const clearVideo = () => {
    const videoElement = videoRef?.current;

    // Clean up existing video element if there is any
    if (videoElement?.innerHTML) {
      videoElement.innerHTML = "";
    }

    // Clean up WebSocket video resources
    cleanupWebSocketVideo();
  };

  const cleanupWebSocketVideo = () => {
    // Clear the queue first to prevent any pending operations
    videoChunksQueueRef.current = [];

    if (sourceBufferRef.current && mediaSourceRef.current) {
      try {
        // Only end the stream if it's still open
        if (mediaSourceRef.current.readyState === "open") {
          // Wait for any pending updates to complete before ending
          if (!sourceBufferRef.current.updating) {
            mediaSourceRef.current.endOfStream();
          }
        }
      } catch (e) {
        console.error("Error ending MediaSource stream:", e);
      }
    }
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
  };

  const setupWebSocketVideoPlayback = () => {
    // Clear any existing video
    clearVideo();

    // Create video element for WebSocket mode
    const videoElement = document.createElement("video");
    videoElement.id = "ws-video";
    videoElement.autoplay = true;
    videoElement.playsInline = true;

    // Use responsive dimensions so the video resizes with the browser window,
    // matching the WebRTC behaviour for both photo and non-photo avatars.
    if (isPhotoAvatar) {
      videoElement.style.borderRadius = "10%";
      videoElement.style.width = "auto";
      videoElement.style.height = isDevelop ? "auto" : "";
      videoElement.style.objectFit = "cover";
    } else {
      // For non-photo avatars, clear inline styles so CSS rules
      // (.content video / .developer-content video) constrain the size,
      // matching WebRTC behaviour (no object-fit override).
      videoElement.style.width = "";
      videoElement.style.height = "";
    }
    videoElement.style.display = "block";

    // Add canplay event to start playback
    videoElement.addEventListener("canplay", () => {
      videoElement.play().catch(e => console.error("Play error:", e));
    });

    // fMP4 codec string with video (H.264) and audio (AAC) - matches avatar service output
    const FMP4_MIME_CODEC = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';

    // Set up MediaSource
    if (!MediaSource.isTypeSupported(FMP4_MIME_CODEC)) {
      console.error("MediaSource fMP4 codec not supported");
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "error",
          content: "WebSocket video playback not supported in this browser. Please use WebRTC mode.",
        },
      ]);
      return;
    }

    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    videoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", () => {
      try {
        if (mediaSource.readyState === "open") {
          const sourceBuffer = mediaSource.addSourceBuffer(FMP4_MIME_CODEC);
          sourceBufferRef.current = sourceBuffer;

          sourceBuffer.addEventListener("updateend", () => {
            processVideoChunkQueue();
          });
        }
      } catch (e) {
        console.error("Error creating SourceBuffer:", e);
      }
    });

    // Store video element to be appended when DOM is ready
    pendingVideoElementRef.current = videoElement;

    // Try to append now if DOM is ready, otherwise useEffect will handle it
    if (videoRef.current) {
      videoRef.current.appendChild(videoElement);
      pendingVideoElementRef.current = null;
    }
  };

  // Effect to append pending video element when DOM becomes available
  useEffect(() => {
    if (isConnected && videoRef.current && pendingVideoElementRef.current) {
      videoRef.current.appendChild(pendingVideoElementRef.current);
      pendingVideoElementRef.current = null;
    }
  }, [isConnected]);

  const processVideoChunkQueue = () => {
    const sourceBuffer = sourceBufferRef.current;
    const mediaSource = mediaSourceRef.current;

    if (!sourceBuffer ||
        sourceBuffer.updating ||
        !mediaSource ||
        mediaSource.readyState !== "open") {
      return;
    }

    const next = videoChunksQueueRef.current.shift();
    if (!next) {
      return;
    }

    try {
      sourceBuffer.appendBuffer(next);
    } catch (e) {
      console.error("Error appending video chunk:", e);
    }
  };

  const handleVideoChunk = (base64Data: string) => {
    try {
      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const arrayBuffer = new ArrayBuffer(binaryString.length);
      const bytes = new Uint8Array(arrayBuffer);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Add ArrayBuffer to queue and process
      videoChunksQueueRef.current.push(arrayBuffer);
      processVideoChunkQueue();
    } catch (e) {
      console.error("Error handling video chunk:", e);
    }
  };

  const downloadRecording = () => {
    if (audioHandlerRef.current) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      audioHandlerRef.current.downloadRecording(
        `conversation-${timestamp}`,
        sessionId
      );
    }
  };

  useEffect(() => {
    const initAudioHandler = async () => {
      const handler = new AudioHandler();
      await handler.initialize();
      audioHandlerRef.current = handler;
    };

    initAudioHandler().catch(console.error);

    return () => {
      disconnect();
      audioHandlerRef.current?.close().catch(console.error);
    };
  }, []);

  useEffect(() => {
    const element = document.getElementById("messages-area");
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // Function to detect mobile devices
    const checkForMobileDevice = () => {
      const userAgent = navigator.userAgent;
      const isMobileCheck =
        /iPad|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(
          userAgent
        );
      setIsMobile(isMobileCheck);
    };

    // Run the check when component mounts
    checkForMobileDevice();

    // Optionally, could add window resize listener here if needed
    // to detect orientation changes or responsive breakpoints
  }, []);

  useEffect(() => {
    const element = animationRef.current;
    if (isConnected && element && !isEnableAvatar) {
      audioHandlerRef.current?.setCircleElement(element);
    } else {
      audioHandlerRef.current?.setCircleElement(null);
    }
  }, [isConnected, isEnableAvatar]);

  useEffect(() => {
    if (isConnected && isEnableAvatar && isRecording) {
      intervalId = setInterval(() => {
        for (let i = 0; i < 20; i++) {
          const ele = document.getElementById(`item-${i}`);
          const height = 50 * Math.sin((Math.PI / 20) * i) * Math.random();
          if (ele) {
            ele.style.transition = "height 0.15s ease";
            ele.style.height = `${height}px`;
          }
        }
      }, 150);
    } else {
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  }, [isConnected, isEnableAvatar, isRecording]);

  useEffect(() => {
    if (isConnected && isEnableAvatar) {
      const videoPlayer = document.getElementById("video");
      if (videoPlayer) {
        if (isDevelop) {
          videoPlayer.style.width = "auto";
          videoPlayer.style.height = "auto";
        } else {
          videoPlayer.style.width = "auto";
          videoPlayer.style.height = "";
        }
      }
    }
  }, [isDevelop]);

  // Apply settings from a predefined scenario
  const applyScenario = (scenarioKey: string) => {
    const scenario = predefinedScenarios[scenarioKey];
    if (!scenario) return;

    // Apply instructions
    if (scenario.instructions) {
      setInstructions(scenario.instructions);
    }

    // Apply proactive setting
    if (scenario.pro_active !== undefined) {
      setEnableProactive(scenario.pro_active);
    }

    // Apply voice settings
    if (scenario.voice) {
      if (scenario.voice.custom_voice) {
        setVoiceType("custom");
        if (scenario.voice.deployment_id) {
          setVoiceDeploymentId(scenario.voice.deployment_id);
        }
        if (scenario.voice.voice_name) {
          setCustomVoiceName(scenario.voice.voice_name);
        }
        if (scenario.voice.temperature) {
          setVoiceTemperature(scenario.voice.temperature);
        }
        if (scenario.voice.speed) {
          setVoiceSpeed(scenario.voice.speed);
        }
      } else {
        setVoiceType("standard");
        if (scenario.voice.voice_name) {
          setVoiceName(scenario.voice.voice_name);
        }
      }
    }

    // Apply avatar settings
    if (scenario.avatar) {
      setIsAvatar(scenario.avatar.enabled);
      if (scenario.avatar.enabled) {
        setIsCustomAvatar(scenario.avatar.customized);
        if (scenario.avatar.customized) {
          setCustomAvatarName(scenario.avatar.avatar_name);
        } else {
          setAvatarName(scenario.avatar.avatar_name);
        }
      }
    } else {
      setIsAvatar(false);
    }

    // Update selected scenario
    setSelectedScenario(scenarioKey);
  };

  // Returns true if agent mode is enabled or a cascaded model is selected
  function isCascaded(mode: "model" | "agent", model: string): boolean {
    if (mode === "agent") return true;
    // Add all cascaded model names here
    const cascadedModels = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-5-chat",
      "gpt-5.1",
      "gpt-5.1-chat",
      "gpt-5.2",
      "gpt-5.2-chat",
      "gpt-5.3-chat",
      "gpt-5.4",
    ];
    return cascadedModels.includes(model);
  }

  function handleSettings() {
    if (settingsRef.current) {
      if (isSettings) {
        settingsRef.current.style.display = "block";
        setIsSettings(false);
      } else {
        settingsRef.current.style.display = "none";
        setIsSettings(true);
      }
    }
  }

  const addPhrase = (phrase: string) => {
    if (phrase.trim() && phraseList.length < 10 && !phraseList.includes(phrase)) {
      setPhraseList([...phraseList, phrase]);
    }
  };

  const removePhrase = (phrase: string) => {
    setPhraseList(phraseList.filter((p) => p !== phrase));
  };

  const addCustomSpeechModel = (key: string, value: string) => {
    if (
      key &&
      value &&
      !customSpeechModels[key] &&
      Object.keys(customSpeechModels).length < 9
    ) {
      setCustomSpeechModels({ ...customSpeechModels, [key]: value });
    }
  };

  const removeCustomSpeechModel = (key: string) => {
    const updatedModels = { ...customSpeechModels };
    delete updatedModels[key];
    setCustomSpeechModels(updatedModels);
  };

  return (
    <div className="flex h-screen">
      {/* Parameters Panel */}
      <div
        className="w-80 bg-gray-50 p-4 flex flex-col border-r"
        ref={settingsRef}
      >
        <div className="flex-1 overflow-y-auto">
          <Accordion type="single" collapsible className="space-y-4">
            {/* Instructions */}
            <AccordionItem value="instructions">
              <AccordionTrigger className="text-lg font-semibold">
                Instructions
              </AccordionTrigger>
              <AccordionContent>
                <div className="w-full min-h-[200px] p-4 border rounded bg-gray-50 font-sans text-sm text-gray-800 overflow-auto">
                  <ReactMarkdown
                    components={{
                      ol: ({ ...props }) => (
                        <ol className="list-decimal ml-6" {...props} />
                      ),
                      ul: ({ ...props }) => (
                        <ul className="list-disc ml-6" {...props} />
                      ),
                      li: ({ ...props }) => <li className="mb-1" {...props} />,
                      p: ({ ...props }) => <p className="my-2" {...props} />,
                    }}
                  >
                    {readme}
                  </ReactMarkdown>
                </div>
              </AccordionContent>
            </AccordionItem>
            {/* Connection Settings */}
            <AccordionItem value="connection">
              <AccordionTrigger className="text-lg font-semibold">
                Connection Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {/* Mode Switch */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mode</label>
                  <Select
                    value={mode}
                    onValueChange={(v) => setMode(v as "model" | "agent")}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="model">Model</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Always show endpoint and subscription key */}
                <Input
                  placeholder="Azure AI Services Endpoint"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  disabled={isConnected || configLoaded}
                />
                {(!configLoaded || mode === "agent") && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Authentication</label>
                      <Select
                        value={authType}
                        onValueChange={(v) => setAuthType(v as "apiKey" | "entraToken")}
                        disabled={isConnected}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="apiKey">API Key</SelectItem>
                          <SelectItem value="entraToken">Entra ID Token</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {authType === "entraToken" ? (
                      <Input
                        placeholder="Entra Token"
                        value={entraToken}
                        onChange={(e) => setEntraToken(e.target.value)}
                        disabled={isConnected}
                      />
                    ) : (
                      <Input
                        type="password"
                        placeholder="Subscription Key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        disabled={isConnected}
                      />
                    )}
                  </>
                )}

                {/* Show agent fields if agent mode */}
                {mode === "agent" ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Agent</label>
                    </div>
                    <Input
                      placeholder="Agent Project Name"
                      value={agentProjectName}
                      onChange={(e) => setAgentProjectName(e.target.value)}
                      disabled={isConnected}
                    />
                    {agents.length > 0 ? (
                      <Select
                        value={`${agentName}:${agentVersion}`}
                        onValueChange={(value) => {
                          const [name, ...versionParts] = value.split(":");
                          setAgentName(name);
                          setAgentVersion(versionParts.join(":"));
                        }}
                        disabled={isConnected}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={`${agent.name}:${agent.version}`} value={`${agent.name}:${agent.version}`}>
                              {agent.name} (v{agent.version})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="Agent Name"
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        disabled={isConnected}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Model</label>
                      <Select
                        value={model}
                        onValueChange={(value) => {
                          setModel(value);
                          if (value === "azure-realtime") {
                            setVoiceType("azure-realtime-native");
                            setVoiceName("ava");
                          } else if (voiceType === "azure-realtime-native") {
                            setVoiceType("standard");
                          }
                        }}
                        disabled={isConnected}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-realtime-1.5">
                            GPT Realtime 1.5
                          </SelectItem>
                          <SelectItem value="azure-realtime">
                            Azure Realtime
                          </SelectItem>
                          <SelectItem value="gpt-realtime">
                            GPT Realtime
                          </SelectItem>
                          <SelectItem value="gpt-realtime-mini">
                            GPT Realtime Mini
                          </SelectItem>
                          <SelectItem value="gpt-5.4">
                            GPT-5.4 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5.3-chat">
                            GPT-5.3 Chat (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5.2">
                            GPT-5.2 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5.2-chat">
                            GPT-5.2 Chat (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5.1">
                            GPT-5.1 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5.1-chat">
                            GPT-5.1 Chat (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5">
                            GPT-5 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5-mini">
                            GPT-5 Mini (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5-nano">
                            GPT-5 Nano (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-5-chat">
                            GPT-5 Chat (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4.1">
                            GPT-4.1 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4.1-mini">
                            GPT-4.1 Mini (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4.1-nano">
                            GPT-4.1 Nano (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4o">
                            GPT-4o (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4o-mini">
                            GPT-4o Mini (Cascaded)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
            {/* Conversation Settings */}
            <AccordionItem value="conversation">
              <AccordionTrigger className="text-lg font-semibold">
                Conversation Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {/* Predefined Scenarios dropdown */}
                {Object.keys(predefinedScenarios).length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Predefined Scenarios
                    </label>
                    <Select
                      value={selectedScenario}
                      onValueChange={(value) => applyScenario(value)}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a predefined scenario" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(predefinedScenarios).map(
                          ([key, scenario]) => (
                            <SelectItem key={key} value={key}>
                              {scenario.name || key}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {/* {selectedScenario && (
                      <div className="text-xs text-gray-500 italic mt-1">
                        Applied settings from "{selectedScenario}" scenario
                      </div>
                    )} */}
                  </div>
                )}

                {/* Speech Recognition Model selection - only show if cascaded/agent */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Speech Recognition Model
                  </label>
                  <Select
                    value={srModel}
                    onValueChange={(value) => setSrModel(value as typeof srModel)}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="azure-speech">Azure Speech</SelectItem>
                      <SelectItem value="mai-transcribe-1">MAI Transcribe 1</SelectItem>
                      {!isCascaded(mode, model) && (
                        <>
                          <SelectItem value="gpt-4o-transcribe">GPT-4o Transcribe</SelectItem>
                          <SelectItem value="gpt-4o-mini-transcribe">GPT-4o Mini Transcribe</SelectItem>
                          <SelectItem value="gpt-4o-transcribe-diarize">GPT-4o Transcribe Diarize</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Recognition Language selection - only show if cascaded/agent and not mai-transcribe-1 */}
                {isCascaded(mode, model) && srModel !== "mai-transcribe-1" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Recognition Language
                    </label>
                    <Select
                      value={recognitionLanguage}
                      onValueChange={setRecognitionLanguage}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLanguages.map((lang) => (
                          <SelectItem key={lang.id} value={lang.id}>
                            {lang.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Phrase List Component */}
                {isCascaded(mode, model) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Phrase List</label>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Add a phrase"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addPhrase(e.currentTarget.value);
                            e.currentTarget.value = "";
                          }
                        }}
                        disabled={isConnected || phraseList.length >= 10}
                      />
                      <span className="text-xs text-gray-500">
                        {phraseList.length}/10 phrases
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {phraseList.map((phrase, index) => (
                        <div
                          key={index}
                          className="flex items-center bg-gray-200 text-sm px-2 py-1 rounded"
                        >
                          <span>{phrase}</span>
                          <button
                            className="ml-2 text-red-500"
                            onClick={() => removePhrase(phrase)}
                            disabled={isConnected}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom Speech Component */}
                {isCascaded(mode, model) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Custom Speech Models</label>
                    <div className="flex items-center gap-2">
                      <Select
                        onValueChange={(key) => {
                          const value = prompt("Enter Custom Speech Model ID:");
                          if (value) {
                            addCustomSpeechModel(key, value);
                          }
                        }}
                        disabled={isConnected || Object.keys(customSpeechModels).length >= 9}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select Language" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLanguages
                            .filter((lang) => lang.id !== "auto")
                            .map((lang) => (
                              <SelectItem key={lang.id} value={lang.id}>
                                {lang.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-gray-500">
                        {Object.keys(customSpeechModels).length}/9 models
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 mt-2">
                      {Object.entries(customSpeechModels).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center bg-gray-200 text-sm px-2 py-1 rounded"
                        >
                          <span className="flex-1">
                            {availableLanguages.find((lang) => lang.id === key)?.name}: {value}
                          </span>
                          <button
                            className="ml-2 text-red-500"
                            onClick={() => removeCustomSpeechModel(key)}
                            disabled={isConnected}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Noise suppression</span>
                  <Switch
                    checked={useNS}
                    onCheckedChange={setUseNS}
                    disabled={isConnected}
                  />
                </div>
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Echo cancellation</span>
                  <Switch
                    checked={useEC}
                    onCheckedChange={setUseEC}
                    disabled={isConnected}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Turn detection</label>
                  <Select
                    value={
                      turnDetectionType === null
                        ? "none"
                        : turnDetectionType.type
                    }
                    onValueChange={(value: string) => {
                      setTurnDetectionType(
                        value === "none"
                          ? null
                          : ({ type: value } as TurnDetection)
                      );
                    }}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTurnDetection.map((td) => (
                        <SelectItem key={td.id} value={td.id}>
                          {td.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                </div>
                {isCascaded(mode, model) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">EOU detection</label>
                    <Select
                      value={eouDetectionType}
                      onValueChange={setEouDetectionType}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEouDetection.map((eou) => (
                          <SelectItem
                            key={eou.id}
                            value={eou.id}
                            disabled={eou.disabled}
                          >
                            {eou.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Model instructions - only show in model mode */}
                {mode === "model" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Model instructions
                    </label>
                    <textarea
                      className="w-full min-h-[100px] p-2 border rounded"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      disabled={isConnected}
                    />
                  </div>
                )}
                {/* Interim Response Configuration - only for cascaded models and agent mode (not supported by realtime models) */}
                {isCascaded(mode, model) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Interim response</span>
                    <Switch
                      checked={interimResponseEnabled}
                      onCheckedChange={setInterimResponseEnabled}
                      disabled={isConnected}
                    />
                  </div>
                  {interimResponseEnabled && (
                    <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Type</label>
                        <Select
                          value={interimResponseType}
                          onValueChange={(value: string) =>
                            setInterimResponseType(value as "static_interim_response" | "llm_interim_response")
                          }
                          disabled={isConnected}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="static_interim_response">Static</SelectItem>
                            <SelectItem value="llm_interim_response">LLM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Triggers</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-1 text-sm">
                            <Checkbox
                              checked={interimResponseTriggers.includes("latency")}
                              onCheckedChange={(checked) => {
                                setInterimResponseTriggers(prev =>
                                  checked
                                    ? [...prev.filter(t => t !== "latency"), "latency"]
                                    : prev.filter(t => t !== "latency")
                                );
                              }}
                              disabled={isConnected}
                            />
                            Latency
                          </label>
                          <label className="flex items-center gap-1 text-sm">
                            <Checkbox
                              checked={interimResponseTriggers.includes("tool")}
                              onCheckedChange={(checked) => {
                                setInterimResponseTriggers(prev =>
                                  checked
                                    ? [...prev.filter(t => t !== "tool"), "tool"]
                                    : prev.filter(t => t !== "tool")
                                );
                              }}
                              disabled={isConnected}
                            />
                            Tool call
                          </label>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">
                          Latency threshold (ms)
                        </label>
                        <Input
                          type="number"
                          value={interimResponseLatencyThreshold}
                          onChange={(e) => setInterimResponseLatencyThreshold(Number(e.target.value))}
                          disabled={isConnected}
                          min={500}
                          step={500}
                        />
                      </div>
                      {interimResponseType === "static_interim_response" && (
                        <div className="space-y-1">
                          <label className="text-sm font-medium">
                            Response texts (one per line)
                          </label>
                          <textarea
                            className="w-full min-h-[80px] p-2 border rounded text-sm"
                            value={interimResponseTexts}
                            onChange={(e) => setInterimResponseTexts(e.target.value)}
                            disabled={isConnected}
                            placeholder="Let me think about that...&#10;One moment please..."
                          />
                        </div>
                      )}
                      {interimResponseType === "llm_interim_response" && (
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Model</label>
                            <Input
                              value={interimResponseModel}
                              onChange={(e) => setInterimResponseModel(e.target.value)}
                              disabled={isConnected}
                              placeholder="gpt-4.1-mini"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Instructions</label>
                            <textarea
                              className="w-full min-h-[60px] p-2 border rounded text-sm"
                              value={interimResponseInstructions}
                              onChange={(e) => setInterimResponseInstructions(e.target.value)}
                              disabled={isConnected}
                              placeholder="Custom instructions for generating interim responses..."
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-sm font-medium">Max tokens</label>
                            <Input
                              type="number"
                              value={interimResponseMaxTokens}
                              onChange={(e) => setInterimResponseMaxTokens(Number(e.target.value))}
                              disabled={isConnected}
                              min={10}
                              step={10}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Enable proactive responses</span>
                  <Switch
                    checked={enableProactive}
                    onCheckedChange={setEnableProactive}
                    disabled={isConnected || enablePA}
                  />
                </div>
                {/* Tools - only show in model mode */}
                {mode === "model" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tools</label>
                    {/* Add predefined tool selection */}
                    <div className="mb-2">
                      <div className="border rounded-md">
                        <div className="p-2 font-medium">
                          Add predefined tools
                        </div>
                        <div className="border-t p-2 space-y-2 max-h-48 overflow-y-auto">
                          {predefinedTools.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-center space-x-2"
                            >
                              <input
                                type="checkbox"
                                id={tool.id}
                                className="rounded"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    if (tool.is_system_tool){
                                      setTools([...tools, tool.tool as SystemToolDeclaration]);
                                    }
                                    else {
                                      setTools([...tools, tool.tool as ToolDeclaration]);
                                    }
                                  } else {
                                    let tool_name = tool.tool.type;
                                    if ("name" in tool.tool)
                                    {
                                      tool_name = tool.tool.name;
                                    }
                                    setTools(tools.filter(t => {
                                      if ('name' in t) {
                                        // ToolDeclaration - check name
                                        return t.name !== tool_name;
                                      } else if ('type' in t) {
                                        // SystemToolDeclaration - check type
                                        return t.type !== tool_name;
                                      }
                                    }));
                                  }
                                  console.log("Tools: ", tools);
                                  if (tool.id === "search") {
                                    setEnableSearch(e.target.checked);
                                  } else if (
                                    tool.id === "pronunciation_assessment"
                                  ) {
                                    setEnablePA(e.target.checked);
                                    if (e.target.checked) {
                                      setEnableProactive(true);
                                    }
                                  }
                                }}
                                disabled={isConnected || !tool.enabled}
                                hidden={!tool.enabled}
                              />
                              <label htmlFor={tool.id} className="text-sm" hidden={!tool.enabled}>
                                {tool.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* if search enabled, let user input search endpoint, index, and key */}
                    {enableSearch && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Azure Search setting
                        </label>
                        <Input
                          placeholder="Search Endpoint"
                          value={searchEndpoint}
                          onChange={(e) => setSearchEndpoint(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Index"
                          value={searchIndex}
                          onChange={(e) => setSearchIndex(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Key"
                          value={searchApiKey}
                          onChange={(e) => setSearchApiKey(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Content Field (default: chunk)"
                          value={searchContentField}
                          onChange={(e) =>
                            setSearchContentField(e.target.value)
                          }
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Identifier Field (default: chunk_id)"
                          value={searchIdentifierField}
                          onChange={(e) =>
                            setSearchIdentifierField(e.target.value)
                          }
                          disabled={isConnected}
                        />
                      </div>
                    )}
                    {/* MCP Tools Section */}
                    <div className="mt-4">
                      <div className="border rounded-md">
                        <div className="p-2 font-medium">MCP Tools</div>
                        <div className="border-t p-2 space-y-2">
                          {/* List of configured MCP servers */}
                          {mcpServers.length > 0 && (
                            <div className="space-y-2 mb-2">
                              {mcpServers.map((server) => (
                                <div
                                  key={server.id}
                                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                                >
                                  <span className="text-sm">{server.serverLabel}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setMcpServers(mcpServers.filter((s) => s.id !== server.id));
                                    }}
                                    disabled={isConnected}
                                    className="h-6 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Add New MCP Server Button and Dialog */}
                          <Dialog open={isMcpDialogOpen} onOpenChange={setIsMcpDialogOpen}>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                disabled={isConnected}
                              >
                                Add New MCP Server
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                              <DialogHeader>
                                <DialogTitle>Add MCP Server</DialogTitle>
                                <DialogDescription>
                                  Configure a new MCP (Model Context Protocol) server connection.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="serverLabel" className="text-right">
                                    Server Label *
                                  </Label>
                                  <Input
                                    id="serverLabel"
                                    placeholder="my-mcp-server"
                                    value={newMcpServer.serverLabel}
                                    onChange={(e) =>
                                      setNewMcpServer({ ...newMcpServer, serverLabel: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="serverUrl" className="text-right">
                                    Server URL *
                                  </Label>
                                  <Input
                                    id="serverUrl"
                                    placeholder="https://example.com/mcp"
                                    value={newMcpServer.serverUrl}
                                    onChange={(e) =>
                                      setNewMcpServer({ ...newMcpServer, serverUrl: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="authorization" className="text-right">
                                    Authorization
                                  </Label>
                                  <Input
                                    id="authorization"
                                    placeholder="Bearer token or API key (optional)"
                                    value={newMcpServer.authorization}
                                    onChange={(e) =>
                                      setNewMcpServer({ ...newMcpServer, authorization: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="requireApproval" className="text-right">
                                    Require Approval
                                  </Label>
                                  <div className="col-span-3 flex items-center space-x-2">
                                    <Checkbox
                                      id="requireApproval"
                                      checked={newMcpServer.requireApproval}
                                      onCheckedChange={(checked: boolean | "indeterminate") =>
                                        setNewMcpServer({ ...newMcpServer, requireApproval: checked === true })
                                      }
                                    />
                                    <label
                                      htmlFor="requireApproval"
                                      className="text-sm text-muted-foreground"
                                    >
                                      Require approval before executing MCP tools
                                    </label>
                                  </div>
                                </div>
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setIsMcpDialogOpen(false);
                                    setNewMcpServer({
                                      serverUrl: "",
                                      authorization: "",
                                      serverLabel: "",
                                      requireApproval: false,
                                    });
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => {
                                    if (newMcpServer.serverUrl && newMcpServer.serverLabel) {
                                      const newServer: MCPServerConfig = {
                                        ...newMcpServer,
                                        id: `mcp-${Date.now()}`,
                                      };
                                      setMcpServers([...mcpServers, newServer]);
                                      setIsMcpDialogOpen(false);
                                      setNewMcpServer({
                                        serverUrl: "",
                                        authorization: "",
                                        serverLabel: "",
                                        requireApproval: false,
                                      });
                                    }
                                  }}
                                  disabled={!newMcpServer.serverUrl || !newMcpServer.serverLabel}
                                >
                                  Add Server
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </div>
                    {/* Foundry Agent Tool Section */}
                    <div className="mt-4 hidden">
                      <div className="border rounded-md">
                        <div className="p-2 font-medium">Foundry Agent Tools</div>
                        <div className="border-t p-2 space-y-2">
                          {/* List of configured Foundry Agent Tools */}
                          {foundryAgentTools.length > 0 && (
                            <div className="space-y-2 mb-2">
                              {foundryAgentTools.map((tool) => (
                                <div
                                  key={tool.id}
                                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                                >
                                  <span className="text-sm">{tool.agentName}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setFoundryAgentTools(foundryAgentTools.filter((t) => t.id !== tool.id));
                                    }}
                                    disabled={isConnected}
                                    className="h-6 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Add Foundry Tool Button and Dialog */}
                          <Dialog open={isFoundryDialogOpen} onOpenChange={setIsFoundryDialogOpen}>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                disabled={isConnected}
                              >
                                Add Foundry Tool
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                              <DialogHeader>
                                <DialogTitle>Add Foundry Agent Tool</DialogTitle>
                                <DialogDescription>
                                  Configure a new Foundry Agent Tool connection.
                                </DialogDescription>
                              </DialogHeader>
                              {/* Predefined Agent Buttons */}
                              <div className="flex gap-2 mb-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="flex-1 text-xs"
                                  onClick={() => {
                                    setNewFoundryTool({
                                      agentName: "voice-live-agent-test",
                                      agentVersion: "2",
                                      projectName: "va-dev-fdp",
                                      description: "You are a helpful agent that can search online information like weather, stock, flight status",
                                      clientId: "",
                                    });
                                  }}
                                >
                                  Weather/Stock Agent
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="flex-1 text-xs"
                                  onClick={() => {
                                    setNewFoundryTool({
                                      agentName: "zava-inventory-file-search-no-repeat",
                                      agentVersion: "4",
                                      projectName: "va-dev-fdp",
                                      description: "You are a product support agent for Zava that speaks to employees in a store over a headset.",
                                      clientId: "",
                                    });
                                  }}
                                >
                                  Zava Inventory Agent
                                </Button>
                              </div>
                              <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                  <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                  <span className="bg-background px-2 text-muted-foreground">Or configure manually</span>
                                </div>
                              </div>
                              <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="foundryAgentName" className="text-right">
                                    Agent Name *
                                  </Label>
                                  <Input
                                    id="foundryAgentName"
                                    placeholder="my-agent"
                                    value={newFoundryTool.agentName}
                                    onChange={(e) =>
                                      setNewFoundryTool({ ...newFoundryTool, agentName: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="foundryAgentVersion" className="text-right">
                                    Agent Version *
                                  </Label>
                                  <Input
                                    id="foundryAgentVersion"
                                    placeholder="1.0.0"
                                    value={newFoundryTool.agentVersion}
                                    onChange={(e) =>
                                      setNewFoundryTool({ ...newFoundryTool, agentVersion: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="foundryProjectName" className="text-right">
                                    Project Name *
                                  </Label>
                                  <Input
                                    id="foundryProjectName"
                                    placeholder="my-project"
                                    value={newFoundryTool.projectName}
                                    onChange={(e) =>
                                      setNewFoundryTool({ ...newFoundryTool, projectName: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="foundryDescription" className="text-right">
                                    Description
                                  </Label>
                                  <Input
                                    id="foundryDescription"
                                    placeholder="Optional description"
                                    value={newFoundryTool.description}
                                    onChange={(e) =>
                                      setNewFoundryTool({ ...newFoundryTool, description: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor="foundryClientId" className="text-right">
                                    Client ID
                                  </Label>
                                  <Input
                                    id="foundryClientId"
                                    placeholder="Optional client ID"
                                    value={newFoundryTool.clientId}
                                    onChange={(e) =>
                                      setNewFoundryTool({ ...newFoundryTool, clientId: e.target.value })
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setIsFoundryDialogOpen(false);
                                    setNewFoundryTool({
                                      agentName: "",
                                      agentVersion: "",
                                      projectName: "",
                                      description: "",
                                      clientId: "",
                                    });
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => {
                                    if (newFoundryTool.agentName && newFoundryTool.agentVersion && newFoundryTool.projectName) {
                                      const newTool: FoundryAgentToolConfig = {
                                        ...newFoundryTool,
                                        id: `foundry-${Date.now()}`,
                                      };
                                      setFoundryAgentTools([...foundryAgentTools, newTool]);
                                      setIsFoundryDialogOpen(false);
                                      setNewFoundryTool({
                                        agentName: "",
                                        agentVersion: "",
                                        projectName: "",
                                        description: "",
                                        clientId: "",
                                      });
                                    }
                                  }}
                                  disabled={!newFoundryTool.agentName || !newFoundryTool.agentVersion || !newFoundryTool.projectName}
                                >
                                  Add Tool
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {/* Temperature is not configurable in agent mode */}
                {mode !== "agent" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Temperature ({temperature})
                    </label>
                    <Slider
                      value={[temperature]}
                      onValueChange={([value]) => setTemperature(value)}
                      min={isCascaded(mode, model) ? 0 : 0.6}
                      max={isCascaded(mode, model) ? 1.0 : 1.2}
                      step={0.1}
                      disabled={isConnected}
                    />
                  </div>
                )}

                {/* Voice Configuration Section */}
                <div className="p-4 border-2 border-gray-200 rounded-lg bg-gray-50/50 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Voice Type</label>
                    <Select
                      value={voiceType}
                      onValueChange={(value: string) => setVoiceType(value as "standard" | "custom" | "personal" | "azure-realtime-native")}
                      disabled={isConnected}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard Voices</SelectItem>
                        <SelectItem value="custom">Custom Voice</SelectItem>
                        <SelectItem value="personal">Personal Voice</SelectItem>
                        {isAvatar && isCustomAvatar && (
                          <SelectItem value="avatar-voice-sync">Avatar Voice Sync</SelectItem>
                        )}
                        {model === "azure-realtime" && (
                          <SelectItem value="azure-realtime-native">Azure Realtime Native</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {voiceType === "azure-realtime-native" && (
                    <div className="space-y-2 pl-2 border-l-2 border-teal-200">
                      <label className="text-sm font-medium text-gray-700">Voice</label>
                      <Select
                        value={voiceName || "ava"}
                        onValueChange={setVoiceName}
                        disabled={isConnected}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="aarti">Aarti</SelectItem>
                          <SelectItem value="andrew">Andrew</SelectItem>
                          <SelectItem value="ava">Ava</SelectItem>
                          <SelectItem value="denise">Denise</SelectItem>
                          <SelectItem value="elsa">Elsa</SelectItem>
                          <SelectItem value="florian">Florian</SelectItem>
                          <SelectItem value="francisca">Francisca</SelectItem>
                          <SelectItem value="meera">Meera</SelectItem>
                          <SelectItem value="xiaoxiao">Xiaoxiao</SelectItem>
                          <SelectItem value="ximena">Ximena</SelectItem>
                          <SelectItem value="yunxi">Yunxi</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {voiceType === "avatar-voice-sync" && (
                    <div className="space-y-3 pl-2 border-l-2 border-orange-200">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Voice Model</label>
                        <Select
                          value={avatarVoiceSyncModel}
                          onValueChange={(value: string) => setAvatarVoiceSyncModel(value as "DragonLatestNeural" | "DragonHDOmniLatestNeural" | "mai-voice-1")}
                          disabled={isConnected}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DragonLatestNeural">Dragon</SelectItem>
                            <SelectItem value="DragonHDOmniLatestNeural">Dragon Omni</SelectItem>
                            <SelectItem value="mai-voice-1">MAI Voice 1</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {voiceType === "custom" && (
                    <div className="space-y-3 pl-2 border-l-2 border-blue-200">
                      <Input
                        placeholder="Voice Deployment ID"
                        value={voiceDeploymentId}
                        onChange={(e) => setVoiceDeploymentId(e.target.value)}
                        disabled={isConnected}
                        className="bg-white"
                      />
                      <Input
                        placeholder="Voice"
                        value={customVoiceName}
                        onChange={(e) => setCustomVoiceName(e.target.value)}
                        disabled={isConnected}
                        className="bg-white"
                      />
                    </div>
                  )}

                  {voiceType === "personal" && (
                    <div className="space-y-3 pl-2 border-l-2 border-green-200">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Personal Voice</label>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (!endpoint) return;
                              setIsFetchingPersonalVoices(true);
                              try {
                                const baseUrl = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
                                const url = `${baseUrl}/customvoice/personalvoices?api-version=2024-02-01-preview`;
                                const headers: Record<string, string> = {};
                                if (entraToken) {
                                  headers["Authorization"] = `Bearer ${entraToken}`;
                                } else if (apiKey) {
                                  headers["Ocp-Apim-Subscription-Key"] = apiKey;
                                }
                                const res = await fetch(url, { headers });
                                if (!res.ok) {
                                  throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
                                }
                                const data = await res.json();
                                const voices: PersonalVoiceInfo[] = (data.value || []).map((v: any) => ({
                                  id: v.id,
                                  displayName: v.displayName || v.id,
                                  status: v.status,
                                }));
                                setPersonalVoices(voices);
                                if (voices.length > 0 && !personalVoiceName) {
                                  setPersonalVoiceName(voices[0].id);
                                }
                              } catch (error) {
                                console.error("Failed to fetch personal voices:", error);
                                setMessages((prev) => [
                                  ...prev,
                                  { type: "error", content: `Failed to fetch personal voices: ${error}` },
                                ]);
                              } finally {
                                setIsFetchingPersonalVoices(false);
                              }
                            }}
                            disabled={isConnected || !endpoint || isFetchingPersonalVoices}
                            className="whitespace-nowrap"
                          >
                            {isFetchingPersonalVoices ? "Fetching..." : "Fetch Voices"}
                          </Button>
                        </div>
                        {personalVoices.length > 0 ? (
                          <Select
                            value={personalVoiceName}
                            onValueChange={setPersonalVoiceName}
                            disabled={isConnected}
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Select a personal voice" />
                            </SelectTrigger>
                            <SelectContent>
                              {personalVoices.map((voice) => (
                                <SelectItem key={voice.id} value={voice.id}>
                                  {voice.displayName || voice.id} ({voice.status})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="Personal voice name (or fetch voices above)"
                            value={personalVoiceName}
                            onChange={(e) => setPersonalVoiceName(e.target.value)}
                            disabled={isConnected}
                            className="bg-white"
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Personal Voice Model</label>
                        <Select
                          value={personalVoiceModel}
                          onValueChange={(value: string) => setPersonalVoiceModel(value as "DragonLatestNeural" | "DragonHDOmniLatestNeural" | "mai-voice-1")}
                          disabled={isConnected}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DragonLatestNeural">Dragon</SelectItem>
                            <SelectItem value="DragonHDOmniLatestNeural">Dragon Omni</SelectItem>
                            <SelectItem value="mai-voice-1">MAI Voice 1</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {voiceType === "standard" && (
                    <div className="space-y-2 pl-2 border-l-2 border-purple-200">
                      <label className="text-sm font-medium text-gray-700">Voice</label>
                      <Select
                        value={availableVoices.some((v) => v.id === voiceName) ? voiceName : "__custom__"}
                        onValueChange={(value) => {
                          if (value === "__custom__") {
                            setVoiceName("");
                          } else {
                            setVoiceName(value);
                          }
                        }}
                        disabled={isConnected}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableVoices
                            .filter(
                              (voice) =>
                                !(
                                  isCascaded(mode, model) && !voice.id.includes("-")
                                )
                            )
                            .map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name}
                              </SelectItem>
                            ))}
                          <SelectItem value="__custom__">Custom voice name...</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Or type any voice name"
                        value={availableVoices.some((v) => v.id === voiceName) ? "" : voiceName}
                        onChange={(e) => setVoiceName(e.target.value)}
                        disabled={isConnected}
                        className="bg-white"
                      />
                    </div>
                  )}

                  {/* Voice Temperature Slider */}
                  {((voiceType === "avatar-voice-sync") ||
                    (voiceType === "custom" &&
                    customVoiceName.toLowerCase().includes("dragonhd")) ||
                    (voiceType === "personal") ||
                    (voiceType === "standard" &&
                      voiceName.toLowerCase().includes("dragonhd"))) && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      <label className="text-sm font-medium text-gray-700">
                        Voice Temperature ({voiceTemperature})
                      </label>
                      <Slider
                        value={[voiceTemperature]}
                        onValueChange={([value]) => setVoiceTemperature(value)}
                        min={0.0}
                        max={1.0}
                        step={0.1}
                        disabled={isConnected}
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Voice Speed Slider */}
                  {(voiceType !== "standard" || voiceName.includes("-") || voiceName.includes(":")) && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      <label className="text-sm font-medium text-gray-700">
                        Voice Speed ({Math.round(voiceSpeed * 100)}%)
                      </label>
                      <Slider
                        value={[voiceSpeed]}
                        onValueChange={([value]) => setVoiceSpeed(value)}
                        min={0.5}
                        max={1.5}
                        step={0.1}
                        disabled={isConnected}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span style={{ marginRight: 10 }}>Avatar</span>
                      <Switch
                        checked={isAvatar}
                        onCheckedChange={(checked: boolean) =>
                          setIsAvatar(checked)
                        }
                        disabled={isConnected}
                      />
                    </div>
                    {isAvatar && (
                      <div className="flex items-center">
                        <span style={{ marginRight: 10 }}>
                          Use Photo Avatar
                        </span>
                        <Switch
                          checked={isPhotoAvatar}
                          onCheckedChange={(checked: boolean) => {
                            setIsPhotoAvatar(checked);
                          }}
                          disabled={isConnected}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {isAvatar && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Avatar Output Mode</label>
                    <Select
                      value={avatarOutputMode}
                      onValueChange={(value: string) => setAvatarOutputMode(value as "webrtc" | "websocket")}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="webrtc">WebRTC</SelectItem>
                        <SelectItem value="websocket">WebSocket</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      WebRTC provides real-time streaming. WebSocket mode streams video data over the WebSocket connection.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    {isAvatar && (
                      <div className="flex items-center">
                        <span style={{ marginRight: 10 }}>
                          Use Custom Avatar
                        </span>
                        <Switch
                          checked={isCustomAvatar}
                          onCheckedChange={(checked: boolean) =>
                            setIsCustomAvatar(checked)
                          }
                          disabled={isConnected}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {isAvatar && !isCustomAvatar && !isPhotoAvatar && (
                    <Select
                      value={avatarName}
                      onValueChange={setAvatarName}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {avatarNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {isAvatar && !isCustomAvatar && isPhotoAvatar && (
                    <Select
                      value={photoAvatarName}
                      onValueChange={setPhotoAvatarName}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {photoAvatarNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {isAvatar && isCustomAvatar && (
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!endpoint) return;
                          setIsFetchingCustomAvatars(true);
                          try {
                            const baseUrl = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
                            const url = isPhotoAvatar
                              ? `${baseUrl}/customavatar/endpoints?kind=PhotoAvatar&api-version=2023-12-01-preview`
                              : `${baseUrl}/customavatar/endpoints?api-version=2023-12-01-preview`;
                            const headers: Record<string, string> = {};
                            if (entraToken) {
                              headers["Authorization"] = `Bearer ${entraToken}`;
                            } else if (apiKey) {
                              headers["Ocp-Apim-Subscription-Key"] = apiKey;
                            }
                            const res = await fetch(url, { headers });
                            if (!res.ok) {
                              throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
                            }
                            const data = await res.json();
                            const avatars: CustomAvatarInfo[] = (data.value || []).map((v: any) => ({
                              id: v.id,
                              description: v.description || v.id,
                              state: v.state,
                              previewImageUrl: v.previewImages?.square?.location || v.previewImages?.wide?.location,
                            }));
                            setCustomAvatars(avatars);
                            if (avatars.length > 0 && !customAvatarName) {
                              setCustomAvatarName(avatars[0].id);
                            }
                          } catch (error) {
                            console.error("Failed to fetch custom avatars:", error);
                            setMessages((prev) => [
                              ...prev,
                              { type: "error", content: `Failed to fetch custom avatars: ${error}` },
                            ]);
                          } finally {
                            setIsFetchingCustomAvatars(false);
                          }
                        }}
                        disabled={isConnected || !endpoint || isFetchingCustomAvatars}
                        className="whitespace-nowrap"
                      >
                        {isFetchingCustomAvatars ? "Fetching..." : "Fetch Custom Avatars"}
                      </Button>
                      {customAvatars.length > 0 ? (
                        <>
                        <Select
                          value={customAvatarName}
                          onValueChange={setCustomAvatarName}
                          disabled={isConnected}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a custom avatar" />
                          </SelectTrigger>
                          <SelectContent>
                            {customAvatars.map((avatar) => (
                              <SelectItem key={avatar.id} value={avatar.id}>
                                <div className="flex items-center gap-2">
                                  {avatar.previewImageUrl && (
                                    <img
                                      src={avatar.previewImageUrl}
                                      alt={avatar.id}
                                      className="w-6 h-6 rounded object-cover"
                                    />
                                  )}
                                  <span>{avatar.id} ({avatar.state})</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(() => {
                          const selected = customAvatars.find((a) => a.id === customAvatarName);
                          return selected?.previewImageUrl ? (
                            <img
                              src={selected.previewImageUrl}
                              alt={selected.id}
                              className="w-full max-w-[200px] rounded border mt-1"
                            />
                          ) : null;
                        })()}
                        </>
                      ) : (
                        <Input
                          placeholder="Character (or fetch avatars above)"
                          value={customAvatarName}
                          onChange={(e) => setCustomAvatarName(e.target.value)}
                          disabled={isConnected}
                        />
                      )}
                    </div>
                  )}
                </div>
                {isAvatar && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Avatar Background Image URL</label>
                    <Input
                      placeholder="Enter avatar background image URL"
                      value={avatarBackgroundImageUrl}
                      onChange={(e) => setAvatarBackgroundImageUrl(e.target.value)}
                      disabled={isConnected}
                    />
                  </div>
                )}
                {isAvatar && isPhotoAvatar && (
                  <div className="space-y-4 mt-4">
                    <label className="text-sm font-medium">Scene Settings {isConnected && "(Live Adjustable)"}</label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Zoom: {sceneZoom.toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[sceneZoom]}
                        onValueChange={(value) => {
                          setSceneZoom(value[0]);
                          updateAvatarScene();
                        }}
                        min={70}
                        max={100}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Position X: {scenePositionX.toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[scenePositionX]}
                        onValueChange={(value) => {
                          setScenePositionX(value[0]);
                          updateAvatarScene();
                        }}
                        min={-50}
                        max={50}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Position Y: {scenePositionY.toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[scenePositionY]}
                        onValueChange={(value) => {
                          setScenePositionY(value[0]);
                          updateAvatarScene();
                        }}
                        min={-50}
                        max={50}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Rotation X: {sceneRotationX.toFixed(0)} deg</span>
                      </div>
                      <Slider
                        value={[sceneRotationX]}
                        onValueChange={(value) => {
                          setSceneRotationX(value[0]);
                          updateAvatarScene();
                        }}
                        min={-30}
                        max={30}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Rotation Y: {sceneRotationY.toFixed(0)} deg</span>
                      </div>
                      <Slider
                        value={[sceneRotationY]}
                        onValueChange={(value) => {
                          setSceneRotationY(value[0]);
                          updateAvatarScene();
                        }}
                        min={-30}
                        max={30}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Rotation Z: {sceneRotationZ.toFixed(0)} deg</span>
                      </div>
                      <Slider
                        value={[sceneRotationZ]}
                        onValueChange={(value) => {
                          setSceneRotationZ(value[0]);
                          updateAvatarScene();
                        }}
                        min={-30}
                        max={30}
                        step={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Amplitude: {sceneAmplitude.toFixed(0)}%</span>
                      </div>
                      <Slider
                        value={[sceneAmplitude]}
                        onValueChange={(value) => {
                          setSceneAmplitude(value[0]);
                          updateAvatarScene();
                        }}
                        min={10}
                        max={100}
                        step={1}
                      />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Connect Button and Download Recording Button */}
        <div className="mt-4 space-y-2">
          <Button
            className="w-full"
            variant={isConnected ? "destructive" : "default"}
            onClick={handleConnect}
            disabled={isConnecting}
          >
            <Power className="w-4 h-4 mr-2" />
            {isConnecting
              ? "Connecting..."
              : isConnected
                ? "Disconnect"
                : "Connect"}
          </Button>

          {hasRecording && !isConnected && (
            <Button
              className="w-full"
              variant="outline"
              onClick={downloadRecording}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download Recording
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          {/* Settings */}
          {isMobile && (
            <div
              className="flex items-center settings"
              role="button"
              onClick={handleSettings}
            >
              <span className="settings-svg">{settingsSvg()}</span>
              <span>Settings</span>
            </div>
          )}

          {/* Developer Mode */}
          <div className="flex items-center">
            <span className="developer-mode">Developer mode</span>
            <Switch
              checked={isDevelop}
              onCheckedChange={(checked: boolean) => setIsDevelop(checked)}
            />
          </div>

          {/* Clear Chat */}
          <div>
            <button
              style={{ opacity: messages.length > 0 ? "" : "0.5" }}
              onClick={() => messages.length > 0 && setMessages([])}
            >
              {clearChatSvg()}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={`flex ${isDevelop ? "developer-content" : "content"}`}>
          {isConnected &&
            (isEnableAvatar ? (
              <>
                {/* Video Window */}
                <div
                  ref={videoRef}
                  className={`flex flex-1 justify-center items-center`}
                ></div>
              </>
            ) : (
              <>
                {/* Animation Window */}
                <div className="flex flex-1 justify-center items-center">
                  <div
                    key="volume-circle"
                    ref={animationRef}
                    className="volume-circle"
                  ></div>
                  <div className="robot-svg">{robotSvg()}</div>
                </div>
              </>
            ))}

          {(isDevelop || !isConnected) && (
            <>
              {/* Chat Window */}
              <div className="flex flex-1 flex-col">
                {/* Messages Area */}
                <div
                  id="messages-area"
                  className="flex-1 p-4 overflow-y-auto messages-area"
                >
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`mb-4 p-3 rounded-lg ${getMessageClassNames(message.type)}`}
                    >
                      {message.type === "mcp_approval" && message.mcpApproval ? (
                        <div className="flex flex-col gap-2">
                          <div className="font-semibold text-purple-700">{message.content}</div>
                          <div className="text-sm">
                            <div><strong>Server:</strong> {message.mcpApproval.serverLabel}</div>
                            <div><strong>Tool:</strong> {message.mcpApproval.name}</div>
                            <div><strong>Arguments:</strong> <code className="bg-gray-200 px-1 rounded text-xs">{message.mcpApproval.arguments}</code></div>
                          </div>
                          {!message.mcpApproval.handled ? (
                            <div className="flex gap-2 mt-2">
                              <Button
                                size="sm"
                                className="bg-green-500 hover:bg-green-600 text-white"
                                onClick={() => handleMcpApprovalResponse(message.id!, true)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-500 text-red-500 hover:bg-red-50"
                                onClick={() => handleMcpApprovalResponse(message.id!, false)}
                              >
                                Deny
                              </Button>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500 italic mt-1">Response sent</div>
                          )}
                        </div>
                      ) : message.type === "foundry_agent" && message.foundryAgent ? (
                        <div className="flex flex-col gap-2">
                          <div className="font-semibold text-blue-700">{message.content}</div>
                          <div className="text-sm">
                            {message.foundryAgent.arguments && (
                              <div><strong>Arguments:</strong> <code className="bg-gray-200 px-1 rounded text-xs">{message.foundryAgent.arguments}</code></div>
                            )}
                            {message.foundryAgent.agentResponseId && (
                              <div><strong>Agent Response ID:</strong> <code className="bg-gray-200 px-1 rounded text-xs">{message.foundryAgent.agentResponseId}</code></div>
                            )}
                            {message.foundryAgent.output && (
                              <div><strong>Output:</strong> <code className="bg-gray-200 px-1 rounded text-xs whitespace-pre-wrap">{message.foundryAgent.output}</code></div>
                            )}
                          </div>
                        </div>
                      ) : (
                        message.content
                      )}
                    </div>
                  ))}
                </div>
                {isDevelop && (
                  <>
                    {/* Input Area */}
                    <div className="p-4 border-t">
                      <div className="flex gap-2">
                        <Input
                          value={currentMessage}
                          onChange={(e) => setCurrentMessage(e.target.value)}
                          placeholder="Type your message..."
                          onKeyUp={(e) => e.key === "Enter" && sendMessage()}
                          disabled={!isConnected}
                        />
                        <Button
                          variant="outline"
                          onClick={toggleRecording}
                          className={isRecording ? "bg-red-100" : ""}
                          disabled={!isConnected}
                        >
                          {isRecording ? recordingSvg() : offSvg()}
                        </Button>
                        <Button onClick={sendMessage} disabled={!isConnected}>
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isDevelop && (
          <>
            {/* Record Button */}
            <div className="flex flex-1 justify-center items-center">
              <div className="flex justify-center items-center recording-border">
                {isConnected && isEnableAvatar && isRecording && (
                  <div className="flex justify-center items-center sound-wave">
                    <div className="sound-wave-item" id="item-0"></div>
                    <div className="sound-wave-item" id="item-1"></div>
                    <div className="sound-wave-item" id="item-2"></div>
                    <div className="sound-wave-item" id="item-3"></div>
                    <div className="sound-wave-item" id="item-4"></div>
                    <div className="sound-wave-item" id="item-5"></div>
                    <div className="sound-wave-item" id="item-6"></div>
                    <div className="sound-wave-item" id="item-7"></div>
                    <div className="sound-wave-item" id="item-8"></div>
                    <div className="sound-wave-item" id="item-9"></div>
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={toggleRecording}
                  className={isRecording ? "bg-red-100" : ""}
                  disabled={!isConnected}
                >
                  {isRecording ? (
                    <div className="flex justify-center items-center">
                      {recordingSvg()}
                      <span className="microphone">Turn off microphone</span>
                    </div>
                  ) : (
                    <div className="flex justify-center items-center">
                      {offSvg()}
                      <span className="microphone">Turn on microphone</span>
                    </div>
                  )}
                </Button>
                {isConnected && isEnableAvatar && isRecording && (
                  <div className="flex justify-center items-center sound-wave sound-wave2">
                    <div className="sound-wave-item" id="item-10"></div>
                    <div className="sound-wave-item" id="item-11"></div>
                    <div className="sound-wave-item" id="item-12"></div>
                    <div className="sound-wave-item" id="item-13"></div>
                    <div className="sound-wave-item" id="item-14"></div>
                    <div className="sound-wave-item" id="item-15"></div>
                    <div className="sound-wave-item" id="item-16"></div>
                    <div className="sound-wave-item" id="item-17"></div>
                    <div className="sound-wave-item" id="item-18"></div>
                    <div className="sound-wave-item" id="item-19"></div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;
