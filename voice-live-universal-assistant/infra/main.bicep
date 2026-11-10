targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment (e.g., dev, prod)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Azure Voice Live API endpoint')
param voiceLiveEndpoint string = ''

@secure()
@description('Azure Voice Live API key')
param voiceLiveApiKey string = ''

@description('Connection mode: agent or model')
@allowed(['agent', 'model'])
param voiceLiveMode string = 'agent'

@description('Agent name for Foundry Agent Service (agent mode)')
param voiceLiveAgentName string = ''

@description('Project name for Foundry Agent Service (agent mode)')
param voiceLiveProject string = ''

@description('Model name for direct model access (model mode)')
param voiceLiveModel string = 'gpt-realtime'

@description('Voice name for TTS')
param voiceLiveVoice string = 'en-US-Ava:DragonHDLatestNeural'

@description('Voice type: openai or azure-standard')
@allowed(['openai', 'azure-standard'])
param voiceLiveVoiceType string = 'azure-standard'

@description('Transcription model')
param voiceLiveTranscribeModel string = 'gpt-4o-transcribe'

// --- Optional Foundry provisioning ---
@description('Create a new AI Foundry account and project (default: false — use existing endpoint)')
param createFoundry bool = false

@description('Foundry account name (used when createFoundry=true)')
param foundryAccountName string = ''

@description('Foundry project name (used when createFoundry=true)')
param foundryProjectName string = 'voicelive-project'

// --- Optional Agent provisioning (implies createFoundry) ---
@description('Create a Foundry Agent with Voice Live config and deploy GPT-4.1-mini (default: false)')
param createAgent bool = false

@description('Model deployment name for the agent (used when createAgent=true)')
param agentModelDeploymentName string = 'gpt-4.1-mini'

@description('Agent name (used when createAgent=true)')
param agentName string = 'voicelive-assistant'

@description('Backend language for Dockerfile selection (e.g., python, csharp, java, javascript)')
param backendLanguage string = 'python'

@description('Allow unauthenticated /ws connections. Keep false: the postprovision hook enables Container Apps authentication (Microsoft Entra ID) so only signed-in users can start sessions.')
param allowAnonymous bool = false

// createAgent implies createFoundry
var effectiveCreateFoundry = createFoundry || createAgent

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  'app-name': 'voicelive-web-sample'
}

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module infrastructure 'main-infrastructure.bicep' = {
  name: 'infrastructure'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

// --- Optional: AI Foundry account + project ---
var effectiveFoundryAccountName = !empty(foundryAccountName) ? foundryAccountName : 'ai-${resourceToken}'
var effectiveFoundryProjectName = foundryProjectName

// Model deployments: GPT-4.1-mini when createAgent (required for Foundry Agent).
// Model-mode uses gpt-realtime which is routed server-side by the Voice Live service
// and does NOT need a Cognitive Services model deployment.
var modelDeployments = createAgent ? [
  {
    name: agentModelDeploymentName
    model: 'gpt-4.1-mini'
    capacity: 1
  }
] : []

module foundry './modules/foundry.bicep' = if (effectiveCreateFoundry) {
  name: 'foundry'
  scope: rg
  params: {
    accountName: effectiveFoundryAccountName
    location: location
    tags: tags
    projectName: effectiveFoundryProjectName
    modelDeployments: modelDeployments
  }
}

module foundryRbac './modules/foundry-rbac.bicep' = if (effectiveCreateFoundry) {
  name: 'foundry-rbac'
  scope: rg
  params: {
    foundryAccountName: effectiveFoundryAccountName
    foundryProjectPrincipalId: foundry.outputs.projectPrincipalId
  }
}

// Resolve values from provisioned Foundry or user-provided settings
var resolvedEndpoint = effectiveCreateFoundry ? foundry.outputs.accountEndpoint : voiceLiveEndpoint
var resolvedProjectEndpoint = effectiveCreateFoundry ? foundry.outputs.projectEndpoint : voiceLiveEndpoint
var resolvedMode = createAgent ? 'agent' : (effectiveCreateFoundry ? 'model' : voiceLiveMode)
var resolvedAgentName = createAgent ? agentName : voiceLiveAgentName
var resolvedProject = effectiveCreateFoundry ? effectiveFoundryProjectName : voiceLiveProject
var resolvedModel = effectiveCreateFoundry && !createAgent ? 'gpt-realtime' : voiceLiveModel

module app 'main-app.bicep' = {
  name: 'app'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    containerAppsEnvironmentId: infrastructure.outputs.containerAppsEnvironmentId
    containerRegistryName: infrastructure.outputs.containerRegistryName
    voiceLiveEndpoint: resolvedEndpoint
    voiceLiveApiKey: voiceLiveApiKey
    voiceLiveMode: resolvedMode
    voiceLiveAgentName: resolvedAgentName
    voiceLiveProject: resolvedProject
    voiceLiveModel: resolvedModel
    voiceLiveVoice: voiceLiveVoice
    voiceLiveVoiceType: voiceLiveVoiceType
    voiceLiveTranscribeModel: voiceLiveTranscribeModel
    voiceLiveProjectEndpoint: resolvedProjectEndpoint
    allowAnonymous: allowAnonymous
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = infrastructure.outputs.containerRegistryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = infrastructure.outputs.containerRegistryName
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = infrastructure.outputs.containerAppsEnvironmentId
output AZURE_RESOURCE_GROUP_NAME string = rg.name
output AZURE_CONTAINER_APP_NAME string = app.outputs.webAppName
output WEB_ENDPOINT string = app.outputs.webEndpoint
output WEB_IDENTITY_PRINCIPAL_ID string = app.outputs.webIdentityPrincipalId

// Foundry outputs (empty strings when Foundry not provisioned)
output FOUNDRY_PROJECT_ENDPOINT string = effectiveCreateFoundry ? foundry.outputs.projectEndpoint : ''
output FOUNDRY_ACCOUNT_NAME string = effectiveCreateFoundry ? foundry.outputs.accountName : ''
output FOUNDRY_PROJECT_PRINCIPAL_ID string = effectiveCreateFoundry ? foundry.outputs.projectPrincipalId : ''

// Agent provisioning flags
output CREATE_FOUNDRY string = string(effectiveCreateFoundry)
output CREATE_AGENT string = string(createAgent)
output AGENT_MODEL_DEPLOYMENT_NAME string = createAgent ? agentModelDeploymentName : ''
output AGENT_NAME string = createAgent ? agentName : ''

// Backend language selection
output BACKEND_LANGUAGE string = backendLanguage
output VOICELIVE_ALLOW_ANONYMOUS string = string(allowAnonymous)
